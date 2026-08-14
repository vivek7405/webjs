/**
 * Client router: navigator.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { ANCHOR_SUPPRESS_FLOOR_MS } from './constants.js';
import { reportFallback, reportPreBootNavigation, setNavigating, shouldFullLoadDuringParse } from './diagnostics.js';
import { applyOptimisticLoading } from './dom-differ.js';
import { parseHTML } from './dom-parse.js';
import { onClick, onPopState, onSubmit } from './events.js';
import { fetchAndApply } from './fetch-apply.js';
import { clearFormBusy, markFormBusy } from './frames.js';
import { clearPrefetchHover, clearPrefetchRefused, clearPrefetchViewTimers, onPrefetchIntent, onPrefetchOut, prefetchCache, refreshPrefetchObservers, teardownPrefetchViewObserver } from './prefetch.js';
// `restoreGeneration` is imported READ-ONLY: the deferred restore captures it
// and re-compares after the frame, so it must be the live binding. Writes go
// through bumpRestoreGeneration(), since ESM forbids assigning an import.
import { afterTwoFrames, bumpRestoreGeneration, cancelScrollCatchUp, catchUpToRestoredScroll, releaseScrollAnchor, restoreGeneration, suppressScrollAnchoring } from './scroll.js';
import { snapshotCache, snapshotCurrent, snapshotGet } from './snapshot-cache.js';
import { _setEnabled, bumpNavToken, currentNavigationToken, enabled, hardNavigate } from './state.js';
import { _swapCommit, applySwap } from './swap.js';
import { ensureUpgradeObserver } from './upgrade.js';
import { viewTransitionsEnabled } from './view-transition.js';


/**
 * AbortController for the currently in-flight fetch. A new navigation /
 * submission `abort()`s this and replaces it: Turbo Drive's
 * `navigator.stop()` pattern. Aborting in-flight requests on rapid
 * link clicks avoids late responses clobbering newer settled state.
 *
 * @type {AbortController | null}
 */
let activeAbortController = null;

/**
 * The URL the user is currently viewing: tracked separately from
 * `location.href` because on `popstate` the browser updates
 * `location.href` to the destination URL BEFORE firing the event,
 * which means snapshotting "the current page" naively keys against
 * the wrong URL (the page being arrived at, not the page being left).
 *
 * Updated after every successful navigation completes. Used by
 * `snapshotCurrent` to key the snapshot under the URL the user is
 * actually leaving.
 *
 * @type {string | null}
 */
let currentPageUrl = null;

/**
 * Previous value of `history.scrollRestoration` (so we can restore it
 * when the router is disabled). The browser's default behavior of
 * auto-restoring scroll on popstate races with the SPA's own scroll
 * restoration: disabled here so WebJs is the sole authority on scroll
 * during navigation. Same pattern as Turbo Drive's
 * `assumeControlOfScrollRestoration()` (turbo/src/core/drive/history.js).
 *
 * @type {ScrollRestoration | null}
 */
export let prevScrollRestoration = null;

