/**
 * Pluggable cache store — the foundation for rate limiting, sessions,
 * and any feature that needs shared state across requests.
 *
 * Default: in-memory LRU (single-process, great for dev).
 * For production horizontal scaling, the user explicitly switches to Redis:
 *
 * ```js
 * import { setStore, redisStore } from '@webjs/server';
 * setStore(redisStore({ url: process.env.REDIS_URL }));
 * ```
 *
 * No magic, no auto-detection. The user decides.
 *
 * @module cache
 */

/**
 * @typedef {Object} CacheStore
 * @property {(key: string) => Promise<string | null>} get
 * @property {(key: string, value: string, ttlMs?: number) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 * @property {(key: string, ttlMs?: number) => Promise<number>} increment
 *   Atomically increment a counter. Returns the new value. Creates the
 *   key with value 1 if it doesn't exist. TTL is set on creation only.
 */

/**
 * In-memory LRU cache store. Fast, zero dependencies, single-process only.
 * Entries are evicted when the cache exceeds `maxSize`.
 *
 * @param {{ maxSize?: number }} [opts]
 * @returns {CacheStore}
 */
export function memoryStore(opts = {}) {
  const max = opts.maxSize || 10000;
  /** @type {Map<string, { value: string, expiresAt: number | null }>} */
  const map = new Map();

  function evict() {
    if (map.size <= max) return;
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }

  function isExpired(entry) {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  return {
    async get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (isExpired(entry)) { map.delete(key); return null; }
      // Move to end (LRU)
      map.delete(key);
      map.set(key, entry);
      return entry.value;
    },
    async set(key, value, ttlMs) {
      map.delete(key); // remove old position
      map.set(key, {
        value,
        expiresAt: ttlMs ? Date.now() + ttlMs : null,
      });
      evict();
    },
    async delete(key) {
      map.delete(key);
    },
    async increment(key, ttlMs) {
      const entry = map.get(key);
      if (!entry || isExpired(entry)) {
        map.set(key, {
          value: '1',
          expiresAt: ttlMs ? Date.now() + ttlMs : null,
        });
        return 1;
      }
      const next = parseInt(entry.value, 10) + 1;
      entry.value = String(next);
      return next;
    },
  };
}

/**
 * Redis-backed cache store. Scales horizontally — all instances share
 * the same cache. Requires `REDIS_URL` in the environment or explicit URL.
 *
 * Uses the `ioredis` package if available, falls back to built-in
 * `redis` package (Node 20+ ships with `node:` prefix modules but
 * not a Redis client — the user must install one).
 *
 * @param {{ url?: string }} [opts]
 * @returns {CacheStore}
 */
export function redisStore(opts = {}) {
  const url = opts.url || process.env.REDIS_URL;
  if (!url) throw new Error('redisStore requires REDIS_URL environment variable or opts.url');

  /** @type {any} */
  let client = null;
  let connecting = null;

  async function getClient() {
    if (client) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      // Try ioredis first (most popular), then redis package
      try {
        const { default: Redis } = await import('ioredis');
        client = new Redis(url);
        return client;
      } catch {}
      try {
        const { createClient } = await import('redis');
        client = createClient({ url });
        await client.connect();
        return client;
      } catch {}
      throw new Error('Install a Redis client: npm install ioredis (or npm install redis)');
    })();
    return connecting;
  }

  return {
    async get(key) {
      const c = await getClient();
      return c.get(key);
    },
    async set(key, value, ttlMs) {
      const c = await getClient();
      if (ttlMs) {
        // ioredis: set(key, value, 'PX', ms) — redis: set(key, value, { PX: ms })
        if (typeof c.set === 'function' && c.set.length >= 4) {
          await c.set(key, value, 'PX', ttlMs);
        } else {
          await c.set(key, value, { PX: ttlMs });
        }
      } else {
        await c.set(key, value);
      }
    },
    async delete(key) {
      const c = await getClient();
      await c.del(key);
    },
    async increment(key, ttlMs) {
      const c = await getClient();
      const val = await c.incr(key);
      // Set TTL only when counter is first created (val === 1)
      if (val === 1 && ttlMs) {
        await c.pexpire(key, ttlMs);
      }
      return val;
    },
  };
}

/** @type {CacheStore | null} */
let _defaultStore = null;

/**
 * Get the default cache store. Memory store unless explicitly set via
 * `setStore()`. No auto-detection — the user decides.
 *
 * @returns {CacheStore}
 */
export function getStore() {
  if (!_defaultStore) _defaultStore = memoryStore();
  return _defaultStore;
}

/**
 * Set the default cache store. Call this at app startup to use Redis:
 *
 * ```js
 * import { setStore, redisStore } from '@webjs/server';
 * setStore(redisStore({ url: process.env.REDIS_URL }));
 * ```
 *
 * @param {CacheStore} store
 */
export function setStore(store) {
  _defaultStore = store;
}
