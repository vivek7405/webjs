/**
 * Session middleware with Remix-style Session class and SessionStorage interface.
 *
 * Storage owns the Session lifecycle:
 *   `storage.read(cookie) → Session`
 *   `storage.save(session) → cookie | null | ''`
 *
 * ```js
 * // middleware.ts
 * import { session } from '@webjskit/server';
 * export default session({ secret: process.env.SESSION_SECRET });
 *
 * // In any handler:
 * import { getSession } from '@webjskit/server';
 * const s = getSession(req);
 * s.set('userId', user.id);
 * s.flash('message', 'Welcome back!');
 * ```
 *
 * @module session
 */

import { getStore } from './cache.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Session class
// ---------------------------------------------------------------------------

/**
 * A session holds data for a specific user across multiple requests.
 *
 * Modeled after Remix's Session: get, set, has, unset, flash, destroy,
 * regenerateId.
 */
export class Session {
  #id;
  #data;
  #flash;
  #dirty = false;
  #destroyed = false;
  #deleteId;

  /**
   * @param {string} [id]
   * @param {{ data?: Record<string, unknown>, flash?: Record<string, unknown> }} [initial]
   */
  constructor(id, initial) {
    this.#id = id || randomBytes(24).toString('base64url');
    this.#data = new Map(Object.entries(initial?.data || {}));
    this.#flash = new Map(Object.entries(initial?.flash || {}));
    if (this.#flash.size > 0) this.#dirty = true;
  }

  get id() { return this.#id; }
  get dirty() { return this.#dirty; }
  get destroyed() { return this.#destroyed; }
  get deleteId() { return this.#deleteId; }

  /** Serialized data for storage. */
  get data() {
    return {
      data: Object.fromEntries(this.#data),
      flash: Object.fromEntries(this.#flash),
    };
  }

  /** @param {string} key @returns {unknown} */
  get(key) {
    if (this.#destroyed) return undefined;
    return this.#data.get(key) ?? this.#flash.get(key);
  }

  /** @param {string} key @param {unknown} value */
  set(key, value) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    if (value == null) this.#data.delete(key);
    else this.#data.set(key, value);
    this.#dirty = true;
  }

  /** @param {string} key @returns {boolean} */
  has(key) {
    if (this.#destroyed) return false;
    return this.#data.has(key) || this.#flash.has(key);
  }

  /** @param {string} key */
  unset(key) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    this.#data.delete(key);
    this.#dirty = true;
  }

  /**
   * Set a value that exists for one request only.
   * @param {string} key @param {unknown} value
   */
  flash(key, value) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    this.#flash.set(key, value);
    this.#dirty = true;
  }

  /** Destroy the session. Use for logout. */
  destroy() {
    this.#destroyed = true;
    this.#data.clear();
    this.#flash.clear();
    this.#dirty = true;
  }

  /**
   * Regenerate the session ID. Call after login to prevent session fixation.
   * @param {boolean} [deleteOld=false]
   */
  regenerateId(deleteOld = false) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    if (deleteOld) this.#deleteId = this.#id;
    this.#id = randomBytes(24).toString('base64url');
    this.#dirty = true;
  }
}

// ---------------------------------------------------------------------------
// SessionStorage interface
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SessionStorage
 * @property {(cookie: string | null) => Promise<Session>} read
 *   Create or restore a Session from the raw (unsigned) cookie value.
 * @property {(session: Session) => Promise<string | null>} save
 *   Persist session and return the raw cookie value to sign and set.
 *   Returns `null` if no cookie change needed, `''` to clear the cookie.
 */

/**
 * Cookie-based session storage. All data lives in the cookie itself.
 * Stateless — no server storage needed.
 *
 * @returns {SessionStorage}
 */
export function cookieSessionStorage() {
  return {
    async read(cookie) {
      if (cookie) {
        try {
          const parsed = JSON.parse(cookie);
          return new Session(parsed.id, { data: parsed.data, flash: parsed.flash });
        } catch {}
      }
      return new Session();
    },
    async save(session) {
      if (session.destroyed) return '';
      if (!session.dirty) return null;
      return JSON.stringify({ id: session.id, ...session.data });
    },
  };
}

/**
 * Server-side session storage. Session ID in cookie, data in cache store.
 *
 * @param {{ store?: import('./cache.js').CacheStore, maxAge?: number }} [opts]
 * @returns {SessionStorage}
 */
export function storeSessionStorage(opts = {}) {
  const store = opts.store || getStore();
  const maxAge = opts.maxAge || 86400_000;

  return {
    async read(cookie) {
      if (cookie) {
        const raw = await store.get(`session:${cookie}`);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            return new Session(cookie, { data: parsed.data, flash: parsed.flash });
          } catch {}
        }
      }
      return new Session();
    },
    async save(session) {
      if (session.deleteId) await store.delete(`session:${session.deleteId}`);
      if (session.destroyed) {
        await store.delete(`session:${session.id}`);
        return '';
      }
      if (!session.dirty) return null;
      await store.set(`session:${session.id}`, JSON.stringify(session.data), maxAge);
      return session.id;
    },
  };
}

// Backwards-compatible aliases
export const cookieSession = cookieSessionStorage;
export const storeSession = storeSessionStorage;

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function sign(value, secret) {
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}

function unsign(input, secret) {
  const idx = input.lastIndexOf('.');
  if (idx < 1) return null;
  const value = input.slice(0, idx);
  const expected = createHmac('sha256', secret).update(value).digest('base64url');
  const sigBuf = Buffer.from(input.slice(idx + 1));
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expBuf)) return null;
  return value;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    out[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1).trim());
  }
  return out;
}

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
// WeakMap for attaching Session to Request
// ---------------------------------------------------------------------------

