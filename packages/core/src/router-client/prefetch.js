/**
 * Client router: prefetch.
 *
 * Moved verbatim out of the pre-split `router-client.js`; that barrel holds
 * the router's full contract and the public entry points.
 *
 * @module
 */
import { closestAnchor } from './anchors.js';
import { buildHaveHeader } from './boundaries.js';
import { NON_HTML_EXTENSIONS } from './constants.js';
import { liveFrameElement, resolveTargetFrameId } from './frames.js';
import { enabled } from './state.js';

import { cacheKey, snapshotCache } from './snapshot-cache.js';

/** Max speculative responses held at once (LRU). */
const PREFETCH_CAP = 8;

/** Speculative entries expire after this long (ms): avoid serving stale. */
const PREFETCH_TTL = 30_000;

/** Max concurrent in-flight prefetch requests. */
const PREFETCH_CONCURRENCY = 3;

/** Max prefetches waiting for a free slot (bounds a huge link list). */
const PREFETCH_QUEUE_CAP = 24;

/** Hover dwell before a prefetch fires (ms): filter drive-by pointer moves. Matches Remix's intent timeout. */
const PREFETCH_HOVER_DELAY = 100;

/**
 * Viewport dwell before a prefetch fires (ms): a link must SETTLE on-screen,
 * not merely flash past during a scroll. A fast scroll-through clears the
 * timer on exit, so flicked-past links never fetch. Astro uses 300ms for the
 * same purpose; we sit a touch lower so a deliberate stop still feels instant.
 */
const PREFETCH_VIEWPORT_DELAY = 250;

/** @typedef {{ html: string, build: string | null, src: string | null, finalUrl: string, frameId: string | null, at: number }} PrefetchEntry */
/** @type {Map<string, PrefetchEntry>} */
export const prefetchCache = new Map();

/**
 * Keys whose last speculative answer was REFUSED, with the time it was refused
 * (#1407). Only a framed request can be refused: the server marks its sliced
 * subtree, so an unmarked answer is one of the two full-document fall-throughs
 * (a streamed render, or an id absent from the output) and is not the shape the
 * entry claims.
 *
 * This exists so a refusal is not the same as forgetting. With no record, the
 * TTL dedupe would have nothing to match and `prefetchInflight` is released the
 * moment the fetch settles, so every later hover or dwell on that link would
 * re-issue the same useless request for as long as the page lives. A route with
 * a `loading.{js,ts}` or a Suspense boundary streams, so it answers EVERY framed
 * request unmarked, which would make that the normal case there and strictly
 * worse than before this feature (an unframed prefetch was at least cached and
 * deduped for the TTL).
 *
 * It is deliberately NOT an entry in `prefetchCache`. That cache holds fragments
 * a click can consume, it is capped at `PREFETCH_CAP`, and an entry leaves it as
 * soon as a click takes it. A memo holds no fragment and can never serve a
 * click, so filing one there would let a streaming route's framed links occupy
 * slots that genuinely warm fragments are competing for, and hold them longer
 * than any real entry, since nothing consumes a memo. Its own cap bounds it
 * instead.
 *
 * @type {Map<string, number>}
 */
const prefetchRefused = new Map();

/** Max refusal memos held at once (LRU), independent of the fragment cache. */
const PREFETCH_REFUSED_CAP = 16;

/**
 * Whether this key's last answer was refused recently enough that re-asking
 * would just be refused again. Prunes on read, so an expired memo never
 * suppresses a legitimate retry.
 *
 * @param {string} key
 */
function prefetchRefusedRecently(key) {
  const at = prefetchRefused.get(key);
  if (at == null) return false;
  if ((nowMs() - at) >= PREFETCH_TTL) { prefetchRefused.delete(key); return false; }
  return true;
}

