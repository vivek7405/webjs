/**
 * Client router: diagnostics.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { FORM_ACTION_FIELD } from '../form-action.js';
import { FALLBACK_MARKER_KEY } from './constants.js';
import { disableClientRouter, enableClientRouter, navigate } from './navigator.js';
import { prefetch } from './prefetch.js';

/**
 * Emit a `console.warn` at most once per `key` for the lifetime of the
 * page, so a repeated misconfiguration (a stale `data-webjs-frame` clicked
 * many times) does not spam the console.
 *
 * @type {Set<string>}
 */
const warnedKeys = new Set();

/** @param {string} key @param {string} message */
export function warnOnce(key, message, level = 'warn') {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (typeof console === 'undefined') return;
  const fn = level === 'error' ? console.error : console.warn;
  if (fn) fn.call(console, message);
}

/**
 * DEV-ONLY: report at submit time when a submission is carrying a bound
 * action's identity it cannot actually deliver (#1307).
 *
 * This is the backstop for the shapes the renderer deliberately stopped
 * refusing. A PLAIN `<button formmethod="get">` inside a bound form is a legal
 * native override, so it renders, and the form's action then simply does not
 * run. That is what the author asked for, but it is also what a mistake looks
 * like, and submit time is the only moment the whole picture (the resolved
 * method, the resolved enctype, and whether a bound identity is actually in
 * the body) exists in one place.
 *
 * Observational: it runs BEFORE `preventDefault` and changes nothing about the
 * submission. Silent in production, where a console error would be noise the
 * visitor cannot act on; the server-side `onError` telemetry covers that side.
 *
 * @param {HTMLFormElement} form
 * @param {HTMLElement | null} submitter
 * @param {string} method lowercased, already resolved with native precedence
 * @param {FormData} body
 */
export function warnIfActionSubmissionCannotDeliver(form, submitter, method, body) {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  // No identity in the body: an ordinary form with nothing to deliver.
  if (!body.has(FORM_ACTION_FIELD)) return;
  let path = '';
  try { path = new URL(form.getAttribute('action') || location.href, location.href).pathname; }
  catch { path = location.pathname; }
  if (method !== 'post') {
    warnOnce(
      `submit-nowhere:${path}:${method}`,
      `[webjs] this submission carries a bound server action's identity but submits as ${method.toUpperCase()}, which sends no body, so the identity rides the query string and the action never runs. A submitter's own formmethod overrides the form's, and WebJs honours it rather than refusing it, so check for a formmethod on the button that was pressed.`,
      'error',
    );
    return;
  }
  const enctype = (submitter && submitter.getAttribute('formenctype'))
    || form.getAttribute('enctype')
    || 'application/x-www-form-urlencoded';
  // `text/plain` ONLY, not the renderer's parseable-enctype allowlist.
  // `enctype` is an enumerated attribute whose missing AND invalid value
  // defaults are both `application/x-www-form-urlencoded`, so
  // `enctype="nonsense"` submits a perfectly parseable body and the action
  // runs. Testing against the allowlist would report that working form as
  // broken.
  if (enctype.toLowerCase() === 'text/plain') {
    warnOnce(
      `submit-nowhere:${path}:${enctype}`,
      `[webjs] this submission carries a bound server action's identity but declares enctype="${enctype}", which the server cannot parse. The router declines to send it so both paths behave the same way, and both are answered with a 405. Drop the enctype and let the binding supply it.`,
      'error',
    );
    return;
  }
  // The identity is going somewhere OTHER than this page (#1307). A bound
  // submitter emits no `formaction` url, so the submission targets whatever the
  // FORM targets, and a form declaring its own `action="/x"` sends its buttons
  // to `/x` by ordinary native precedence.
  //
  // This is the one shape the redesign left both unrefused and, until here,
  // unreported. The renderer used to throw for it, but only where it could SEE
  // the form, which is exactly the cross-element judgement that could not be
  // made from inside a component. So it is reported at submit time instead,
  // where the resolved target is a fact rather than an inference.
  //
  // A warning rather than an error, because it is not necessarily wrong: if
  // `/x` is a PAGE route the action really does run there, and the 422
  // re-render simply lands on that page. It is only dead if `/x` is a
  // `route.ts`, another origin, or nothing at all, and the client cannot tell
  // which from here.
  if (path && path !== location.pathname) {
    warnOnce(
      `submit-elsewhere:${path}`,
      `[webjs] this submission carries a bound server action's identity but posts to "${path}" rather than this page, because the enclosing <form> declares its own action. A bound submitter emits no formaction, so the form's target wins, which is what native HTML does. The action runs only if "${path}" is a page route; against a route.ts or another origin the identity is ignored and nothing runs. Drop the form's action attribute to keep the submission on this page.`,
    );
  }
}

