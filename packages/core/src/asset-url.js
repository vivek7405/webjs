/**
 * Resolve a `public/` asset url to its content-fingerprinted form, so a
 * deploy that changes the file changes the url and no cache can serve the
 * previous bytes. Isomorphic: importable from server-loaded AND browser-loaded
 * modules, exactly like `cspNonce()` and for the same reason (a layout must
 * load on the browser to register its component imports).
 *
 *   import { html, asset } from '@webjsdev/core';
 *   html`<link rel="stylesheet" href=${asset('/public/app.css')}>`
 *
 * On the server, `@webjsdev/server` installs a provider that appends
 * `?v=<content-hash>`; the framework then serves a `?v=`-carrying request
 * `immutable` for a year instead of the short fallback. On the browser there
 * is no provider and the path is returned UNCHANGED, which is always a
 * correct url, just an un-versioned one.
 *
 * Why this is opt-in rather than automatic. An earlier attempt (#1196)
 * rewrote asset urls by matching the assembled HTML, and two deep-review
 * rounds found six major defects, five of them the same bug: at that layer
 * framework output and author data are indistinguishable, so the matcher kept
 * touching things it did not own (a custom element's reactive prop, a
 * rendered code sample, a `rel=preload` hint whose real request comes from
 * CSS, a data-driven `src` pointing at `/.env`). Marking the url at the point
 * the author writes it makes the meaning unambiguous, so the blast radius is
 * exactly the set of urls someone deliberately marked and nothing else in the
 * document is ever read or rewritten.
 *
 * Scope note: only a `public/` path is fingerprinted, matching what the
 * static-asset route will actually serve. Anything else is returned
 * unchanged rather than guessed at.
 */

/** @type {((path: string) => string) | null} */
let _provider = null;

/**
 * Internal: server-only wiring. `@webjsdev/server` calls this once at load
 * time to install the real resolver. Browser builds never call it, so
 * `asset()` stays an identity function there.
 *
 * @param {(path: string) => string} fn
 * @returns {void}
 */
export function setAssetUrlProvider(fn) {
  _provider = fn;
}

/**
 * The runtime function. Returns the fingerprinted url on the server, or the
 * path unchanged when there is no provider (browser), when fingerprinting is
 * off (dev, so dev output stays byte-identical), or when the file cannot be
 * resolved. Every failure mode degrades to the plain path, never to a broken
 * one.
 *
 * @param {string} path  a root-absolute same-origin path, e.g. `/public/app.css`
 * @returns {string}
 */
export function asset(path) {
  if (typeof path !== 'string' || !path) return path;
  if (!_provider) return path;
  try {
    return _provider(path) || path;
  } catch {
    return path;
  }
}