/** Enable the client router. Idempotent. */
export function enableClientRouter() {
  if (enabled || typeof document === 'undefined') return;
  _setEnabled(true);
  // Publish the in-place refresh entry on the global (#1398). The dev
  // live-reload client is a separate served script with no import of this
  // module, so a global is the only seam it has, and its PRESENCE is the
  // feature detection: an app that opted out with `webjs.clientRouter: false`
  // never calls this, and a page that ships no component never loads
  // @webjsdev/core at all, so both no-router cases resolve to a full reload
  // without either side assuming anything about the other.
  /** @type any */ (globalThis).__webjsRefreshPage = refreshPage;
  // Both `click` and `submit` are BUBBLE phase, not capture. A component's
  // per-element `@click` / `@submit` handler (render-client.js) runs in the
  // at-target phase, BEFORE a document-level bubble listener. So onClick /
  // onSubmit run AFTER the component, and their `if (e.defaultPrevented) return`
  // guard sees the component's `preventDefault` and leaves the element alone.
  // A capture listener would run FIRST, before the component, so the guard
  // would always see `false` and the router would wrongly hijack a JS-handled
  // link or form: navigate a `<a @click=${e => e.preventDefault()}>` away, or
  // submit a `<form @submit=${e => e.preventDefault()}>` (the live chat /
  // comments forms, which preventDefault and send over WebSocket / fetch),
  // navigating the page out from under it. All the phase-independent filtering
  // (modifier / middle clicks, downloads, cross-origin, hash links, GET-vs-POST)
  // happens inside onClick / onSubmit regardless of phase. Mirrors
  // hotwired/turbo, which does its interception work in bubble listeners.
  document.addEventListener('click', onClick, false);
  document.addEventListener('submit', onSubmit, false);
  window.addEventListener('popstate', onPopState);
  // Intent prefetch: warm the next page on hover / focus / touch-start.
  // pointerover + focusin bubble, so one delegated listener each covers
  // the whole document, including links added by later navigations.
  document.addEventListener('pointerover', onPrefetchIntent, true);
  document.addEventListener('focusin', onPrefetchIntent, true);
  document.addEventListener('touchstart', onPrefetchIntent, { capture: true, passive: true });
  document.addEventListener('pointerout', onPrefetchOut, true);
  // After every client navigation the swapped-in DOM may carry new
  // anchors, so re-scan for render/viewport modes. webjs:navigate fires
  // at the end of fetchAndApply for both link and frame swaps.
  document.addEventListener('webjs:navigate', refreshPrefetchObservers);
  ensureUpgradeObserver();
  // Apply render/viewport prefetch modes to the initial document.
  refreshPrefetchObservers();
  // Take control of scroll restoration so the browser doesn't fight
  // the SPA's own snapshot-based restore on popstate.
  if (typeof history !== 'undefined' && 'scrollRestoration' in history) {
    prevScrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
  }
  // Seed the "current page" tracker so the first navigation can
  // snapshot the page the user is leaving.
  if (typeof location !== 'undefined') currentPageUrl = location.href;
  // Last, once the listeners are on: report whether the load that got us here
  // was a same-origin navigation the router never saw (#1118). Running it after
  // the listeners means a throw inside a diagnostic can never leave the router
  // half-installed.
  reportPreBootNavigation();
}

/** Disable the client router. */
export function disableClientRouter() {
  if (!enabled) return;
  _setEnabled(false);
  document.removeEventListener('click', onClick, false);
  document.removeEventListener('submit', onSubmit, false);
  window.removeEventListener('popstate', onPopState);
  document.removeEventListener('pointerover', onPrefetchIntent, true);
  document.removeEventListener('focusin', onPrefetchIntent, true);
  document.removeEventListener('touchstart', onPrefetchIntent, /** @type any */ ({ capture: true }));
  document.removeEventListener('pointerout', onPrefetchOut, true);
  document.removeEventListener('webjs:navigate', refreshPrefetchObservers);
  clearPrefetchHover();
  clearPrefetchViewTimers();
  teardownPrefetchViewObserver();
  if (typeof history !== 'undefined' && prevScrollRestoration !== null) {
    history.scrollRestoration = prevScrollRestoration;
    prevScrollRestoration = null;
  }
  // Never leave a restore window open on <html>, nor a catch-up chasing a
  // scroll offset after the router is gone (#1310).
  bumpRestoreGeneration();
  if (releaseScrollAnchor) releaseScrollAnchor();
  if (cancelScrollCatchUp) cancelScrollCatchUp();
  currentPageUrl = null;
  // Unpublish the refresh entry (#1398) so the dev reload client's feature
  // detection sees the router is gone and falls back to a full reload.
  delete (/** @type any */ (globalThis).__webjsRefreshPage);
}

/**
 * Programmatic navigation (replaces `location.href = url`).
 * @param {string} url
 * @param {{ replace?: boolean }} [opts]
 */
export async function navigate(url, opts) {
  const target = new URL(url, location.href);
  if (target.origin !== location.origin) {
    // Cross-origin: an intentional full-page nav, not a degradation, but it
    // ends the session in a test just the same, so it rides the same seam.
    hardNavigate(url);
    return;
  }
  await performNavigation(target.href, opts?.replace ?? false, null);
}