/**
 * Forget every refusal (#1407). Called from the two places where the SOURCE may
 * have changed under us: wherever a DEPLOY is detected, and `refreshPage`, the
 * dev live-reload path, where a `page` or `shell` edit can add or remove a
 * `Suspense` / `<webjs-suspense>` boundary and so start or stop the route
 * streaming. (A `loading.{js,ts}` edit is NOT one of them: that file is a
 * browser entry, so it classifies `ships-to-browser` and takes a full reload.)
 *
 * NEITHER form of `revalidate` clears them, which is a cost/benefit call rather
 * than an impossibility. It is the post-MUTATION api an app calls after an RPC
 * write, so clearing there would drop every memo on every mutation and reopen
 * the request-per-hover loop this exists to close. A mutation CAN change a given
 * render's streamed shape, since a page may render `Suspense` conditionally on
 * fetched data, but the cost of a memo that outlives that is bounded to one
 * skipped warm-up for that key until the 30s TTL runs out, which is the cheaper
 * side of the trade.
 */
export function clearPrefetchRefused() {
  prefetchRefused.clear();
}

/** @param {string} key */
function notePrefetchRefused(key) {
  if (prefetchRefused.has(key)) prefetchRefused.delete(key);
  prefetchRefused.set(key, nowMs());
  while (prefetchRefused.size > PREFETCH_REFUSED_CAP) {
    prefetchRefused.delete(prefetchRefused.keys().next().value);
  }
}

/** Keys with a fetch currently in flight (dedupe + concurrency gate). */
const prefetchInflight = new Set();

/** hrefs waiting for a free concurrency slot (FIFO), and their keys. */
const prefetchQueue = [];

const prefetchQueued = new Set();

/** Pending hover-dwell timer, cleared on pointerout / blur. */
let prefetchHoverTimer = null;

/** Last anchor a hover timer was armed for (so pointerout can match). */
let prefetchHoverAnchor = null;

/** IntersectionObserver for data-prefetch="viewport" anchors, or null. */
export let prefetchViewObserver = null;

/** Per-anchor viewport-dwell timers, so a scroll-out can cancel before firing. */
let prefetchViewTimers = new WeakMap();

/** Live viewport-dwell timer ids, for bulk teardown on disable. */
const prefetchViewPending = new Set();

/**
 * True when the user or platform has asked us to conserve data, OR the
 * connection is too slow to spend bytes speculatively. The Save-Data client
 * hint, the prefers-reduced-data media query, and a 2g `effectiveType` all
 * disable speculative fetching, the same gate Astro / Nuxt apply. Guarded for
 * non-browser / partial DOM.
 *
 * @returns {boolean}
 */
