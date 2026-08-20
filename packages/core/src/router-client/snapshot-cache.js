/**
 * Client router: snapshot-cache.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { SNAPSHOT_CAP } from './constants.js';

/** @typedef {{ html: string, scrollX: number, scrollY: number, scrollHeight: number }} Snapshot */
/** @type {Map<string, Snapshot | string>} */
export const snapshotCache = new Map();

/**
 * Cache the current document's HTML + window scroll position keyed by
 * URL. Used on back/forward navigation: the cached DOM restores
 * instantly, scroll position restores to whatever the user left it at.
 *
 * Turbo Drive captures `window.pageXOffset/pageYOffset` on every scroll
 * event into history state. Webjs captures lazily at snapshot time -
 * one read per nav rather than one per scroll event. Sufficient because
 * we only need the position at the moment of leaving.
 *
 * @param {string} url
 */
export function snapshotCurrent(url) {
  const key = cacheKey(url);
  // Let components and app code strip transient state (open overlays, toasts,
  // in-progress wizard steps) from the page BEFORE it is serialized into the
  // back/forward cache, so a later popstate restore shows a clean page rather
  // than, say, a hover-card frozen open (#766, Turbo's `before-cache` contract).
  // Fires SYNCHRONOUSLY on the live DOM right before the outerHTML read, so a
  // handler's mutations are captured; the live edits are invisible because the
  // page is being navigated away from.
  document.dispatchEvent(new CustomEvent('webjs:before-cache', { detail: { url } }));
  // Move-to-front for LRU.
  if (snapshotCache.has(key)) snapshotCache.delete(key);
  /** @type {Snapshot} */
  const snap = {
    html: document.documentElement.outerHTML,
    scrollX: typeof window !== 'undefined' ? window.scrollX || 0 : 0,
    scrollY: typeof window !== 'undefined' ? window.scrollY || 0 : 0,
    // The page's SETTLED height, captured at the same moment as the offset.
    // A restore re-inserts this snapshot as raw markup, and the document is
    // SHORTER than this until its components upgrade and re-render, which is
    // the window every scroll defect in #1310 lived in. The restore reserves
    // this height across that window (#1428 architecture), so the recorded
    // offset is reachable from the first frame and the browser's own
    // restoration lands exactly, with no clamp and nothing to chase.
    scrollHeight: typeof document !== 'undefined' && document.documentElement
      ? document.documentElement.scrollHeight || 0 : 0,
  };
  snapshotCache.set(key, snap);
  while (snapshotCache.size > SNAPSHOT_CAP) {
    const oldest = snapshotCache.keys().next().value;
    snapshotCache.delete(oldest);
  }
}

/**
 * Look up a cached snapshot by URL. Returns a normalized Snapshot or
 * null. Tolerates legacy string entries (e.g. from test fixtures that
 * `_snapshotCache.set('/x', 'snap')`).
 *
 * @param {string} url
 * @returns {Snapshot | null}
 */
export function snapshotGet(url) {
  const key = cacheKey(url);
  const v = snapshotCache.get(key);
  if (v == null) return null;
  // Move-to-front.
  snapshotCache.delete(key);
  snapshotCache.set(key, v);
  if (typeof v === 'string') return { html: v, scrollX: 0, scrollY: 0 };
  return v;
}

/**
 * The cache key for a URL, optionally in a `<webjs-frame>` dimension (#1407).
 *
 * A frame response is SLICED by the `x-webjs-frame` request header and the
 * server marks it `Vary: X-Webjs-Frame`, so a client-side cache of that
 * response has to carry the same dimension or a frame subtree and a page
 * fragment for one URL alias onto each other.
 *
 * The delimiter is a single SPACE, which cannot occur in either half: the URL
 * parser percent-encodes U+0020 in both the path and the query, and an HTML
 * `id` may not contain ASCII whitespace. So a framed key always holds a space
 * and an unframed one never does, and even a non-conforming id set through the
 * DOM stays unambiguous, because the space-free URL half means the LAST space
 * separates the two.
 *
 * @param {string} url
 * @param {string | null} [frameId]
 */
export function cacheKey(url, frameId) {
  const u = new URL(url, location.href);
  const path = u.pathname + u.search;
  return frameId ? `${frameId} ${path}` : path;
}

/* ====================================================================
 * Navigation
 * ==================================================================== */
