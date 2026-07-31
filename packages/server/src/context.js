import { AsyncLocalStorage } from 'node:async_hooks';
import { parseCookies } from './csrf.js';
import { setCspNonceProvider, cspNonce } from '@webjsdev/core';

/**
 * Per-request context backed by AsyncLocalStorage. Lets server-side code
 * (pages, layouts, server actions, exposed actions) read the current
 * Request's headers and cookies without explicit threading: the same
 * ergonomics as NextJs's `headers()` / `cookies()` from `next/headers`.
 *
 * Strictly server-side: importing this module on the client is a bug.
 *
 * `cspNonce` holds the per-request CSP nonce when CSP is enabled
 * (issue #233). It is minted in the request handler and written here via
 * `setCspNonce`, so the same value the `Content-Security-Policy` header
 * carries is what `cspNonce()` returns for the inline boot script.
 *
 * `bodyLimits` holds the resolved request body-size caps (issue #237) so
 * `readBody` (used inside `route.{js,ts}` handlers, which have no handle to the
 * server state) can enforce the same limit the RPC and form-dispatch paths do. The
 * handler writes it per request via `setBodyLimits`.
 *
 * `requestId` holds the per-request correlation id (issue #239). The handler
 * mints a `crypto.randomUUID()` at the start of every request (or honors an
 * inbound `X-Request-Id` from a trusted upstream proxy) and stores it here via
 * `setRequestId`, so server-side app code can read it with `requestId()` to
 * stamp it on its own logs / outbound calls, and the framework includes it in
 * the access log, the error log, and the `X-Request-Id` response header.
 *
 * `dynamicAccess` is set the moment the render reads per-user request state
 * through a framework helper (`cookies()`, `headers()`, `getSession()`),
 * mirroring Next.js auto-marking a route dynamic on a `cookies()` / `headers()`
 * read (#241). The server HTML cache reads it at commit time and REFUSES to
 * cache a page that opted into `revalidate` but actually varies per user, so a
 * wrong `revalidate` on a cookie-reading page fails safe (uncached) instead of
 * leaking one visitor's view to another.
 *
 * @typedef {{ req: Request, cspNonce?: string, bodyLimits?: { json: number, multipart: number }, requestId?: string, dynamicAccess?: boolean }} Store
 */

/** @type {AsyncLocalStorage<Store>} */
const als = new AsyncLocalStorage();

/**
 * Run `fn` with the given request bound as the current context.
 * @template T
 * @param {Request} req
 * @param {() => T} fn
 * @returns {T}
 */
export function withRequest(req, fn) {
  return als.run({ req }, fn);
}

/** @returns {Request | null} */
export function getRequest() {
  return als.getStore()?.req ?? null;
}

/**
 * Set the per-request CSP nonce on the current AsyncLocalStorage store.
 * Called by the request handler when CSP is enabled, AFTER it mints the
 * nonce and BEFORE the page renders, so `cspNonce()` returns this exact
 * value during SSR (the same value the response's
 * `Content-Security-Policy` header carries: one source, no drift).
 *
 * A no-op outside a request scope, or when CSP is disabled (the handler
 * simply never calls it, so the store's `cspNonce` stays undefined and
 * `cspNonce()` falls through to '').
 *
 * @param {string} nonce
 */
export function setCspNonce(nonce) {
  const store = als.getStore();
  if (store) store.cspNonce = nonce;
}

/**
 * Set the per-request resolved body-size limits on the current store (issue
 * #237). The handler computes them once at boot (`readBodyLimits`) and stamps
 * them on every request so `readBody` (json.js), which runs inside route
 * handlers with no access to the server state, can enforce the same cap.
 *
 * @param {{ json: number, multipart: number }} limits
 */
export function setBodyLimits(limits) {
  const store = als.getStore();
  if (store) store.bodyLimits = limits;
}

/**
 * Read the per-request body-size limits, or null outside a request scope.
 * @returns {{ json: number, multipart: number } | null}
 */
export function getBodyLimits() {
  return als.getStore()?.bodyLimits ?? null;
}

/**
 * Set the per-request correlation id on the current store (issue #239). The
 * handler calls this at the start of every request with either an inbound
 * `X-Request-Id` (a trusted upstream proxy's trace id) or a freshly minted
 * `crypto.randomUUID()`. A no-op outside a request scope.
 *
 * @param {string} id
 */
export function setRequestId(id) {
  const store = als.getStore();
  if (store) store.requestId = id;
}