/**
 * Self-load a `<webjs-frame src>`: fetch `url` as a frame nav and apply the
 * matching `<webjs-frame id>` subtree into `frameEl` through the EXACT same
 * frame-swap path a click-driven frame nav uses (`fetchAndApply` with the
 * frame's id). So the #252 `aria-busy` lifecycle + `webjs:frame-busy` events,
 * the #249 `webjs:navigation-error` recovery, the keyed reconciler, and the
 * `webjs:frame-missing` fallback all apply for free; a `src` self-load and a
 * click that targets the same frame produce identical DOM.
 *
 * This is NOT a page navigation: it records no history entry, takes no page
 * snapshot, and shows no optimistic loading skeleton (it swaps one region, not
 * the page). It runs under a fresh nav token + AbortController so it interleaves
 * safely with real navigations and with a superseding `src` change on the same
 * frame (the later load's token wins; the earlier one's teardown never clears
 * the newer load's busy state, see `frameBusyTokens`).
 *
 * Called only by `<webjs-frame>` itself (`webjs-frame.js`), which owns the
 * no-double-load guard (eager connect vs lazy-viewport vs a `src` mutation).
 *
 * @param {Element} frameEl  The live `<webjs-frame>` element to fill.
 * @param {string} url  The `src` value, resolved against `location.href`.
 * @returns {Promise<{ ok: boolean, status: number | null, aborted: boolean, applied: boolean }>}
 *   Passed straight through from `fetchAndApply`, so `applied` says whether the
 *   frame subtree was actually swapped (#1398). Each guard below returns it
 *   explicitly rather than leaving the field off: one path omitting it would be
 *   the same kind of contract hole the flag exists to close.
 */
export async function loadFrame(frameEl, url) {
  if (typeof location === 'undefined') return { ok: false, status: null, aborted: false, applied: false };
  const id = frameEl && /** @type any */ (frameEl).id;
  if (!id) return { ok: false, status: null, aborted: false, applied: false };
  const target = new URL(url, location.href);
  // Cross-origin can't be a same-document frame swap (and a frame fetch must
  // send a same-origin credentialed request). Leave the frame unchanged.
  if (target.origin !== location.origin) return { ok: false, status: null, aborted: false, applied: false };

  // A frame self-load shares the global abort + token machinery so a real
  // navigation that starts mid-load supersedes it (and vice versa), exactly
  // like a click-driven frame nav routed through performNavigation.
  if (activeAbortController) activeAbortController.abort();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  const myToken = bumpNavToken();

  return fetchAndApply(
    target.href,
    id,
    /* recordHistory */ false,
    /* optimisticState */ null,
    'GET',
    /* body */ null,
    signal,
    myToken,
  );
}

/**
 * Invalidate a cached snapshot. Call after a server action mutates data
 * that affects a cached page so the next visit refetches.
 *
 * Evicts BOTH the back/forward snapshot cache and the speculative
 * prefetch cache. A prefetched fragment captured before a mutation would
 * otherwise be served stale on the next forward click, the same staleness
 * the snapshot eviction prevents for back/forward.
 *
 * @param {string} [url]  Specific URL to invalidate, or omit to clear all.
 */
export function revalidate(url) {
  // Falsy `url` (undefined, null, empty string) clears everything.
  // Loose `== null` would have left `revalidate('')` to silently no-op,
  // because `new URL('', location.href)` is a valid relative URL and the
  // resulting cache key rarely matches anything.
  // The blanket form means "everything held predates the change", which is what
  // `refreshPage` relies on, so it drops the refusal memos too (#1407): an edit
  // can add or remove a `loading.{js,ts}`, and with it whether the route streams
  // at all, which is exactly what a memo recorded. The TARGETED form below does
  // not, since a memo holds no content and so can never be served stale.
  if (!url) { snapshotCache.clear(); prefetchCache.clear(); clearPrefetchRefused(); return; }
  const u = new URL(url, location.href);
  const key = u.pathname + u.search;
  snapshotCache.delete(key);
  // EVERY dimension of that url, not just the page one (#1407). A frame link's
  // entry is keyed `<frameId> <path>`, so deleting the bare path would leave a
  // pre-mutation frame subtree consumable by the next frame click for the rest
  // of its TTL, which is the exact staleness this function exists to prevent.
  // The path half can never contain a space (the URL parser percent-encodes
  // one), so a trailing-space match identifies the framed keys unambiguously.
  prefetchCache.delete(key);
  const framedSuffix = ` ${key}`;
  for (const k of [...prefetchCache.keys()]) {
    if (k.endsWith(framedSuffix)) prefetchCache.delete(k);
  }
}