/**
 * True when a nav must degrade to a full page load because the document is
 * still parsing. A forward, main-document nav fired at `readyState: 'loading'`
 * races the DOM: the leaving page's closing layout markers may not be attached
 * yet, so a soft swap would snapshot an incomplete tree and corrupt the DOM
 * (#1008 / #936). Scoped to frameless forward navs (popstate is browser-driven,
 * a frame nav carries its own boundary element).
 *
 * @param {boolean} isPopState
 * @param {string | null | undefined} frameId
 * @returns {boolean}
 */
export function shouldFullLoadDuringParse(isPopState, frameId) {
  return (
    !isPopState &&
    !frameId &&
    typeof document !== 'undefined' &&
    document.readyState === 'loading'
  );
}

/**
 * Has the pre-boot check already run for THIS document (#1118)? Module scope,
 * so it resets with the document, which is the lifetime the report is about.
 */
let reportedPreBoot = false;

/**
 * Was THIS document load a same-origin navigation the client router never saw?
 *
 * Pure so the branch logic is testable without driving a real navigation
 * (#1118). Every argument is read from the environment by the one caller.
 *
 * @param {string} navType `performance.getEntriesByType('navigation')[0].type`.
 *   Only `'navigate'` qualifies: a `'reload'` and a `'back_forward'` restore are
 *   things the browser does, not clicks the router could have intercepted.
 * @param {string} referrer `document.referrer`. Must parse to the same origin as
 *   `href`: an empty referrer means a typed URL or an external entry (no router
 *   was running to miss the click), and a cross-origin one means the previous
 *   page was not ours.
 * @param {string} href `location.href` of the document that just loaded.
 * @param {string | null} marker the consumed `FALLBACK_MARKER_KEY` value. When
 *   it equals `href` the router already reported this load under its own cause,
 *   so counting it again would double-count a known degradation as an unknown.
 * @returns {boolean}
 */
export function isPreBootNavigation(navType, referrer, href, marker) {
  if (navType !== 'navigate') return false;
  if (!referrer) return false;
  if (marker && marker === href) return false;
  try {
    return new URL(referrer).origin === new URL(href).origin;
  } catch {
    return false;
  }
}

/**
 * Report a document load that reached us by a same-origin navigation the router
 * did not soft-navigate (#1118).
 *
 * A module script is deferred by spec, so it runs only after HTML parsing
 * completes, while the links it will intercept are clickable from first paint.
 * That window cannot be closed from inside the router (see #1118 for why an
 * inline capture shim was rejected), so it is MEASURED instead: this turns the
 * frequency into a production number a deployed app can read off the existing
 * `webjs:navigation-fallback` channel, rather than folklore.
 *
 * Deliberately imprecise, and the docs say so: a `data-no-router` link, a
 * cross-document form post, and an app that opted out of the client router all
 * land here too. The signal is the RATE, not any single event.
 *
 * `willReload` is false because the document load has already happened. That is
 * exactly the distinction the flag was added for.
 */
