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
 * boundary comment ranges), and a mere link PREFETCH of a throwing page raises
 * an overlay on the page the user is actually looking at, in every open tab.
 *
 * The gate cannot be a plain refuse-and-drop, because the SSE frame is pushed
 * DURING the render, before the navigation response is even sent, so it reaches
 * the browser while `location` is still the old page. So there are two slots: a
 * RENDERED frame and a PENDING one the gate refused. A refused frame is held,
 * and the nav sync re-evaluates it once the URL advances. It is consumed by the
 * first navigation after it arrives (it matches, so it renders, or it does not,
 * so it is dropped), which bounds retention without a timer.
 */

/** The single live overlay element, or null. */
let __wjOverlay = null;
/** The frame the live overlay was built from, or null. */
let __wjFrame = null;
/** The most recent frame the scope gate refused, awaiting a URL that matches. */
let __wjPending = null;

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
  if (__wjScoped(f) && !__wjSamePath(f.url, here)) { __wjPending = f; return; }
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
  // A live overlay whose page we have navigated away from comes down. An
  // unscoped overlay (rebuild / ts-strip) is untouched: it describes the build,
  // not one URL, and only the next successful rebuild clears it.
  if (__wjScoped(__wjFrame) && !__wjSamePath(__wjFrame.url, here)) __wjRemoveOverlay();
  // The pending frame is consumed by this navigation either way: it renders if
  // this is the page it belongs to, and is dropped if it is not.
  const p = __wjPending;
  __wjPending = null;
  if (p && __wjSamePath(p.url, here)) renderDevOverlay(p, here);
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
 * - `webjs:before-cache` on `document`, the router's own contract for stripping
 *   transient UI before it serializes the page into that snapshot cache. Without
 *   it the overlay is baked into the cached HTML and restored later as a dead
 *   card whose Dismiss button has no listener. The frame moves to the pending
 *   slot, so the `webjs:navigate` that follows puts it straight back if the URL
 *   did not actually change.
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
    if (__wjFrame) __wjPending = __wjFrame;
    __wjRemoveOverlay();
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
