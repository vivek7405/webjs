/**
 * Client router: upgrade.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { buildHaveHeader, collectBoundaries, planBoundarySwap } from './boundaries.js';
import { FALLBACK_MARKER_KEY, FRAME_TOP, LIVE_ATTRS } from './constants.js';
import { isPreBootNavigation } from './diagnostics.js';
import { applyOptimisticLoading, blurOutgoingFocus, diffElementInPlace, keyOf, reconcileChildren, restoreOptimistic } from './dom-differ.js';
import { parseHTML, resetParseProbe } from './dom-parse.js';
import { onPopState, onSubmit } from './events.js';
import { buildSubmitFormData, encodeSubmitBody, getSubmitAction, getSubmitEnctype, getSubmitMethod } from './form-encoder.js';
import { activeFrameId, clearFormBusy, clearFrameBusy, markFormBusy, markFrameBusy, resolveTargetFrameId } from './frames.js';
import { addNewHeadElements, cloneScriptWithCorrectNonce, mergeHead } from './head-merge.js';

import { eligibleAnchorHref, prefetch, prefetchAnchor, prefetchCache, prefetchHasHoverPointer, prefetchMode, prefetchSaysSaveData, prefetchSuppressed, prefetchTake } from './prefetch.js';
import { snapshotCache } from './snapshot-cache.js';
import { applyStreamedResolve, readStreamedShell, streamBoundariesProgressively, takeResolveUnit } from './stream.js';
import { applySwap } from './swap.js';
import { regraftPermanentElements, regraftPermanentInSlice, regraftedPermanents, runWithTransition, viewTransitionsEnabled } from './view-transition.js';

/**
 * Global MutationObserver that upgrades any custom element inserted into
 * the document. Safety net: if our diff / replaceChildren / View
 * Transitions ever leave an un-upgraded element behind, this catches it.
 */
let upgradeObserver = null;

export function ensureUpgradeObserver() {
  if (upgradeObserver || typeof MutationObserver === 'undefined' || typeof customElements === 'undefined') return;
  upgradeObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = /** @type {Element} */ (node);
        if (el.tagName?.includes('-')) customElements.upgrade(el);
        for (const child of el.querySelectorAll('*')) {
          if (child.tagName?.includes('-')) customElements.upgrade(child);
        }
      }
    }
  });
  upgradeObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Re-upgrade custom elements between a marker pair after a transitioned
 * swap settles. The View Transitions API snapshots and replaces DOM, so
 * elements can need a re-upgrade once the animation finishes.
 *
 * @param {{ start: Comment, end: Comment | null } | undefined} range
 */
export function upgradeCustomElementsInRange(range) {
  if (!range || !range.start) return;
  for (let n = range.start.nextSibling; n && n !== range.end; n = n.nextSibling) {
    if (n.nodeType === 1) upgradeCustomElements(/** @type {Element} */ (n));
  }
}

/** @param {Element} container */
export function upgradeCustomElements(container) {
  if (typeof customElements === 'undefined') return;
  upgradeTree(container);
}

/** @param {Element | DocumentFragment} root */
export function upgradeTree(root) {
  const els = root instanceof Element
    ? [root, ...root.querySelectorAll('*')]
    : [...root.querySelectorAll('*')];
  for (const el of els) {
    if (el.tagName && el.tagName.includes('-')) {
      customElements.upgrade(el);
      if (el.shadowRoot) upgradeTree(el.shadowRoot);
    }
  }
}