/**
 * Re-render the CURRENT url on the server and apply it in place, with no page
 * reload (#1398).
 *
 * Dev-facing today, since the live-reload client calls it for a page or layout
 * edit, but it is a plain capability with no dev-only code in it.
 *
 * It records no history entry and never scrolls, so the reader keeps their
 * place and Back still goes to the previous page. `mode` picks the swap tier:
 *
 * - `'page'` morphs the deepest shared boundary, so the outer layout's DOM and
 *   the hydrated state of its components survive. This is the light tier and
 *   the default.
 * - `'shell'` replaces the whole body. Needed when the LAYOUT's own markup
 *   changed, because that markup lives outside every children range and a
 *   boundary morph would leave it untouched. Component instances do not survive
 *   it.
 *
 * It does NOT reload changed component modules, and cannot: `customElements
 * .define` is once-per-tag and a module URL is fetched once per document. A
 * caller whose change touched browser code must reload instead.
 *
 * @param {'page' | 'shell'} [mode]
 * @returns {Promise<boolean>} whether the refresh applied. `false` means the
 *   caller should fall back to a full load.
 */
export async function refreshPage(mode) {
  if (!enabled || typeof location === 'undefined') return false;
  // Every cached copy predates the change, so drop both caches before fetching.
  revalidate();
  try {
    const res = await performNavigation(location.href, false, null, { refresh: mode === 'shell' ? 'shell' : 'page' });
    // The outcome has to be READ, not inferred from the absence of a throw.
    // `fetchAndApply` reports every real failure as `{ applied: false }` and
    // throws for none of them (a rejected fetch, a non-HTML body, an
    // unparseable one), so a bare try/catch here would resolve `true` for
    // exactly the cases the caller's full-load fallback exists to cover, and
    // the page would silently sit on stale content.
    //
    // It reads `applied`, NOT `ok`. An HTML body of any status is swapped in
    // place, so a page rendered through `notFound()`, `forbidden()`, or an
    // `error.ts` boundary is `ok: false` and applied perfectly well. Reading
    // `ok` would report those as failures and make the dev client reload on top
    // of a swap that already happened, losing the state this exists to keep,
    // every time you iterate on a page that currently renders a 4xx or 5xx.
    //
    // Two outcomes are NOT failures either. A `null` means no fetch decided it
    // (the parse guard hard-navigated, or a popstate restored a snapshot), so
    // the page is already resolved. An `aborted` means a newer navigation
    // superseded this one and owns the page now, and reloading would yank the
    // reader out of it; Turbo drops a refresh that lands mid-navigation for the
    // same reason.
    if (!res || res.aborted) return true;
    return res.applied;
  } catch (_) {
    return false;
  }
}

// Auto-enable on import: deferred to the END of this module (see the
// call after the test-only exports). enableClientRouter() transitively
// reads the prefetch state (prefetchViewObserver and the caches), which
// are `const`/`let` declared lower in the file and therefore in the
// temporal dead zone here. Calling enable at module-end, after every
// top-level binding is initialised, avoids a ReferenceError in the
// bundled browser build.

/* ====================================================================
 * Click + popstate handlers
 * ==================================================================== */

/**
 * @param {string} href
 * @param {boolean} isPopState
 * @param {string | null} frameId  Active <webjs-frame> id, or null.
 * @param {{ refresh?: 'page' | 'shell' }} [opts]  `refresh` marks a same-URL
 *   in-place re-render (#1398). It suppresses three things a forward navigation
 *   does and a refresh must not: the outgoing snapshot, the optimistic loading
 *   skeleton, and history plus scroll. See `refreshPage`.
 * @returns {Promise<{ ok: boolean, status: number | null, aborted: boolean, applied: boolean } | null>}
 *   The `fetchAndApply` outcome, so a caller can tell an applied navigation from
 *   a failed one (#1398). Read `applied` rather than `ok` for that question: an
 *   HTML body of any status is swapped in place, so a rendered 404 or 500 is
 *   `ok: false` and `applied: true`. `null` means no fetch decided the outcome:
 *   the parse guard hard-navigated, or a popstate restored from the snapshot
 *   cache. Both already resolved the page, so a caller must not treat `null` as
 *   a failure. Every other caller ignores the value.
 */