export function prefetchSaysSaveData() {
  try {
    const c = typeof navigator !== 'undefined' ? /** @type any */ (navigator).connection : null;
    if (c) {
      if (c.saveData === true) return true;
      // effectiveType is 'slow-2g' | '2g' | '3g' | '4g'; skip the 2g tiers.
      if (typeof c.effectiveType === 'string' && /2g$/.test(c.effectiveType)) return true;
    }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-data: reduce)').matches) {
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Whether the device drives a hover-capable fine pointer (a mouse or
 * trackpad), as opposed to touch. This picks the ADAPTIVE prefetch default:
 * `intent` (hover / focus) on a pointer device, `viewport` on touch, since a
 * touch device has no hover and `touchstart` fires too close to the tap to
 * front-run it. Detected with `matchMedia('(hover: hover) and (pointer: fine)')`
 * rather than a user-agent sniff. When `matchMedia` is unavailable we assume a
 * pointer (the historical default), so a non-browser / partial-DOM environment
 * keeps the `intent` behaviour and never silently switches to viewport.
 *
 * @returns {boolean}
 */
export function prefetchHasHoverPointer() {
  try {
    if (typeof matchMedia === 'function') {
      return matchMedia('(hover: hover) and (pointer: fine)').matches;
    }
  } catch { /* ignore */ }
  return true;
}

/**
 * Lowercased whitespace-separated rel tokens of an anchor.
 * @param {Element} anchor
 * @returns {string[]}
 */
function relTokens(anchor) {
  const rel = anchor.getAttribute('rel');
  return rel ? rel.toLowerCase().split(/\s+/).filter(Boolean) : [];
}

/**
 * Decide whether an anchor is a same-origin in-app target the router can
 * navigate, returning its absolute href or null. Shared by onClick and
 * the prefetch listeners so eligibility never drifts between them.
 *
 * @param {Element | null} anchor
 * @returns {string | null}
 */
export function eligibleAnchorHref(anchor) {
  if (!anchor || !(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute('download')) return null;
  if (anchor.hasAttribute('data-no-router')) return null;
  if (anchor.target && anchor.target !== '_self') return null;
  const href = anchor.href;
  if (!href) return null;
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== location.origin) return null;
  // A pure same-page hash jump is not a navigation we fetch.
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
  if (NON_HTML_EXTENSIONS.test(url.pathname)) return null;
  return href;
}

/**
 * Whether prefetching this anchor is suppressed by author intent. The
 * `external` rel marks a link leaving the app, `no-prefetch` and
 * `data-no-prefetch` are explicit opt-outs, and `data-no-router` already
 * disables routing entirely (so it is caught upstream too).
 *
 * @param {Element} anchor
 * @returns {boolean}
 */
export function prefetchSuppressed(anchor) {
  if (anchor.hasAttribute('data-no-prefetch')) return true;
  const rel = relTokens(anchor);
  return rel.includes('external') || rel.includes('no-prefetch');
}

/**
 * Resolve the prefetch strategy for an anchor from a `data-prefetch`
 * attribute. WebJs has no Link component (links are plain `<a href>`), so
 * the knob is a valid-HTML `data-*` attribute, the same shape SvelteKit
 * (`data-sveltekit-preload-data`) and Astro (`data-astro-prefetch`) use.
 * Next.js / Nuxt / Remix express the same choice as a component PROP
 * (`<Link prefetch>`) that never reaches the DOM, so there is nothing to
 * mirror attribute-wise; we reuse their value vocabulary (true/false/auto)
 * as aliases. Default is `intent` (fast-by-default) when the attribute is
 * absent or unrecognised.
 *
 * Value mapping (case-insensitive):
 *   - absent / unknown   : the DEVICE-ADAPTIVE default (intent on a pointer,
 *                          viewport on touch); an explicit value always wins
 *   - `intent`           : hover / focus / touch, after a short dwell
 *   - `true` / `render`  : eager, as soon as a document scan sees the link
 *   - `auto` / `viewport`: on viewport entry (IntersectionObserver), after a dwell
 *   - `false` / `none`   : never (also via data-no-prefetch / rel="external")
 *
 * The default is adaptive (not a single `intent`) because `intent` does not
 * help on mobile: a touch device has no hover, and `touchstart` fires at tap
 * time, so the prefetch races the navigation. On touch we default to
 * `viewport` (warm links as they settle on-screen) and keep `touchstart` as an
 * extra warm for the tapped link; on a pointer device `intent` stays the
 * default (precise, cheap, a real head-start before the click). A per-link
 * `data-prefetch` always overrides the adaptive default.
 *
 * Returns `none` for suppressed anchors so callers have a single check.
 *
 * @param {Element} anchor
 * @returns {'intent' | 'render' | 'viewport' | 'none'}
 */
export function prefetchMode(anchor) {
  if (prefetchSuppressed(anchor)) return 'none';
  const raw = (anchor.getAttribute('data-prefetch') || '').toLowerCase().trim();
  switch (raw) {
    case 'false':
    case 'none':
      return 'none';
    case 'true':
    case 'render':
      return 'render';
    case 'auto':
    case 'viewport':
      return 'viewport';
    case 'intent':
      return 'intent';
    default:
      // Unset or unrecognised value: the device-adaptive default.
      return prefetchHasHoverPointer() ? 'intent' : 'viewport';
  }
}

/**
 * Speculatively fetch `href` and stash the server fragment so a later
 * click resolves instantly. No-op when data-saving is on or the entry is
 * already cached or in flight. When the concurrency gate is full the
 * request is QUEUED (not dropped) and drains as in-flight slots free, so
 * a burst of `render` / `viewport` links all eventually prefetch rather
 * than silently losing everything past the cap.
 *
 * @param {string} href
 * @param {string | null} [frameId]  The `<webjs-frame>` this href drives, from
 *   `resolveTargetFrameId` at the trigger. Sends `x-webjs-frame` so the server
 *   answers with the SAME subtree the click will ask for, and keys the entry in
 *   that dimension so it can only ever be consumed by a matching frame nav.
 */
export function prefetch(href, frameId) {
  // Never speculate once the router is torn down: a leftover hover / queue /
  // dwell timer that fires after disableClientRouter must not issue a fetch.
  if (!enabled) return;
  if (typeof fetch !== 'function') return;
  if (prefetchSaysSaveData()) return;
  const key = cacheKey(href, frameId);
  // Never prefetch the page we are already ON (#1106). The request cannot help
  // any future navigation, because a same-URL click short-circuits, and it
  // occupies one of the capped cache slots until its TTL expires. Fires
  // routinely: a hover's intent timer outlives the click it belongs to, so it
  // resolves after the swap has landed and now points at the current page.
  //
  // It ALSO removes one producer of the #1114 stale entry, though it is not the
  // cure for it (the anchor check in prefetchTake is). Worth being precise,
  // because the first version of this fix had the causality backwards: the
  // server short-circuits on LAYOUT segments only and ignores the page's own
  // boundary entry, so a self-prefetch is not a near-empty response, it is a
  // normal fragment anchored at the innermost LAYOUT. That fragment is
  // perfectly applicable from a sibling page and fails only from outside that
  // layout, which is exactly what the anchor check catches, and which a
  // never-clicked hover on a sibling link produces without this guard.
  //
  // Compared in the SAME dimension (#1407): a framed link to the current url is
  // a frame REFRESH, and a refresh must show fresh bytes, so it stays excluded
  // for the reason `fetchAndApply` refuses to let `refresh` consume a prefetch
  // (#1398). Comparing against the bare page key instead would let it through.
  if (typeof location !== 'undefined' && key === cacheKey(location.href, frameId)) return;
  // Every dedupe below keys on the DIMENSIONED key, which is deliberate and has
  // a cost worth stating (#1407). A page holding two links to one href, one
  // driving a frame and one not, warms both dimensions and so issues two
  // requests where it used to issue one, and both occupy a `PREFETCH_CAP` slot.
  // Suppressing the second is the obvious saving and is wrong: the two are
  // DIFFERENT responses, so whichever link lost would never be warmed AHEAD of
  // the click. On touch that is the worse half, because `viewport` is the
  // default there and the only thing left is the `touchstart` warm below, which
  // fires at tap time and so gives a far smaller head start than a dwell would.
  // The duplicate is bounded by the same cap, concurrency gate, TTL, and
  // Save-Data gate as everything else, which is what those are for, and it adds
  // no new TRIGGER and no per-link fan-out.
  if (prefetchInflight.has(key)) return;
  if (prefetchQueued.has(key)) return;
  const existing = prefetchCache.get(key);
  if (existing && (nowMs() - existing.at) < PREFETCH_TTL) return;
  // Refused recently, so re-asking would be refused again (#1407). Bounds the
  // retry to one request per TTL, the same bound a successful entry gets.
  if (prefetchRefusedRecently(key)) return;
  if (prefetchInflight.size >= PREFETCH_CONCURRENCY) {
    // Gate full: queue rather than drop, bounded so a huge link list
    // cannot grow the queue without limit (oldest queued entry is shed).
    prefetchQueued.add(key);
    prefetchQueue.push({ href, frameId: frameId || null });
    while (prefetchQueue.length > PREFETCH_QUEUE_CAP) {
      const dropped = prefetchQueue.shift();
      prefetchQueued.delete(cacheKey(dropped.href, dropped.frameId));
    }
    return;
  }

  const have = buildHaveHeader();
  // #936: while the document is still parsing, the closing `<!--/wj:children-->`
  // marker at the bottom of the body may not exist yet, so `buildHaveHeader()`
  // returns '' meaning "markers not parsed yet", NOT "this page has no layout".
  // A touch-device viewport prefetch fires early enough (mid-parse) to hit this
  // window on real Android Chrome. Caching that empty-`have` response (a full
  // page) would later drive the destructive full-body swap fallback. Skip the
  // speculative fetch; the click path re-fetches with a correct `have` once the
  // document has parsed (and applySwap now falls back to a full load anyway).
  if (!have && typeof document !== 'undefined' && document.readyState === 'loading') return;

  prefetchInflight.add(key);
  const headers = { 'x-webjs-router': '1', 'x-webjs-prefetch': '1' };
  if (have) headers['x-webjs-have'] = have;
  // Ask for exactly what the click will ask for (`fetch-apply.js` adds the same
  // header on a frame nav), so the cached body is the frame subtree, not the
  // page fragment the swap would refuse to apply.
  if (frameId) headers['x-webjs-frame'] = frameId;

  // `no-cache` (revalidate, NOT bypass) is load-bearing (#1131): the deploy
  // check below reads x-webjs-build / x-webjs-src off this response, and a
  // page served with a browser max-age would otherwise satisfy the fetch
  // wholly from the HTTP cache, replaying pre-deploy ids. The check would then
  // compare two equally stale values and skip the eviction, so a deploy stayed
  // invisible for the whole freshness window plus one stale-while-revalidate
  // serving per URL. With stable page ETags a forced revalidation is a
  // conditional request answered 304, so the cost is a header round-trip, not
  // a re-download.
  fetch(href, { method: 'GET', headers, credentials: 'same-origin', cache: 'no-cache' })
    .then(async (resp) => {
      const ctype = resp.headers.get('content-type') || '';
      if (!/^text\/html\b/i.test(ctype)) return;
      if (resp.status >= 400) return;
      const build = resp.headers.get('x-webjs-build');
      const src = resp.headers.get('x-webjs-src');
      // Deploy detected at PREFETCH time (#899). A prefetch fetch carries the
      // server's current build id AND app-source id. If EITHER differs from what
      // the page booted with, a deploy landed, so every earlier snapshot/prefetch
      // is pre-deploy and stale. Evict them here, well before the click (a
      // hover/viewport prefetch fires early), so a click on a previously-
      // prefetched link re-fetches fresh (then applySwap hard-reloads on a build
      // change or soft-applies on a src-only change). This shrinks the window
      // where a pre-deploy prefetch, whose stored ids equal the still-old page
      // ids so applySwap alone cannot tell it is stale, is served. Both ids of a
      // pair must be present: an empty id is the warmup "version unknown", never
      // a deploy signal.
      const pageTag = typeof document !== 'undefined' ? document.querySelector('script[type="importmap"]') : null;
      const pageBuild = pageTag ? pageTag.getAttribute('data-webjs-build') : null;
      const pageSrc = pageTag ? pageTag.getAttribute('data-webjs-src') : null;
      if ((build && pageBuild && build !== pageBuild) || (src && pageSrc && src !== pageSrc)) {
        snapshotCache.clear();
        prefetchCache.clear();
        // A new build can change whether a route streams, so a refusal recorded
        // against the old one says nothing about the new one (#1407).
        clearPrefetchRefused();
        // Deliberately do NOT advance the page's data-webjs-src here (only the
        // foreground `applySwap` does). A prefetch is speculative; leaving the
        // reference id on the old deploy keeps applySwap the single authority
        // that settles the page on the first real navigation. The cost is small:
        // repeated prefetches in the pre-first-nav window each re-clear the
        // (already tiny) caches, which converges the instant the user navigates.
      }
      // The server answers a frame-headed request with the SLICED subtree only
      // when the render did not stream AND the id was in the output
      // (`ssr/render.js`); both fall-throughs return a whole document instead.
      // It marks the sliced case with `x-webjs-frame`, so a mismatch here means
      // the body is not the shape this entry claims. Discard it rather than
      // store it: a full document under a frame key would be swapped into the
      // frame region on the click, and it cannot be filed under the page key
      // either, since it was fetched with a header the response varies on.
      //
      // Discarding is not the same as FORGETTING, so the refusal is memoed (see
      // `prefetchRefused`) to stop the request being re-issued on every hover
      // until the TTL runs out. The body is still never stored.
      const servedFrame = resp.headers.get('x-webjs-frame');
      if ((servedFrame || null) !== (frameId || null)) {
        notePrefetchRefused(key);
        return;
      }
      const finalUrl = resp.redirected && resp.url ? resp.url : href;
      const html = await resp.text();
      prefetchStore(key, { html, build, src, finalUrl, frameId: frameId || null, at: nowMs() });
    })
    .catch(() => { /* speculative: swallow */ })
    .finally(() => {
      prefetchInflight.delete(key);
      drainPrefetchQueue();
    });
}

/** Start the next queued prefetch if a concurrency slot is free. */
function drainPrefetchQueue() {
  while (prefetchQueue.length && prefetchInflight.size < PREFETCH_CONCURRENCY) {
    const { href, frameId } = prefetchQueue.shift();
    prefetchQueued.delete(cacheKey(href, frameId));
    prefetch(href, frameId);
  }
}

/**
 * Store a speculative entry under LRU + cap, then announce that the
 * fragment is cached and consumable.
 *
 * The `webjs:prefetch` event fires the instant a speculative fragment
 * becomes consumable (after the response body has been read), which is
 * strictly later than the prefetch request going out. App code can
 * listen to instrument prefetch hit rate, and tests can await it to know
 * a subsequent click will consume the cache rather than refetch. The
 * detail carries the cached URL and a `from: 'prefetch'` tag so a single
 * listener can disambiguate it from `webjs:navigate`.
 *
 * @param {string} key
 * @param {PrefetchEntry} entry
 */
function prefetchStore(key, entry) {
  if (prefetchCache.has(key)) prefetchCache.delete(key);
  prefetchCache.set(key, entry);
  while (prefetchCache.size > PREFETCH_CAP) {
    const oldest = prefetchCache.keys().next().value;
    prefetchCache.delete(oldest);
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent('webjs:prefetch', {
      detail: { url: entry.finalUrl, key, from: 'prefetch' },
    }));
  }
}

