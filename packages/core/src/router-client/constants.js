/**
 * Client router: constants.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */

/** The content type a content-negotiated stream-action response carries (#248). */
export const STREAM_MIME = 'text/vnd.webjs-stream.html';

/**
 * Client router for webjs: nested-layout-aware partial swap.
 *
 * Intercepts same-origin link clicks and form submissions, fetches the
 * target page's HTML via `fetch()`, finds the deepest layout boundary
 * shared by both the current and incoming pages, and replaces ONLY the
 * children of that boundary. Outer layout DOM (header, sidenav, footer)
 * stays mounted: no re-render, no flicker, scroll positions preserved.
 *
 * Enablement is automatic: this module calls `enableClientRouter()` at its
 * end (idempotent), and the `@webjsdev/core` browser entry loads it, so any
 * page that ships a component gets the router with no import to add. Call
 * `disableClientRouter()` to opt out, or `enableClientRouter()` for
 * programmatic control.
 *
 * Mechanism: auto-derived from folder structure (#1015):
 *   1. SSR injects KEYED boundary comment pairs around each layout's
 *      `${children}` interpolation and around the page itself:
 *      `<!--wj:children:<segment>:<route-key>-->` ... `<!--/wj:children:<segment>-->`.
 *      The close carries the segment (deterministic id-matched pairing, no
 *      LIFO), the open carries the resolved route-key (param values
 *      percent-encoded).
 *   2. On link click, STRICTLY scan both the live DOM and the incoming HTML
 *      into segment → {routeKey, range} maps. Any pairing violation poisons
 *      the scan.
 *   3. Two-tier DECISION (Next.js remount parity), nothing applied yet: a
 *      CHANGED route-key REPLACES (fresh remount) at the PARENT of the
 *      shallowest changed boundary (whose range contains the changed layout's
 *      own markup), else MORPH (keyed reconcile preserving input values,
 *      scroll, popover state, and node identity) at the deepest shared
 *      boundary.
 *   4. A poisoned scan or no shared boundary degrades to a FULL PAGE LOAD:
 *      bounded and correct, never a guessed recovery.
 *   5. Commit, in this order: `history.pushState`, then merge head, then apply
 *      the replace/morph from step 3, then re-run scripts and upgrade custom
 *      elements. The push leads because WebKit binds a same-document entry's
 *      back-forward gesture snapshot to the page state when the entry is
 *      recorded, so recording it after the content swap makes an iOS
 *      back-swipe preview the destination instead of the page being returned
 *      to (#1406).
 *
 * Optimizations bundled into the same response cycle:
 *   - `X-Webjs-Have` request header lists `segment:route-key` entries for
 *     the boundaries the client already has. The server walks the target's
 *     layout chain and short-circuits at the deepest FULL match (segment AND
 *     key, so a dynamic layout held for other params is re-rendered), then
 *     returns only the divergent fragment (wrapped in the matched boundary).
 *     Real wire-byte savings: the layout chain is never re-serialized for
 *     same-shell navigations.
 *   - URL-keyed snapshot cache (Turbo SnapshotCache pattern). Back/
 *     forward via popstate restores from cache instantly, then
 *     revalidates in the background.
 *   - Per-segment loading templates: SSR emits each segment's
 *     loading.ts content as `<template id="wj-loading:<path>">`. On
 *     nav-start the client clones the deepest matching template into
 *     the swap slot so users see an instant skeleton instead of stale
 *     content.
 *
 * Escape hatch:
 *   `<webjs-frame id="...">`: declarative partial-swap region NOT
 *   tied to a folder layout. If a link's enclosing `closest('webjs-frame')`
 *   matches a frame in the incoming HTML, the frame swap takes
 *   precedence over the layout-marker mechanism. Use for ad-hoc
 *   widgets (tabs, lazy-loaded cards) where the swap region isn't a
 *   folder route segment.
 */

/**
 * Hard ceiling on the restore window (#1310). The revalidation is a
 * same-origin GET of a page the browser rendered moments ago, so this is
 * generously past its p99. It exists only so a hung or never-settling fetch
 * can never leave scroll anchoring suppressed for the life of the page.
 */
export const ANCHOR_SUPPRESS_CEILING_MS = 2000;

