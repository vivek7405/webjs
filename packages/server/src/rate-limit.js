/**
 * Fixed-window rate limiter backed by the pluggable cache store.
 *
 * Convention over configuration:
 *   - If `REDIS_URL` is set → rate limits are shared across all instances
 *   - Otherwise → in-memory (single-process, great for dev)
 *
 * ```js
 * import { rateLimit } from '@webjs/server';
 * export default rateLimit({ window: '1m', max: 60 });
 * ```
 *
 * @module rate-limit
 */

import { getStore } from './cache.js';

/**
 * @param {{
 *   window?: number | string,
 *   max?: number,
 *   key?: string | ((req: Request) => string | Promise<string>),
 *   message?: string,
 *   store?: import('./cache.js').CacheStore,
 * }} opts
 * @returns {(req: Request, next: () => Promise<Response>) => Promise<Response>}
 */
export function rateLimit(opts = {}) {
  const windowMs = parseWindow(opts.window ?? '1m');
  const max = opts.max ?? 60;
  const keyFn = typeof opts.key === 'function' ? opts.key : defaultKey;
  const keyPrefix = typeof opts.key === 'string' ? opts.key : '';
  const message = opts.message ?? 'Too Many Requests';
  // Use the provided store, or fall back to the global cache store.
  // The global store auto-detects Redis if REDIS_URL is set.
  const store = opts.store || null;

  return async function rateLimitMiddleware(req, next) {
    const s = store || getStore();
    const raw = typeof opts.key === 'function' ? await keyFn(req) : defaultKey(req);
    const key = `rl:${keyPrefix}${raw}`;

    const count = await s.increment(key, windowMs);
    const resetAt = Date.now() + windowMs;

    if (count > max) {
      return new Response(JSON.stringify({ error: message }), {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(Math.ceil(windowMs / 1000)),
          'x-ratelimit-limit': String(max),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(resetAt / 1000)),
        },
      });
    }

    const resp = await next();
    try {
      resp.headers.set('x-ratelimit-limit', String(max));
      resp.headers.set('x-ratelimit-remaining', String(Math.max(0, max - count)));
      resp.headers.set('x-ratelimit-reset', String(Math.floor(resetAt / 1000)));
    } catch {
      // Headers may be immutable on some synthetic Responses.
    }
    return resp;
  };
}

/** @param {Request} req */
function defaultKey(req) {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    '_anon_'
  );
}

/** @param {number | string} w @returns {number} milliseconds */
export function parseWindow(w) {
  if (typeof w === 'number') return w;
  const m = /^(\d+)\s*(ms|s|m|h)?$/.exec(String(w));
  if (!m) return 60_000;
  const n = Number(m[1]);
  const unit = m[2] || 'ms';
  const mult = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  return n * (mult || 1);
}

/** Testing hook: reset the default store (for unit tests). */
export function _resetRateLimits() {
  // With the cache store, there's nothing to reset here — the store
  // handles its own state. This function exists for API compatibility.
}
