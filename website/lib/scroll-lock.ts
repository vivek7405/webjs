/**
 * Page scroll lock, refcounted, shared with the UI kit's overlays.
 *
 * Hiding the page scrollbar widens the viewport by the scrollbar's width, so
 * anything laid out against the viewport moves. Padding the page holds in-flow
 * content still, but a `position: fixed` header lays out against the initial
 * containing block, never against any padding box, so padding alone leaves it
 * sliding right (#1147, measured at 785px to 800px on an 800x700 viewport, the
 * theme toggle and menu button jumping the full scrollbar width). Two
 * mechanisms fix it:
 *
 *   1. Reserve the scrollbar gutter for the duration of the lock, so the
 *      viewport width never changes and NOTHING moves, in flow or fixed. This
 *      needs no cooperation from the page. Honoured on Chromium and Firefox.
 *   2. Where the engine ignores `scrollbar-gutter` (WebKit today), fall back to
 *      padding <html> and publish the leftover width as
 *      `--wj-scrollbar-compensation`, which a fixed element opts into with
 *      `border-right: var(--wj-scrollbar-compensation, 0px) solid transparent`.
 *      app/layout.ts already carries exactly that on `.site-top > header`.
 *
 * Everything here is MEASURED rather than assumed, because engines disagree
 * about both scrollbar geometry and gutter support. When mechanism 1 works the
 * residual is zero, so no padding is applied and the custom property is never
 * set: the two cannot double-compensate.
 *
 * This is a port of the lock in the UI kit's dialog / alert-dialog (see
 * packages/ui/packages/registry/components/dialog.ts). It is NOT imported from
 * there on purpose: those are registry sources mirrored into modules/ui/ by
 * scripts/copy-registry.mjs, a generated tree this app must not import from,
 * and they each carry their own copy so `webjs ui add alert-dialog` stays
 * self-contained. What makes the copies safe is the SHARED STATE below, not
 * shared code.
 */

/** The property a fixed element opts into. Must match the kit's spelling. */
const SCROLLBAR_COMPENSATION = '--wj-scrollbar-compensation';

interface ScrollLockState {
  count: number;
  overflow: string;
  rootPaddingRight: string;
  scrollbarGutter: string;
  compensation: string;
}

/**
 * The lock's state is DOCUMENT level, so it is keyed on `globalThis` rather
 * than module scope, under the SAME key the kit's overlays use. That is what
 * lets a drawer and a `<ui-dialog>` be open at once without fighting: two
 * independent counters mutating the same <html> can only be released safely in
 * LIFO order, and they are not (`disconnectedCallback` fires in tree order and
 * the before-cache close runs in registration order), so the inner unlock would
 * replay the values it captured with nothing left to clear them, leaving <html>
 * padded for good. One shared counter makes release order irrelevant.
 */
function scrollLockState(): ScrollLockState {
  const store = globalThis as unknown as { __webjsScrollLock?: ScrollLockState };
  let state = store.__webjsScrollLock;
  if (!state) {
    state = { count: 0, overflow: '', rootPaddingRight: '', scrollbarGutter: '', compensation: '' };
    store.__webjsScrollLock = state;
  }
  return state;
}

export function lockScroll(): void {
  const state = scrollLockState();
  if (state.count === 0) {
    const root = document.documentElement;
    const body = document.body;
    const rootStyle = getComputedStyle(root);

    state.overflow = body.style.overflow;
    state.rootPaddingRight = root.style.paddingRight;
    state.scrollbarGutter = root.style.scrollbarGutter;
    state.compensation = root.style.getPropertyValue(SCROLLBAR_COMPENSATION);

    // <html> is an in-flow block filling the initial containing block, so its
    // border box IS the viewport width, and it is re-laid-out synchronously.
    // A `position: fixed` probe is NOT a substitute: WebKit keeps reporting its
    // old box until the next rendering update, so it reads a zero delta and the
    // compensation below never fires.
    const widthBefore = root.getBoundingClientRect().width;
    const padBefore = parseFloat(rootStyle.paddingRight) || 0;
    // An engine with no `scrollbar-gutter` at all reads back undefined, which
    // must be treated as "the page has not chosen" so the gutter is still
    // attempted (setting an unsupported property is a harmless no-op, and the
    // measured residual below is what actually decides the fallback).
    const chosenGutter = rootStyle.scrollbarGutter || 'auto';

    // Reserve the gutter, but only when the page has not already made its own
    // choice. A page running `stable both-edges` keeps both gutters through the
    // lock, and overwriting that with the single-edge value would drop one and
    // introduce the very shift this exists to prevent.
    if (chosenGutter === 'auto' && window.innerWidth > root.clientWidth) {
      root.style.scrollbarGutter = 'stable';
    }
    body.style.overflow = 'hidden';

    const grew = root.getBoundingClientRect().width - widthBefore;
    if (grew > 0) {
      // Padding the ROOT holds in-flow content still whatever the body's own
      // width is (a `max-width` body does not widen with the viewport, so
      // padding the body would miss it), and it leaves the page's own body
      // padding untouched.
      root.style.paddingRight = `${padBefore + grew}px`;
      // A fixed box lays out against the viewport, so no padding here can reach
      // it. Publish what it moved by and let it opt in.
      root.style.setProperty(SCROLLBAR_COMPENSATION, `${grew}px`);
    }
  }
  state.count++;
}

export function unlockScroll(): void {
  const state = scrollLockState();
  // An unlock with no matching lock is a no-op, NOT the last release: clamping
  // to zero and restoring would replay a stale snapshot onto whatever the page
  // owns now.
  if (state.count === 0) return;
  state.count--;
  if (state.count === 0) {
    const root = document.documentElement;
    document.body.style.overflow = state.overflow;
    root.style.paddingRight = state.rootPaddingRight;
    root.style.scrollbarGutter = state.scrollbarGutter;
    // Restored rather than removed, so a value the PAGE set before any lock
    // survives it.
    if (state.compensation) root.style.setProperty(SCROLLBAR_COMPENSATION, state.compensation);
    else root.style.removeProperty(SCROLLBAR_COMPENSATION);
  }
}
