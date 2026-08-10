/**
 * Client router: scroll.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { ANCHOR_RELEASE_EVENTS, ANCHOR_SUPPRESS_CEILING_MS, ANCHOR_SUPPRESS_FLOOR_MS } from './constants.js';
import { loadFrame, prevScrollRestoration } from './navigator.js';
import { currentNavigationToken } from './state.js';

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
export function suppressScrollAnchoring() {
  if (typeof document === 'undefined' || !document.documentElement) return () => {};
  // A second restore inside an open window supersedes the first.
  if (releaseScrollAnchor) releaseScrollAnchor();
  const root = document.documentElement;
  // Save and restore the author's own inline value rather than blanking it,
  // the same contract `prevScrollRestoration` keeps above.
  const prev = root.style.getPropertyValue('overflow-anchor');
  root.style.setProperty('overflow-anchor', 'none');
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  const release = () => {
    // Only the window that installed this release may close it.
    if (releaseScrollAnchor !== release) return;
    releaseScrollAnchor = null;
    if (timer) { clearTimeout(timer); timer = null; }
    if (typeof window !== 'undefined') {
      for (const ev of ANCHOR_RELEASE_EVENTS) {
        window.removeEventListener(ev, release, /** @type {any} */ ({ capture: true }));
      }
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
  }
  return release;
}

/**
 * Cancels an in-flight catch-up, or null when none is running.
 * @type {(() => void) | null}
 */
export let cancelScrollCatchUp = null;

/**
 * Bumped wherever a restore is superseded (#1310), and read by the one restore
 * path that outlives the call scheduling it. That means a PAGE navigation, a
 * PAGE-level submission, and disabling the router. A frame-targeted nav or
 * submission swaps one region and leaves the page, so it is excluded, exactly
 * like the `loadFrame` case below.
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
 * Chase a restored scroll offset the document was too SHORT to reach (#1310).
 *
 * The sibling of `suppressScrollAnchoring`, for the case that one deliberately
 * declines. When the recorded offset is past the un-grown document's maximum,
 * the browser clamps, and anchoring then adds the growth back as the page
 * settles. That lands a reader who left at the very bottom back at the bottom,
 * because there the shortfall and the growth are the same number. It is wrong
 * for everyone else: anchoring adds the FULL growth whatever the shortfall was,
 * so a reader who left 100px above the bottom is carried 100px too far.
 *
 * This re-asserts the recorded offset once the document can actually hold it,
 * which is the only moment the number becomes reachable, and then stops.
 *
 * It is deliberately narrow, because #1310 rejected re-asserting the scroll in
 * the general case and that reasoning still holds. The difference is that this
 * knows exactly where it is going and can tell when it has arrived: it runs
 * ONLY on the clamped path, only while the offset is still out of reach, writes
 * once, and stops on the first real input.
 *
 * It does NOT escape the settling-versus-streaming question, and it is worth
 * being exact about that rather than claiming otherwise. It cannot tell the
 * restore settling apart from any other growth, so the guard is its WINDOW: it
 * lives for `ANCHOR_SUPPRESS_FLOOR_MS` from the RESTORE and no longer. That is
 * tighter than the window a landed restore gets, which runs to the later of the
 * floor and the revalidation and is capped by the ceiling, and deliberately so,
 * because this path WRITES scroll. The suppression this path installs once the
 * chase lands is part of the same window, not a second one: it shares this
 * deadline, so the whole clamped path is bounded by one floor measured from the
 * restore however late the landing happens.
 *
 * Be precise about what the bound does and does not buy, since it is easy to
 * overclaim in both directions. WHILE the window is open the reader is
 * protected: until the offset is reachable there is nothing to protect, and
 * from the moment the chase lands on it, suppression holds it against the rest
 * of the growth. AFTER the window closes, both halves stop: the router writes
 * no more scroll, and anchoring is back on, so any growth still arriving is
 * added to `scrollY` and carries the reader down toward the bottom, which is
 * main's behaviour. So the cost of a component that settles later than the
 * window is that the reader drifts below the offset, not that they sit at the
 * clamp.
 *
 * @param {number} targetY  The recorded offset to reach.
 * @param {number} targetX
 */
export function catchUpToRestoredScroll(targetY, targetX) {
  if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
  if (cancelScrollCatchUp) cancelScrollCatchUp();
  let rafId = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** Release for the suppression installed once the offset is reached. */
  let releaseLanded = null;
  const stop = () => {
    if (cancelScrollCatchUp !== stop) return;
    cancelScrollCatchUp = null;
    if (rafId) cancelAnimationFrame(rafId);
    if (timer) { clearTimeout(timer); timer = null; }
    if (releaseLanded) { releaseLanded(); releaseLanded = null; }
    for (const ev of ANCHOR_RELEASE_EVENTS) {
      window.removeEventListener(ev, stop, /** @type {any} */ ({ capture: true }));
    }
  };
  const tick = () => {
    if (cancelScrollCatchUp !== stop) return;
    const maxY = document.documentElement.scrollHeight - window.innerHeight;
    if (maxY >= targetY) {
      // Reachable at last. Land the reader on the recorded offset.
      window.scrollTo({ left: targetX, top: targetY, behavior: 'instant' });
      // And then protect it, because landing is not the end of the story. The
      // growth that made the offset reachable is rarely all of it: the real
      // cause is components upgrading one at a time, so more arrives after
      // this. Anchoring is still on here, deliberately, so every later stage
      // would be added on top of the offset just written and carry the reader
      // below it again. Measured on a two-stage fixture, an offset of 4000
      // ended at 5000.
      //
      // Once the reader IS on the recorded offset the situation is identical to
      // a restore that landed on its first try, so it gets that case's
      // protection for what remains.
      //
      // It shares THIS chase's deadline rather than starting one of its own,
      // which matters: a fresh floor-length timer here would start at landing
      // rather than at the restore, so the clamped path could hold anchoring
      // off for nearly twice the floor and stop being the tighter of the two
      // windows, which is the whole reason for the bound. `stop` owns the
      // release, so the existing timer and the input listeners close it.
      releaseLanded = suppressScrollAnchoring();
      // Deliberately NOT `stop()`: the window has to outlive the landing, up to
      // the deadline already running.
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      return;
    }
    rafId = requestAnimationFrame(tick);
  };
  cancelScrollCatchUp = stop;
  // Same inputs that close a suppression window: the reader has taken over.
  for (const ev of ANCHOR_RELEASE_EVENTS) {
    window.addEventListener(ev, stop, { capture: true, passive: true });
  }
  // Bounded by the FLOOR, not the ceiling. The ceiling is a backstop for a hung
  // fetch; this is a scroll WRITE, so its window is the one thing that decides
  // whether a reader can be moved without asking. Any growth past the target
  // fires it, and growth is not exclusively the restore settling: a
  // <webjs-suspense> boundary resolving, a lazy component entering, or a late
  // image would all qualify. Holding it open for the full ceiling would mean a
  // reader who landed and started READING, and so generates no input to cancel
  // it, could be scrolled up to two seconds after pressing Back. The floor
  // covers the restore's own settling, which is what it is for, and is measured
  // in a few hundred milliseconds rather than seconds.
  timer = setTimeout(stop, ANCHOR_SUPPRESS_FLOOR_MS);
  rafId = requestAnimationFrame(tick);
}

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
