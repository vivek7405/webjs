/**
 * Client router: frames.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { FRAME_TOP } from './constants.js';
import { warnOnce } from './diagnostics.js';
import { outerHTMLForDiff } from './head-merge.js';
import { applySwap } from './swap.js';

/**
 * Find the id of the innermost <webjs-frame> enclosing `el`, walking up
 * through normal DOM and any shadow boundaries it crosses. Returns null
 * if the element is not inside any frame.
 *
 * @param {Element | null} el
 * @returns {string | null}
 */
export function activeFrameId(el) {
  /** @type {Element | null} */
  let cur = el;
  while (cur) {
    const frame = cur.closest('webjs-frame');
    if (frame && frame.id) return frame.id;
    // Cross shadow boundary upwards if necessary.
    const root = cur.getRootNode();
    if (root && /** @type any */ (root).host) {
      cur = /** @type any */ (root).host;
    } else {
      break;
    }
  }
  return null;
}

/**
 * Resolve which `<webjs-frame>` (if any) a trigger drives, honoring an
 * explicit `data-webjs-frame` attribute before the closest-enclosing-frame
 * default. Models Turbo's `data-turbo-frame` external targeting:
 *
 *   - `data-webjs-frame="<id>"` on (or above) the trigger drives the frame
 *     with that id, resolved via `getElementById` in the CURRENT document.
 *     This lets an EXTERNAL link / form (a sidebar, a filter form) drive a
 *     content frame it is NOT DOM-nested in. If the id does not resolve to a
 *     live `<webjs-frame>`, we warn ONCE and fall back to a normal full nav
 *     (the fail-safe posture: never throw, never silently swap the wrong
 *     region).
 *   - `data-webjs-frame="_top"` forces a full-page navigation even when the
 *     trigger is inside a frame, returning `null` so the swap escapes to the
 *     layout-marker / full-body path.
 *   - No `data-webjs-frame` keeps today's behavior: the innermost enclosing
 *     frame via `activeFrameId`.
 *
 * Resolution precedence: explicit `data-webjs-frame` > closest enclosing
 * frame. The attribute is read with `closest('[data-webjs-frame]')` so it
 * may live on the trigger itself or any ancestor (e.g. a `<nav>` wrapping a
 * set of links that all target one frame).
 *
 * @param {Element | null} trigger
 * @returns {string | null}  A frame id to swap, or null for a full nav.
 */
export function resolveTargetFrameId(trigger) {
  if (!trigger) return null;
  const carrier = trigger.closest && trigger.closest('[data-webjs-frame]');
  const explicit = carrier
    ? (/** @type {HTMLElement} */ (carrier).dataset
        ? /** @type {HTMLElement} */ (carrier).dataset.webjsFrame
        : carrier.getAttribute('data-webjs-frame'))
    : null;
  if (explicit != null && explicit !== '') {
    if (explicit === FRAME_TOP) {
      // Break out: a full-page nav, never a frame swap.
      return null;
    }
    // External targeting by id. Resolve in the current document.
    const el = typeof document !== 'undefined' ? document.getElementById(explicit) : null;
    if (el && el.tagName && el.tagName.toLowerCase() === 'webjs-frame') {
      return explicit;
    }
    // Unresolvable id: warn once, fall back to a normal full nav so the
    // click still works rather than swapping nothing or the wrong region.
    warnOnce(
      `webjs:frame-unresolved:${explicit}`,
      `[webjs] data-webjs-frame="${explicit}" did not match a live <webjs-frame id="${explicit}">; performing a normal navigation instead.`,
    );
    return null;
  }
  // No explicit target: today's closest-enclosing-frame default.
  return activeFrameId(trigger);
}

/**
 * The nav token that currently OWNS each frame's busy state. Under two rapid
 * frame navs the router aborts the first; its `finally` would otherwise clear
 * `aria-busy` that the SECOND nav already re-set, leaving the frame falsely
 * idle while still loading (and an unbalanced busy-event stream). A clear only
 * fires when its token still owns the frame, so the superseding nav's busy
 * state survives the aborted nav's teardown.
 *
 * @type {WeakMap<Element, number>}
 */
export const frameBusyTokens = new WeakMap();