/**
 * The `segment:routeKey` a cached fragment is ANCHORED at, or null when it
 * carries no boundary (a full document, or an unparseable body).
 *
 * A reduced response begins at the deepest boundary the server short-circuited
 * on, so its FIRST open-boundary comment is the join point the swap will look
 * for in the live DOM. Verified against the server: `have=/:/` yields a
 * fragment starting at `<!--wj:children:/:/-->` (anchored at the root, so it
 * applies on any page), while `have=/docs:/docs,/:/` yields one starting at
 * `<!--wj:children:/docs:/docs-->` (applies only under /docs).
 *
 * Read with a regex rather than a parse: this runs on the click path, and the
 * full parse happens moments later in `fetchAndApply` anyway. The pattern is
 * anchored on the literal marker the SSR emits, and a miss is treated as
 * "no constraint", so a shape change degrades to the old permissive behaviour
 * rather than silently rejecting every entry.
 *
 * @param {string} html
 * @returns {string | null}
 */
export function prefetchAnchor(html) {
  const m = /<!--wj:children:([^>]*?)-->/.exec(html || '');
  return m ? m[1] : null;
}

/**
 * Consume a fresh speculative entry for `href`, removing it (a fragment
 * is single-use: once applied it becomes a real snapshot). Returns null
 * on miss, when the entry has aged past the TTL, or when the live DOM no
 * longer offers the boundary the fragment is anchored at.
 *
 * @param {string} href
 * @param {string} [liveKeysOverride] the `X-Webjs-Have` view to validate the
 *   anchor against, when the caller holds a truer one than the live DOM does.
 *   Used for the optimistic loading skeleton, which deletes nested boundaries
 *   before the fetch, so reading the DOM here would under-report them.
 * @param {string | null} [frameId]  Consume only an entry fetched in THIS frame
 *   dimension (#1407). A page fragment and a frame subtree for one url are
 *   different responses, so they are different entries.
 * @returns {PrefetchEntry | null}
 */