export async function performNavigation(href, isPopState, frameId, opts) {
  const refresh = (opts && opts.refresh) || undefined;
  // #1008 / #936: a forward, main-document nav fired while the document is
  // still parsing (`readyState === 'loading'`) races the DOM. The leaving
  // page's closing layout markers at the bottom of the body may not exist yet,
  // so `snapshotCurrent` plus region discovery would capture an incomplete tree
  // and drive a corrupt or over-wide swap (the suspected root cause of the
  // dropped-marker reports). The PREFETCH path already skips this window (see
  // the `buildHaveHeader` call site); the click / `navigate()` path did not.
  // Degrade to a correct full-page load, which is what an MPA would do anyway.
  // Scoped to frameless forward navs: popstate is browser-driven, and a frame
  // nav carries its own boundary element.
  if (shouldFullLoadDuringParse(isPopState, frameId) && typeof location !== 'undefined') {
    reportFallback('readyState-loading', href);
    hardNavigate(href);
    return null;
  }

  // Cancel any in-flight fetch: Turbo Drive's navigator.stop().
  if (activeAbortController) activeAbortController.abort();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  // Bump nav generation. Captured below + by anything we await into.
  const myToken = bumpNavToken();

  // A new navigation ends any restore window still open from an earlier one
  // (#1310). The window outlives its own restore by design (a floor, then a
  // ceiling), so without this a second navigation inside that span inherits
  // suppressed anchoring: a Back that CLAMPS opens no window of its own, so it
  // would run the whole growth under the previous restore's suppression and
  // freeze its clamp, and a forward nav would carry it onto a different page
  // entirely. Reopening for this navigation, if it earns one, happens below.
  // The clamped path's catch-up is cancelled for the same reason: it chases an
  // offset recorded for the page being navigated away from.
  //
  // A FRAME-targeted nav is excluded, for the same reason `loadFrame` is: it
  // swaps one region and leaves the page, and so the restored scroll offset,
  // intact. The codebase already treats a click-driven frame nav and a `src`
  // self-load as the same thing, so exempting one and not the other would be
  // the split this rule exists to avoid.
  //
  // All THREE move together. Exempting only the counter while still closing
  // the window and aborting the catch-up would leave the split exactly where
  // it was, one line further down: a form inside a frame, submitted by a
  // component upgrading in the just-restored page, would hand anchoring back
  // mid-restore and bring the whole double-count back.
  if (!frameId) {
    bumpRestoreGeneration();
    if (releaseScrollAnchor) releaseScrollAnchor();
    if (cancelScrollCatchUp) cancelScrollCatchUp();
  }

  // Snapshot the page the user is LEAVING (with its scroll position)
  // so back/forward navigation can restore it. We key under
  // `currentPageUrl` rather than `location.href` because on popstate
  // the browser has already updated `location.href` to the destination
  // URL: using it as the key would clobber the cached snapshot we're
  // about to read in the popstate-restore branch below.
  //
  // A refresh (#1398) skips it: it navigates to the URL it is already on, so
  // snapshotting first would write the PRE-EDIT page into `snapshotCache` under
  // that exact key and a later Back would restore the stale render.
  if (!refresh && currentPageUrl) snapshotCurrent(currentPageUrl);

  // Expose the opt-in `data-navigating` loading-indicator hook (see
  // setNavigating), but only if the nav takes long enough to be worth showing
  // one. Deferred so quick navs (sub-150ms) never set it at all.
  let navigatingFlagTimer = setTimeout(() => {
    setNavigating(true);
    navigatingFlagTimer = null;
  }, 150);

  // Optimistic loading: clone the per-segment loading.ts template (if
  // any) into the deepest current children-slot so the user sees an
  // instant skeleton instead of stale content. Saved so we can restore
  // it if the fetch fails.
  //
  // A refresh (#1398) shows none: flashing a `loading.ts` skeleton over content
  // that is already correct is strictly worse than showing the old content for
  // one round trip. Turbo's `MorphingPageRenderer` suppresses its own
  // equivalents for the same reason.
  let optimisticState = null;
  if (!isPopState && !refresh) optimisticState = applyOptimisticLoading();

  try {
    // popstate: try cache first, then refetch in background. Instant restore.
    if (isPopState) {
      const cached = snapshotGet(href);
      if (cached) {
        const cachedDoc = parseHTML(cached.html);
        if (cachedDoc) {
          applySwap(cachedDoc, frameId, /* revalidating */ true, /* href */ null);
          // Restore window scroll to where the user left it. Use
          // behavior:'instant' so an app-level `scroll-behavior: smooth`
          // stylesheet does not animate the restore (native nav jumps).
          //
          // `cached.scrollY` was recorded at the page's SETTLED height, and the
          // DOM just swapped in is still shorter until its components upgrade
          // and re-render. Suppress scroll anchoring across the restore, or the
          // browser adds that late growth to the restored offset and the reader
          // lands below where they left (#1310).
          let releaseAnchor = () => {};
          if (typeof window !== 'undefined') {
            // Restore the scroll, then decide whether to suppress anchoring.
            //
            // Suppress ONLY when the recorded offset was actually reached. A
            // document that has not grown yet can be too SHORT to scroll that
            // far, and the browser clamps to its current maximum. A reader at
            // the bottom of the settled page is the clear case: the shortfall is
            // then exactly the growth still to come, and anchoring ADDING that
            // growth is what carries them back to the bottom. Suppressing there
            // freezes the clamp instead and strands them a full page-growth
            // ABOVE where they left, which is this bug's own mirror image. The
            // two situations want opposite things and are told apart by the one
            // question that separates them: did the scroll land.
            //
            // Both halves must read the SAME layout, and the scroll must be
            // written against the page being restored. That is why this is
            // ordered rather than simply inlined, and why the ordering differs
            // by path.
            const restoreScroll = () => {
              window.scrollTo({ left: cached.scrollX, top: cached.scrollY, behavior: 'instant' });
              if (window.scrollY >= cached.scrollY - 1) {
                releaseAnchor = suppressScrollAnchoring();
              } else {
                // Clamped. Anchoring is left on, since it is what carries the
                // reader back down, but it adds the FULL growth regardless of
                // how far short the clamp fell, so on its own it only lands a
                // reader who left at the very bottom. Chase the recorded offset
                // instead, once the page is tall enough to hold it.
                catchUpToRestoredScroll(cached.scrollY, cached.scrollX);
              }
            };
            if (viewTransitionsEnabled() && typeof (/** @type any */ (document)).startViewTransition === 'function') {
              // Under a view transition `applySwap` defers its DOM mutation a
              // frame, so running now would write and measure against the
              // OUTGOING page. Measured with a 60000px outgoing page and a
              // 3000px restored one: the scroll "landed" at 20000, suppression
              // opened, and the restored page then clamped to 2416 with
              // anchoring held off, which is precisely the stranding the
              // conditional exists to prevent. Wait for the swap to commit.
              //
              // Guarded, because this is the one path where the restore
              // outlives the call that scheduled it. Every cancel site in this
              // feature (performNavigation, performSubmission,
              // disableClientRouter) runs at the START of the next thing, so a
              // navigation, submission, or disable arriving inside the deferred
              // frame would close the window and then have this reopen it,
              // scrolling a page it was never meant for to an offset recorded
              // for the previous history entry. The synchronous branch below
              // cannot outlive anything and so needs no guard.
              const myRestore = restoreGeneration;
              _swapCommit.then(() => {
                if (myRestore !== restoreGeneration || !enabled) return;
                restoreScroll();
              }).catch(() => {});
            } else {
              // The synchronous path, and the read must STAY synchronous here.
              // Deferring it even by a microtask breaks the fix outright: by
              // then the restored components' renders have been applied, and
              // reading `scrollY` forces the layout that flushes them, so
              // anchoring runs DURING the read and hands back the
              // already-shifted offset. Measured on /ui/button, the suppression
              // landed 19ms late with `scrollY` already 800 -> 1563. What makes
              // it correct is not which document it sees but that it sees the
              // same layout the scroll just landed in.
              restoreScroll();
            }
          }
          // Fire-and-forget revalidation. Uses a fresh AbortController
          // since this background fetch is allowed to overlap with the
          // next foreground nav (it'll get aborted if a new nav lands).
          //
          // Closing the anchoring window on THIS revalidation's settle (plus two
          // frames for the re-applied DOM to lay out) is what keeps the window
          // tied to one restore. A height observer could not tell a settling
          // restore from a streaming <webjs-suspense> boundary (#471 / #473).
          //
          // The floor is what makes that safe. Waiting on the revalidation ALONE
          // ties the window's length to network latency rather than to the
          // growth it guards, so a server that answers faster than the restored
          // page renders closes it early and the reader lands low again, which
          // is the whole defect.
          const revalidated = fetchAndApply(href, frameId, /* recordHistory */ false, optimisticState, 'GET', null, signal, myToken, /* revalidating */ true)
            .catch(() => {});
          const floor = new Promise((r) => setTimeout(r, ANCHOR_SUPPRESS_FLOOR_MS));
          Promise.all([revalidated, floor]).then(() => afterTwoFrames(releaseAnchor));
          return null;
        }
      }
      // Cache-miss popstate. Browser-native scroll restoration is
      // disabled (we set scrollRestoration='manual'): so without
      // explicit handling, scroll would just stay where the user was
      // on the page they popped FROM. Scroll to top as the reasonable
      // default; fetchAndApply skips its own scroll handling when
      // recordHistory=false (which is the case here).
      if (typeof window !== 'undefined') window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
    }

    // `recordHistory: false` on a refresh (#1398) is what suppresses BOTH the
    // duplicate `history.pushState` and the whole scroll block in one flag,
    // which is exactly what the comment above that block already says it means.
    // So Back still goes to the previous page and the reader keeps their place.
    return await fetchAndApply(href, frameId, !isPopState && !refresh, optimisticState, 'GET', null, signal, myToken, /* revalidating */ false, refresh);
  } finally {
    if (navigatingFlagTimer) clearTimeout(navigatingFlagTimer);
    // Only clear the navigating flag if WE are still the active nav.
    // A newer nav has its own flag lifecycle.
    if (myToken === currentNavigationToken) {
      setNavigating(false);
      // Record where the user is NOW so the next navigation can
      // snapshot under the right URL key.
      if (typeof location !== 'undefined') currentPageUrl = location.href;
    }
  }
}

