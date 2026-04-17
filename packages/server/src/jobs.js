/**
 * Background job queue — pluggable backend with convention-over-configuration.
 *
 * Define named jobs, enqueue them from request handlers, and process them
 * asynchronously. Jobs survive server restarts when backed by Redis.
 *
 * Convention over configuration:
 *   - `REDIS_URL` in the environment → Redis queue (reliable, multi-instance)
 *   - Otherwise → in-memory queue (same event loop, great for dev)
 *
 * ```js
 * // jobs/email.js
 * import { defineJob } from '@webjs/server';
 *
 * defineJob('sendWelcomeEmail', async (data, { signal }) => {
 *   await sendEmail({ to: data.email, subject: 'Welcome!' });
 * });
 *
 * // handler.js
 * import { enqueue } from '@webjs/server';
 *
 * export async function POST(req) {
 *   const body = await req.json();
 *   await enqueue('sendWelcomeEmail', { email: body.email });
 *   return new Response('OK');
 * }
 * ```
 *
 * In development, jobs run immediately in-process. In production with Redis,
 * call `startWorker()` in a dedicated worker process for reliable background
 * processing.
 *
 * @module jobs
 */

/**
 * @typedef {Object} Queue
 * @property {(name: string, data: unknown, opts?: { delay?: number, priority?: number }) => Promise<void>} enqueue
 * @property {(name: string, handler: (data: unknown, ctx: { signal: AbortSignal }) => Promise<void>) => void} process
 */

// ---------------------------------------------------------------------------
// Job registry (shared across all backends)
// ---------------------------------------------------------------------------

/** @type {Map<string, (data: unknown, ctx: { signal: AbortSignal }) => Promise<void>>} */
const handlers = new Map();

/**
 * Register a named job handler. Call this at module load time (top-level).
 * The handler receives the job data and a context with an `AbortSignal` for
 * graceful shutdown.
 *
 * @param {string} name
 * @param {(data: unknown, ctx: { signal: AbortSignal }) => Promise<void>} handler
 */
export function defineJob(name, handler) {
  if (handlers.has(name)) throw new Error(`Job "${name}" is already defined`);
  handlers.set(name, handler);
}

// ---------------------------------------------------------------------------
// In-memory queue
// ---------------------------------------------------------------------------

/**
 * In-memory job queue. Jobs execute in the same event loop via `setTimeout`.
 * No persistence, no retries — ideal for development and simple workloads.
 *
 * @returns {Queue}
 */
export function memoryQueue() {
  const ac = new AbortController();

  return {
    async enqueue(name, data, opts = {}) {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`No handler registered for job "${name}"`);
      const delay = opts.delay || 0;

      const timer = setTimeout(async () => {
        try {
          await handler(data, { signal: ac.signal });
        } catch (err) {
          // In dev: log and swallow so the server doesn't crash
          console.error(`[jobs] "${name}" failed:`, err);
        }
      }, delay);

      // Don't keep the process alive for queued jobs
      if (timer && typeof timer === 'object' && 'unref' in timer) {
        timer.unref();
      }
    },

    process(name, handler) {
      handlers.set(name, handler);
    },
  };
}

// ---------------------------------------------------------------------------
// Redis queue
// ---------------------------------------------------------------------------

/**
 * Redis-backed job queue using the LPUSH/BRPOP pattern. Jobs are serialized
 * as JSON into Redis lists, one list per job name. Reliable: jobs survive
 * server restarts and can be processed by dedicated worker instances.
 *
 * Does **not** depend on BullMQ — uses raw Redis commands for simplicity.
 *
 * Requires `ioredis` or `redis` package to be installed.
 *
 * @param {{ url?: string, prefix?: string }} [opts]
 * @returns {Queue}
 */
