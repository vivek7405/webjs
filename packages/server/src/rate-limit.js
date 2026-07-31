/**
 * Fixed-window rate limiter backed by the pluggable cache store.
 *
 * Uses the global cache store (`getStore()`) by default, which is
 * in-memory unless the app calls `setStore(redisStore(...))` at
 * startup. Passing `opts.store` lets a single middleware target a
 * different store than the default.
 *
 * ```js
 * import { rateLimit } from '@webjsdev/server';
 * export default rateLimit({ window: '1m', max: 60 });
 * ```
 *
 * For horizontal scaling across multiple instances, switch the global
 * store to Redis once at app startup:
 *
 * ```js
 * import { setStore, redisStore } from '@webjsdev/server';
 * setStore(redisStore({ url: process.env.REDIS_URL }));
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
 *   trustProxy?: boolean,
 * }} opts
 * @returns {(req: Request, next: () => Promise<Response>) => Promise<Response>}
 */
export function rateLimit(opts = {}) {
  const windowMs = parseWindow(opts.window ?? '1m');
  const max = opts.max ?? 60;
  const keyFn = typeof opts.key === 'function' ? opts.key : null;
  const keyPrefix = typeof opts.key === 'string' ? opts.key : '';
  const message = opts.message ?? 'Too Many Requests';
  const trustProxy = opts.trustProxy === true;
  // Use the provided store, or fall back to the global cache store.
  // Whatever was set via `setStore()` at app startup (in-memory by default).
  const store = opts.store || null;

  return async function rateLimitMiddleware(req, next) {
    const s = store || getStore();
    const raw = keyFn ? await keyFn(req) : clientIp(req, { trustProxy });
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

/**
 * Header name the framework stamps onto every incoming request with
 * the TCP socket's remote address. Surfaces the socket IP through the
 * Web `Request` boundary (which has no `.socket` property of its own).
 *
 * `dev.js`'s `toWebRequest` strips any inbound copy of this header
 * BEFORE adding its own, so clients cannot spoof it from the wire.
 */
const REMOTE_IP_HEADER = 'x-webjs-remote-ip';

/**
 * Out-of-band trusted remote IP (#756). A listener shell that already holds the
 * socket IP can stamp it here instead of reallocating a whole `Request` just to
 * set the `x-webjs-remote-ip` header (the Bun hot path). When an entry exists
 * for a request it is AUTHORITATIVE: `trustedRemoteIp` returns it and ignores
 * the inbound header entirely, so a client-spoofed `x-webjs-remote-ip` is never
 * trusted even though the original (unmodified) request still carries it.
 * @type {WeakMap<Request, string>}
 */
const trustedIpMap = new WeakMap();

/**
 * Stamp the trusted remote IP for a request out-of-band (no Request clone).
 * Pass `''` (or a falsy value) to mark the request as listener-stamped with no
 * known IP, which still makes the inbound header untrusted (resolves to the
 * anon fallback rather than a spoofable header value).
 * @param {Request} req
 * @param {string | null | undefined} ip
 */
export function setTrustedRemoteIp(req, ip) {
  trustedIpMap.set(req, ip || '');
}

/**
 * The framework-trusted remote IP for a request: the out-of-band WeakMap value
 * when a listener stamped it (authoritative, header ignored), else the
 * framework-stamped `x-webjs-remote-ip` header (the node / embedded path).
 * @param {Request} req
 * @returns {string}
 */
function trustedRemoteIp(req) {
  if (trustedIpMap.has(req)) return trustedIpMap.get(req) || '';
  return req.headers.get(REMOTE_IP_HEADER) || '';
}

/**
 * Carry the trusted remote IP from `src` to a freshly-rebuilt `dst` Request
 * (#756). When the framework re-wraps a request (the form-submission body rebuild
 * in `form-dispatch.js`), the out-of-band WeakMap key is a new object, so the trusted
 * IP would be lost and `clientIp(dst)` would fall back to the (spoofable) header
 * the rebuild copied over. Propagating the trusted value via the WeakMap keeps
 * `dst` authoritative on BOTH runtimes (it reads `trustedRemoteIp(src)`, which is
 * the WeakMap value on Bun and the framework-stamped header on Node). The caller
 * must ALSO strip the inbound `x-webjs-remote-ip` header from `dst` so a client
 * copy can never win. Idempotent and safe to call on any rebuild.
 * @param {Request} src
 * @param {Request} dst
 */
export function propagateTrustedRemoteIp(src, dst) {
  setTrustedRemoteIp(dst, trustedRemoteIp(src));
}

/**
 * Resolve the client IP for rate-limit bucket keying.
 *
 * `trustProxy: false` (default, safe everywhere): read ONLY the
 * framework-trusted remote IP. Under `startServer` the framework derives it from
 * the actual TCP socket: the node shell stamps the `x-webjs-remote-ip` header
 * (stripping any inbound copy via `toWebRequest`), and the Bun shell stamps it
 * OUT OF BAND via `setTrustedRemoteIp` (a WeakMap, no per-request Request clone,
 * #756) which `trustedRemoteIp` reads in preference to (and to the exclusion of)
 * the header, so a client cannot spoof it either way.
 * Under `createRequestHandler` (embedded use) the host adapter MUST
 * call `stampRemoteIp(req, remoteAddress)` first, otherwise the
 * adapter may pass forged inbound headers straight through and the
 * "cannot spoof" guarantee no longer holds. Forwarded-IP headers
 * (`x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`) are IGNORED
 * regardless. Fallback `_anon_` covers requests that arrive without
 * a stamped IP.
 *
 * `trustProxy: true`: honour forwarded-IP headers, preferring the
 * leftmost entry of `X-Forwarded-For`, then `CF-Connecting-IP`,
 * then `X-Real-IP`, then the framework-stamped remote IP, then
 * `_anon_`. Production deploys MUST run behind a reverse proxy that
 * STRIPS inbound `X-Forwarded-For` before adding its own, otherwise
 * trust-proxy reintroduces the spoofability this option exists to
 * defend against.
 *
 * @param {Request} req
 * @param {{ trustProxy?: boolean }} [opts]
 * @returns {string}
 */
export function clientIp(req, opts = {}) {
  if (opts.trustProxy === true) {
    return (
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-real-ip') ||
      trustedRemoteIp(req) ||
      '_anon_'
    );
  }
  return trustedRemoteIp(req) || '_anon_';
}

/**
 * Return a Request equivalent to `req` but with `x-webjs-remote-ip`
 * stripped from inbound headers and re-set to `remoteAddress`.
 *
 * `startServer`'s built-in HTTP path does this internally via
 * `toWebRequest`. Embedded adapters (`createRequestHandler` running
 * under Express / Bun / Deno / edge runtimes) MUST call this helper
 * before invoking `app.handle(req)`, otherwise a malicious client
 * can include `x-webjs-remote-ip: <fake>` on the wire and webjs's
 * rate-limit `clientIp(req)` will trust it.
 *
 * Body and method are preserved verbatim. The new Request consumes
 * the original's body stream, so do not reuse the original afterwards.
 *
 * ```js
 * // express adapter
 * app.use(async (req, res) => {
 *   const webReq = new Request(..., { headers: req.headers, ... });
 *   const safe = stampRemoteIp(webReq, req.socket.remoteAddress);
 *   const webRes = await handler.handle(safe);
 *   // write webRes back to res
 * });
 * ```
 *
 * @param {Request} req
 * @param {string | null | undefined} remoteAddress  trusted socket IP
 * @returns {Request}
 */
export function stampRemoteIp(req, remoteAddress) {
  const headers = new Headers(req.headers);
  headers.delete(REMOTE_IP_HEADER);
  if (remoteAddress) headers.set(REMOTE_IP_HEADER, remoteAddress);
  /** @type {RequestInit & { duplex?: string }} */
  const init = { method: req.method, headers };
  // Preserve AbortSignal so host-side cancellation propagates
  // (e.g. client disconnects mid-request). The framework's body
  // stream has its own teardown, but downstream consumers may
  // listen on the signal directly.
  if (req.signal) init.signal = req.signal;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body;
    init.duplex = 'half';
  }
  return new Request(req.url, init);
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
  // With the cache store, there's nothing to reset here: the store
  // handles its own state. This function exists for API compatibility.
}
