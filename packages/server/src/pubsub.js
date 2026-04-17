/**
 * Pluggable pub/sub — cross-instance messaging for WebSocket broadcast,
 * real-time notifications, and any feature that needs to fan out events
 * across multiple server processes.
 *
 * Convention over configuration:
 *   - `REDIS_URL` in the environment → Redis pub/sub (multi-instance)
 *   - Otherwise → in-process memory pub/sub (single-instance, great for dev)
 *
 * ```js
 * import { getPubSub } from '@webjs/server';
 *
 * const ps = getPubSub();
 * ps.subscribe('chat:lobby', (message) => {
 *   // broadcast to connected WebSocket clients
 *   for (const ws of clients) ws.send(message);
 * });
 *
 * // From any server instance:
 * ps.publish('chat:lobby', JSON.stringify({ user: 'alice', text: 'hello' }));
 * ```
 *
 * For production multi-instance deployments, use `redisPubSub()` (or let
 * `autoPubSub()` detect `REDIS_URL`). Redis pub/sub uses a dedicated
 * subscriber connection as required by the Redis protocol.
 *
 * @module pubsub
 */

/**
 * @typedef {Object} PubSub
 * @property {(channel: string, message: string) => Promise<void>} publish
 * @property {(channel: string, callback: (message: string) => void) => Promise<void>} subscribe
 * @property {(channel: string, callback: (message: string) => void) => Promise<void>} unsubscribe
 */

// ---------------------------------------------------------------------------
// In-memory pub/sub
// ---------------------------------------------------------------------------

/**
 * In-memory pub/sub. Messages are delivered synchronously within the same
 * process. Zero dependencies, no network — ideal for development and
 * single-instance deployments.
 *
 * @returns {PubSub}
 */
export function memoryPubSub() {
  /** @type {Map<string, Set<(message: string) => void>>} */
  const channels = new Map();

  return {
    async publish(channel, message) {
      const subs = channels.get(channel);
      if (!subs) return;
      for (const cb of subs) {
        try { cb(message); } catch { /* subscriber errors don't propagate */ }
      }
    },

    async subscribe(channel, callback) {
      let subs = channels.get(channel);
      if (!subs) {
        subs = new Set();
        channels.set(channel, subs);
      }
      subs.add(callback);
    },

    async unsubscribe(channel, callback) {
      const subs = channels.get(channel);
      if (!subs) return;
      subs.delete(callback);
      if (subs.size === 0) channels.delete(channel);
    },
  };
}

// ---------------------------------------------------------------------------
// Redis pub/sub
// ---------------------------------------------------------------------------

/**
 * Redis-backed pub/sub. Messages are delivered across all connected server
 * instances via Redis PUBLISH/SUBSCRIBE. Uses a **dedicated** Redis
 * connection for subscriptions (Redis requires this — a client in subscribe
 * mode cannot issue other commands).
 *
 * Requires `ioredis` or `redis` package to be installed.
 *
 * @param {{ url?: string }} [opts]
 * @returns {PubSub}
 */
export function redisPubSub(opts = {}) {
  const url = opts.url || process.env.REDIS_URL;
  if (!url) throw new Error('redisPubSub requires REDIS_URL environment variable or opts.url');

  /** @type {any} */ let pubClient = null;
  /** @type {any} */ let subClient = null;
  /** @type {Promise<void> | null} */ let connecting = null;
  /** @type {string | null} */ let driverType = null;

  /** @type {Map<string, Set<(message: string) => void>>} */
  const localCallbacks = new Map();

  async function ensureClients() {
    if (pubClient && subClient) return;
    if (connecting) return connecting;
    connecting = (async () => {
      // Try ioredis first, then redis package
      try {
        const { default: Redis } = await import('ioredis');
        pubClient = new Redis(url);
        subClient = new Redis(url);
        driverType = 'ioredis';

        subClient.on('message', (/** @type {string} */ channel, /** @type {string} */ message) => {
          const subs = localCallbacks.get(channel);
          if (!subs) return;
          for (const cb of subs) {
            try { cb(message); } catch { /* subscriber errors don't propagate */ }
          }
        });
        return;
      } catch { /* ioredis not available */ }

      try {
        const { createClient } = await import('redis');
        pubClient = createClient({ url });
        subClient = pubClient.duplicate();
        await pubClient.connect();
        await subClient.connect();
        driverType = 'redis';
        return;
      } catch { /* redis not available */ }

      throw new Error('Install a Redis client: npm install ioredis (or npm install redis)');
    })();
    return connecting;
  }

  return {
    async publish(channel, message) {
      await ensureClients();
      await pubClient.publish(channel, message);
    },

    async subscribe(channel, callback) {
      await ensureClients();

      let subs = localCallbacks.get(channel);
      const isNew = !subs;
      if (!subs) {
        subs = new Set();
        localCallbacks.set(channel, subs);
      }
      subs.add(callback);

      // Only issue Redis SUBSCRIBE on first callback for this channel
      if (isNew) {
        if (driverType === 'ioredis') {
          await subClient.subscribe(channel);
        } else {
          // node-redis: subscribe takes a callback directly
          await subClient.subscribe(channel, (/** @type {string} */ message) => {
            const cbs = localCallbacks.get(channel);
            if (!cbs) return;
            for (const cb of cbs) {
              try { cb(message); } catch {}
            }
          });
        }
      }
    },

    async unsubscribe(channel, callback) {
      const subs = localCallbacks.get(channel);
      if (!subs) return;
      subs.delete(callback);

      // Unsubscribe from Redis when no local callbacks remain
      if (subs.size === 0) {
        localCallbacks.delete(channel);
        if (subClient) {
          await subClient.unsubscribe(channel);
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-detect
// ---------------------------------------------------------------------------

/**
 * Auto-detect the best pub/sub backend based on environment.
 * `REDIS_URL` → Redis pub/sub, otherwise → in-memory.
 *
 * @returns {PubSub}
 */
export function autoPubSub() {
  if (process.env.REDIS_URL) return redisPubSub();
  return memoryPubSub();
}

// ---------------------------------------------------------------------------
// Global default
// ---------------------------------------------------------------------------

/** @type {PubSub | null} */
let _default = null;

/**
 * Get the default pub/sub instance (auto-detected on first call).
 * @returns {PubSub}
 */
export function getPubSub() {
  if (!_default) _default = autoPubSub();
  return _default;
}

/**
 * Override the default pub/sub instance.
 * @param {PubSub} ps
 */
export function setPubSub(ps) {
  _default = ps;
}
