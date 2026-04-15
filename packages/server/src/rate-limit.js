/**
 * Simple in-memory fixed-window rate limiter, shaped as a webjs middleware.
 *
 * ```js
 * // middleware.js
 * import { rateLimit } from '@webjs/server';
 * export default rateLimit({ window: '1m', max: 60 });
 *
 * // or per-segment for /api/*:
 * // app/api/middleware.js
 * export default rateLimit({
 *   window: '10s', max: 10,
 *   key: req => `login:${req.headers.get('x-forwarded-for') || 'anon'}`,
 * });
 * ```
 *
 * Notes / deliberate limits:
 *   - In-memory only. For multi-instance deployments put a shared store
 *     (Redis) behind `key` or rate-limit at the edge (cloudflare / nginx).
 *   - Fixed-window — slightly coarser than sliding-window but much cheaper
 *     and good enough for protecting login / signup / cheap-to-abuse routes.
 *   - Buckets expire passively on the next hit after `resetAt`; a periodic
 *     sweeper drops stale entries every 60s so idle keys don't leak memory.
 */

/** @type {Map<string, { count: number, resetAt: number }>} */
const buckets = new Map();

// Periodic cleanup — keeps the Map bounded when keys churn (per-IP).
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000);
sweeper.unref();

/**
 * @param {{
 *   window?: number | string,   // ms number, or "30s" / "1m" / "1h"
 *   max?: number,
 *   key?: string | ((req: Request) => string | Promise<string>),
 *   message?: string,
 * }} opts
 * @returns {(req: Request, next: () => Promise<Response>) => Promise<Response>}
 */
export function rateLimit(opts = {}) {
  const windowMs = parseWindow(opts.window ?? '1m');
  const max = opts.max ?? 60;
  const keyFn = typeof opts.key === 'function' ? opts.key : defaultKey;
  const keyPrefix = typeof opts.key === 'string' ? opts.key : '';
  const message = opts.message ?? 'Too Many Requests';

  return async function rateLimitMiddleware(req, next) {
    const key = keyPrefix + (typeof opts.key === 'function' ? await keyFn(req) : defaultKey(req));
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      return new Response(JSON.stringify({ error: message }), {
        status: 429,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': String(Math.ceil((bucket.resetAt - now) / 1000)),
          'x-ratelimit-limit': String(max),
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(bucket.resetAt / 1000)),
        },
      });
    }
    const resp = await next();
    // Add headers without copying the body (preserve streaming Responses).
    try {
      resp.headers.set('x-ratelimit-limit', String(max));
      resp.headers.set('x-ratelimit-remaining', String(Math.max(0, max - bucket.count)));
      resp.headers.set('x-ratelimit-reset', String(Math.floor(bucket.resetAt / 1000)));
    } catch {
      // Headers may be immutable on some synthetic Responses — ignore.
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

/** Testing hook: wipe all buckets. */
export function _resetRateLimits() {
  buckets.clear();
}
