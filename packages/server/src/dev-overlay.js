/**
 * The dev error overlay renderer (#264), the BROWSER half of the dev error
 * overlay. It is a browser-safe ES module (no node imports) so it can be both
 * unit-tested in a real browser AND inlined verbatim into the served dev
 * reload client (`reloadClientJs` reads this file's source, strips the `export`
 * keywords, and embeds it). Sharing the one source means the test drives the
 * exact code that ships, with no drift.
 *
 * Security: the overlay is built with `createElement` + `textContent` only,
 * NEVER `innerHTML`, so a hostile error message / file path / code frame is
 * rendered as inert text and can never inject markup or script.
 *
 * Scope (#1047): a `render` frame is stamped server-side with the URL that
 * produced it, and this module is the single gate deciding whether a frame
 * belongs on the page currently being viewed. Without it, a body-level overlay
 * outlives every client-router swap (which works strictly inside the keyed
 * boundary comment ranges), and any render of a page this tab is NOT looking at
 * raises an overlay over the one it is, in every open tab, since the frame fans
 * out over the shared SSE channel. (The other half of #1047, a link prefetch
 * reporting a frame at all, is cut server-side in `dev.js`, not here.)
 *
 * The gate cannot be a plain refuse-and-drop, because the SSE frame is pushed
 * DURING the render, before the navigation response is even sent, so it reaches
 * the browser while `location` is still the old page. So there are two slots: a
 * RENDERED frame and a PENDING one the gate refused. A refused frame is held,
 * and the nav sync re-evaluates it once the URL advances.
 *
 * A held frame is only ever rendered for the navigation it actually belongs to,
 * which is what `__wjNavSeq` is for. A frame that arrives while a navigation is
 * IN FLIGHT is that navigation's; one that arrived while the tab sat idle is
 * not, and must never paint on a later visit to that url, because by then the
 * page may well render fine. An idle-time frame comes from a render this tab
 * did not navigate for: another tab's page, or a background fetch of some other
 * url. NOT from a link prefetch, which reports no frame at all. Both look
 * identical once held, so the seq records which navigation was in flight when
 * the frame landed, and the sync renders it only if that is still the one
 * finishing. `webjs:before-cache` is the nav-START signal (the router snapshots
 * the page it is leaving before it fetches); a navigation that does not emit one
 * leaves the seq unchanged, which fails toward SHOWING the frame, the same way
 * the rest of the gate fails open.
 */

/** The single live overlay element, or null. */
let __wjOverlay = null;
/** The frame the live overlay was built from, or null. */
let __wjFrame = null;
/** The most recent frame the scope gate refused, awaiting a URL that matches. */
let __wjPending = null;
/** The navigation that was in flight when `__wjPending` arrived. */
let __wjPendingSeq = -1;
/** Bumped at the start of each client-router navigation. */
let __wjNavSeq = 0;

/** The path the gate compares a frame's url against. */
function __wjCurrentPath() {
  return typeof location !== 'undefined' ? location.pathname + location.search : '';
}

/**
 * Compare a frame url against a browser path. Encoding-tolerant on purpose: a
 * mismatch fails CLOSED (no overlay), so a percent-encoding difference on a
 * dynamic segment would otherwise hide a genuine error.
 */
function __wjSamePath(a, b) {
  if (a === b) return true;
  try { return decodeURI(a) === decodeURI(b); } catch (_) { return false; }
}

/** True when `f` is a frame the scope gate applies to (a url-stamped render). */
function __wjScoped(f) {
  return !!f && f.kind === 'render' && typeof f.url === 'string' && f.url !== '';
}

/** Take the overlay off the page. Leaves the pending slot alone. */
function __wjRemoveOverlay() {
  if (__wjOverlay) { __wjOverlay.remove(); __wjOverlay = null; }
  __wjFrame = null;
}

/**
 * Remove the overlay if one is showing, and forget any pending frame. This is
 * what the Dismiss button calls, so a frame the user dismissed by hand is never
 * resurrected by a later navigation.
 */
export function dismissDevOverlay() {
  __wjRemoveOverlay();
  __wjPending = null;
  __wjPendingSeq = -1;
}

/** Append a styled text row to `parent`. */
function __wjRow(parent, css, text) {
  const d = document.createElement('div');
  d.style.cssText = css;
  d.textContent = text;
  parent.appendChild(d);
  return d;
}

