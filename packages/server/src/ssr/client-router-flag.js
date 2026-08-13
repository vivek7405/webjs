/**
 * The app-wide client-router opt-out flag (#629).
 *
 * Default ON (the framework's automatic-nav thesis): the router auto-enables in
 * the browser when `@webjsdev/core` loads. `webjs.clientRouter: false` flips it
 * off app-wide; the dev server reads the config at boot and on each rebuild and
 * calls `setClientRouterEnabled`, and `wrapHead` then emits a
 * `window.__WEBJS_CLIENT_ROUTER__=false` flag BEFORE the deferred boot module
 * so the bundle's module-end auto-enable skips.
 *
 * A module-level switch (mirroring `setBasePath` / `setElisionFingerprint`) so
 * no opt has to thread through every render path. Default true keeps every
 * existing app and test byte-identical.
 *
 * It sits in its own module rather than beside its readers because it has TWO
 * of them, in `head.js` and `render.js`, and parking it in either made the
 * other import across what was otherwise a one-way edge. That was the second
 * half of the ssr import cycle. The rule the pre-split file stated, that module
 * state belongs with the code that uses and writes it, is unchanged for state
 * with a single reader: `_metadataIconRoutes` still lives in `head.js`, whose
 * `wrapHead` is the only thing that reads it.
 */

// Client-router opt-out (#629). Default ON (the framework's automatic-nav
// thesis): the router auto-enables in the browser when `@webjsdev/core` loads.
// `webjs.clientRouter: false` flips this off app-wide; `dev.js` reads the
// config at boot / each rebuild and calls `setClientRouterEnabled`, and
// `wrapHead` then emits a `window.__WEBJS_CLIENT_ROUTER__=false` flag BEFORE
// the deferred boot module so the bundle's module-end auto-enable skips. A
// module-level switch (mirrors setBasePath / setElisionFingerprint) so no opt
// has to thread through every render path; default true keeps every existing
// app and test byte-identical.
let _clientRouterEnabled = true;

/**
 * Set the app-wide client-router flag.
 *
 * @param {boolean} enabled  anything but `false` enables
 */
export function setClientRouterEnabled(enabled) {
  _clientRouterEnabled = enabled !== false;
}

/**
 * Whether the client router is enabled app-wide.
 *
 * @returns {boolean}
 */
export function clientRouterEnabled() {
  return _clientRouterEnabled;
}
