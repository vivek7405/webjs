/**
 * Client router: swap.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { scanSeeds } from '../action-seed-client.js';
import { collectBoundaries, planBoundarySwap } from './boundaries.js';
import { reportFallback } from './diagnostics.js';
import { blurOutgoingFocus, diffChildren, replaceBoundaryRange, resyncEnclosingHostSlots, swapMarkerRange } from './dom-differ.js';
import { trackedReloadSignature } from './frames.js';
import { addNewHeadElements, mergeHead } from './head-merge.js';
import { prefetchCache } from './prefetch.js';
import { snapshotCache } from './snapshot-cache.js';
import { hardNavigate } from './state.js';
import { forwardSuspenseResolvers } from './stream.js';
import { reactivateScripts, upgradeCustomElements, upgradeCustomElementsInRange } from './upgrade.js';
import { regraftPermanentElements, runWithTransition } from './view-transition.js';

/**
 * Resolves when the most recent `applySwap` DOM mutation has committed. Under an
 * async view transition the swap is deferred a frame, so the progressive
 * Suspense streamer must await this before applying resolves, or it targets the
 * pre-swap DOM (no placeholder yet) and drops the boundary (#1048). A resolved
 * promise on the synchronous (no-transition) path.
 * @type {Promise<void>}
 */
export let _swapCommit = Promise.resolve();

/**
 * @param {Document} doc
 * @param {string | null} frameId
 * @param {boolean} revalidating
 * @param {string | null} href
 * @param {string | null} [incomingBuild]
 * @param {string | null} [incomingSrc]
 * @returns {'discard' | 'none' | undefined} `'discard'` when a background
 *   revalidation was thrown away, `'none'` when it returned without committing
 *   anything (a missing frame, or a degradation to a hard navigation), and
 *   `undefined` when a swap committed. `fetchAndApply` maps the first two to
 *   `applied: false`.
 * @param {'page' | 'shell' | undefined} [refresh]  same-URL in-place refresh
 *   mode (#1398). `'shell'` takes the full-body tier directly, because the
 *   layout's OWN markup changed and that lives outside every children range.
 *   `'page'` falls through to the normal two-tier logic, which morphs the
 *   deepest shared boundary and so preserves outer-layout component state.
 * @param {(() => void) | null} [recordHistoryNow]  Record this navigation's
 *   history entry (#1406). Called at each COMMIT point, immediately BEFORE the
 *   DOM mutation, for the same reason `ingestSeeds` is: this function can still
 *   decide to throw the response away after parsing it, and a `pushState`
 *   issued for a swap that never happened is worse than a late one. It runs
 *   BEFORE the mutation, because WebKit binds a same-document entry's
 *   back-forward gesture snapshot to the page state at the moment the entry is
 *   recorded, and a snapshot taken against the incoming (often shorter)
 *   document previews blank.
 *
 *   What that buys is bounded by what is on screen when it fires, and on one
 *   route class that is NOT the outgoing page: where a `loading.{js,ts}`
 *   covers the deepest live boundary, `applyOptimisticLoading` has already
 *   replaced that range with the skeleton and let the engine clamp the offset
 *   before the fetch was issued. There the snapshot is of this route's own
 *   shell plus a skeleton, which still beats the destination document, but it
 *   is not the page the reader left. Fixing that means recording the entry
 *   ahead of the optimistic swap too, which is a separate change on a path
 *   nothing here measured.
 *
 *   The caller's thunk is one-shot, so it is safe to call here AND on the
 *   caller's fall-through. Omitted or null on every path that records no
 *   history (a revalidation, a refresh, the popstate restore).
 */