/**
 * Render the dev error overlay for a frame, replacing any prior one.
 *
 * A url-stamped `render` frame for a DIFFERENT path than `currentPath` is not
 * rendered; it is held in the pending slot for `syncDevOverlayToLocation` to
 * re-evaluate once the URL advances (#1047). The gate runs BEFORE any removal,
 * so a refused frame never wipes what is on screen (a live `rebuild` /
 * `ts-strip` overlay describes a still-broken build and must survive it) and
 * never paints even briefly. A frame with no `url`, or any other kind, renders
 * exactly as it always did.
 *
 * @param {{ kind?: string, message?: string, file?: string|null, line?: number|null, column?: number|null, codeFrame?: string|null, hint?: string|null, url?: string|null }} f
 * @param {string} [currentPath] defaults to `location.pathname + location.search`
 */
export function renderDevOverlay(f, currentPath) {
  if (!f) { dismissDevOverlay(); return; }
  const here = currentPath === undefined ? __wjCurrentPath() : currentPath;
  if (__wjScoped(f) && !__wjSamePath(f.url, here)) {
    __wjPending = f;
    __wjPendingSeq = __wjNavSeq;
    return;
  }
  __wjRemoveOverlay();
  const o = document.createElement('div');
  o.setAttribute('data-webjs-error-overlay', '');
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(10,10,12,.92);color:#e6e6e6;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;padding:32px;overflow:auto';
  const card = document.createElement('div');
  card.style.cssText = 'max-width:920px;margin:0 auto;background:#1a1a1f;border:1px solid #5b2330;border-radius:8px;padding:24px';
  const kind = f.kind === 'ts-strip' ? 'TypeScript error (hydration is dead until fixed)' : f.kind === 'rebuild' ? 'Rebuild failed' : 'Server render error';
  __wjRow(card, 'color:#ff6b6b;font-weight:700;font-size:15px;margin-bottom:8px', kind);
  __wjRow(card, 'white-space:pre-wrap;margin-bottom:12px', f.message || '');
  if (f.file) __wjRow(card, 'color:#9aa3ad;margin-bottom:12px', f.file + (f.line ? ':' + f.line + (f.column ? ':' + f.column : '') : ''));
  if (f.codeFrame) {
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:#0d0d10;border-radius:6px;padding:12px;overflow:auto;margin:0 0 12px;white-space:pre';
    pre.textContent = f.codeFrame;
    card.appendChild(pre);
  }
  if (f.hint) __wjRow(card, 'color:#ffd479;border-top:1px solid #333;padding-top:12px;white-space:pre-wrap', f.hint);
  if (f.stack) {
    const det = document.createElement('details');
    det.style.cssText = 'margin-top:12px;color:#9aa3ad';
    const sum = document.createElement('summary');
    sum.textContent = 'Stack trace';
    sum.style.cssText = 'cursor:pointer';
    det.appendChild(sum);
    const pre = document.createElement('pre');
    pre.style.cssText = 'background:#0d0d10;border-radius:6px;padding:12px;overflow:auto;margin:8px 0 0;white-space:pre;font-size:12px';
    pre.textContent = f.stack;
    det.appendChild(pre);
    card.appendChild(det);
  }
  const btn = document.createElement('button');
  btn.textContent = 'Dismiss';
  btn.style.cssText = 'margin-top:16px;background:#333;color:#eee;border:0;border-radius:4px;padding:6px 12px;cursor:pointer';
  btn.addEventListener('click', dismissDevOverlay);
  card.appendChild(btn);
  o.appendChild(card);
  (document.body || document.documentElement).appendChild(o);
  __wjOverlay = o;
  __wjFrame = f;
}

/**
 * Re-evaluate the scope gate against the page now being viewed (#1047). Called
 * on every client-router navigation, so an overlay the navigation just made
 * stale comes down, and a frame that arrived before the URL advanced (the usual
 * ordering, since the SSE frame is pushed during the render that produces the
 * navigation response) goes up.
 *
 * @param {string} [currentPath] defaults to `location.pathname + location.search`
 */