export function reportPreBootNavigation() {
  // Same guard the scroll/current-page seeding above uses: a DOM shim without a
  // `location` (linkedom under the unit runner) is not a document load to
  // report on, and reading through would throw inside the boot.
  if (typeof location === 'undefined') return;
  // Once per DOCUMENT, not once per enable. `enableClientRouter` is re-callable
  // after `disableClientRouter()` (the documented per-moment opt-out), and this
  // reports on the load that produced the document, which does not happen again
  // when the router is toggled back on. Without this, an app that toggles would
  // emit a duplicate for a single load and inflate the very rate the report
  // exists to measure. The marker is already consumed by then, so it cannot
  // suppress the duplicate on its own.
  if (reportedPreBoot) return;
  reportedPreBoot = true;
  /** @type {string | null} */
  let marker = null;
  try {
    marker = sessionStorage.getItem(FALLBACK_MARKER_KEY);
    // Consume unconditionally, even when it does not match: a stale marker left
    // by an earlier navigation must never suppress a later real one.
    sessionStorage.removeItem(FALLBACK_MARKER_KEY);
  } catch {
    // No marker available. Treated as absent, which can only over-report.
  }
  let navType = '';
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    navType = nav ? /** @type {PerformanceNavigationTiming} */ (nav).type : '';
  } catch {
    // No Navigation Timing Level 2 entry. Without a nav type the check cannot
    // exclude a reload, so it reports nothing rather than guessing.
  }
  if (isPreBootNavigation(navType, document.referrer, location.href, marker)) {
    reportFallback('pre-boot-navigation', location.href, false);
  }
}

/**
 * The client router degraded a soft navigation. Records WHY (the `cause`), so
 * "why did my SPA nav do a full reload?" is answerable instead of guessed at.
 *
 * Two channels, deliberately different in reach:
 *
 * - A **`webjs:navigation-fallback` event on `document`, in EVERY environment**,
 *   detail `{ cause, href, willReload }`. Dispatch convention matches
 *   `webjs:navigate` / `webjs:prefetch` / `webjs:navigation-error`.
 * - A dev-only console warning, deduped per cause so a repeat does not spam.
 *
 * The event exists because the console warning alone made this class of bug
 * UNDIAGNOSABLE in production (#1114). A degradation is correct behaviour, not
 * an error, so nothing was logged and nothing was thrown, and a deployed app had
 * no way to observe that a click had turned into a full document load. The
 * user-visible symptoms (a loading spinner in the browser tab, a whole-document
 * flash including preserved chrome) were then attributed to a styling problem
 * for a full investigation cycle, because the actual cause emitted no signal.
 *
 * An event costs nothing when nobody listens, is greppable from a page console,
 * and lets a deployed app wire this to analytics. It is NOT cancelable: by the
 * time this fires the decision to degrade is already made and is the only safe
 * option (#1015 chose a bounded full load over a heuristic recovery that could
 * corrupt the DOM silently), so there is nothing for a listener to veto.
 *
 * @param {string} cause a short stable slug for the degradation reason
 * @param {string} href the destination the router fell back to loading
 * @param {boolean} [willReload] true when a full document load follows (the
 *   default). False for a degradation that does NOT reload, so a listener can
 *   tell "this click became a document load" from "this background op was
 *   dropped", which are very different user-visible events.
 */
export function reportFallback(cause, href, willReload = true) {
  if (willReload) {
    // Leave a marker naming the destination this full load is going to
    // (#1118). The next document's boot reads it to tell "the router itself
    // chose this full load, and already reported it under its own cause" from
    // "a same-origin navigation the router never saw", which is the pre-boot
    // click window. Best-effort: `sessionStorage` throws in some privacy modes
    // and partitioned contexts, and a diagnostic must never break a navigation.
    try {
      sessionStorage.setItem(FALLBACK_MARKER_KEY, href);
    } catch {
      // Without the marker the next boot may attribute this load to the
      // pre-boot window. That is a false positive in a diagnostic, which is
      // strictly better than a thrown navigation.
    }
  }
  if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') {
    try {
      document.dispatchEvent(new CustomEvent('webjs:navigation-fallback', {
        detail: { cause, href, willReload },
      }));
    } catch {
      // A listener that throws must never turn a correct degradation into a
      // broken navigation. Diagnostics are strictly best-effort.
    }
  }
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  // Word the warning from `willReload`: several causes deliberately do NOT
  // reload (a suppressed deploy reload, a discarded background revalidation),
  // and claiming a full page load for those sends a reader hunting the wrong
  // symptom.
  warnOnce(
    `fallback:${cause}`,
    willReload
      ? `[webjs] client router fell back to a full page load (${cause}) navigating to ${href}. This is correct (no DOM corruption), just not a soft nav.`
      : `[webjs] client router degraded a soft navigation (${cause}) for ${href}, without a full page load.`
  );
}

