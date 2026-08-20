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

/**
 * The href a bowed-out same-document fragment CLICK is navigating to, pending
 * the popstate that click is about to produce.
 *
 * This exists because URLs alone cannot separate the two ways a popstate can
 * arrive carrying the url the reader is already on, and the two need opposite
 * treatment (#1437).
 *
 *   - A REPEAT click of one in-page anchor REPLACES its history entry rather
 *     than pushing, so it fires popstate with `location.href` unchanged. The
 *     browser has already done the jump and there is nothing to fetch.
 *   - A Back between two DISTINCT entries that happen to share a url is a real
 *     traversal that must re-render. The no-JS write path produces that pair: a
 *     bound `<form action=${fn}>` emits no `action` attribute (invariant 12), so
 *     `form.action` reflects the node document's URL and the 422 re-render
 *     pushes a duplicate entry at it.
 *
 * An earlier attempt tried to tell them apart by whether the url carried a
 * fragment, on the reasoning that a repeat anchor click always has one and a
 * 422 entry never does. The second half is false: `form.action` returns the
 * document URL WITH its fragment (measured in Chromium, for a missing `action`
 * attribute and an empty one alike), so a reader who used an in-page anchor
 * before submitting produces a 422 entry carrying `#sec`, and the Back out of
 * the validation error was swallowed.
 *
 * So the signal is not the url, it is provenance: the router SAW the click it
 * bowed out of, and it never sees a traversal. `onClick` records the href here
 * on its way out, the very next popstate consumes it, and anything that starts
 * a real navigation or submission drops it so it cannot leak across.
 *
 * Underscore-prefixed because no source module reads the binding (they go
 * through the three functions below); its only reader is the test suite, and
 * this file's own convention is that an unprefixed export here reads as public
 * API.
 *
 * @type {string | null}
 */
export let _pendingFragmentNav = null;

/**
 * Record that a bowed-out fragment click is about to fire a popstate.
 *
 * @param {string} href The absolute href the click is navigating to.
 */
export function markFragmentNav(href) { _pendingFragmentNav = href; }

/**
 * Consume the pending mark if it matches, and clear it either way. Clearing on
 * a MISS matters as much as on a hit: a mark that outlived its popstate must
 * not sit around waiting to swallow an unrelated one.
 *
 * @param {string} href `location.href` at popstate time.
 * @returns {boolean} True when this popstate is the one that click produced.
 */
export function consumeFragmentNav(href) {
  const hit = _pendingFragmentNav !== null && _pendingFragmentNav === href;
  _pendingFragmentNav = null;
  return hit;
}

/** Drop the pending mark. Any real navigation or submission invalidates it. */
export function clearFragmentNav() { _pendingFragmentNav = null; }