/**
 * Re-execute every `<script>` in `container`, INCLUDING `container` itself when
 * it is one (#1102). A script parsed by `DOMParser` carries the spec's
 * "already started" flag, so the node grafted into the live document is inert
 * and only a fresh clone runs. `querySelectorAll` never matches the element it
 * is called on, so a container-is-a-script was silently skipped: the two swap
 * tiers hand this function each TOP-LEVEL node of the swapped range in turn, so
 * a script emitted as a sibling of the content (a layout's progressive-
 * enhancement script, the shape that surfaced this) never ran after a soft nav.
 *
 * Replacing the container DETACHES it, which is why both callers snapshot the
 * range before iterating rather than walking live `nextSibling` links.
 *
 * `data-webjs-permanent` splits into two cases here, and the split is the whole
 * rule (#1252):
 *
 *   - The marked element IS a script: NEVER exempt, however the walk reaches
 *     it. This holds whether it arrives as the `container` or as a descendant
 *     of one, because the regraft selector has no tag filter and will happily
 *     preserve a `<script id data-webjs-permanent>` by identity. The exemption
 *     below is therefore STRICT containment, never reflexive. This must not be
 *     changed. The regrafts have a both-exist guard, so on the swap that first
 *     mounts a route there is no live node to preserve, the inert parsed copy
 *     is what lands, and exempting it would leave a script that runs on a cold
 *     load and never on a soft navigation. That is precisely the #1102 failure,
 *     reintroduced under the banner of fixing it. A script's only state is that
 *     it ran, and re-running is the contract for everything in a swapped range.
 *   - A script INSIDE a marked element that was ACTUALLY preserved: exempt.
 *     The attribute means the subtree survives as the same live node, which is
 *     what `diffElementInPlace` already implements by returning early rather
 *     than recursing into it. Re-emitting an init script against a widget
 *     instance the author deliberately kept alive is a double-initialization,
 *     not a refresh.
 *
 * The filter keys on `regraftedPermanents` (actual preservation by identity),
 * never on the attribute alone. A permanent element arriving for the FIRST time
 * was never preserved, so its scripts have never run and must run now; an
 * attribute-only filter would leave them never running on any path.
 *
 * @param {Element} container
 * @returns {Element} `container`, or its replacement when it was a script that
 *   was re-emitted. The replacement sits wherever `container` was; when
 *   `container` was already detached, `replaceWith` is a spec no-op and the
 *   returned clone is detached too, so callers must not assume it is connected.
 */
export function reactivateScripts(container) {
  if (container.tagName === 'SCRIPT') {
    const fresh = cloneScriptWithCorrectNonce(/** @type {HTMLScriptElement} */ (container));
    // A no-op when the node has no parent. That happens when an EARLIER
    // script's reactivation ran code that removed this node from the range
    // (reactivation executes synchronously), so a stale snapshot entry cannot
    // resurrect itself into the document.
    container.replaceWith(fresh);
    return fresh;
  }
  // Roots whose subtrees survived this swap by identity. Collected from the
  // container DOWNWARD so the exemption is bounded to the swapped range by
  // construction; `closest()` from a script upward could escape into an outer
  // ancestor that was never part of this swap.
  /** @type {Element[]} */
  const preserved = [];
  if (regraftedPermanents.has(container)) preserved.push(container);
  for (const el of container.querySelectorAll('[data-webjs-permanent]')) {
    if (regraftedPermanents.has(el)) preserved.push(el);
  }

  for (const old of container.querySelectorAll('script')) {
    // STRICT containment: a preserved root exempts its DESCENDANTS, never
    // itself. The regrafts select `[data-webjs-permanent][id]` with no tag
    // filter, so a `<script id data-webjs-permanent>` present on both sides is
    // regrafted like any other element and lands in the WeakSet. Skipping it
    // here would exempt the marked script itself whenever the walk reaches it
    // as a descendant (the full-body path), while the container branch above
    // still re-emits it, so one script would get opposite answers depending on
    // which entry point reached it. `contains()` is reflexive, hence `p !== old`.
    if (preserved.length && preserved.some((p) => p !== old && p.contains(old))) continue;
    old.replaceWith(cloneScriptWithCorrectNonce(/** @type {HTMLScriptElement} */ (old)));
  }
  return container;
}