export function applySwap(doc, frameId, revalidating, href, incomingBuild, incomingSrc, refresh, recordHistoryNow) {
  // SSR action seeding (#472): ingest the incoming page's seed payload BEFORE
  // its components are grafted into the live DOM and upgrade, so a
  // soft-navigated async component resolves from the seed instead of
  // re-fetching. Scanning `doc` (the detached parse) also strips the carriers,
  // so the inert payload never lands in the live document.
  //
  // Called at each COMMIT point rather than once up front, because this function
  // can still decide to throw the response away after parsing it (a hard
  // navigate, or a background revalidation with no trustworthy boundary plan).
  // Scanning eagerly would clear the visible page's own unconsumed seeds and
  // ingest a render that is never painted, so the next `async render()` would
  // hit on data that disagrees with the HTML on screen. That is the same hole
  // the frame ID-MISSING case closes, reached through a different discard.
  //
  // A frame swap is NOT a page navigation, so say so: the consumer must leave
  // the surrounding page's state alone (see `scanSeeds`).
  let seedsScanned = false;
  const ingestSeeds = () => {
    if (seedsScanned) return;
    seedsScanned = true;
    try { scanSeeds(doc, { frame: !!frameId }); } catch { /* seeding is best-effort */ }
  };

  // Every host in this parsed doc is FRAMEWORK-SERIALIZED markup (an SSR
  // fragment or a back/forward snapshot of post-hydration HTML), never
  // author-written children. Stamp them so connectedCallback's slot chooser
  // ADOPTS instead of capture-hoovering the rendered tree, which matters for
  // a restored host whose serialized shape carries no projected slot (a
  // conditionally closed slot at snapshot time) where the structural
  // slot-marker detector has nothing to see. The chooser consumes and removes
  // the attribute on upgrade.
  // (An ELIDED display-only host never upgrades, so its stamp is retained as
  // an inert attribute; diffElementInPlace never copies it onto a live host,
  // and the upgrade path consumes it, so it cannot mis-route anything.)
  try {
    for (const el of doc.querySelectorAll('[data-wj-host]')) {
      el.setAttribute('data-wj-serialized', '');
    }
  } catch { /* stamping is best-effort */ }

  // Any clean swap (no importmap mismatch, including cache restores
  // and frame swaps where we don't even run the mismatch check) is a
  // signal that the user successfully navigated, so clear the reload
  // flag. Otherwise a sequence "reload because of mismatch → Back to
  // a cache restore → Forward to a deploy-bumped URL" would find the
  // stale flag still set and suppress the second legitimate reload.
  try {
    if (typeof sessionStorage !== 'undefined' && (!href || frameId || revalidating)) {
      sessionStorage.removeItem('webjs:importmap-reload');
    }
  } catch { /* ignore */ }

  // Importmap-mismatch guard. Only fires for foreground navs (href
  // present); revalidation passes href=null to keep cache restores
  // soft. Skipped if a <webjs-frame> escape hatch is in play (frame
  // swaps are intra-page and don't change the importmap).
  if (href && !frameId && !revalidating) {
    const currentTag = document.querySelector('script[type="importmap"]');
    const currentBuild = currentTag ? currentTag.getAttribute('data-webjs-build') : null;
    let mismatch = false;
    if (incomingBuild && currentBuild) {
      // Preferred path: compare per-response build id. Works even
      // when the response body has no importmap (partial swap).
      mismatch = incomingBuild !== currentBuild;
    }
    // An empty / absent build id on EITHER side means "version unknown":
    // the server has not published an authoritative importmap yet (the
    // warmup window, where a runtime-first-boot app resolves its vendor
    // map over the first request), or the response predates the build
    // header. In that state a hard reload is unsafe and destructive: it
    // would fire repeatedly as the warming server's id flips from empty
    // to its final value, wiping any half-filled form on the page. So we
    // never hard-reload against an unknown id and leave `mismatch` false;
    // the soft swap proceeds and the page settles once the server is
    // warm. A real cross-deploy reload still fires, because both sides
    // then carry non-empty, differing ids. (No importmap-textContent
    // fallback: the published-id contract above supersedes it, and the
    // textContent of a warming map drifts for the same reason the id does.)
    // Generic `data-webjs-track="reload"` opt-in. ANY element in the
    // head that the user marks gets included in the tracked-element
    // signature. If the signature differs between current and incoming
    // documents, hard-reload. Mirrors hotwired/turbo's
    // data-turbo-track="reload" semantics (head_snapshot.js
    // trackedElementSignature). Lets app authors tag arbitrary
    // version-sensitive elements (CSS bundle <link>, deploy meta tag)
    // for cross-deploy reload, not just the importmap.
    //
    // Importmap-specific data-webjs-build / X-Webjs-Build remain the
    // primary mechanism because they ALSO work on partial responses
    // (no head in the body). data-webjs-track is for elements that
    // can't ride the build hash.
    //
    // Skip the check when the incoming response has no head content
    // (X-Webjs-Have partial-fragment response). Without this guard
    // a partial response would always mismatch any current tracked
    // signature and falsely reload. With the guard, a partial
    // response means "trust the build hash; don't decide based on
    // missing head info." Comparing on full responses also catches
    // added/removed track markers because empty `incomingSig`
    // would correctly differ from a non-empty `currentSig`.
    if (!mismatch && doc.head && doc.head.children.length > 0) {
      const currentSig = trackedReloadSignature(document);
      const incomingSig = trackedReloadSignature(doc);
      if (currentSig !== incomingSig) mismatch = true;
    }
    if (mismatch && typeof location !== 'undefined') {
      // A detected cross-deploy mismatch means every URL-keyed snapshot and
      // speculative prefetch was captured on the OLD deploy, so it is stale
      // pre-deploy HTML (#899). Evict both caches so no stale entry is applied
      // on a later soft nav, even when the infinite-reload guard below bails to
      // a partial swap instead of a full reload (that partial swap must not then
      // pull a pre-deploy fragment out of the cache).
      snapshotCache.clear();
      prefetchCache.clear();
      // Infinite-reload guard: if the importmap appears to genuinely
      // change EVERY navigation (e.g. a developer is live-editing the
      // pin file in dev, or a misbehaving CDN returns different
      // jspm.io URLs each request), the user would experience a hard
      // reload on every click. Use a one-shot sessionStorage flag:
      // set before the first reload, cleared by the next successful
      // swap. Two reloads BACK-TO-BACK (without an intervening clean
      // nav) trip the guard.
      try {
        const flag = 'webjs:importmap-reload';
        if (sessionStorage && sessionStorage.getItem(flag)) {
          // Already reloaded once for an importmap mismatch and the
          // next nav STILL mismatches: bail to the partial swap. The
          // user is on a stale importmap but at least the page
          // renders.
          sessionStorage.removeItem(flag);
          reportFallback('deploy-mismatch-reload-suppressed', href, false);
        } else {
          if (sessionStorage) sessionStorage.setItem(flag, '1');
          reportFallback('deploy-mismatch', href);
          hardNavigate(href);
          return 'none';
        }
      } catch {
        // sessionStorage unavailable (private mode w/ quota etc.):
        // fall through to a single reload like before.
        reportFallback('deploy-mismatch', href);
        hardNavigate(href);
        return 'none';
      }
    } else if (!mismatch) {
      // No importmap/build mismatch, so no hard reload. But the app-source
      // signal (#899) is the SECOND tier: if `data-webjs-src` differs, an
      // app-source or server-framework deploy changed the SSR output while the
      // running page's browser code is unchanged. A hard reload would be an
      // over-correction; instead EVICT the URL-keyed snapshot + prefetch caches
      // (all captured on the OLD deploy) so a later soft nav re-fetches fresh.
      // The current nav's already-fetched `doc` still applies normally. Both ids
      // must be present (an empty id is the warmup "unknown", never a signal),
      // exactly like the build guard.
      const currentSrc = currentTag ? currentTag.getAttribute('data-webjs-src') : null;
      if (incomingSrc && currentSrc && incomingSrc !== currentSrc) {
        snapshotCache.clear();
        prefetchCache.clear();
        // Advance the page's reference id. The importmap <script> is preserved
        // across soft navs (an importmap cannot be re-registered), so without
        // this the tag would keep its OLD id and EVERY later nav in the new
        // deploy would re-detect the same mismatch and evict again, defeating
        // the caches. Updating the attribute (not the importmap body) settles
        // the page onto the new deploy: evict once, then cache normally.
        if (currentTag) currentTag.setAttribute('data-webjs-src', incomingSrc);
      }
      // A clean swap (no importmap mismatch) means we're back to
      // matching client/server importmaps. Clear the reload flag so
      // a future LEGITIMATE mismatch (e.g. a later deploy) gets a
      // fresh single-shot reload instead of being suppressed by a
      // stale flag from an unrelated earlier reload.
      try {
        if (typeof sessionStorage !== 'undefined') {
          sessionStorage.removeItem('webjs:importmap-reload');
        }
      } catch { /* ignore */ }
    }
  }

  // 1. webjs-frame escape hatch.
  if (frameId) {
    // Both outcomes here (a successful subtree swap, or frame-missing) discard
    // whatever the parse carried, so this is safe wherever it lands.
    ingestSeeds();
    const target = document.querySelector(`webjs-frame#${CSS.escape(frameId)}`);
    const source = doc.querySelector(`webjs-frame#${CSS.escape(frameId)}`);
    if (target && source) {
      // #1406: record at the commit, before any mutation, including the head
      // merge below (a stylesheet it adds can change layout height).
      if (recordHistoryNow) recordHistoryNow();
      // ADD-ONLY head merge: preserve runtime-generated head content
      // (Tailwind CSS injection, etc.) that the outer layout's scripts
      // already produced.
      addNewHeadElements(doc.head);
      // `diffChildren` -> `reconcileChildren` regrafts permanent elements
      // by node identity (it imports the incoming children first, then
      // swaps the live permanent node into the imported tree), so the live
      // `<audio>`/widget keeps running across the frame swap.
      // Capture the swap commit like the other swap paths so a frame nav that
      // ALSO progressively streams a Suspense boundary gates its resolves on the
      // committed frame swap, not a stale prior _swapCommit (#1048).
      _swapCommit = runWithTransition(() => {
        diffChildren(target, source);
        reactivateScripts(target);
        upgradeCustomElements(target);
        // Inside the swap so the placeholder exists before we resolve (#1048).
        forwardSuspenseResolvers(doc.body);
        blurOutgoingFocus();
      }, () => upgradeCustomElements(target));
      return;
    }
    // The response did not carry the requested frame (source null), or the
    // target frame is gone from the live DOM (target null). Falling through
    // would wholesale-replace the document, a silent full-page swap that
    // destroys the page (e.g. an auth redirect returning a login page without
    // the frame). Surface the contract violation with a cancelable event
    // instead. Default: warn and leave the frame unchanged. A listener that
    // calls preventDefault owns the outcome.
    const evt = new CustomEvent('webjs:frame-missing', {
      bubbles: true,
      cancelable: true,
      detail: { frameId, url: href || (typeof location !== 'undefined' ? location.href : null), document: doc },
    });
    (target || document).dispatchEvent(evt);
    if (!evt.defaultPrevented) {
      console.warn(`[webjs] frame "${frameId}" was not in the navigation response, leaving it unchanged. Handle "webjs:frame-missing" (preventDefault) to override.`);
    }
    return 'none';
  }

  // 1b. Same-URL refresh in `shell` mode (#1398). A boundary morph can only
  // rewrite what sits INSIDE a `<!--wj:children:...-->` range, and a layout's
  // own header, nav, and footer sit outside every one of them, so a layout edit
  // applied through the boundary tiers would silently do nothing, which is
  // strictly worse than the reload it replaced. Take the full-body tier
  // directly instead. Component instances do not survive it, which is the
  // honest cost of a layout edit and still beats a page reload: scroll is kept
  // and no history entry is written.
  if (refresh === 'shell') {
    ingestSeeds();
    if (recordHistoryNow) recordHistoryNow();
    swapFullBody(doc);
    return;
  }

  // 2. Two-tier keyed boundary swap (#1015). Scan both trees STRICTLY: a
  // poisoned side (malformed, truncated, or mispaired boundaries) yields null
  // and falls through to the integrity degradation below. A valid pair of
  // scans picks the swap tier by route-key comparison: a CHANGED key REPLACES
  // (remount, Next param-change parity) at the PARENT of the shallowest
  // change, else MORPH (state-preserving keyed reconcile) at the deepest
  // shared boundary.
  const here = collectBoundaries(document.body);
  const there = collectBoundaries(doc.body);
  const plan = here && there ? planBoundarySwap(here, there) : null;

  if (plan) {
    // Committed: this response is being applied, so its seeds are the ones the
    // user is about to look at.
    ingestSeeds();
    // #1406: and the history entry is recorded here, while the outgoing page is
    // still in the DOM at its own scroll offset. This is the path the iOS
    // back-swipe defect was measured on.
    if (recordHistoryNow) recordHistoryNow();
    const { mode, live, incoming } = plan;
    // ADD-ONLY head merge: the outer layout stays mounted, so its head-bound
    // runtime state (Tailwind injection, etc.) must not be invalidated.
    addNewHeadElements(doc.head);
    _swapCommit = runWithTransition(() => {
      if (mode === 'replace') replaceBoundaryRange(live, incoming);
      else swapMarkerRange(live, incoming, doc);
      // No key sync is needed on the anchor's own comments: the plan's anchor
      // carries EQUAL live/incoming route-keys in every tier (a changed-key
      // REPLACE anchors at a parent already compared equal; the other tiers
      // require no change at all), and the fresh deeper keys arrive via the
      // physically replaced boundary comments inside the range.
      //
      // When the swapped range lives INSIDE a light-DOM slot (a layout whose
      // ${children} render inside a slotted shell component), the raw swap
      // just rewrote nodes the slot runtime believes it owns, so its record is
      // now stale. Resync the owning host's record from the slot's real
      // children through the one public seam, or the host's next
      // applySlotAssignments would wipe the freshly swapped content and
      // restore the stale list.
      resyncEnclosingHostSlots(live.start, incoming.start);
      // Resolve buffered Suspense boundaries INSIDE the swap so the placeholder
      // exists first. Doing this after `runWithTransition` returned raced the
      // async view-transition swap and stuck the skeleton (#1048).
      forwardSuspenseResolvers(doc.body);
      blurOutgoingFocus();
    }, () => upgradeCustomElementsInRange(live));
    return;
  }

  // 3. Integrity degradation (#1015). No trustworthy shared boundary exists:
  // one side is poisoned, or the trees share no segment (a divergent shell).
  // For a FOREGROUND nav, degrade to a FULL PAGE LOAD: bounded, correct, and
  // exactly what an MPA would do, where the deleted heuristic recovery could
  // guess wrong and corrupt silently. Dev logs the cause so a systematic
  // producer of malformed boundaries is visible immediately. A REVALIDATION
  // (the background refresh after a snapshot restore) is excluded: the user
  // is already viewing a page, so a background op must never yank them
  // through a hard load; it takes the in-place path below.
  if (href && !revalidating && typeof location !== 'undefined') {
    reportFallback(!here ? 'live-boundaries-malformed'
      : !there ? 'incoming-boundaries-malformed'
      : 'no-shared-boundary', href);
    hardNavigate(href);
    return 'none';
  }

  // A BACKGROUND revalidation (revalidating + href) with no trustworthy plan
  // DISCARDS the response outright: the user is viewing a valid restored
  // snapshot, and the response may be a reduced (chrome-less) X-Webjs-Have
  // fragment, so the full-body swap below would wipe the shell from a
  // background op. Doing nothing is the only safe degradation here.
  if (href && revalidating) {
    reportFallback('revalidation-discarded', href, false);
    return 'discard';
  }

  // 4. In-place full-body swap: the background paths only (a snapshot
  // restore or its revalidation, where a full load is not an option
  // because the user is already viewing the page).
  ingestSeeds();   // committed: past both discard branches above
  if (recordHistoryNow) recordHistoryNow();
  swapFullBody(doc);
}

