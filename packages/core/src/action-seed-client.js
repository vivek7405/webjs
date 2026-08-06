/**
 * Client-side SSR action-seed consumer (#472).
 *
 * The server (`@webjsdev/server`'s `action-seed.js`) serializes each action
 * result invoked during SSR into a `<script type="application/json"
 * id="__webjs-seeds">` block. A per-element `data-webjs-seed` carrier is also
 * READ here, for a future per-component / streamed-region seeding; no server
 * path emits one today, and a streamed render emits no seeds at all.
 * On the client, the generated RPC stub
 * (`actions.js`) calls `takeSeed(hash, fn, argsKey)` on its FIRST invocation: a
 * hit resolves the action synchronously with the SSR value (no RPC, no flicker
 * on hydration); a miss falls through to the normal RPC.
 *
 * Consume-once: a hit removes the seed, so a later refetch / arg-change always
 * goes to the network (the seed is a first-paint optimization, not a cache).
 * Keyed `hash/fn/stringify(args)`, where `hash` and `stringify` match exactly
 * what the server emitted, so distinct components and distinct args each map to
 * their own seed. A miss is always safe (it just re-fetches).
 *
 * This module is imported by the generated stub via the bare `@webjsdev/core`
 * specifier; on the server it is inert (its only DOM access is inside
 * `scanSeeds`, never called server-side).
 */

import { parse } from './serialize.js';

/** Global consume-once seed store: `key -> value`. */
const seeds = new Map();

/** Returned by `takeSeed` when no seed matches; distinct from any real value. */
export const SEED_MISS = Symbol('webjs.seed.miss');

/** One-time eager scan guard (the initial-load document is scanned lazily). */
let scannedInitial = false;

/**
 * Cumulative counters (#1309). ALWAYS on: WebJs is no-build on the server, and
 * the one build that exists (the core browser bundle) cannot express a dev gate,
 * since esbuild substitutes `process.env.NODE_ENV` with "production" and
 * `publicEnvShim` always defines `window.process.env`, so a NODE_ENV guard in
 * this bundle is a constant that reads the wrong way round. Four integer
 * increments on a path that already awaits `stringify(args)` and usually a
 * `fetch`, so nothing is gated here; only the REPORTING is, by a server-emitted
 * marker (see `readDevMarker`).
 */
const stats = { ingested: 0, replaced: 0, hits: 0, misses: 0 };

/**
 * The open report window, or null. Each scan OPENS one and CLOSES the previous,
 * so a window measures exactly the page it was opened for.
 *
 * The window has to be the hydration window (scan to idle), because a miss AFTER
 * it is correct behaviour: the seed is consume-once, so a deliberate refetch or
 * an argument change is SUPPOSED to miss. Measure any wider and correct misses
 * are reported as defects, which is what trains a developer to filter the
 * channel out.
 *
 * "Wider" has two directions and both were live at some point in this PR. Late:
 * snapshotting at report time rather than schedule time banks post-hydration
 * misses and charges them to the next page. Early: letting a report stay open
 * across a soft navigation folds the NEXT page's seeds and calls into the
 * previous page's numbers, so a healthy page gets a defect line and the page
 * that actually had one gets no report at all. Closing on the next scan bounds
 * it from both ends, and the marker rides the window for the same reason the
 * counters do.
 *
 * `epoch` lets a scheduled callback tell whether its window is still the open
 * one; a window closed early (by the next scan, or by `__resetSeeds`) leaves a
 * callback behind that must be a no-op rather than report a window it does not
 * own.
 * @type {{ epoch: number, hits: number, misses: number, merged: number, marker: string } | null}
 */
let openWindow = null;
/** Monotonic window id, so a stale callback can recognise itself. */
let windowEpoch = 0;

/**
 * Merge any seeds found under `root` into the global store, then remove the
 * carriers so a re-scan (a streamed boundary, a soft navigation) never
 * re-ingests stale data. Reads both the page-level `#__webjs-seeds` JSON block
 * and per-element `[data-webjs-seed]` carriers. Idempotent and fail-open: a
 * malformed payload is skipped, never thrown.
 * @param {ParentNode & { querySelectorAll?: Function }} [root]
 */