/**
 * Submit a form via the partial-swap pipeline. Mirrors performNavigation
 * but routes the FormData body. GET submissions promote the body to a
 * query string (HTML form-submission algorithm); non-GET submissions
 * send the body as-is.
 *
 * Mutating methods (anything except GET/HEAD) clear the whole snapshot
 * cache after a successful response: Turbo's `clearSnapshotCache()` on
 * `!isSafe` (`navigator.js:71-88`). Other URLs in the cache may have
 * been server-side-mutated by this submission; refusing to clear would
 * serve stale content on subsequent back/forward.
 *
 * Submission-state events + aria-busy: while the enhanced submission fetch
 * is in flight the router sets `aria-busy="true"` on the FORM element and
 * dispatches `webjs:submit-start` (detail `{ form, url }`); on EVERY settle
 * path (success swap, validation re-render, navigation error, abort by a
 * superseding submit/nav) it clears `aria-busy` and dispatches
 * `webjs:submit-end` (detail `{ form, url, ok }`, `ok` = the submission was
 * not an error outcome). The toggle uses the same nav-token guard the
 * `<webjs-frame>` busy state uses (`formBusyTokens` / `markFormBusy` /
 * `clearFormBusy`): a superseded submit's teardown never clears the busy
 * state a NEWER submit already set, so a rapid re-submit stays busy until the
 * live submission settles. The native `aria-busy` attribute on the form is
 * the readable "is this form submitting" primitive (any component can read
 * it); the events are the push-notification counterpart. Progressive
 * enhancement: with JS off this whole code path is skipped and the form is a
 * plain POST.
 *
 * @param {string} href     Absolute target URL.
 * @param {string} method   Lowercased HTTP verb.
 * @param {FormData | URLSearchParams} body  Encoded per the declared enctype
 *   (#1307): `FormData` for multipart, `URLSearchParams` for urlencoded. Both
 *   iterate as `[name, value]` pairs, which is all the safe-method query-string
 *   promotion below needs, and `fetch` derives the right content type from
 *   either without an explicit header.
 * @param {string | null} frameId
 * @param {HTMLFormElement | null} [form]  The submitted form, for busy + events.
 */
