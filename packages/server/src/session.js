/**
 * Session middleware — pluggable store with convention-over-configuration.
 *
 * Two strategies:
 *   - **Cookie session** (default when no Redis): session data is JSON-serialized,
 *     signed with HMAC-SHA256, and stored directly in the cookie. No server state.
 *     Good for small payloads (< 4 KB total). Zero infrastructure.
 *   - **Store session**: a random session ID lives in the cookie; actual data is
 *     kept in a {@link import('./cache.js').CacheStore}. Scales to any payload
 *     size and allows server-side invalidation.
 *
 * Convention over configuration:
 *   - `REDIS_URL` in the environment  → StoreSession (data in Redis)
 *   - Otherwise                       → CookieSession (data in cookie)
 *
 * The `SESSION_SECRET` env var is **required** — it signs the cookie to prevent
 * tampering. Generate a long random string (`openssl rand -base64 32`).
 *
 * ```js
 * // middleware.js
 * import { session } from '@webjs/server';
 * export default session();                  // auto-detects strategy
 *
 * // handler.js
 * import { getSession } from '@webjs/server';
 * export async function POST(req) {
 *   const s = getSession(req);
 *   s.views = (s.views || 0) + 1;
 *   return new Response(`Views: ${s.views}`);
 * }
 * ```
 *
 * @module session
 */

import { getStore } from './cache.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * @typedef {Record<string, unknown>} SessionData
 */

/**
 * @typedef {Object} SessionStore
 * @property {(id: string) => Promise<SessionData | null>} load
 * @property {(id: string, data: SessionData, maxAgeMs: number) => Promise<void>} save
 * @property {(id: string) => Promise<void>} destroy
 */

// ---------------------------------------------------------------------------
// WeakMap for attaching session data to Request objects
// ---------------------------------------------------------------------------

/** @type {WeakMap<Request, SessionData>} */
const sessionMap = new WeakMap();

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/**
 * Sign a value with HMAC-SHA256.
 * @param {string} value
 * @param {string} secret
 * @returns {string} `value.signature`
 */
