/**
 * Client router: scroll.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { ANCHOR_RELEASE_EVENTS, ANCHOR_SUPPRESS_CEILING_MS } from './constants.js';

/**
 * Closes the currently open restore window, or null when none is open.
 * @type {(() => void) | null}
 */
export let releaseScrollAnchor = null;

/**
 * Suppress the browser's scroll anchoring for the duration of a back/forward
 * scroll restore (#1310).
 *
 * A snapshot's `scrollY` is recorded against the page at its SETTLED height.
 * The restore replays that number onto a document that has only just been
 * swapped in and is still shorter, because the components in the restored
 * markup have not upgraded and re-rendered yet. When they do, content grows
 * ABOVE the viewport, and scroll anchoring (`overflow-anchor: auto`, the UA
 * default) holds the VISUAL position by adding that growth to `scrollY`. The
 * offset is counted twice. On webjs.dev's `/ui/button` that lands the reader
 * 763px too low, exactly the settled-minus-swapped height delta.
 *
 * Anchoring is right for a reader on a live page and wrong for exactly this
 * window, where the restored number already accounts for the growth. So the
 * window suppresses it rather than re-scrolling afterwards. A re-assert would
 * have to fire on every growth, and a settling restore cannot be told apart
 * from a `<webjs-suspense>` boundary streaming in (#471 / #473). Suppression
 * never MOVES the viewport, it only withholds a correction, so it also cannot
 * yank a reader who has already started scrolling.
 *
 * Chromium, Firefox, and WebKit all implement scroll anchoring, and all three
 * honour `overflow-anchor: none` identically whether it sits on the root
 * scroller or on `<body>`, so there is no engine-specific path here.
 *
 * It goes on the ROOT, and `<body>` is not an alternative even though it looks
 * like the tidier one. Suppressing on `<body>` works identically on all three
 * engines (the property excludes an element and its subtree from being chosen
 * as the anchor, and every candidate lives under `<body>`), and it would avoid
 * writing to the root at all, which is worth wanting: toggling something on the
 * root re-runs global style resolution, and on WebKit that re-resolves
 * `oklch()` token values and repaints them for a frame, which is the #610 flash
 * that made `data-navigating` opt-in.
 *
 * It is disqualified by the RELEASE, not the suppression. On WebKit, anchoring
 * never resumes once it has been suppressed on `<body>`: removing the property,
 * setting it back to `auto`, and both in sequence were each measured, and after
 * every one the next growth above the viewport still failed to move `scrollY`.
 * Suppressing on the root resumes correctly on all three. Since the whole point
 * is that suppression is TEMPORARY, a placement that cannot be undone would
 * leave every WebKit reader, so every iOS browser, with scroll anchoring off
 * for the life of the page after their first Back. That is a far worse trade
 * than one repaint, so the root it is.
 *
 * @returns {() => void} Idempotent release. Safe to call after the window has
 *   already closed on user input or the ceiling.
 */
export function suppressScrollAnchoring(targetX, targetY) {
  if (typeof document === 'undefined' || !document.documentElement) return () => {};
  // A second restore inside an open window supersedes the first.
  if (releaseScrollAnchor) releaseScrollAnchor();
  const root = document.documentElement;
  // Save and restore the author's own inline value rather than blanking it,
  // the same save-and-put-back contract the router keeps elsewhere.
  const prev = root.style.getPropertyValue('overflow-anchor');
  root.style.setProperty('overflow-anchor', 'none');
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  // With a target, the window also WRITES BACK a programmatic displacement
  // (#1428). Under `scrollRestoration: 'auto'` Firefox performs a scroll
  // action of its own after an intercepted traverse's handler settles,
  // ignoring the interception's `scroll: 'manual'`, and it lands at 0,
  // clobbering the restore this window is holding. A user can never trigger
  // this listener first: every release event is a CAPTURE-phase input
  // listener (wheel / touchmove / keydown / pointerdown), and each of those
  // fires BEFORE the scroll event that follows it, so by the time a
  // user-driven scroll lands here the window is already closed. What remains
  // is exactly a programmatic non-user write inside the restore's own span,
  // which is the one thing the restore may overrule. Re-entry is benign: the
  // write-back's own scroll event arrives on-target and returns.
  const onScroll = (typeof targetY === 'number' && typeof window !== 'undefined')
    ? () => {
      if (Math.abs(window.scrollY - targetY) <= 1 && Math.abs(window.scrollX - (targetX || 0)) <= 1) return;
      window.scrollTo({ left: targetX || 0, top: targetY, behavior: 'instant' });
    }
    : null;
  const release = () => {
    // Only the window that installed this release may close it.
    if (releaseScrollAnchor !== release) return;
    releaseScrollAnchor = null;
    if (timer) { clearTimeout(timer); timer = null; }
    if (typeof window !== 'undefined') {
      for (const ev of ANCHOR_RELEASE_EVENTS) {
        window.removeEventListener(ev, release, /** @type {any} */ ({ capture: true }));
      }
      if (onScroll) window.removeEventListener('scroll', onScroll);
    }
    if (prev) root.style.setProperty('overflow-anchor', prev);
    else root.style.removeProperty('overflow-anchor');
  };
  releaseScrollAnchor = release;
  timer = setTimeout(release, ANCHOR_SUPPRESS_CEILING_MS);
  if (typeof window !== 'undefined') {
    for (const ev of ANCHOR_RELEASE_EVENTS) {
      window.addEventListener(ev, release, { capture: true, passive: true });
    }
    if (onScroll) window.addEventListener('scroll', onScroll, { passive: true });
  }
  return release;
}

