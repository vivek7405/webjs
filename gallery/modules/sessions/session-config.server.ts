// The session helpers. `session(opts)` builds session MIDDLEWARE; its storage is
// pluggable. `cookieSessionStorage()` (alias `cookieSession`) keeps the whole
// session in a signed cookie (stateless, the default). `storeSessionStorage()`
// (alias `storeSession`) persists the session in the active store (memoryStore
// in dev, Redis in prod via setStore()) and keeps only an id in the cookie, for
// larger or server-held sessions. `getSession(req)` reads the current session
// inside a route or middleware the session wraps.
import { session, getSession, cookieSession, cookieSessionStorage, storeSession, storeSessionStorage } from '@webjsdev/server';

// A dev fallback keeps a fresh scaffold booting; set SESSION_SECRET in .env for
// any real deployment (and fail fast in production).
const trimmed = process.env.SESSION_SECRET?.trim();
if (process.env.NODE_ENV === 'production' && !trimmed) {
  throw new Error('SESSION_SECRET must be set in production');
}
const secret = trimmed || 'dev-insecure-session-secret-change-me';

// Cookie-backed session middleware (all state in a signed cookie): the default
// this demo applies. cookieSession() is the alias for cookieSessionStorage().
export const cookieSessions = session({ secret, storage: cookieSession() });

// Store-backed alternative (session in the active store, id in the cookie).
// storeSession() is the alias for storeSessionStorage(); swap it in above for
// larger sessions. Kept here to show both strategies.
export const storeSessions = session({ secret, storage: storeSession() });

// Equivalent explicit spellings (the aliases just name the storage factories):
export const cookieStorageExplicit = cookieSessionStorage();
export const storeStorageExplicit = storeSessionStorage();

export { getSession };