/** @type {WeakMap<Request, Session>} */
const sessionMap = new WeakMap();

// ---------------------------------------------------------------------------
// Session middleware
// ---------------------------------------------------------------------------

/**
 * Session middleware. Storage owns the Session lifecycle:
 * `storage.read(cookie) → Session`, `storage.save(session) → cookie`.
 *
 * @param {{
 *   storage?: SessionStorage,
 *   cookieName?: string,
 *   secret?: string,
 *   maxAge?: number,
 *   path?: string,
 *   httpOnly?: boolean,
 *   secure?: boolean,
 *   sameSite?: string,
 * }} [opts]
 */
export function session(opts = {}) {
  const secret = opts.secret || process.env.SESSION_SECRET;
  if (!secret) throw new Error('session() requires secret option or SESSION_SECRET env var');

  const storage = opts.storage || cookieSessionStorage();
  const cookieName = opts.cookieName || 'webjs.sid';
  const cookieOpts = {
    maxAge: opts.maxAge || 86400_000,
    path: opts.path || '/',
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
  };

  return async function sessionMiddleware(req, next) {
    const cookies = parseCookies(req.headers.get('cookie') || '');
    const rawCookie = cookies[cookieName] || '';
    const unsigned = rawCookie ? unsign(rawCookie, secret) : null;

    // Storage creates the Session
    const s = await storage.read(unsigned);
    sessionMap.set(req, s);

    const resp = await next();

    // Storage serializes the Session
    const cookieValue = await storage.save(s);

    if (cookieValue === '') {
      // Destroyed — clear the cookie
      try {
        resp.headers.append('set-cookie', `${cookieName}=; Max-Age=0; Path=${cookieOpts.path}`);
      } catch {}
    } else if (cookieValue !== null) {
      // Changed — sign and set
      try {
        resp.headers.append('set-cookie', serializeCookie(cookieName, sign(cookieValue, secret), cookieOpts));
      } catch {}
    }
    // null = no change

    return resp;
  };
}

// ---------------------------------------------------------------------------
// Read session from request
// ---------------------------------------------------------------------------

/**
 * Get the Session for the current request.
 *
 * ```js
 * const s = getSession(req);
 * s.get('userId');
 * s.set('userId', user.id);
 * s.flash('message', 'Saved!');
 * ```
 *
 * @param {Request} req
 * @returns {Session}
 */
export function getSession(req) {
  const s = sessionMap.get(req);
  if (!s) throw new Error('getSession() called outside of session middleware');
  return s;
}
