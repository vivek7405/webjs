/**
 * Client router: nav-error.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { collectBoundaries } from './boundaries.js';
import { reportFallback } from './diagnostics.js';
import { navigate } from './navigator.js';
import { prefetch } from './prefetch.js';
import { hardNavigate } from './state.js';

/**
 * Render the minimal default in-place error surface into the deepest
 * shared layout children slot, so the SPA shell (outer chrome, nav,
 * scroll, focus, client state) survives a failed navigation instead of
 * being destroyed by a full reload. Returns true when it rendered into a
 * slot, false when no shared layout marker exists (a cross-document nav).
 * On a false return the caller may fall back to a hard load as a last
 * resort.
 *
 * @param {number | null} status  HTTP status of the failed response, or null for a transport/parse failure.
 * @returns {boolean}
 */
function renderInPlaceNavError(status) {
  if (typeof document === 'undefined' || !document.body) return false;
  const here = collectBoundaries(document.body);
  if (!here) return false; // poisoned live tree: let the caller hard-load
  // The deepest boundary is the same swap target a normal partial swap writes
  // to (longest path wins), so the outer chrome / nav are preserved.
  /** @type {{ start: Comment, end: Comment } | undefined} */
  let deepest;
  let deepestPathLen = -1;
  for (const [path, slot] of here) {
    if (path.length > deepestPathLen) { deepestPathLen = path.length; deepest = slot; }
  }
  if (!deepest) return false;
  const liveParent = deepest.start.parentNode;
  if (!liveParent || deepest.start.parentNode !== deepest.end.parentNode) return false;

  const alert = document.createElement('div');
  alert.setAttribute('role', 'alert');
  alert.setAttribute('data-webjs-nav-error', '');
  const msg = status
    ? `This page could not be loaded. (status ${status})`
    : 'This page could not be loaded.';
  alert.textContent = msg;

  // Replace the slot contents with the alert.
  const range = document.createRange();
  range.setStartAfter(deepest.start);
  range.setEndBefore(deepest.end);
  range.deleteContents();
  liveParent.insertBefore(alert, deepest.end);
  return true;
}

/**
 * Shared fallback for a non-HTML error response or a transport/parse
 * failure during a client navigation. Dispatches a cancelable
 * `webjs:navigation-error` event on `document` (matching the
 * `webjs:frame-missing` / `webjs:prefetch` dispatch convention) so the
 * app can recover in place. If the app calls `preventDefault()`, the
 * router does NOTHING further and leaves the current page exactly as it
 * is. Otherwise it renders a minimal in-place `role="alert"` surface into
 * the deepest layout children slot (the SPA shell survives), and only
 * hard-navigates as a last resort when no in-place target exists.
 *
 * Never call this for an AbortError: a superseding nav is a normal
 * supersede, not an error, and must not surface a navigation-error.
 *
 * @param {string} href  The URL that failed to navigate to.
 * @param {number | null} status  HTTP status when a response arrived, else null.
 * @param {Error | null} error  The Error for a transport/parse failure, else null.
 */
export function handleNavigationError(href, status, error) {
  const evt = new CustomEvent('webjs:navigation-error', {
    bubbles: true,
    cancelable: true,
    detail: { url: href, status: status == null ? null : status, error: error || null },
  });
  // Guard the dispatch: a throwing app listener must not wedge the nav engine.
  if (typeof document !== 'undefined') {
    try { document.dispatchEvent(evt); } catch { /* a buggy listener cannot break recovery */ }
  }
  // The app owns recovery: leave the page untouched (shell, scroll, focus,
  // client state all preserved). No reload, no render.
  if (evt.defaultPrevented) return;
  // Default: render a minimal in-place error surface so the SPA is not
  // destroyed and the user is not sent to a second failing round-trip.
  if (renderInPlaceNavError(status)) return;
  // Last resort only: no shared layout marker to render into (a genuine
  // cross-document nav). Fall back to a hard load so an unrecoverable case
  // is not a silent dead-end. This is the exception, reached only after
  // the event was not cancelled AND no in-place target exists.
  //
  // Report it like every other degradation (#1114): this IS a click turning
  // into a document load, so an app watching `webjs:navigation-fallback` to
  // count full loads must see it. The preceding `webjs:navigation-error`
  // carries no `cause` / `willReload`, so it is not a substitute.
  if (typeof location !== 'undefined') {
    reportFallback('navigation-error-unrecoverable', href);
    hardNavigate(href);
  }
}