/**
 * Reactivate scripts + upgrade custom elements across a just-swapped boundary
 * range. The range is SNAPSHOT first: `reactivateScripts` replaces a top-level
 * script node, which detaches it and cuts a live `nextSibling` walk, silently
 * skipping every node after it (#1102).
 *
 * The snapshot is taken AFTER the tier has finished writing the range (the
 * replace tier's insert loop, the morph tier's `reconcileSiblings`), so every
 * entry is attached when it is recorded. It can still go stale DURING the walk,
 * because reactivating a script executes it synchronously and that code may
 * mutate the range. Two consequences, both deliberate. A node an earlier script
 * REMOVED is skipped, since `replaceWith` on a parentless node is a spec no-op.
 * A node an earlier script INSERTED is not visited, unlike the live walk this
 * replaced. That costs nothing reachable: such a node is connected by
 * definition, so the browser upgrades it on insertion, and `ensureUpgradeObserver`
 * catches it on the microtask regardless. Do NOT "restore" the live walk to
 * recover it. A correct live walk has to advance off the REPLACEMENT (advancing
 * off the detached original is bug #1102 itself), and in that form a script
 * appending a sibling script loops forever, each clone appending the next; it
 * would also re-run a script that already executed when its own creator
 * inserted it. The snapshot is additionally safer under a MOVE, since a live
 * walk would follow a node out of the range and start re-executing unrelated
 * scripts in the rest of the body.
 *
 * @param {{ start: Comment, end: Comment }} range
 */
export function activateSwappedRange(range) {
  /** @type {Element[]} */
  const swapped = [];
  for (let n = range.start.nextSibling; n && n !== range.end; n = n.nextSibling) {
    if (n.nodeType === 1) swapped.push(/** @type {Element} */ (n));
  }
  for (const el of swapped) {
    const live = reactivateScripts(el);
    // Nothing to upgrade in a detached tree. `customElements.upgrade` off
    // document runs the CONSTRUCTOR (not `connectedCallback`, which waits for
    // insertion), so this skips constructing elements for a tree that was just
    // removed and will never be seen.
    if (live.isConnected !== false) upgradeCustomElements(live);
  }
}

/* ====================================================================
 * Internal exports for unit testing
 * ==================================================================== */

export {
  addNewHeadElements as _addNewHeadElements,
  mergeHead as _mergeHead,
  reactivateScripts as _reactivateScripts,
  isPreBootNavigation as _isPreBootNavigation,
  FALLBACK_MARKER_KEY as _FALLBACK_MARKER_KEY,
  activateSwappedRange as _activateSwappedRange,
  activeFrameId as _activeFrameId,
  resolveTargetFrameId as _resolveTargetFrameId,
  FRAME_TOP as _FRAME_TOP,
  markFrameBusy as _markFrameBusy,
  clearFrameBusy as _clearFrameBusy,
  markFormBusy as _markFormBusy,
  clearFormBusy as _clearFormBusy,
  collectBoundaries as _collectBoundaries,
  planBoundarySwap as _planBoundarySwap,
  parseHTML as _parseHTML,
  resetParseProbe as _resetParseProbe,
  keyOf as _keyOf,
  diffElementInPlace as _diffElementInPlace,
  reconcileChildren as _reconcileChildren,
  onPopState as _onPopState,
  applySwap as _applySwap,
  buildHaveHeader as _buildHaveHeader,
  snapshotCache as _snapshotCache,
  prefetchCache as _prefetchCache,
  LIVE_ATTRS as _LIVE_ATTRS,
  blurOutgoingFocus as _blurOutgoingFocus,
  onSubmit as _onSubmit,
  getSubmitMethod as _getSubmitMethod,
  getSubmitAction as _getSubmitAction,
  buildSubmitFormData as _buildSubmitFormData,
  getSubmitEnctype as _getSubmitEnctype,
  encodeSubmitBody as _encodeSubmitBody,
  restoreOptimistic as _restoreOptimistic,
  eligibleAnchorHref as _eligibleAnchorHref,
  viewTransitionsEnabled as _viewTransitionsEnabled,
  runWithTransition as _runWithTransition,
  regraftPermanentElements as _regraftPermanentElements,
  regraftPermanentInSlice as _regraftPermanentInSlice,
  prefetchSuppressed as _prefetchSuppressed,
  prefetchMode as _prefetchMode,
  prefetchHasHoverPointer as _prefetchHasHoverPointer,
  prefetch as _prefetch,
  prefetchTake as _prefetchTake,
  prefetchAnchor as _prefetchAnchor,
  applyOptimisticLoading as _applyOptimisticLoading,
  prefetchSaysSaveData as _prefetchSaysSaveData,
  readStreamedShell as _readStreamedShell,
  takeResolveUnit as _takeResolveUnit,
  applyStreamedResolve as _applyStreamedResolve,
  streamBoundariesProgressively as _streamBoundariesProgressively,
};