export function scanSeeds(root) {
  const live = typeof document !== 'undefined' ? document : null;
  const scope = root || live;
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  // Close the previous page's window BEFORE ingesting anything: the moment this
  // page's content arrives is exactly where the previous page's numbers stop. Do
  // it after the ingest loops instead and this scan's seeds are already counted
  // into the window being closed, which is the whole defect.
  closeReportWindow();
  // A scan of an EXPLICIT root is a new page arriving: the router's `applySwap`
  // passes a detached parse, never the live document. The live document can
  // still be holding the OUTGOING page's block, because the initial scan is lazy
  // (it runs on the first `takeSeed`) and a page whose async components all
  // elided never triggers it, while the block itself sits after the body content
  // outside every boundary range, so no swap removes it either.
  //
  // Drain it FIRST, in ingest order, which is what makes last-write-wins correct
  // here: the outgoing page's values go in before the incoming page's, so a key
  // both renders share ends up holding the INCOMING one, the render whose paint
  // is on screen. Leave the leftover for the lazy scan to find later and the
  // order inverts, the stale value wins, and a hit contradicts the HTML the user
  // is looking at. Keeping the outgoing values rather than discarding them costs
  // nothing and still answers an in-flight `async render()` from the page being
  // navigated away from.
  if (live && scope !== live) drainCarriers(live);
  // Either way the live document has now been handled, so the lazy scan must not
  // run again: a second pass finds nothing to ingest but would close the window
  // this scan is about to open.
  if (live) scannedInitial = true;
  // Read BEFORE ingesting THIS page: the report distinguishes "the page carried
  // no seeds at all" from "it carried seeds, but not for these calls", and that
  // turns on how many THIS scan merged. Read after the drain above, so the
  // outgoing page's leftovers are not counted as this page's. MERGED is
  // `ingested + replaced`, not `ingested`: a key already in the store counts as
  // a replacement, so a scan whose seeds all replace unconsumed ones (revisiting
  // a page whose seeding component elided, exactly the shape last-write-wins
  // exists for) would otherwise measure as zero and claim the page carried no
  // seeds while naming one.
  const mergedBefore = stats.ingested + stats.replaced;
  startReportWindow(drainCarriers(scope), mergedBefore);
}

/**
 * Ingest and strip every seed carrier under `scope`, returning the dev marker it
 * carried (the page-level block's, the only carrier that has one) or null.
 * @param {ParentNode & { querySelectorAll: Function }} scope
 * @returns {string | null}
 */
function drainCarriers(scope) {
  let marker = null;
  // Page-level JSON block(s). The dev marker rides this carrier only, and it is
  // THIS scan's marker that decides whether there is a report to make and what
  // cause it names.
  for (const el of scope.querySelectorAll('script[type="application/json"]#__webjs-seeds, script[type="application/json"][data-webjs-seeds]')) {
    const m = readDevMarker(el.getAttribute?.('data-webjs-dev'));
    if (m !== null) marker = m;
    ingest(el.textContent, el);
  }
  // Per-element carriers (streamed boundaries / future per-component seeding).
  for (const el of scope.querySelectorAll('[data-webjs-seed]')) {
    ingest(el.getAttribute('data-webjs-seed'), el, () => el.removeAttribute('data-webjs-seed'));
  }
  return marker;
}

/**
 * Parse one serialized seed payload and merge it, then run `cleanup` (or remove
 * the element).
 *
 * LAST write wins. A hit DELETES its key (`takeSeed`), so a duplicate can only
 * mean "a later render emitted a seed for a key an earlier render left
 * unconsumed", and the later render is the one whose paint is on screen. The
 * previous first-write-wins rule handed that component the OLDER value, the one
 * path where a hit could disagree with the visible HTML. It is reachable on a
 * soft navigation, on the background revalidation after one, and on a
 * back/forward snapshot restore, all of which route through `applySwap`'s
 * `scanSeeds(doc)`.
 * @param {string | null} raw
 * @param {Element} el
 * @param {() => void} [cleanup]
 */
function ingest(raw, el, cleanup) {
  if (raw) {
    try {
      const obj = parse(raw);
      if (obj && typeof obj === 'object') {
        for (const k in obj) {
          if (seeds.has(k)) stats.replaced++;
          else stats.ingested++;
          seeds.set(k, obj[k]);
        }
      }
    } catch {
      // Malformed payload: ignore, the stub re-fetches.
    }
  }
  if (cleanup) cleanup();
  else el.remove?.();
}

/**
 * Read the server's dev marker off one carrier, the ONLY dev signal this bundle
 * can trust (a `process.env.NODE_ENV` comparison here is a compile-time
 * constant, see `stats`). Absent in production, so the reporting below never
 * runs there. Pure: the value belongs to the scan that read it, never to the
 * module.
 * @param {string | null | undefined} v the `data-webjs-dev` attribute value
 * @returns {string | null} the marker, or null when this carrier had none
 */
function readDevMarker(v) {
  if (typeof v !== 'string') return null;
  return v || 'ok';
}

