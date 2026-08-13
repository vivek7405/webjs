// Importing this side-effect-registers <webjs-frame> so apps that
// `import '@webjsdev/core/client-router'` get the escape-hatch element
// available without a second import.
import './webjs-frame.js';
// Same for the <webjs-stream> element. Registering it here means the surgical
// stream-action applier (and `renderStream`) is available app-wide wherever
// the client router is active, for both the HTTP form path (below) and a
// live-channel `connectWS` handler.
import './webjs-stream.js';
import { renderStream } from './webjs-stream.js';
import { FORM_ACTION_FIELD } from './form-action.js';
// Register <webjs-suspense> (the element-level streaming boundary, #471) so it
// is layout-neutral and available for the progressive soft-nav streaming apply.
import './webjs-suspense.js';
// Ingest SSR action seeds (#472) from an incoming soft-nav document before its
// components hydrate, so a navigated async component resolves from the seed.
import { scanSeeds } from './action-seed-client.js';
// A form-bound action's `invalidates` tags (#1155) ride the submission response
// the same way an RPC mutation's do, so a cached GET action is not served stale
// after a no-JS-shaped write went through the router.
import { markStale, parseTagHeader } from './action-cache-client.js';
// Slot-runtime constants for re-projecting page-authored slotted content of a
// reused hydrated light-DOM component across a soft nav (#908).
import {
  SLOT_STATE, LIGHT_SLOT_ATTR, PROJECTION_ATTR, PROJECTION_ACTUAL,
  projectAuthored, keyOfName, isAuthoredContentSlot,
} from './slot.js';
import { enableClientRouter } from './router-client/navigator.js';

export { _isNonHtmlPath } from './router-client/constants.js';
export { _resetWarnOnce, _shouldFullLoadDuringParse } from './router-client/diagnostics.js';
export { _currentPageUrl, _setCurrentPageUrl, disableClientRouter, enableClientRouter, loadFrame, navigate, revalidate } from './router-client/navigator.js';
export { _prefetchInflightSize, _prefetchPeek, _resetPrefetch } from './router-client/prefetch.js';
export { _bumpNavToken, _navToken, _setHardNavigate } from './router-client/state.js';

export {
  buildHaveHeader as _buildHaveHeader,
  collectBoundaries as _collectBoundaries,
  planBoundarySwap as _planBoundarySwap,
} from './router-client/boundaries.js';
export {
  FALLBACK_MARKER_KEY as _FALLBACK_MARKER_KEY,
  FRAME_TOP as _FRAME_TOP,
  LIVE_ATTRS as _LIVE_ATTRS,
} from './router-client/constants.js';
export {
  isPreBootNavigation as _isPreBootNavigation,
} from './router-client/diagnostics.js';
export {
  applyOptimisticLoading as _applyOptimisticLoading,
  blurOutgoingFocus as _blurOutgoingFocus,
  diffElementInPlace as _diffElementInPlace,
  keyOf as _keyOf,
  reconcileChildren as _reconcileChildren,
  restoreOptimistic as _restoreOptimistic,
} from './router-client/dom-differ.js';
export {
  parseHTML as _parseHTML,
  resetParseProbe as _resetParseProbe,
} from './router-client/dom-parse.js';
export {
  findAnchorInPath as _findAnchorInPath,
  onPopState as _onPopState,
  onSubmit as _onSubmit,
} from './router-client/events.js';
export {
  buildSubmitFormData as _buildSubmitFormData,
  encodeSubmitBody as _encodeSubmitBody,
  getSubmitAction as _getSubmitAction,
  getSubmitEnctype as _getSubmitEnctype,
  getSubmitMethod as _getSubmitMethod,
} from './router-client/form-encoder.js';
export {
  activeFrameId as _activeFrameId,
  clearFormBusy as _clearFormBusy,
  clearFrameBusy as _clearFrameBusy,
  markFormBusy as _markFormBusy,
  markFrameBusy as _markFrameBusy,
  resolveTargetFrameId as _resolveTargetFrameId,
} from './router-client/frames.js';
export {
  addNewHeadElements as _addNewHeadElements,
  mergeHead as _mergeHead,
} from './router-client/head-merge.js';
export {
  eligibleAnchorHref as _eligibleAnchorHref,
  prefetch as _prefetch,
  prefetchAnchor as _prefetchAnchor,
  prefetchCache as _prefetchCache,
  prefetchHasHoverPointer as _prefetchHasHoverPointer,
  prefetchMode as _prefetchMode,
  prefetchSaysSaveData as _prefetchSaysSaveData,
  prefetchSuppressed as _prefetchSuppressed,
  prefetchTake as _prefetchTake,
} from './router-client/prefetch.js';
export {
  snapshotCache as _snapshotCache,
} from './router-client/snapshot-cache.js';
export {
  applyStreamedResolve as _applyStreamedResolve,
  readStreamedShell as _readStreamedShell,
  streamBoundariesProgressively as _streamBoundariesProgressively,
  takeResolveUnit as _takeResolveUnit,
} from './router-client/stream.js';
export {
  applySwap as _applySwap,
} from './router-client/swap.js';
export {
  activateSwappedRange as _activateSwappedRange,
  reactivateScripts as _reactivateScripts,
} from './router-client/upgrade.js';
export {
  regraftPermanentElements as _regraftPermanentElements,
  regraftPermanentInSlice as _regraftPermanentInSlice,
  runWithTransition as _runWithTransition,
  viewTransitionsEnabled as _viewTransitionsEnabled,
} from './router-client/view-transition.js';

// Auto-enable on import (standard Turbo-Drive convention) UNLESS the app opted
// out with `webjs.clientRouter: false` (#629), which the server signals by
// setting `window.__WEBJS_CLIENT_ROUTER__ = false` in an inline script emitted
// BEFORE this (deferred) bundle runs. On the server `window` is undefined, so
// the call still runs and no-ops behind its own `typeof document` guard, as
// before. Placed last so every top-level binding the router touches (notably
// the prefetch state) is initialised before enableClientRouter() runs.
if (typeof window === 'undefined' || window.__WEBJS_CLIENT_ROUTER__ !== false) {
  enableClientRouter();
}
