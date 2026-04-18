/**
 * In-memory stand-in for the `ioredis` package, good enough to exercise
 * webjs's `redisStore` implementation in unit tests without a running
 * Redis server.
 *
 * Matches the subset of ioredis's API that cache.js uses:
 *   new Redis(url)
 *   .get(key), .set(key, val, 'PX', ms), .del(key), .incr(key), .pexpire(key, ms)
 */

export default class FakeRedis {
  constructor(url) {
    this.url = url;
    /** @type {Map<string, { value: string, expiresAt: number | null }>} */
    this.store = new Map();
  }

  _expired(entry) {
    return entry.expiresAt !== null && Date.now() > entry.expiresAt;
  }

  async get(key) {
    const e = this.store.get(key);
    if (!e) return null;
    if (this._expired(e)) { this.store.delete(key); return null; }
    return e.value;
  }

  // ioredis signature: set(key, value, 'PX', ms) — 4 positional args.
  async set(key, value, ...rest) {
    let expiresAt = null;
    // rest = [mode, ms] or [{ PX: ms }]
    if (rest[0] === 'PX' && typeof rest[1] === 'number') {
      expiresAt = Date.now() + rest[1];
    } else if (rest[0] && typeof rest[0] === 'object' && typeof rest[0].PX === 'number') {
      expiresAt = Date.now() + rest[0].PX;
    }
    this.store.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async del(key) {
    const had = this.store.delete(key);
    return had ? 1 : 0;
  }

  async incr(key) {
    const e = this.store.get(key);
    const n = (e && !this._expired(e) ? parseInt(e.value, 10) : 0) + 1;
    this.store.set(key, { value: String(n), expiresAt: e?.expiresAt ?? null });
    return n;
  }

  async pexpire(key, ms) {
    const e = this.store.get(key);
    if (!e) return 0;
    e.expiresAt = Date.now() + ms;
    return 1;
  }

  async quit() { this.store.clear(); return 'OK'; }
}