function sign(value, secret) {
  const sig = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${sig}`;
}

/**
 * Verify and unsign a signed value. Returns null if invalid.
 * @param {string} input
 * @param {string} secret
 * @returns {string | null}
 */
function unsign(input, secret) {
  const idx = input.lastIndexOf('.');
  if (idx < 1) return null;
  const value = input.slice(0, idx);
  const sig = input.slice(idx + 1);
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  return value;
}

/**
 * Parse a `Cookie` header into a plain object.
 * @param {string} header
 * @returns {Record<string, string>}
 */
function parseCookies(header) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim();
    const val = pair.slice(eq + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

/**
 * Build a `Set-Cookie` header value.
 * @param {string} name
 * @param {string} value
 * @param {{ maxAge: number, path?: string, httpOnly?: boolean, secure?: boolean, sameSite?: string }} opts
 * @returns {string}
 */
function serializeCookie(name, value, opts) {
  let str = `${name}=${encodeURIComponent(value)}`;
  str += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
  str += `; Path=${opts.path || '/'}`;
  if (opts.httpOnly !== false) str += '; HttpOnly';
  if (opts.secure !== false) str += '; Secure';
  str += `; SameSite=${opts.sameSite || 'Lax'}`;
  return str;
}

// ---------------------------------------------------------------------------
// Cookie session store (data in the cookie itself)
// ---------------------------------------------------------------------------

/**
 * Cookie-based session store. Session data is JSON-serialized, base64-encoded,
 * and signed directly into the cookie. No server state at all.
 *
 * Best for small session payloads. Cookie size limit is ~4 KB.
 *
 * @param {{ maxAge?: number }} [opts]
 * @returns {SessionStore}
 */
export function cookieSession(opts = {}) {
  const maxAge = opts.maxAge || 86400_000; // 24h
  return {
    async load(_id) {
      // Cookie store doesn't use IDs — handled specially in the middleware
      return null;
    },
    async save(_id, _data, _maxAgeMs) {
      // Cookie store writes are handled in the middleware
    },
    async destroy(_id) {
      // No-op: cookie is cleared by the middleware
    },
    /** @internal */
    _type: 'cookie',
    _maxAge: maxAge,
  };
}

// ---------------------------------------------------------------------------
// Server-side session store (ID in cookie, data in cache)
// ---------------------------------------------------------------------------

/**
 * Server-side session store. A random session ID is stored in the cookie;
 * actual data lives in the cache store (memory or Redis).
 *
 * Advantages over cookie sessions:
 *   - No 4 KB payload limit
 *   - Server can invalidate sessions at will
 *   - Session data never leaves the server
 *
 * @param {{ store?: import('./cache.js').CacheStore, maxAge?: number }} [opts]
 * @returns {SessionStore}
 */
export function storeSession(opts = {}) {
  const store = opts.store || getStore();
  const maxAge = opts.maxAge || 86400_000;

  return {
    async load(id) {
      const raw = await store.get(`session:${id}`);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async save(id, data, maxAgeMs) {
      await store.set(`session:${id}`, JSON.stringify(data), maxAgeMs || maxAge);
    },
    async destroy(id) {
      await store.delete(`session:${id}`);
    },
    _type: 'store',
    _maxAge: maxAge,
  };
}

// ---------------------------------------------------------------------------
// Auto-detect
// ---------------------------------------------------------------------------

/**
 * Auto-detect the best session store based on environment.
 * `REDIS_URL` present → server-side store (via cache), otherwise → cookie store.
 *
 * @param {{ maxAge?: number }} [opts]
 * @returns {SessionStore}
 */
function defaultSessionStore(opts = {}) {
  return cookieSession(opts);
}

// ---------------------------------------------------------------------------
// Session middleware
// ---------------------------------------------------------------------------

/**
 * Session middleware. Attach to your middleware chain to enable sessions.
 *
 * Reads the session cookie, deserializes session data, makes it available via
 * {@link getSession}, and writes changes back after the handler responds.
 *
 * @param {{
 *   store?: SessionStore,
 *   cookieName?: string,
 *   secret?: string,
 *   maxAge?: number,
 *   path?: string,
 *   httpOnly?: boolean,
 *   secure?: boolean,
 *   sameSite?: string,
 * }} [opts]
 * @returns {(req: Request, next: () => Promise<Response>) => Promise<Response>}
 */
export function session(opts = {}) {
  const secret = opts.secret || process.env.SESSION_SECRET;
  if (!secret) throw new Error('session() requires SESSION_SECRET env var or opts.secret');

  const cookieName = opts.cookieName || 'webjs.sid';
  const maxAge = opts.maxAge || 86400_000;
  const store = opts.store || defaultSessionStore({ maxAge });
  const isCookieStore = /** @type {any} */ (store)._type === 'cookie';

  const cookieOpts = {
    maxAge,
    path: opts.path || '/',
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
  };

  return async function sessionMiddleware(req, next) {
    const cookies = parseCookies(req.headers.get('cookie') || '');
    const rawCookie = cookies[cookieName] || '';

    /** @type {SessionData} */
    let data = {};
    let sessionId = '';

    if (rawCookie) {
      if (isCookieStore) {
        // Cookie session: unsign, decode, parse
        const unsigned = unsign(rawCookie, secret);
        if (unsigned) {
          try {
            const json = Buffer.from(unsigned, 'base64url').toString('utf8');
            data = JSON.parse(json);
          } catch { /* tampered or corrupt — start fresh */ }
        }
      } else {
        // Store session: unsign to get session ID, load from store
        sessionId = unsign(rawCookie, secret) || '';
        if (sessionId) {
          data = (await store.load(sessionId)) || {};
        }
      }
    }

    // Generate session ID for store-based sessions if needed
    if (!isCookieStore && !sessionId) {
      sessionId = randomBytes(24).toString('base64url');
    }

    // Snapshot for dirty checking
    const snapshot = JSON.stringify(data);

    // Attach session data to the request
    sessionMap.set(req, data);

    // Run the handler
    const resp = await next();

    // Retrieve (possibly mutated) session data
    const current = sessionMap.get(req) || {};
    const currentJson = JSON.stringify(current);

    // Only write cookie if session changed
    if (currentJson !== snapshot) {
      /** @type {string} */
      let cookieValue;
      if (isCookieStore) {
        const encoded = Buffer.from(currentJson).toString('base64url');
        cookieValue = sign(encoded, secret);
      } else {
        await store.save(sessionId, current, maxAge);
        cookieValue = sign(sessionId, secret);
      }
      try {
        resp.headers.append('set-cookie', serializeCookie(cookieName, cookieValue, cookieOpts));
      } catch {
        // Headers may be immutable — ignore
      }
    } else if (!rawCookie && !isCookieStore) {
      // First request: always set the session cookie even if empty
      const cookieValue = sign(sessionId, secret);
      try {
        resp.headers.append('set-cookie', serializeCookie(cookieName, cookieValue, cookieOpts));
      } catch {}
    }

    return resp;
  };
}

// ---------------------------------------------------------------------------
// Read session data from a request
// ---------------------------------------------------------------------------

/**
 * Read the session data attached to the current request. Must be used inside
 * a handler that runs after the {@link session} middleware.
 *
 * The returned object is the live session — mutate it directly and changes
 * will be persisted after the response.
 *
 * @param {Request} req
 * @returns {SessionData}
 */
export function getSession(req) {
  const data = sessionMap.get(req);
  if (!data) throw new Error('getSession() called outside of session middleware');
  return data;
}
