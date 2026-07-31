/**
 * Resolve a `public/` asset url to its content-fingerprinted form, so a
 * deploy that changes the file changes the url and no cache can serve the
 * previous bytes.
 *
 *   import { html, asset } from '@webjsdev/core';
 *   html`<link rel="stylesheet" href=${asset('/public/app.css')}>`
 *
 * On the server, `@webjsdev/server` installs a provider that appends
 * `?v=<content-hash>`; the framework then serves a `?v=`-carrying request
 * `immutable` for a year instead of the short fallback. On the browser there
 * is no provider and the path is returned UNCHANGED.
 *
 * USE IT IN A PAGE, LAYOUT, OR METADATA ROUTE, not inside a component that
 * ships to the browser. Those modules render only on the server, so the
 * fingerprinted url is the one the browser sees and keeps. A component is
 * different: hydration is a full client RE-RENDER (`render-client.js` drops
 * the hydrate marker and `createInstance` replaces the SSR'd children), so
 * the client value overwrites the server one. With no provider in the
 * browser, `asset()` returns the bare path there, so an `<img src=${asset(
 * '/public/logo.svg')}>` inside a shipping component paints the hashed url
 * at SSR and then swaps it for the un-hashed one on upgrade, fetching the
 * same bytes twice and leaving the short-lived url in the DOM. It still
 * WORKS (the path is always valid), which is why this is a convention rather
 * than a `webjs check` rule, but it silently forfeits the caching the call
 * was for. Import the asset url into a layout, or accept the plain path.
 *
 * The sibling `cspNonce()` carries the same server/browser asymmetry and the
 * same scoping, for the same hydration reason.
 *
 * Call it INSIDE the render function, not at module scope. A depth-0 call is a
 * module-scope side effect, which the elision analyser reads as client work, so
 * hoisting `const CSS = asset('/public/app.css')` pins the whole page or layout
 * into the browser bundle for no benefit. Resolver ordering is not the issue
 * (the server installs its resolver at boot, before any app module loads).
 *
 * Under `webjs.basePath`, write the prefix yourself: `asset('/app/public/x.css')`.
 * The framework only base-path-prefixes urls IT emits, so an author-written
 * url is already your responsibility (an un-prefixed one 404s under a
 * sub-path deploy with or without this helper). `asset()` strips the prefix
 * to find the file and keeps it on the url it returns.
 *
 * Mark files that change only with a DEPLOY. The hash is memoized for the
 * process lifetime, and prod never rebuilds, so a `public/` file rewritten in
 * place while the server runs keeps its old url while being served `immutable`
 * for a year. A build artifact (a compiled stylesheet, a bundled script, a
 * committed image) is exactly right; a runtime-written upload is not, and
 * should keep its plain path (or carry its own version in the filename).
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