/**
 * Closes the currently held height reservation, or null when none is open.
 * @type {(() => void) | null}
 */
export let releaseHeightReservation = null;

/**
 * Reserve the restored page's SETTLED height across a Back/Forward restore
 * (#1428 architecture).
 *
 * A restore re-inserts an outerHTML snapshot, and that markup is SHORTER than
 * the page it was serialized from until its components upgrade and re-render a
 * beat later. Every scroll defect in this file's history lived in that window:
 * the browser clamped the recorded offset against the short document (#1310's
 * clamped band, formerly healed by a chase), and the UA's own restoration
 * landed short the same way. Holding the settled height on the ROOT element
 * makes the recorded offset reachable from the first frame, so a restore lands
 * exactly, once, and the clamp class cannot occur at all.
 *
 * The root and not `<body>`, because the restore REPLACES the whole body, so
 * an inline style there would leave with the old node. Same
 * save-and-put-back contract as `overflow-anchor` above.
 *
 * Released on the restore's settle, on the ceiling, and on supersede (a new
 * page navigation, a submission, disabling the router). NEVER on user input:
 * the window releases early for a reader taking over, but yanking the page's
 * height out from under a reader mid-scroll is the one harm an early release
 * here could cause, so this deliberately does not share that trigger.
 *
 * @param {number} px the snapshot's recorded `scrollHeight`
 * @returns {() => void} Idempotent release.
 */
export function reserveRestoredHeight(px) {
  if (typeof document === 'undefined' || !document.documentElement || !(px > 0)) return () => {};
  // A second reservation supersedes the first.
  if (releaseHeightReservation) releaseHeightReservation();
  const root = document.documentElement;
  const prev = root.style.getPropertyValue('min-height');
  root.style.setProperty('min-height', px + 'px');
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const release = () => {
    if (releaseHeightReservation !== release) return;
    releaseHeightReservation = null;
    if (timer) { clearTimeout(timer); timer = null; }
    if (prev) root.style.setProperty('min-height', prev);
    else root.style.removeProperty('min-height');
  };
  releaseHeightReservation = release;
  timer = setTimeout(release, ANCHOR_SUPPRESS_CEILING_MS);
  return release;
}

/**
 * Bumped wherever a restore is superseded (#1310), and read by the one restore
 * path that outlives the call scheduling it. That means a PAGE navigation, a
 * PAGE-level submission, and disabling the router. A frame-targeted nav or
 * submission swaps one region and leaves the page, so it is excluded, exactly
 * like the `loadFrame` case.
 *
 * Deliberately NOT `currentNavigationToken`, which is the obvious choice and the
 * wrong one: `loadFrame` bumps that too, and its own contract says a frame
 * self-load is not a page navigation. An eager `<webjs-frame src>` inside a
 * RESTORED snapshot loads during the swap, so keying on the nav token would
 * read a routine frame load as a supersede and drop the entire restore, leaving
 * the reader at the outgoing page's offset. That is worse than the defect this
 * whole change fixes. This counter moves only for the three things that really
 * do end a restore.
 */
export let restoreGeneration = 0;

/**
 * Run `fn` after two animation frames, so a just-applied DOM has laid out
 * before it reads or acts. Falls back to a macrotask where
 * `requestAnimationFrame` is absent (the linkedom-backed node test harness).
 *
 * @param {() => void} fn
 */
export function afterTwoFrames(fn) {
  if (typeof requestAnimationFrame !== 'function') { setTimeout(fn, 0); return; }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

/**
 * Bump the restore generation.
 *
 * `restoreGeneration` is written by this module AND by the navigator, where
 * every fresh navigation invalidates an in-flight scroll restore. An ESM import
 * binding cannot be assigned across a module boundary, so the navigator calls
 * this rather than doing `restoreGeneration += 1` itself. Same statement, same
 * semantics, one indirection.
 */
export function bumpRestoreGeneration() {
  restoreGeneration += 1;
}
