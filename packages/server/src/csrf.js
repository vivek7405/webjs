/**
 * Cross-origin (CSRF) protection for `/__webjs/action/*` RPC endpoints, via
 * Fetch-Metadata + Origin verification. This is the model Remix 3's
 * `cop-middleware` and Go 1.25's `http.CrossOriginProtection` use, and the
 * spiritual sibling of Next.js / Astro's Origin-vs-Host check.
 *
 * Why not a token cookie: WebJs previously issued a per-request `webjs_csrf`
 * double-submit cookie on every SSR response. That made SSR HTML
 * un-cacheable at a CDN (a CDN skips a response with `Set-Cookie`, and a
 * cached one would share / poison the token across visitors). A header check
 * needs nothing on the page, so SSR HTML carries no `Set-Cookie` and a page
 * that opts into a public `Cache-Control` is edge-cacheable.
 *
 * The check, on every state-changing verb (a safe GET is exempt):
 *   1. `Sec-Fetch-Site` is the primary signal. The browser sets it on every
 *      request and page JS cannot forge it. `same-origin` / `none` (a direct
 *      navigation with no initiator) pass; `same-site` / `cross-site` are
 *      rejected unless the source origin is in `webjs.allowedOrigins`.
 *   2. When `Sec-Fetch-Site` is absent (an older browser), fall back to
 *      comparing the `Origin` host to the request host; an absent `Origin`
 *      can't be checked so it passes (a handcrafted / non-browser request
 *      can't carry a victim's SameSite cookies cross-site anyway). That
 *      request host comes from `requestHost` below, which resolves
 *      `x-forwarded-host` through the shared `trustProxy()` seam in
 *      `forwarded.js` (#1104), so this file holds no trust posture of its own.
 *
 * Scope:
 *   - Internal RPC only. A `route.ts` REST endpoint (hand-written or via the
 *     `route()` adapter) is intentionally NOT covered here; it is for external
 *     consumers and must carry its own auth.
 *   - Session / auth cookies stay `SameSite=Lax` as defense-in-depth.
 */

import { trustProxy } from './forwarded.js';

/**
 * Parse cookies off a standard Request. Retained as a general cookie reader
 * (used by `context.js` for `cookies()`), independent of CSRF.
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

/** Lower-cased host from a URL-or-origin string, or '' if unparseable. */
function hostOf(value) {
  if (!value) return '';
  try { return new URL(value).host.toLowerCase(); } catch { return ''; }
}

/**
 * The host the request was addressed to: `x-forwarded-host` when a proxy is
 * trusted to speak for the client (the Cloudflare-in-front-of-Railway setup),
 * then the `Host` header, then the request URL.
 *
 * Trust note, preserved from before this read went through `trustProxy()`
 * (#1104), because it is correct and non-obvious: reading `x-forwarded-host`
 * here was never a CSRF weakness. A CSRF attack is browser-driven and a
 * browser cannot set `x-forwarded-host` (or `Origin`); only a direct
 * non-browser client can, and such a client carries no victim SameSite
 * cookies to abuse. The primary `Sec-Fetch-Site` path does not reach this
 * function at all, only the legacy no-`Sec-Fetch-Site` fallback in
 * `verifyOrigin` does. The value CAN still be attacker-chosen, since a proxy
 * of the kind above forwards a client-supplied one rather than overwriting
 * it; see the threat model in `forwarded.js` for what that does reach.
 *
 * What changed is the POSTURE, not a hole: the read now honors
 * `WEBJS_NO_TRUST_PROXY=1` like every other forwarded-header read, so an
 * operator who sets the flag because their container is directly reachable
 * gets one answer from the whole package instead of two. Behind a proxy
 * WITHOUT the flag nothing changes. With the flag set on a genuinely proxied
 * deploy (a misconfiguration) the fallback compares `Origin` against the raw
 * `Host`, so a legitimate cross-host request can now be rejected. That is the
 * flag's intended meaning.
 *
 * @param {Request} req
 */
export function requestHost(req) {
  if (trustProxy()) {
    const xfh = req.headers.get('x-forwarded-host');
    if (xfh) return xfh.split(',')[0].trim().toLowerCase();
  }
  const host = req.headers.get('host');
  if (host) return host.toLowerCase();
  return hostOf(req.url);
}

/** Is the request's `Origin` host in the configured allowlist? */
function originAllowed(req, allowedOrigins) {
  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') return false;
  const h = hostOf(origin);
  if (!h) return false;
  const allow = new Set(
    // A full-origin entry (`https://x.example`) is host-parsed; a bare host
    // (`x.example` or a copy-pasted `x.example/`) is lower-cased and stripped
    // of a stray trailing slash so it still matches.
    allowedOrigins.map((o) => (o.includes('://') ? hostOf(o) : o.toLowerCase().replace(/\/+$/, ''))),
  );
  return allow.has(h);
}

/**
 * Cross-origin (CSRF) verification for a state-changing action request.
 * @param {Request} req
 * @param {string[]} [allowedOrigins] hosts or full origins allowed cross-site
 * @returns {{ ok: boolean, reason?: string }}
 */
export function verifyOrigin(req, allowedOrigins = []) {
  // Primary: the Sec-Fetch-Site fetch-metadata header (browser-set, not
  // forgeable by page JS, sent on every request).
  const secFetchSite = (req.headers.get('sec-fetch-site') || '').toLowerCase();
  if (secFetchSite === 'same-origin' || secFetchSite === 'none') return { ok: true };
  if (secFetchSite) {
    // 'same-site' or 'cross-site': reject unless the source origin is trusted.
    return originAllowed(req, allowedOrigins)
      ? { ok: true }
      : { ok: false, reason: `cross-origin request (Sec-Fetch-Site: ${secFetchSite})` };
  }
  // Fallback (no Sec-Fetch-Site, older browser): compare Origin host to host.
  const origin = req.headers.get('origin');
  if (!origin) return { ok: true, reason: 'no-origin' };
  const sourceHost = origin === 'null' ? 'null' : hostOf(origin);
  const host = requestHost(req);
  if (sourceHost && host && sourceHost === host) return { ok: true };
  return originAllowed(req, allowedOrigins)
    ? { ok: true }
    : { ok: false, reason: `origin ${sourceHost || '(none)'} does not match host ${host || '(none)'}` };
}

/**
 * Read `webjs.allowedOrigins` (string[]) from a parsed package.json. Pure;
 * the caller supplies the package.json read (mirrors `readBasePath`).
 * @param {unknown} pkg
 * @returns {string[]}
 */
export function readAllowedOrigins(pkg) {
  const raw =
    pkg &&
    typeof pkg === 'object' &&
    /** @type {any} */ (pkg).webjs &&
    /** @type {any} */ (pkg).webjs.allowedOrigins;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => typeof x === 'string' && x.length > 0);
}