export function prefetchTake(href, liveKeysOverride, frameId) {
  const key = cacheKey(href, frameId);
  const entry = prefetchCache.get(key);
  if (!entry) return null;
  if ((nowMs() - entry.at) >= PREFETCH_TTL) { prefetchCache.delete(key); return null; }
  // A FRAME entry's validity question is a different one (#1407). Its body is a
  // `<webjs-frame>` subtree with no `wj:children` boundary in it, so
  // `prefetchAnchor` returns null, and null means "no constraint" below: falling
  // through would consume it anywhere. What has to hold instead is that the
  // region it was fetched for is still in the document, which only the live DOM
  // can answer and only at consume time (an outer navigation between the
  // prefetch and the click can remove the frame).
  if (entry.frameId) {
    prefetchCache.delete(key);
    return liveFrameElement(entry.frameId) ? entry : null;
  }
  // The reduced response VARIES on X-Webjs-Have, and this cache is a
  // client-side cache of that response, so it has to respect its own vary
  // dimension (#1114). The dimension is NOT the whole have string though: a
  // fragment is anchored at ONE boundary and applies to any live DOM that still
  // offers that boundary with the same route-key. Checking the whole string
  // instead discards entries that would have applied (prefetch /docs/x from /,
  // soft-nav to /blog, click: the fragment is anchored at the root, which /blog
  // also has), and worse, `applyOptimisticLoading` removes the page's own
  // boundary before the fetch to insert a loading skeleton, so on any route
  // with a `loading.{js,ts}` the live have is legitimately SHORTER at consume
  // time than at prefetch time with no navigation at all.
  //
  // So: consume when the anchor is still live, discard when it is not.
  // Discarding costs one round-trip; consuming a fragment whose anchor is gone
  // hands `applySwap` a tree sharing no boundary with the live DOM, and the
  // #1015 integrity degradation correctly turns that into a full page load,
  // which is the whole-document flash this guard exists to prevent.
  const anchor = prefetchAnchor(entry.html);
  if (anchor) {
    // `buildHaveHeader()` emits exactly comma-joined `segment:routeKey` entries,
    // so it is the single source of truth for the comparison format: membership
    // in it IS "the live DOM offers this boundary with this route-key". It
    // returns '' mid-parse, which rejects an anchored entry, and that is the
    // safe direction (a click during parse takes the full-load path regardless).
    const liveKeys = new Set(
      String(liveKeysOverride != null ? liveKeysOverride : (buildHaveHeader() || ''))
        .split(',').filter(Boolean)
    );
    if (!liveKeys.has(anchor)) {
      prefetchCache.delete(key);
      return null;
    }
  }
  prefetchCache.delete(key);
  return entry;
}