/**
 * Floor on the restore window (#1310). The window's other closer is the
 * revalidation settling, which is only long enough while the revalidation is
 * SLOWER than the restored page's own upgrade-and-render. That holds on a
 * deployed site (measured: growth ~65ms after the swap, the revalidation's swap
 * ~300ms after that) but it is a property of one deployment, not a guarantee: a
 * local server, a 304, or a warm cache answers in single-digit milliseconds and
 * would otherwise close the window before the growth it exists to absorb.
 *
 * So the window lasts at least this long whatever the network does. The value
 * clears the measured revalidation swap with margin and stays well under the
 * ceiling. It is a floor, not a delay: a real user input still closes the
 * window immediately, which is the case that actually matters for not holding
 * anchoring off longer than a reader would want.
 */
export const ANCHOR_SUPPRESS_FLOOR_MS = 500;

/**
 * Inputs that mean the reader has taken over the viewport, so the restore is
 * over and the browser's own anchoring should resume.
 *
 * NOT `scroll`. The router's own `scrollTo` and anchoring itself both fire
 * `scroll`, so it cannot tell a reader apart from the restore it is guarding,
 * and no threshold makes it able to. These are input events, so there is
 * nothing to threshold out and the FIRST one closes the window. `keydown` is
 * deliberately not narrowed to scrolling keys: any keypress means interaction,
 * and closing early only restores the browser default, which is the safe
 * direction to err in.
 *
 * @type {string[]}
 */
export const ANCHOR_RELEASE_EVENTS = ['wheel', 'touchmove', 'keydown', 'pointerdown'];

/**
 * Pathnames with these extensions are never HTML pages.
 */
export const NON_HTML_EXTENSIONS = /\.(?:pdf|zip|tar|gz|7z|rar|dmg|exe|msi|deb|rpm|apk|ipa|xlsx?|docx?|pptx?|csv|odt|ods|odp|rtf|epub|mobi|xml|json|rss|atom|txt|md|wasm|mp3|mp4|mov|avi|webm|ogg|flac|wav|m4a|m4v|mkv|png|jpe?g|gif|webp|avif|bmp|ico|svg|tiff?|heic)$/i;

/**
 * The reserved `data-webjs-frame` token that forces a full-page navigation,
 * breaking OUT of any enclosing frame (Turbo's `data-turbo-frame="_top"`).
 * `resolveTargetFrameId` returns this sentinel; callers treat it exactly
 * like "no frame" (a normal layout-marker / full-body swap), so a trigger
 * physically nested in a frame escapes the frame swap. Distinct from `null`
 * only inside `resolveTargetFrameId` (where `null` would otherwise fall back
 * to the enclosing frame); both reach `performNavigation` as a frameless
 * nav, so they behave identically downstream.
 */
export const FRAME_TOP = '_top';

/**
 * `sessionStorage` key holding the destination of a full load the ROUTER
 * itself chose (#1118). Written by `reportFallback` when `willReload` is true,
 * consumed once by the next document's boot. Per-tab and cleared with the tab,
 * which is the right lifetime for a marker about one navigation.
 */
export const FALLBACK_MARKER_KEY = 'webjs:nav-fallback';

export const SNAPSHOT_CAP = 16;

/**
 * Attribute names whose live DOM state must NEVER be overwritten by
 * incoming server HTML during a partial swap. The server emits these
 * with their initial-render value; the user may have typed/clicked
 * between renders. Preserving them keeps focus, typing, open state,
 * and popover state intact across navigation.
 */
export const LIVE_ATTRS = new Set([
  // Form controls
  'value', 'checked', 'selected', 'indeterminate', 'disabled',
  // Disclosure / popover
  'open', 'popover',
]);

/* ====================================================================
 * Optimistic loading (per-segment loading.ts templates)
 * ==================================================================== */

/**
 * The one framework-owned keyed meta that must NEVER be reconciled: the CSP
 * nonce. A soft-nav response carries a FRESH per-request nonce, but the browser
 * enforces CSP against the nonce the ORIGINAL page load declared (see
 * `getCspNonce`), so overwriting the live `csp-nonce` meta with the incoming
 * one would make every later nonce-stamped script/preload violate the active
 * policy. Excluded from add/update/remove so the original meta survives verbatim.
 */
export const META_KEY_CSP_NONCE = 'name=csp-nonce';

/**
 * Predicate used by the onClick handler to decide whether a same-origin
 * href should bypass the router. Exposed for unit testing.
 *
 * @param {string} pathname
 * @returns {boolean}
 */
export function _isNonHtmlPath(pathname) {
  return NON_HTML_EXTENSIONS.test(pathname);
}