/**
 * The correlation id for the in-flight request (issue #239), or `null`
 * outside a request scope. Server-side app code (pages, layouts, server
 * actions, route handlers, middleware) reads it to correlate its own logs and
 * outbound calls with the framework's access / error logs and the
 * `X-Request-Id` response header, all of which carry the same id.
 *
 * @returns {string | null}
 */
export function requestId() {
  return als.getStore()?.requestId ?? null;
}

/**
 * Mark the in-flight request as having read per-user state (issue #241). The
 * framework's request-state readers (`cookies()`, `headers()`, `getSession()`)
 * call this, so the server HTML cache can tell at commit time that the render
 * actually depends on the visitor and refuse to cache it even when the page
 * declared `revalidate`. A no-op outside a request scope.
 */
export function markDynamicAccess() {
  const store = als.getStore();
  if (store) store.dynamicAccess = true;
}

/**
 * True when the in-flight render read per-user request state via a framework
 * helper (issue #241). Read by the server HTML cache's commit step to fail
 * safe (do not cache) on a per-user page that wrongly set `revalidate`.
 * Returns false outside a request scope.
 *
 * @returns {boolean}
 */
export function dynamicAccessed() {
  return als.getStore()?.dynamicAccess === true;
}

/**
 * Server-only implementation of the CSP nonce reader. Returns the
 * per-request nonce that the handler MINTED and stored (issue #233) when
 * CSP is enabled. Falls back to parsing an INBOUND
 * `Content-Security-Policy` request header (the legacy consume-only
 * behaviour) so an app sitting behind a proxy that already mints a nonce
 * still works without enabling webjs's own CSP. Returns '' when neither
 * is in scope.
 *
 * The public `cspNonce()` function lives in `@webjsdev/core` so user
 * layouts / pages can import it without dragging server-only deps
 * (node:async_hooks etc.) into browser-loaded modules. The actual
 * implementation is wired here, server-side only, via
 * `setCspNonceProvider`. On the browser there is no provider, so
 * `cspNonce()` returns '' (empty `nonce=""` attribute, browser
 * ignores it).
 */
// The regex fallback captures the first `nonce-...` token anywhere in the
// inbound CSP header. Webjs uses a single per-request nonce shared across
// all directives that emit it (the standard CSP3 single-nonce model), so
// reading the first match is correct. Kept identical to the matching
// helper in ssr.js so both paths interpret the header the same way.
setCspNonceProvider(() => {
  const store = als.getStore();
  if (!store) return '';
  if (typeof store.cspNonce === 'string') return store.cspNonce;
  const csp = store.req?.headers.get('content-security-policy') || '';
  const match = /\bnonce-([A-Za-z0-9+/=]+)/.exec(csp);
  return match ? match[1] : '';
});

// Re-export for backwards-compat: callers that imported cspNonce from
// @webjsdev/server still work. New code should import from
// @webjsdev/core for browser-isomorphism.
export { cspNonce };

/**
 * Read-only headers for the in-flight request. Throws outside a request
 * (e.g. at module top-level).
 * @returns {Headers}
 */
export function headers() {
  const req = getRequest();
  if (!req) throw new Error('headers(): called outside a request scope');
  // Reading request headers makes the render per-user (an Authorization /
  // Accept-Language / Cookie read varies the output), so mark the request
  // dynamic so the HTML cache excludes it even under `revalidate` (#241).
  markDynamicAccess();
  return req.headers;
}

/**
 * Read-only cookie jar for the in-flight request. Returns an object with
 * `.get(name)`, `.has(name)`, `.entries()`. To SET a cookie, return a
 * `Response` whose headers include `Set-Cookie` (route handlers and
 * exposed actions can do this directly).
 *
 * @returns {{ get: (name: string) => string | undefined, has: (name: string) => boolean, entries: () => [string, string][] }}
 */
export function cookies() {
  const req = getRequest();
  if (!req) throw new Error('cookies(): called outside a request scope');
  // Reading cookies makes the render per-user (a logged-in vs logged-out body
  // keys off an auth cookie), so mark the request dynamic so the HTML cache
  // excludes it even under `revalidate`, the core leak defense (#241).
  markDynamicAccess();
  const map = parseCookies(req);
  return {
    get: (name) => map[name],
    has: (name) => Object.prototype.hasOwnProperty.call(map, name),
    entries: () => Object.entries(map),
  };
}