/**
 * Set `aria-busy="true"` on the live `<webjs-frame id>` element and announce
 * the start of its load with a bubbling `webjs:frame-busy` event (detail
 * `{ frameId, busy: true }`), mirroring Turbo's `frame.markAsBusy`. Stamps the
 * nav `token` as the frame's busy owner (see `frameBusyTokens`). Returns the
 * resolved frame element so `clearFrameBusy` can target the SAME node even if
 * the swap later replaces the frame's id lookup (the element identity is stable
 * across a child-only frame swap). Returns null when the frame is not in the
 * live DOM (e.g. a stale external `data-webjs-frame` that slipped the
 * resolve-time check), so nothing to mark.
 *
 * @param {string} frameId
 * @param {number} token
 * @returns {Element | null}
 */
export function markFrameBusy(frameId, token) {
  if (typeof document === 'undefined') return null;
  let frame = null;
  try {
    frame = document.querySelector(`webjs-frame#${CSS.escape(frameId)}`);
  } catch { frame = document.getElementById(frameId); }
  if (!frame) return null;
  // Dispatch the `true` edge only on a real idle -> busy transition, so a nav
  // that supersedes an in-flight one (frame already busy) does not emit a
  // redundant `true`. The token always advances to the newest owner.
  const wasBusy = frameBusyTokens.has(frame);
  frameBusyTokens.set(frame, token);
  frame.setAttribute('aria-busy', 'true');
  if (!wasBusy) {
    frame.dispatchEvent(new CustomEvent('webjs:frame-busy', {
      bubbles: true,
      detail: { frameId, busy: true },
    }));
  }
  return frame;
}

/**
 * Clear the busy state set by `markFrameBusy`: set `aria-busy="false"` and
 * dispatch the matching `webjs:frame-busy` (detail `{ frameId, busy: false }`)
 * so app code sees a symmetric start/finish pair. Mirrors Turbo's
 * `frame.clearBusyState`. Operates on the element captured at start, so an
 * abort / error clears the same node the start marked. A clear whose token no
 * longer owns the frame (a newer nav re-set busy) is a stale teardown from a
 * superseded nav and is skipped, so the live nav stays busy.
 *
 * @param {Element} frame
 * @param {number} token
 */
export function clearFrameBusy(frame, token) {
  if (frameBusyTokens.get(frame) !== token) return;
  frameBusyTokens.delete(frame);
  frame.setAttribute('aria-busy', 'false');
  const frameId = frame.id || null;
  frame.dispatchEvent(new CustomEvent('webjs:frame-busy', {
    bubbles: true,
    detail: { frameId, busy: false },
  }));
}

/**
 * The nav token that currently OWNS each form's submission-busy state. Same
 * role as `frameBusyTokens` for frames: under two rapid submits the router
 * aborts the first, and its `finally` would otherwise clear `aria-busy` /
 * dispatch `webjs:submit-end` for a submission the SECOND submit already
 * re-set, leaving the form falsely idle while still submitting (and an
 * unbalanced start/end event stream). A clear only fires when its token still
 * owns the form, so the superseding submit's busy state survives the aborted
 * submit's teardown.
 *
 * @type {WeakMap<Element, number>}
 */
export const formBusyTokens = new WeakMap();

/**
 * Mark a submitting `<form>` busy: set the native `aria-busy="true"` (the
 * readable "is this form submitting" primitive any component can poll) and
 * dispatch a bubbling `webjs:submit-start` event (detail `{ form, url }`).
 * Stamps `token` as the form's busy owner (see `formBusyTokens`). The `true`
 * edge fires only on a real idle -> busy transition, so a submit that
 * supersedes an in-flight one (form already busy) does not emit a redundant
 * start; the token always advances to the newest owner. Returns the form so
 * `clearFormBusy` targets the same node.
 *
 * @param {HTMLFormElement} form
 * @param {number} token
 * @param {string} url   Resolved action URL the submission targets.
 * @returns {HTMLFormElement}
 */
export function markFormBusy(form, token, url) {
  const wasBusy = formBusyTokens.has(form);
  formBusyTokens.set(form, token);
  form.setAttribute('aria-busy', 'true');
  if (!wasBusy) {
    form.dispatchEvent(new CustomEvent('webjs:submit-start', {
      bubbles: true,
      detail: { form, url },
    }));
  }
  return form;
}

/**
 * Clear the busy state set by `markFormBusy`: set `aria-busy="false"` and
 * dispatch the matching `webjs:submit-end` (detail `{ form, url, ok }`, `ok` =
 * the submission settled as a success / not an error outcome) so app code sees
 * a symmetric start/finish pair. Operates on the element captured at start, so
 * an abort / error clears the same node the start marked. A clear whose token
 * no longer owns the form (a newer submit re-set busy) is a stale teardown
 * from a superseded submit and is skipped, so the live submit stays busy.
 *
 * @param {HTMLFormElement} form
 * @param {number} token
 * @param {string} url
 * @param {boolean} ok
 */