export async function performSubmission(href, method, body, frameId, form) {
  if (activeAbortController) activeAbortController.abort();
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;
  const myToken = bumpNavToken();
  // Same reasoning as performNavigation: a submission is a navigation, so it
  // ends any restore window a recent Back left open (#1310), and cancels a
  // clamped restore's catch-up. Frame-targeted submissions are excluded on the
  // same reasoning as the frame navs above.
  if (!frameId) {
    bumpRestoreGeneration();
    if (releaseScrollAnchor) releaseScrollAnchor();
    if (cancelScrollCatchUp) cancelScrollCatchUp();
  }

  const isSafe = method === 'get' || method === 'head';
  let url = new URL(href, location.href);
  if (isSafe) {
    // Promote body to query string per the HTML5 form-submission
    // algorithm. The form's own `action` query is replaced: same as
    // a native GET-form submission.
    url.search = '';
    for (const [k, v] of body) {
      url.searchParams.append(k, typeof v === 'string' ? v : v.name);
    }
  }

  // Snapshot the page being submitted from (form submissions are
  // always foreground / never popstate, so `currentPageUrl` already
  // matches `location.href`: but use the tracker for consistency
  // with performNavigation).
  if (currentPageUrl) snapshotCurrent(currentPageUrl);

  let navigatingFlagTimer = setTimeout(() => {
    setNavigating(true);
    navigatingFlagTimer = null;
  }, 150);

  const optimisticState = applyOptimisticLoading();

  // Submission-state lifecycle: mark the form busy + announce the start, then
  // clear + announce the settle in the finally so EVERY exit (success,
  // validation re-render, navigation error, abort by a superseding submit)
  // balances the pair. `ok` is filled from the fetch outcome; an abort or a
  // teardown that never reached the fetch settles ok:false. The token guard
  // (markFormBusy/clearFormBusy) keeps a superseded submit's teardown from
  // clearing the busy state a newer submit set.
  const busyForm = form ? markFormBusy(form, myToken, url.href) : null;
  let outcomeOk = false;
  try {
    const outcome = await fetchAndApply(
      url.href,
      frameId,
      /* recordHistory */ true,
      optimisticState,
      isSafe ? 'GET' : method.toUpperCase(),
      isSafe ? null : body,
      signal,
      myToken,
    );
    outcomeOk = !!(outcome && outcome.ok);
    // Mutating submissions invalidate cached versions of other URLs -
    // do this *after* the response applies so the new page itself is
    // snapshotted on the next nav, not pre-emptively wiped. Clear the
    // speculative prefetch cache too: a fragment prefetched before this
    // mutation would otherwise be served stale on a later forward click.
    if (!isSafe && myToken === currentNavigationToken) {
      snapshotCache.clear();
      prefetchCache.clear();
    }
  } finally {
    if (busyForm) clearFormBusy(busyForm, myToken, url.href, outcomeOk);
    if (navigatingFlagTimer) clearTimeout(navigatingFlagTimer);
    if (myToken === currentNavigationToken) {
      setNavigating(false);
      if (typeof location !== 'undefined') currentPageUrl = location.href;
    }
  }
}