/**
 * Dev-only, fire-once-per-id hint: a streamed Suspense resolution arrived but
 * its boundary placeholder was not in the DOM, so it was dropped (#1051). This
 * is benign when the navigation was superseded, degraded to a full load, or
 * discarded, but a stuck skeleton that is NONE of those has no other signal (it
 * is what made the #1048 view-transition race hard to diagnose). Never warns in
 * production, never throws.
 *
 * @param {string} id the streamed boundary id that could not be applied
 */
export function warnDropped(id) {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  warnOnce(
    `stream-drop:${id}`,
    `[webjs] dropped a streamed Suspense resolve for "${id}": no #${id} boundary in the DOM. Benign if this navigation was superseded or degraded. A stuck skeleton here means the shell swap did not place the boundary.`
  );
}

/**
 * Dev-only, fire-once hint: the router forces an INSTANT scroll-to-top on a
 * forward navigation (matching a native page load), so an app-level
 * `scroll-behavior: smooth` on <html> does not affect route transitions (it
 * still applies to in-page #anchor links via `scrollIntoView`). A developer
 * who set smooth expecting smooth nav scrolling would otherwise be puzzled.
 * Also flags the iOS sticky-`backdrop-filter` flash this combination can
 * cause (#610). Never warns in production, never throws.
 *
 * The `smoothScrollChecked` flag gates the `getComputedStyle` read (a forced
 * style flush) to AT MOST ONCE per page, so a dev session does not pay a
 * per-navigation reflow after the first forward nav.
 */
let smoothScrollChecked = false;

export function warnIfSmoothScrollOnHtml() {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') return;
  if (smoothScrollChecked) return;
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return;
  const root = document.documentElement;
  if (!root) return;
  smoothScrollChecked = true;
  let behavior;
  try { behavior = getComputedStyle(root).scrollBehavior; } catch { return; }
  if (behavior !== 'smooth') return;
  warnOnce(
    'scroll-behavior-smooth-html',
    '[webjs] Detected `scroll-behavior: smooth` on <html>. The client router scrolls ' +
    'to the top instantly on navigation (like a native page load), so route transitions ' +
    'are not affected by it. It still applies to in-page #anchor links. Pairing it with a ' +
    'sticky `backdrop-filter` header can also flash on iOS during navigation.'
  );
}

/**
 * Nav-in-flight signalling. The router can expose `data-navigating` on <html>
 * so an app may style a loading indicator with `html[data-navigating] { … }`.
 *
 * This is OPT-IN, set only when the app marks `<html data-webjs-nav-progress>`.
 * The reason it is not unconditional: toggling ANY attribute on the root
 * re-runs global style resolution, and on WebKit (so every iOS browser, since
 * they all use it) that re-resolves `oklch()` / `color-mix(in oklch, …)` token
 * values to an equivalent oklab representation and repaints them for one frame.
 * On a token-driven theme that is a visible background flash on navigation
 * (#610). The flash only shows on a nav slow enough to reach the deferred set
 * below, which a desktop nav rarely is but a mobile forward fetch routinely is,
 * so the symptom is iOS-and-forward-only. With no opt-in the attribute is never
 * written, so the re-resolution never happens and the flash cannot occur.
 */
export function setNavigating(on) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root || !root.hasAttribute('data-webjs-nav-progress')) return;
  try {
    if (on) root.setAttribute('data-navigating', '');
    else root.removeAttribute('data-navigating');
  } catch { /* non-DOM environment */ }
}

/* ====================================================================
 * Boundary discovery (the heart of the partial-swap mechanism, #1015)
 * ==================================================================== */

/** Test-only: clear the fire-once warning guards so a case can be re-exercised. */
export function _resetWarnOnce() { warnedKeys.clear(); smoothScrollChecked = false; }

/** Test-only: the readyState-loading full-load degradation predicate (#1008). */
export function _shouldFullLoadDuringParse(isPopState, frameId) {
  return shouldFullLoadDuringParse(isPopState, frameId);
}