export function redisQueue(opts = {}) {
  const url = opts.url || process.env.REDIS_URL;
  if (!url) throw new Error('redisQueue requires REDIS_URL environment variable or opts.url');
  const prefix = opts.prefix || 'webjs:job:';

  /** @type {any} */
  let client = null;
  /** @type {Promise<any> | null} */
  let connecting = null;
  /** @type {string | null} */
  let driverType = null;

  async function getClient() {
    if (client) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      try {
        const { default: Redis } = await import('ioredis');
        client = new Redis(url);
        driverType = 'ioredis';
        return client;
      } catch { /* ioredis not available */ }
      try {
        const { createClient } = await import('redis');
        client = createClient({ url });
        await client.connect();
        driverType = 'redis';
        return client;
      } catch { /* redis not available */ }
      throw new Error('Install a Redis client: npm install ioredis (or npm install redis)');
    })();
    return connecting;
  }

  return {
    async enqueue(name, data, enqueueOpts = {}) {
      const c = await getClient();
      const payload = JSON.stringify({
        name,
        data,
        priority: enqueueOpts.priority || 0,
        createdAt: Date.now(),
      });

      if (enqueueOpts.delay && enqueueOpts.delay > 0) {
        // Delayed job: use a sorted set with score = executeAt timestamp
        const executeAt = Date.now() + enqueueOpts.delay;
        if (driverType === 'ioredis') {
          await c.zadd(`${prefix}delayed`, executeAt, payload);
        } else {
          await c.zAdd(`${prefix}delayed`, { score: executeAt, value: payload });
        }
      } else {
        // Immediate job: push to list
        await c.lpush(`${prefix}${name}`, payload);
      }
    },

    process(name, handler) {
      handlers.set(name, handler);
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-detect
// ---------------------------------------------------------------------------

/**
 * Auto-detect the best queue backend based on environment.
 * `REDIS_URL` → Redis queue, otherwise → in-memory queue.
 *
 * @returns {Queue}
 */
export function autoQueue() {
  if (process.env.REDIS_URL) return redisQueue();
  return memoryQueue();
}

// ---------------------------------------------------------------------------
// Global default
// ---------------------------------------------------------------------------

/** @type {Queue | null} */
let _default = null;

/**
 * Get the default queue (auto-detected on first call).
 * @returns {Queue}
 */
export function getQueue() {
  if (!_default) _default = autoQueue();
  return _default;
}

/**
 * Override the default queue.
 * @param {Queue} q
 */
export function setQueue(q) {
  _default = q;
}

// ---------------------------------------------------------------------------
// Convenience: enqueue on the default queue
// ---------------------------------------------------------------------------

/**
 * Add a job to the default queue.
 *
 * @param {string} name — must match a name passed to {@link defineJob}
 * @param {unknown} data — JSON-serializable payload
 * @param {{ delay?: number, priority?: number }} [opts]
 * @returns {Promise<void>}
 */
export async function enqueue(name, data, opts) {
  return getQueue().enqueue(name, data, opts);
}

// ---------------------------------------------------------------------------
// Worker loop
// ---------------------------------------------------------------------------

/**
 * Start processing jobs. In dev mode with memoryQueue this is a no-op
 * (jobs run inline). With redisQueue this starts a blocking BRPOP loop
 * for all registered job names.
 *
 * Call this in a dedicated worker process for production deployments:
 * ```js
 * import './jobs/email.js';       // registers handlers via defineJob()
 * import './jobs/thumbnail.js';
 * import { startWorker } from '@webjs/server';
 * startWorker();
 * ```
 *
 * @param {{ concurrency?: number, pollInterval?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<void>} resolves when the worker is stopped (via signal)
 */
export async function startWorker(opts = {}) {
  const queue = getQueue();

  // Memory queue: jobs run inline, nothing to poll
  if (/** @type {any} */ (queue)._memoryQueue) return;

  const concurrency = opts.concurrency || 1;
  const pollInterval = opts.pollInterval || 1000;
  const signal = opts.signal || new AbortController().signal;

  // Resolve the redis client from the queue's internal state
  // For redis queue, we need our own blocking client
  const url = process.env.REDIS_URL;
  if (!url) return; // Memory mode — nothing to do

  const prefix = 'webjs:job:';

  /** @type {any} */
  let blockClient = null;

  try {
    const { default: Redis } = await import('ioredis');
    blockClient = new Redis(url);
  } catch {
    try {
      const { createClient } = await import('redis');
      blockClient = createClient({ url });
      await blockClient.connect();
    } catch {
      throw new Error('Install a Redis client: npm install ioredis (or npm install redis)');
    }
  }

  const jobNames = [...handlers.keys()];
  if (jobNames.length === 0) {
    console.warn('[jobs] startWorker() called but no job handlers are registered');
    return;
  }

  const keys = jobNames.map((n) => `${prefix}${n}`);
  let active = 0;

  /** Process delayed jobs: move any due items from the sorted set to their lists */
  async function promoteDelayed() {
    try {
      const now = Date.now();
      // ZRANGEBYSCORE to find due jobs
      let due;
      if (typeof blockClient.zrangebyscore === 'function') {
        due = await blockClient.zrangebyscore(`${prefix}delayed`, 0, now);
      } else if (typeof blockClient.zRangeByScore === 'function') {
        due = await blockClient.zRangeByScore(`${prefix}delayed`, 0, now);
      } else {
        return;
      }
      for (const raw of due) {
        const job = JSON.parse(raw);
        await blockClient.lpush(`${prefix}${job.name}`, raw);
        if (typeof blockClient.zrem === 'function') {
          await blockClient.zrem(`${prefix}delayed`, raw);
        } else {
          await blockClient.zRem(`${prefix}delayed`, raw);
        }
      }
    } catch { /* best effort */ }
  }

  async function poll() {
    while (!signal.aborted) {
      if (active >= concurrency) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }

      await promoteDelayed();

      try {
        // BRPOP with timeout (1 second)
        let result;
        if (typeof blockClient.brpop === 'function' && blockClient.brpop.length >= 2) {
          // ioredis: brpop(key1, key2, ..., timeout)
          result = await blockClient.brpop(...keys, 1);
        } else if (typeof blockClient.brPop === 'function') {
          // node-redis: brPop(key, timeout)
          result = await blockClient.brPop(keys, 1);
        }

        if (!result) continue;

        // result shape varies: ioredis = [key, value], node-redis = { key, element }
        const raw = Array.isArray(result) ? result[1] : result.element;
        if (!raw) continue;

        const job = JSON.parse(raw);
        const handler = handlers.get(job.name);
        if (!handler) {
          console.error(`[jobs] No handler for "${job.name}", discarding`);
          continue;
        }

        active++;
        handler(job.data, { signal }).catch((err) => {
          console.error(`[jobs] "${job.name}" failed:`, err);
        }).finally(() => { active--; });
      } catch (err) {
        if (signal.aborted) break;
        console.error('[jobs] Worker poll error:', err);
        await new Promise((r) => setTimeout(r, pollInterval));
      }
    }
  }

  await poll();
}
