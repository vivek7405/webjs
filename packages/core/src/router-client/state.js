/**
 * Client router: state.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */

/**
 * Monotonic counter incremented at the start of every navigation. Each
 * async path captures the value at its entry point and compares before
 * applying side effects (swap, restore-optimistic). A mismatch means a
 * newer nav superseded this one: bail out silently. Belt-and-suspenders
 * on top of AbortController: covers paths where a response has already
 * resolved past the await but a newer nav started before applySwap ran.
 */
export let currentNavigationToken = 0;

/**
 * The one place the router hands a navigation back to the browser.
 *
 * Every hard navigation the router performs goes through here rather than
 * assigning `location.href` inline, so a browser test can observe it. The
 * default is exactly the assignment it replaces, so behaviour is unchanged
 * unless something calls `setHardNavigate`.
 *
 * This exists because a hard navigation is UNOBSERVABLE and UNPREVENTABLE from
 * outside. `preventDefault` cancels a default action, not a script assignment,
 * and `location.href` is non-configurable on Chromium, Firefox, and WebKit
 * alike, so a test cannot redefine its setter either (measured; the older
 * `spyOnReload` helper that tried was silently a no-op on every engine). In a
 * web-test-runner session a real navigation aborts the WHOLE session, so one
 * degradation destroys every remaining browser test file and reports `0 failed`
 * on the way out. A seam is the only thing that makes it catchable.
 *
 * @param {string} href
 */
export let hardNavigate = (href) => { location.href = href; };

/**
 * Test-only: replace the hard-navigate action so a browser test can observe a
 * navigation instead of being destroyed by it. Call with no argument to
 * restore. Underscore-prefixed and kept in this block like every other
 * test-only export here, so it stays out of `router-client.d.ts` and out of
 * the app-facing API (the `./client-router` subpath resolves this file under
 * the `source` condition, so an unprefixed name here would read as public).
 *
 * @param {((href: string) => void) | null} [fn]
 */
export function _setHardNavigate(fn) {
  hardNavigate = fn || ((href) => { location.href = href; });
}

/** Test-only: read the monotonic navigation-token counter. */
export function _navToken() { return currentNavigationToken; }

/** Test-only: bump the navigation-token counter (simulates a fresh nav). */
export function _bumpNavToken() { return ++currentNavigationToken; }

/**
 * Bump the navigation token and return the new value.
 *
 * The navigator opens every navigation with `++currentNavigationToken`, and the
 * counter lives here beside the `_navToken` seam that reads it. An ESM import
 * binding cannot be incremented from another module, so the navigator calls
 * this and keeps the same capture-then-compare pattern.
 */
export function bumpNavToken() {
  return ++currentNavigationToken;
}

/**
 * Whether the client router is currently intercepting navigations.
 *
 * Owned here rather than in navigator.js because `events.js` and
 * `prefetch.js` both gate on it, so parking it beside the code that flips it
 * made two leaf-ward modules import the orchestrator and pulled them into the
 * router's import cycle. navigator.js still owns the TRANSITIONS through
 * `_setEnabled`; this module just holds the bit.
 */
export let enabled = false;

/**
 * Flip the router-enabled bit. Called only by enableClientRouter /
 * disableClientRouter in navigator.js.
 *
 * @param {boolean} v
 */
export function _setEnabled(v) {
  enabled = v;
}
