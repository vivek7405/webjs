/**
 * Session middleware with Remix-style Session class.
 *
 * ```js
 * // middleware.ts
 * import { session } from '@webjs/server';
 * export default session({ secret: process.env.SESSION_SECRET });
 *
 * // In any handler:
 * import { getSession } from '@webjs/server';
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
 * API modeled after Remix's Session class: `get`, `set`, `has`, `unset`,
 * `flash`, `destroy`, `regenerateId`.
 */
export class Session {
  /** @type {string} */
  #id;
  /** @type {Map<string, unknown>} */
  #data;
  /** @type {Map<string, unknown>} */
  #flash;
  /** @type {boolean} */
  #dirty = false;
  /** @type {boolean} */
  #destroyed = false;
  /** @type {string | undefined} */
  #deleteId;

  /**
   * @param {string} [id]
   * @param {Record<string, unknown>} [data]
   * @param {Record<string, unknown>} [flash]
   */
  constructor(id, data, flash) {
    this.#id = id || randomBytes(24).toString('base64url');
    this.#data = new Map(Object.entries(data || {}));
    this.#flash = new Map(Object.entries(flash || {}));
    if (this.#flash.size > 0) this.#dirty = true;
  }

  /** The session ID. */
  get id() { return this.#id; }

  /** Whether session data has been modified. */
  get dirty() { return this.#dirty; }

  /** Whether the session has been destroyed. */
  get destroyed() { return this.#destroyed; }

  /** Session ID to delete (set after regenerateId with deleteOld=true). */
  get deleteId() { return this.#deleteId; }

  /**
   * Get a session value. Also reads flash data (one-time values).
   * @param {string} key
   * @returns {unknown}
   */
  get(key) {
    if (this.#destroyed) return undefined;
    return this.#data.get(key) ?? this.#flash.get(key);
  }

  /**
   * Set a session value.
   * @param {string} key
   * @param {unknown} value
   */
  set(key, value) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    if (value == null) {
      this.#data.delete(key);
    } else {
      this.#data.set(key, value);
    }
    this.#dirty = true;
  }

  /**
   * Check if a key exists in the session.
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    if (this.#destroyed) return false;
    return this.#data.has(key) || this.#flash.has(key);
  }

  /**
   * Remove a value from the session.
   * @param {string} key
   */
  unset(key) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    this.#data.delete(key);
    this.#dirty = true;
  }

  /**
   * Set a value that exists for one request only. After the next request
   * reads it, it's gone. Use for form validation errors, success messages.
   *
   * ```js
   * // After form submit:
   * s.flash('error', 'Email is required');
   * // Redirect → next page reads s.get('error') once → gone
   * ```
   *
   * @param {string} key
   * @param {unknown} value
   */
  flash(key, value) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    this.#flash.set(key, value);
    this.#dirty = true;
  }

  /**
   * Destroy the session. Clears all data and marks for deletion.
   * Use for logout.
   */
  destroy() {
    this.#destroyed = true;
    this.#data.clear();
    this.#flash.clear();
    this.#dirty = true;
  }

  /**
   * Regenerate the session ID. Call after login to prevent session
   * fixation attacks.
   *
   * @param {boolean} [deleteOld=false] Delete the old session from storage
   */
  regenerateId(deleteOld = false) {
    if (this.#destroyed) throw new Error('Session has been destroyed');
    if (deleteOld) this.#deleteId = this.#id;
    this.#id = randomBytes(24).toString('base64url');
    this.#dirty = true;
  }

  /**
   * Serialize session data for storage. Flash data moves to the next
   * request's flash slot; current flash is consumed.
   * @returns {{ data: Record<string, unknown>, flash: Record<string, unknown> }}
   */
  _serialize() {
    return {
      data: Object.fromEntries(this.#data),
      flash: Object.fromEntries(this.#flash),
    };
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

function sign(value, secret) {
  const sig = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${sig}`;
}

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

function clearCookie(name, opts) {
  return `${name}=; Max-Age=0; Path=${opts.path || '/'}`;
}

// ---------------------------------------------------------------------------
// Session stores
// ---------------------------------------------------------------------------

/**
 * Cookie-based session store. Data lives in the cookie itself.
 * @param {{ maxAge?: number }} [opts]
 */
export function cookieSession(opts = {}) {
  return { _type: 'cookie', _maxAge: opts.maxAge || 86400_000 };
}

/**
 * Server-side session store. ID in cookie, data in cache store.
 * @param {{ store?: import('./cache.js').CacheStore, maxAge?: number }} [opts]
 */
export function storeSession(opts = {}) {
  const store = opts.store || getStore();
  const maxAge = opts.maxAge || 86400_000;
  return {
    _type: 'store',
    _maxAge: maxAge,
    async load(id) {
      const raw = await store.get(`session:${id}`);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async save(id, data, ttl) {
      await store.set(`session:${id}`, JSON.stringify(data), ttl || maxAge);
    },
    async destroy(id) {
      await store.delete(`session:${id}`);
    },
  };
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
 * Session middleware.
 *
 * @param {{
 *   store?: any,
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

  const cookieName = opts.cookieName || 'webjs.sid';
  const maxAge = opts.maxAge || 86400_000;
  const store = opts.store || cookieSession({ maxAge });
  const isCookie = store._type === 'cookie';

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

    let data = {};
    let flash = {};
    let sessionId = '';

    if (rawCookie) {
      if (isCookie) {
        const unsigned = unsign(rawCookie, secret);
        if (unsigned) {
          try {
            const parsed = JSON.parse(Buffer.from(unsigned, 'base64url').toString('utf8'));
            data = parsed.data || parsed;
            flash = parsed.flash || {};
          } catch {}
        }
      } else {
        sessionId = unsign(rawCookie, secret) || '';
        if (sessionId) {
          const loaded = await store.load(sessionId);
          if (loaded) {
            data = loaded.data || loaded;
            flash = loaded.flash || {};
          }
        }
      }
    }

    const s = new Session(sessionId || undefined, data, flash);
    sessionMap.set(req, s);

    const resp = await next();

    // Handle destroyed sessions
    if (s.destroyed) {
      if (!isCookie && sessionId) await store.destroy(sessionId);
      try {
        resp.headers.append('set-cookie', clearCookie(cookieName, cookieOpts));
      } catch {}
      return resp;
    }

    // Handle regenerateId with deleteOld
    if (s.deleteId && !isCookie) {
      await store.destroy(s.deleteId);
    }

    // Write session if dirty
    if (s.dirty) {
      const serialized = s._serialize();
      let cookieValue;
      if (isCookie) {
        const json = JSON.stringify(serialized);
        cookieValue = sign(Buffer.from(json).toString('base64url'), secret);
      } else {
        await store.save(s.id, serialized, maxAge);
        cookieValue = sign(s.id, secret);
      }
      try {
        resp.headers.append('set-cookie', serializeCookie(cookieName, cookieValue, cookieOpts));
      } catch {}
    }

    return resp;
  };
}

// ---------------------------------------------------------------------------
// Read session from request
// ---------------------------------------------------------------------------

/**
 * Get the Session for the current request. Must be called inside a handler
 * that runs after the session() middleware.
 *
 * ```js
 * const s = getSession(req);
 * const userId = s.get('userId');
 * s.set('lastSeen', Date.now());
 * s.flash('message', 'Settings saved!');
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