/* ====================================================================
 * Link prefetch (Remix-style strategies, fast-by-default)
 *
 * A link click already resolves through fetchAndApply, but the fetch
 * only STARTS on click, so the user waits a full round-trip. Prefetch
 * warms a dedicated cache speculatively so the click reads it instantly.
 *
 * Strategy per anchor via a `data-prefetch` attribute (valid-HTML data-*,
 * like SvelteKit / Astro). The default is DEVICE-ADAPTIVE so the common case
 * is fast on every device without per-link opt-in: `intent` on a hover-capable
 * pointer (a real head-start before the click), `viewport` on touch (no hover
 * exists, and `touchstart` fires too close to the tap to front-run it). Value
 * vocabulary borrows Next's true/false/auto aliases:
 *   - absent (default)       : intent on pointer, viewport on touch (adaptive)
 *   - intent                 : hover / focus / touch, after a short dwell
 *   - true / render          : eager, as soon as a document scan sees it
 *   - auto / viewport        : on viewport entry (IntersectionObserver, 0.5),
 *                              after a dwell so a fast scroll-through skips it
 *   - false / none           : never (also data-no-prefetch / rel="external")
 *
 * Why a separate cache, not snapshotCache: snapshotCache is keyed to the
 * back/forward restore path (popstate), which holds the FULL serialized
 * document of pages the user already visited. A prefetch holds the
 * SERVER FRAGMENT for a page not yet visited (the same X-Webjs-Have
 * partial body a real nav would receive). fetchAndApply consumes it via
 * prefetchTake() before falling back to the network.
 *
 * Only same-origin in-app links are prefetched (the same eligibility as
 * a click), and never under Save-Data / prefers-reduced-data / a 2g link,
 * never past a small concurrency cap, and never twice (deduped + cached). The
 * viewport path additionally waits a dwell and cancels on scroll-out, so a
 * fast scroll through a long list does not flood the network tab. There is no
 * logout-style heuristic: prefetch issues a real GET, so as everywhere in
 * the ecosystem (Next / Nuxt / Remix), a non-idempotent action must be a
 * POST or a `<form>`, and `data-no-prefetch` / `rel="external"` opt out.
 *
 * What we do NOT touch: a native `<link rel="prefetch">` in the document
 * head is the browser's own mechanism and warms the HTTP cache; we never
 * interfere with it.
 * ==================================================================== */

/** Test-only: read the "current page URL" tracker (used for snapshot keying). */
export function _currentPageUrl() { return currentPageUrl; }

/** Test-only: set the tracker (simulates being on a specific page). */
export function _setCurrentPageUrl(u) { currentPageUrl = u; }
