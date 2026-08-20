/**
 * Client router: events.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { findAnchorInPath } from './anchors.js';
import { NON_HTML_EXTENSIONS } from './constants.js';
import { enabled, markFragmentNav } from './state.js';
import { warnIfActionSubmissionCannotDeliver } from './diagnostics.js';
import { buildSubmitFormData, encodeSubmitBody, getSubmitAction, getSubmitEnctype, getSubmitMethod } from './form-encoder.js';
import { resolveTargetFrameId } from './frames.js';
import { absorbSameDocumentTraversal, performNavigation, performSubmission } from './navigator.js';

/** @param {MouseEvent} e */
export function onClick(e) {
  if (!enabled) return;
  if (e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

  const anchor = findAnchorInPath(e);
  if (!anchor) return;
  if (anchor.hasAttribute('download')) return;
  if (anchor.target && anchor.target !== '_self') return;

  const href = anchor.href;
  if (!href) return;

  const url = new URL(href);
  if (url.origin !== location.origin) return;
  // `href.includes('#')` rather than `url.hash`, because the URL serializer
  // reports BOTH a null fragment and an empty one as `''`, and only the second
  // is a fragment navigation. `href="#"` keeps its `#` in `href` and per the
  // spec navigates to the document element (the back-to-top idiom), while
  // `href=""` resolves to the current url with the fragment REMOVED, which the
  // spec reloads rather than jumping, so it must stay a router navigation. A
  // `#` cannot appear anywhere else in a serialized url: the parser encodes it
  // in the path and starts the fragment at it in the query (#1437).
  if (url.pathname === location.pathname && url.search === location.search && url.href.includes('#')) {
    // Leave a mark for the popstate this jump is about to fire. A REPEAT click
    // replaces its history entry rather than pushing, so that popstate arrives
    // with an unchanged url and is indistinguishable by comparison from a real
    // Back between two entries that share one. Provenance is the only thing
    // that separates them, and this is where the router has it (#1437).
    markFragmentNav(url.href);
    return;
  }
  // Checked AFTER the fragment bow-out on purpose. `data-no-router` opts out of
  // ROUTING, and the bow-out above routes nothing either way, but the browser
  // still performs the native jump and still fires the popstate that has to be
  // recognised. Returning here first would leave a repeat click of a
  // `data-no-router` in-page anchor unmarked, so it would arrive with an
  // unchanged url and be re-navigated destructively (#1437).
  if (anchor.hasAttribute('data-no-router')) return;
  if (NON_HTML_EXTENSIONS.test(url.pathname)) return;

  e.preventDefault();
  // Resolve the target frame. An explicit `data-webjs-frame` on (or above)
  // the anchor drives a frame by id from anywhere in the document (an
  // external sidebar/nav link), `_top` breaks out to a full-page nav, and
  // absence falls back to the closest enclosing frame (today's default).
  const frameId = resolveTargetFrameId(anchor);
  performNavigation(href, false, frameId);
}

/** @param {PopStateEvent} _e */
export function onPopState(_e) {
  // A popstate that stays on this pathname and search is not a navigation:
  // same document, same server response, and the browser has already done
  // whatever the traversal needed. Absorb it (which also records the new url)
  // rather than re-fetching and re-swapping the page out from under the reader
  // (#1437). This is the popstate sibling of the same-page bow-out on the click
  // path above, and it covers the REPEAT click of one anchor, which replaces
  // rather than pushes and so arrives here with an unchanged href.
  if (absorbSameDocumentTraversal(location.href)) return;
  // popstate has no DOM anchor, so no frame context: restore via cache or
  // refetch the whole document.
  performNavigation(location.href, true, null);
}

/**
 * Intercept form submissions. BUBBLE phase (see enableClientRouter) so we run
 * AFTER a component's per-element `@submit` handler, which is bound at-target.
 * That ordering is what makes the `if (e.defaultPrevented) return` guard below
 * work: a component that calls `e.preventDefault()` (the chat / comments forms,
 * or any JS-handled form) has already run, so we see the prevented default and
 * leave the form alone. A capture listener would fire us first, before the
 * component, defeating the guard and wrongly navigating the page out from under
 * a JS-handled form.
 *
 * Filtering mirrors Turbo's `form_submit_observer.js`:
 *   - `data-no-router` on form or submitter → full browser submit.
 *   - `formmethod="dialog"` → native <dialog> dismissal, never routed.
 *   - `target` / `formtarget` that isn't `_self` → iframe / popup target.
 *   - Cross-origin or non-HTML-extension action → let the browser handle.
 *
 * Submitter attributes (`formmethod`, `formaction`, `formenctype`) take
 * precedence over the form's own: HTML5 form-submission algorithm.
 *
 * @param {SubmitEvent} e
 */
export function onSubmit(e) {
  if (!enabled) return;
  if (e.defaultPrevented) return;

  const form = /** @type {HTMLFormElement | null} */ (e.target);
  // Duck-type check rather than `instanceof HTMLFormElement`: linkedom
  // and other non-browser DOMs don't always mark form elements as
  // instances of the window's HTMLFormElement class.
  if (!form || form.nodeType !== 1 || form.tagName !== 'FORM') return;
  if (form.hasAttribute('data-no-router')) return;

  const submitter = /** @type {HTMLElement | null} */ (e.submitter ?? null);
  if (submitter && submitter.hasAttribute('data-no-router')) return;

  // Presence, not truthiness, exactly as `getSubmitAction` resolves the action
  // (#1322). The form-submission algorithm asks whether the submitter HAS a
  // `formtarget`, so a present-but-empty one overrides the form and then means
  // the current browsing context, per the rules for choosing a navigable.
  const target = (submitter && submitter.hasAttribute('formtarget'))
    ? (submitter.getAttribute('formtarget') || '')
    : (form.getAttribute('target') || '');
  if (target && target !== '_self') return;

  const method = getSubmitMethod(form, submitter);
  if (method === 'dialog') return;

  const enctype = getSubmitEnctype(form, submitter);
  const isSafeMethod = method === 'get' || method === 'head';

  const action = getSubmitAction(form, submitter);
  /** @type {URL} */ let url;
  try { url = new URL(action, location.href); }
  catch { return; }
  if (url.origin !== location.origin) return;
  if (NON_HTML_EXTENSIONS.test(url.pathname)) return;

  // Built once, after the cheap bails (a submission the router ignores should
  // not pay for a FormData) and BEFORE the text/plain bail below. That order
  // matters for the dev report: `text/plain` is precisely the case where the
  // router declines the submission, so reporting after the bail would be dead
  // code for the one shape that most needs it, since both paths are then
  // answered with a 405 and the author gets no other signal.
  const rawBody = buildSubmitFormData(form, submitter);
  // Observational, and silent in production. Runs before `preventDefault`.
  warnIfActionSubmissionCannotDeliver(form, submitter, method, rawBody);

  // #1307: `text/plain` is a legal native encoding the server cannot parse
  // (`looksLikeFormSubmission` accepts multipart and urlencoded only), and
  // there is no honest way to send it over `fetch` and have the response mean
  // anything. Bail to the browser so BOTH paths do the same thing, rather than
  // silently sending multipart, which is what made the same form behave one
  // way with JS and another way without it. Turbo enumerates this encoding and
  // then sends FormData anyway, which is the divergence being avoided here. A
  // safe method ignores the enctype entirely, per the submission algorithm.
  if (!isSafeMethod && enctype === 'text/plain') return;

  const body = encodeSubmitBody(rawBody, enctype);

  e.preventDefault();
  // Resolve the target frame for the submit, same precedence as a link:
  // an explicit `data-webjs-frame` on (or above) the form or its submitter
  // wins, `_top` breaks out, absence falls back to the enclosing frame.
  const frameId = resolveTargetFrameId(submitter || form);
  performSubmission(url.href, method, body, frameId, form);
}