/**
 * Open the window for this scan. Called at the END of a scan, once the merged
 * count for it is known; the window it supersedes was already closed at the TOP
 * of the scan, so a markerless scan still ends the previous page's window.
 * @param {string | null} scanMarker THIS scan's `data-webjs-dev` marker, or null
 * @param {number} mergedBefore merged-seed count as it stood before this scan
 */
function startReportWindow(scanMarker, mergedBefore) {
  // The previous window was already closed at the top of the scan, before any
  // ingest. No marker in THIS scan means there is nothing to report on. Production never
  // has one, and a back/forward restore scans a snapshot carrying no seed block
  // at all (the first scan removed it before the snapshot was serialized), so a
  // marker inherited from the previous page would name a cause read off it.
  if (scanMarker === null) return;
  const epoch = ++windowEpoch;
  openWindow = { epoch, hits: stats.hits, misses: stats.misses, merged: mergedBefore, marker: scanMarker };
  const run = () => {
    if (!openWindow || openWindow.epoch !== epoch) return; // already closed; not ours
    closeReportWindow();
  };
  try {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 250);
  } catch {
    openWindow = null;
  }
}

/** Close the open window and report on it. A no-op when none is open. */
function closeReportWindow() {
  const w = openWindow;
  openWindow = null;
  if (!w) return;
  try { reportSeeds(w); } catch { /* diagnostics never break a page */ }
}

/**
 * One dev console line per page view, and ONLY on a defect. A healthy line every
 * navigation trains a developer to filter the channel out, and the healthy
 * numbers are already on the server's access-log line for every request.
 */
function reportSeeds(w) {
  const hits = stats.hits - w.hits;
  const misses = stats.misses - w.misses;
  const merged = (stats.ingested + stats.replaced) - w.merged;
  if (misses === 0) return;
  const cause = w.marker === 'streamed'
    ? 'This page streams (a Suspense or <webjs-suspense> boundary), and a streamed render emits no seeds, so every action call on it goes to the network.'
    : merged === 0
      ? 'The page carried no seeds at all. Check that the action lives in a *.server.{js,ts} file whose head declares \'use server\', and that a component actually awaited it during the SSR render.'
      : 'The page carried seeds, but not for these calls. The key is the action file hash plus the function name plus the serialized arguments, so a different argument misses (a deliberate refetch after hydration misses too, and is expected).';
  console.warn(
    `[webjs] SSR action seeding: ${misses} of ${hits + misses} hydration action call(s) missed the seed and cost a network round-trip `
    + `(${merged} seed(s) on this page, ${seeds.size} still unconsumed). ${cause} `
    + 'See https://webjs.dev/docs/data-fetching for the seeding reference.',
  );
}

/**
 * Look up and CONSUME the seed for an action call. Returns the seeded value
 * (removing it) on a hit, or `SEED_MISS` when there is none. The first call
 * lazily scans the initial document, so the boot path needs no wiring; the
 * router calls `scanSeeds(subtree)` for content that arrives later.
 * @param {string} hash the action file's hash (the RPC endpoint hash)
 * @param {string} fnName the exported action name
 * @param {string} argsKey `stringify(args)`, computed by the stub with the same
 *   serializer the server used, so identical args produce an identical key
 * @returns {unknown | typeof SEED_MISS}
 */
export function takeSeed(hash, fnName, argsKey) {
  if (!scannedInitial) {
    scannedInitial = true;
    scanSeeds();
  }
  const key = `${hash}/${fnName}/${argsKey}`;
  if (seeds.has(key)) {
    const v = seeds.get(key);
    seeds.delete(key);
    stats.hits++;
    return v;
  }
  stats.misses++;
  return SEED_MISS;
}

/**
 * The cumulative seed counters for this page session (#1309). `ingested` and
 * `replaced` are what `scanSeeds` merged; `hits` and `misses` are what the
 * generated RPC stubs asked for; `pending` is what is still in the store
 * unconsumed (a non-zero `pending` at rest usually means the seeding component
 * elided, so nothing on the client was ever going to call it).
 * @returns {{ ingested: number, replaced: number, hits: number, misses: number, pending: number }}
 */
export function seedStats() {
  return { ...stats, pending: seeds.size };
}

/** Test seam: drop all seeds and reset the lazy-scan guard + the counters. */
export function __resetSeeds() {
  seeds.clear();
  scannedInitial = false;
  stats.ingested = 0;
  stats.replaced = 0;
  stats.hits = 0;
  stats.misses = 0;
  openWindow = null;   // drop it silently; a reset is not a page view
  windowEpoch++;       // and burn any in-flight callback rather than let it report
}