/** Monotonic-ish clock guarded for environments without performance. */
function nowMs() {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch { /* ignore */ }
  return 0;
}

/** @param {Event} e */
export function onPrefetchIntent(e) {
  if (!enabled) return;
  const anchor = closestAnchor(/** @type any */ (e.target));
  if (!anchor) return;
  const mode = prefetchMode(anchor);
  // `none` is suppressed; `render` already prefetched on the document scan.
  if (mode === 'none' || mode === 'render') return;
  const href = eligibleAnchorHref(anchor);
  if (!href) return;
  // touchstart IS the tap: warm the tapped link immediately, for both intent
  // and viewport modes (a single request for a link about to be navigated, the
  // small mobile win the viewport default cannot give for the link just tapped).
  // No dwell, since the tap is the intent.
  if (e.type === 'touchstart') { prefetch(href, resolveTargetFrameId(anchor)); return; }
  // hover / focus only warm `intent` links; `viewport` links are the
  // observer's job (warmed on a dwell, not on a stray hover).
  if (mode !== 'intent') return;
  // pointerover/focusin bubble, so re-entering a child of the same anchor
  // would re-arm; collapse to one timer per anchor.
  if (prefetchHoverAnchor === anchor && prefetchHoverTimer) return;
  clearPrefetchHover();
  prefetchHoverAnchor = anchor;
  prefetchHoverTimer = setTimeout(() => {
    prefetchHoverTimer = null;
    prefetchHoverAnchor = null;
    // Resolved at FIRE time, so it sees the document a click at this moment
    // would (a soft nav during the dwell can change which frame encloses it).
    prefetch(href, resolveTargetFrameId(anchor));
  }, PREFETCH_HOVER_DELAY);
}