/**
 * In-place FULL-BODY swap: merge the head, then replace every body child.
 *
 * `mergeHead` PRESERVES stylesheets and `<style>` unconditionally (#936), so
 * this can never leave the page unstyled, and `regraftPermanentElements` adopts
 * each live `[data-webjs-permanent][id]` node by identity so a running widget
 * survives. Component INSTANCES do not: every element is re-created and
 * re-upgraded, which is the difference between this and a boundary morph.
 *
 * Two callers. The background snapshot-restore path in `applySwap`, where a full
 * load is not an option because the user is already viewing the page. And the
 * `shell` mode of `refreshPage` (#1398), which needs the LAYOUT's own markup
 * replaced and cannot get that from a boundary-range swap, since a layout's own
 * header, nav, and footer sit outside every `<!--wj:children:...-->` range.
 *
 * The caller ingests seeds first: this is a commit point, and both callers reach
 * it only past their own discard branches.
 *
 * @param {Document} doc
 */
function swapFullBody(doc) {
  mergeHead(doc.head);
  // Persist permanent elements by node identity across the full-body
  // swap: move each live [data-webjs-permanent][id] node into the matching
  // position in the incoming body BEFORE replaceChildren reads it, so the
  // live node is adopted rather than destroyed.
  regraftPermanentElements(document.body, doc.body);
  const newChildren = [...doc.body.childNodes];
  const doSwap = () => {
    document.body.replaceChildren(...newChildren);
    reactivateScripts(document.body);
    upgradeCustomElements(document.body);
    blurOutgoingFocus();
  };
  _swapCommit = runWithTransition(doSwap, () => upgradeCustomElements(document.body));
}
