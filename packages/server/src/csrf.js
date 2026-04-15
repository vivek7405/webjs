// Use Web Crypto (globalThis.crypto) for random + hash — works on Node >=20,
// Deno, Bun, Cloudflare Workers. Avoids the node:crypto import and keeps
// CSRF portable across runtimes.
const webCrypto = /** @type {Crypto} */ (globalThis.crypto);

/**
 * Double-submit cookie CSRF protection for `/__webjs/action/*` RPC endpoints.
 *
 * Flow:
 *   1. Every SSR response that lacks the cookie issues a fresh `webjs_csrf`
 *      cookie with `SameSite=Lax; Path=/` (and `Secure` when over HTTPS).
 *      The cookie is readable by JS (not HttpOnly) so the auto-generated
 *      action stub can echo it.
 *   2. The action-stub `fetch` sends the token back in `x-webjs-csrf`.
 *   3. `invokeAction` compares the header to the cookie with constant-time
 *      equality; mismatch → 403.
 *
 * This protects against classic CSRF (a malicious site triggering a POST
 * from a victim browser): cross-origin requests cannot read the cookie, so
 * they cannot set the header to the matching value.
 *
 * Notes on scope:
 *   - Applies to internal RPC only. `expose()`d REST endpoints are *not*
 *     CSRF-protected by default because they're intended for external
 *     consumers; those endpoints should carry their own auth (bearer token,
 *     signed request, API key) which the app provides via middleware.
 */

export const CSRF_COOKIE = 'webjs_csrf';
export const CSRF_HEADER = 'x-webjs-csrf';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/** @returns {string} a 128-bit hex token */
export function newToken() {
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Parse cookies off a standard Request.
 * @param {Request} req
 * @returns {Record<string,string>}
 */
export function parseCookies(req) {
  const header = req.headers.get('cookie') || '';
  /** @type {Record<string,string>} */
  const out = {};
  for (const part of header.split(/;\s*/)) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

/** @param {Request} req */
export function readToken(req) {
  return parseCookies(req)[CSRF_COOKIE] || null;
}

/**
 * Serialise a Set-Cookie value for the CSRF token.
 * @param {string} token
 * @param {{ secure?: boolean }} [opts]
 */
export function cookieHeader(token, opts = {}) {
  const parts = [
    `${CSRF_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * Constant-time verification of the double-submit.
 * @param {Request} req
 */
export function verify(req) {
  const cookie = readToken(req);
  const header = req.headers.get(CSRF_HEADER);
  if (!cookie || !header) return false;
  if (cookie.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < cookie.length; i++) diff |= cookie.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}