/** @param {Event} e */
export function onPrefetchOut(e) {
  const anchor = closestAnchor(/** @type any */ (e.target));
  if (anchor && anchor === prefetchHoverAnchor) clearPrefetchHover();
}

export function clearPrefetchHover() {
  if (prefetchHoverTimer) { clearTimeout(prefetchHoverTimer); prefetchHoverTimer = null; }
  prefetchHoverAnchor = null;
}

/** Cancel every pending viewport-dwell timer and reset the per-anchor map. */
export function clearPrefetchViewTimers() {
  for (const timer of prefetchViewPending) clearTimeout(timer);
  prefetchViewPending.clear();
  prefetchViewTimers = new WeakMap();
}

/**
 * (Re)scan the document and apply the non-hover prefetch modes:
 *   - `render`   anchors prefetch immediately (they are now in the DOM).
 *   - `viewport` anchors are observed and prefetch on intersection.
 * `intent` (the default) is handled by the hover/focus/touch listeners,
 * and `none` is skipped. Called on enable and after each navigation,
 * since the swapped-in DOM may carry new links.
 *
 * The viewport threshold (0.5) matches Remix's IntersectionObserver.
 */
export function refreshPrefetchObservers() {
  if (typeof document === 'undefined') return;
  if (prefetchSaysSaveData()) return;
  const hasIO = typeof IntersectionObserver !== 'undefined';
  if (hasIO) {
    if (!prefetchViewObserver) {
      prefetchViewObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const anchor = /** @type {Element} */ (entry.target);
          if (entry.isIntersecting) {
            // Arm a dwell timer; the link must STAY on-screen to warm. One
            // timer per anchor, so re-entry while pending does not stack.
            if (prefetchViewTimers.has(anchor)) continue;
            const timer = setTimeout(() => {
              prefetchViewPending.delete(timer);
              prefetchViewTimers.delete(anchor);
              prefetchViewObserver.unobserve(anchor);
              const href = eligibleAnchorHref(anchor);
              if (href && prefetchMode(anchor) === 'viewport') prefetch(href, resolveTargetFrameId(anchor));
            }, PREFETCH_VIEWPORT_DELAY);
            prefetchViewTimers.set(anchor, timer);
            prefetchViewPending.add(timer);
          } else {
            // Scrolled out before the dwell elapsed: cancel, so a fast
            // scroll-through never spends a request.
            const timer = prefetchViewTimers.get(anchor);
            if (timer) {
              clearTimeout(timer);
              prefetchViewPending.delete(timer);
              prefetchViewTimers.delete(anchor);
            }
          }
        }
      }, { threshold: 0.5 });
    } else {
      // Re-scan: drop the old observation set AND cancel any pending dwell
      // timers, so a timer armed for an anchor the soft-nav swap removed cannot
      // fire a prefetch for a stale URL (its exit callback never comes once it
      // is gone). Anchors still on-screen re-arm when observe() below redelivers
      // their current intersection state.
      prefetchViewObserver.disconnect();
      clearPrefetchViewTimers();
    }
  }
  for (const anchor of document.querySelectorAll('a[href]')) {
    const mode = prefetchMode(anchor);
    if (mode === 'render') {
      const href = eligibleAnchorHref(anchor);
      if (href) prefetch(href, resolveTargetFrameId(anchor));
    } else if (mode === 'viewport' && hasIO) {
      prefetchViewObserver.observe(anchor);
    }
  }
}

/** Test-only: peek the speculative cache for a href without consuming it. */
export function _prefetchPeek(href, frameId) { return prefetchCache.get(cacheKey(href, frameId)) || null; }

/** Test-only: number of prefetch requests currently in flight. */
export function _prefetchInflightSize() { return prefetchInflight.size; }

/** Test-only: clear all prefetch state between cases. */
export function _resetPrefetch() {
  prefetchCache.clear();
  prefetchRefused.clear();
  prefetchInflight.clear();
  prefetchQueue.length = 0;
  prefetchQueued.clear();
  clearPrefetchHover();
  clearPrefetchViewTimers();
}

/**
 * Disconnect and drop the viewport observer.
 *
 * `disableClientRouter` tears this down, and the binding lives here because
 * `refreshPrefetchObservers` creates it. An ESM import binding cannot be
 * assigned from another module, so the navigator calls this instead of nulling
 * it directly. The same two statements as before.
 */
export function teardownPrefetchViewObserver() {
  if (prefetchViewObserver) { prefetchViewObserver.disconnect(); prefetchViewObserver = null; }
}