export function syncDevOverlayToLocation(currentPath) {
  const here = currentPath === undefined ? __wjCurrentPath() : currentPath;
  // The BACKSTOP for an overlay element this module does not own. Any such node
  // is unremovable and its Dismiss button carries no listener, so it would sit
  // there forever: a `document.body.replaceChildren` from cached HTML is the way
  // that happens. The router's OWN back/forward snapshot is already handled
  // upstream, since `before-cache` detaches the overlay across its `outerHTML`
  // read, so what is left here is everything else (a snapshot cached before this
  // client installed its listeners, or any other wholesale body replacement).
  // Also notice when the node we did own was replaced out from under us: it is
  // detached, so `.remove()` would no-op and the slot would lie about what is
  // on screen.
  if (typeof document !== 'undefined') {
    const live = __wjOverlay && __wjOverlay.isConnected ? __wjOverlay : null;
    __wjOverlay = live;
    document.querySelectorAll('[data-webjs-error-overlay]').forEach((el) => {
      if (el !== live) el.remove();
    });
  }
  // A live overlay whose page we have navigated away from comes down. An
  // unscoped overlay (rebuild / ts-strip) is untouched: it describes the build,
  // not one URL, and only the next successful rebuild clears it.
  if (__wjScoped(__wjFrame) && !__wjSamePath(__wjFrame.url, here)) __wjRemoveOverlay();
  // Still the right frame for this page, but its node was swept away by the
  // restore above: put a REAL one back, with a working Dismiss button.
  if (__wjFrame && !__wjOverlay) renderDevOverlay(__wjFrame, here);
  // The pending frame is consumed by this navigation either way. It renders
  // only if this is BOTH the page it names and the navigation it belongs to;
  // a frame held from an idle-time render (another tab's page, a background
  // fetch of some other url) is dropped, because by the time you actually
  // visit that url the page may render perfectly well, and an overlay over it
  // would be the very bug this whole gate exists to stop.
  const p = __wjPending;
  const seq = __wjPendingSeq;
  __wjPending = null;
  __wjPendingSeq = -1;
  if (p && seq === __wjNavSeq && __wjSamePath(p.url, here)) renderDevOverlay(p, here);
}

/**
 * Mark the start of a client-router navigation (#1047), so a frame arriving
 * from here on is known to belong to it. Exported for the browser test; the
 * shipping wiring is `installDevOverlayNavSync`.
 */
export function markDevOverlayNavStart() {
  __wjNavSeq++;
}

/**
 * Wire the scope gate to the client router's navigation events (#1047), so the
 * overlay tracks the page actually on screen. Browser-safe and dev-only: the
 * reload client that calls this is served only in dev.
 *
 * Three events, each for a distinct reason:
 * - `webjs:navigate` on `document`, the applied-navigation signal, dispatched
 *   after `history.pushState` so `location` is already current.
 * - `popstate` on `window`, because a back/forward restore served from the
 *   router's snapshot cache returns before it dispatches `webjs:navigate`.
 * - `webjs:before-cache` on `document`, which does two things. It is the
 *   nav-START marker (the router dispatches it from `snapshotCurrent`, at the
 *   top of every navigation and form submission, before the fetch), the only
 *   signal separating a frame belonging to the navigation in flight from one
 *   held since the tab was idle. And it detaches the overlay across the
 *   snapshot read, re-attaching it a microtask later, so the cached HTML
 *   carries no copy. What it must NOT do is strip the overlay for good, which
 *   the event's own contract invites: it fires on EVERY navigation, so that
 *   would tear a `rebuild` / `ts-strip` overlay off the page the moment you
 *   clicked any link, while the build was still broken.
 *
 * @param {{ document?: any, window?: any, getPath?: () => string }} [opts] injection seam for the browser test
 * @returns {() => void} an uninstall thunk
 */
export function installDevOverlayNavSync(opts) {
  const o = opts || {};
  const doc = o.document || (typeof document !== 'undefined' ? document : null);
  const win = o.window || (typeof window !== 'undefined' ? window : null);
  const getPath = o.getPath || __wjCurrentPath;
  const onNav = () => syncDevOverlayToLocation(getPath());
  const onBeforeCache = () => {
    markDevOverlayNavStart();
    // Keep the overlay out of the snapshot the router is about to take. It
    // reads `outerHTML` SYNCHRONOUSLY right after this event, so detaching here
    // and re-attaching in a microtask (which runs once that read has returned,
    // and long before any paint) means the cached HTML never carries a copy,
    // while the overlay on screen never flickers.
    //
    // This is not the strip that used to live here. That one dropped the frame
    // permanently, so any link click tore down a `rebuild` / `ts-strip`
    // overlay while the build was still broken; this puts the SAME node back.
    // The sweep in `syncDevOverlayToLocation` stays as the backstop, because
    // it cannot cover every ordering on its own: under an opt-in view
    // transition the router defers the body swap past the sync, so a copy
    // parsed in afterwards would otherwise sit there undismissable.
    const el = __wjOverlay;
    if (!el || !el.isConnected) return;
    const parent = el.parentNode;
    el.remove();
    queueMicrotask(() => {
      // Only if it is still the live overlay: a frame arriving meanwhile may
      // have replaced it, or the user may have dismissed it.
      if (__wjOverlay === el && !el.isConnected && parent) parent.appendChild(el);
    });
  };
  if (doc) {
    doc.addEventListener('webjs:navigate', onNav);
    doc.addEventListener('webjs:before-cache', onBeforeCache);
  }
  if (win) win.addEventListener('popstate', onNav);
  return () => {
    if (doc) {
      doc.removeEventListener('webjs:navigate', onNav);
      doc.removeEventListener('webjs:before-cache', onBeforeCache);
    }
    if (win) win.removeEventListener('popstate', onNav);
  };
}