export function clearFormBusy(form, token, url, ok) {
  if (formBusyTokens.get(form) !== token) return;
  formBusyTokens.delete(form);
  form.setAttribute('aria-busy', 'false');
  const evt = new CustomEvent('webjs:submit-end', {
    bubbles: true,
    detail: { form, url, ok: !!ok },
  });
  // A successful submission swaps the page in place, and a full-body swap
  // (or a swap whose region contained the form) detaches the form before
  // this teardown runs. A bubbling event dispatched on a DISCONNECTED node
  // never reaches a `document`-level listener, so a synchronous swap (the
  // no-view-transition default) would silently drop `submit-end`. Dispatch
  // on `document` when the form is no longer connected so the symmetric
  // start/end pair always lands, regardless of swap timing.
  if (form.isConnected) {
    form.dispatchEvent(evt);
  } else if (typeof document !== 'undefined') {
    document.dispatchEvent(evt);
  } else {
    form.dispatchEvent(evt);
  }
}

/**
 * Apply the swap from a parsed incoming Document onto the live document.
 * Picks the most-scoped match: explicit webjs-frame > deepest shared
 * layout marker > full body swap.
 *
 * If the incoming page carries a different importmap from the current
 * page (typical after a deploy that bumped a vendor pin), partial swap
 * is unsafe: importmaps are immutable once applied, so the new page
 * would resolve modules against the stale URLs. We fall back to a full
 * page load via `location.assign(href)`. Mirrors Turbo's
 * `tracked_element_mismatch` reload, applied specifically to
 * importmaps. Called with `href = null` for revalidation flows (which
 * never trigger a hard reload).
 *
 * Detection uses the `X-Webjs-Build` response header (read by the
 * fetch path and passed in as `incomingBuild`), compared against the
 * current page's `data-webjs-build`. The header is set on EVERY SSR
 * response, including X-Webjs-Have partial responses that omit the
 * head and importmap entirely, and it carries the PUBLISHED build id,
 * which the server advertises only once the importmap is final. A hard
 * reload fires only when both ids are present and differ (a real
 * cross-deploy). An empty / absent id on either side means "version
 * unknown" (a warming runtime-first-boot server, or a response that
 * predates the header) and never triggers a reload, so the warmup
 * window cannot wipe a half-filled form.
 *
 * @param {Document} doc
 * @param {string | null} frameId
 * @param {boolean} revalidating  Restore from cache; already-matched markers may stomp inflight state, signal helps loading templates skip.
 * @param {string | null} [href]  Target URL for hard-reload fallback on importmap mismatch.
 * @param {string | null} [incomingBuild]  X-Webjs-Build header from the response, or null.
 */
/**
 * Compute the signature of all `data-webjs-track="reload"` elements
 * in the head of `root`. Returns the concatenation of each element's
 * `outerHTML`, in document order. Two documents with identical
 * tracked-element sets produce identical signatures; any change in
 * attributes, content, or set membership produces a different one.
 *
 * Mirrors hotwired/turbo's `head_snapshot.js` `trackedElementSignature`
 * (the data-turbo-track="reload" mechanism). Used by applySwap as a
 * generic opt-in next to the importmap-specific build hash.
 *
 * Returns the empty string when `root` has no head (e.g. an
 * X-Webjs-Have partial response) or when no elements opt in.
 *
 * @param {Document | undefined} root
 * @returns {string}
 */
export function trackedReloadSignature(root) {
  if (!root || !root.head) return '';
  const tracked = root.head.querySelectorAll('[data-webjs-track="reload"]');
  if (!tracked.length) return '';
  // Use outerHTMLForDiff so the CSP nonce (which rotates per
  // request) is stripped before signature comparison. Without this,
  // a nonced tracked script like `<script nonce="${cspNonce()}"
  // data-webjs-track="reload" src="/build.js?v=42">` would mismatch
  // every navigation and infinite-reload. Matches Turbo's
  // head_snapshot.js elementWithoutNonce posture.
  let sig = '';
  for (const el of tracked) sig += outerHTMLForDiff(el);
  return sig;
}

/* ====================================================================
 * View Transitions (opt-in) + permanent-element persistence
 * ==================================================================== */
