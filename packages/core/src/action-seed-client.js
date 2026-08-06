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
const stats = { ingested: 0, replaced: 0, hits: 0, misses: 0, keyMisses: 0 };

/**
 * The `hash/fn` of every action this page SEEDED, whatever arguments it used.
 *
 * This is what makes a miss provable. A miss on its own is not evidence of
 * anything: every action call routes through `takeSeed`, including ones that
 * were never SSR-invoked and never could have been seeded (a mutation, a `Task`
 * autorun, a `connectedCallback` read, an `optimistic()` call). But a miss on an
 * action the server DID invoke during this render, under some other argument
 * list, is a genuine key mismatch and nothing else: the action is reachable, it
 * was seeded, and this call still asked for a key the page does not carry.
 *
 * Keyed on the first two segments, which is exact: the file hash and the export
 * name are both `/`-free, and only the serialized argument list can contain one.
 */
const seedFns = new Set();

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
 * @type {{ epoch: number, hits: number, misses: number, keyMisses: number, merged: number, marker: string } | null}
 */
let openWindow = null;
/** Monotonic window id, so a stale callback can recognise itself. */
let windowEpoch = 0;

/**
 * Merge any seeds found under `root` into the global store, then remove the
 * carriers so a re-scan never re-ingests stale data. Reads both the page-level
 * `#__webjs-seeds` JSON block and per-element `[data-webjs-seed]` carriers.
 * Idempotent and fail-open: a malformed payload is skipped, never thrown.
 *
 * A DETACHED root means a new PAGE is arriving (the router's `applySwap` passes
 * one), which is what ends the outgoing page's report window and discards its
 * leftovers. A `<webjs-frame>` swap goes through the same `applySwap` but is NOT
 * a page navigation, so the router flags it and this leaves every bit of page
 * state alone; see `opts.frame`.
 * @param {ParentNode & { querySelectorAll?: Function }} [root]
 * @param {{ frame?: boolean }} [opts] `frame: true` marks a `<webjs-frame>`
 *   subtree swap rather than a page navigation.
 */
export function scanSeeds(root, opts) {
  const live = typeof document !== 'undefined' ? document : null;
  const scope = root || live;
  if (!scope || typeof scope.querySelectorAll !== 'function') return;

  // A FRAME swap is not a page navigation: the page around the frame is still
  // the page on screen. So touch no page state at all, no window closed or
  // opened and no lazy-scan suppression, and DISCARD whatever the parse carries.
  //
  // The router has to say which it is, because the parse cannot be recognised
  // from its own shape. `ssr.js` slices out a bare frame subtree ONLY when the
  // id was found and the render did not stream; in every other case it falls
  // through and serves the WHOLE PAGE, seed block and all, so a frame response
  // is not reliably distinguishable from a page that seeded nothing. Guessing
  // failed in both directions in turn: treating it as a page killed the report
  // for the whole page the frame sits on, and attributing the window to the live
  // page made it report a CAUSE that is provably false, since none of the causes
  // describes a frame response. (The response's own `X-Webjs-Seed` is no help
  // either: the isolable case returns before the header is set, and the three
  // fallthrough shapes below carry the SURROUNDING page's header, which says
  // nothing about the frame.)
  //
  // Discarding is right for every shape the fallthrough produces, and they are
  // not all the same shape:
  //  - ISOLABLE (id found, buffered): the subtree was sliced before the block
  //    was appended, so there is nothing to discard.
  //  - STREAMED: the whole page is served and the frame IS in it, so the swap
  //    SUCCEEDS. In dev the page carries a marker-only block, which holds no
  //    seeds anyway.
  //  - #241 HTML CACHE HIT: the cached page is returned before the slice, so the
  //    parse carries a real, populated block, and the swap succeeds. Those seeds
  //    describe the whole page, not the one region being swapped in, and the
  //    page on screen already has its own.
  //  - ID MISSING: the whole page is served, the router dispatches
  //    `webjs:frame-missing`, and the response is thrown away entirely.
  //
  // Ingesting in the last three would put another response's seeds in the store,
  // where last-write-wins hands them to a component on the page still on screen,
  // which is the exact "a hit disagrees with the paint" class this feature
  // promises cannot happen.
  if (opts && opts.frame === true) {
    drainCarriers(scope, true);
    return;
  }

  // Close the previous page's window BEFORE ingesting anything: the moment this
  // page's content arrives is exactly where the previous page's numbers stop. Do
  // it after the ingest loops instead and this scan's seeds are already counted
  // into the window being closed, which is the whole defect.
  closeReportWindow();

  // Is this root the live document, or part of it? A live root (the lazy initial
  // scan) or a live subtree is not an incoming page, and must not trigger the
  // discard below: it would strip the very subtree being scanned.
  const scopeIsLive = scope === live;
  const scopeInLive = !!live && !scopeIsLive && typeof live.contains === 'function' && live.contains(scope);
  const incomingPage = !!live && !scopeIsLive && !scopeInLive;

  // The live document can still be holding the OUTGOING page's block, because
  // the initial scan is lazy (it runs on the first `takeSeed`) and a page whose
  // async components all elided never triggers it, while the block sits after
  // the body content outside every boundary range, so no swap removes it either.
  //
  // Strip it WITHOUT ingesting. Those values belong to a page that is being
  // replaced, so nothing on the incoming page should ever receive one: leaving
  // them for the lazy scan to ingest LATER is what let a departed page's value
  // win a key under last-write-wins and contradict the paint. Ingesting them
  // HERE would order them correctly but keep them forever, because the very
  // reason the block went unconsumed is that its components elided, so nothing
  // will ever call `takeSeed` for those keys and nothing but a hit deletes one.
  // That would grow the store by a whole page payload per navigation, in
  // production, and inflate the "still unconsumed" figure in the dev line with
  // keys from pages the developer has already left. The cost of discarding is
  // that an in-flight `async render()` from the outgoing page misses and
  // refetches, which is a round-trip rather than wrong data.
  if (incomingPage) {
    drainCarriers(live, true);
    // And evict what the outgoing page ALREADY ingested. Stripping the DOM
    // carrier is not enough: a page carrying an elided component alongside a
    // shipping one has its WHOLE block ingested by the lazy scan the shipping
    // one triggers, so the elided component's keys are in the store with no
    // carrier left to strip and nothing that will ever consume them. Navigate to
    // a page that emits no seed for such a key (a streamed page emits no block
    // at all) and a component calling the same action with the same arguments
    // gets a HIT carrying the DEPARTED page's value, painted over the fresh SSR
    // HTML. That is the same "a hit disagrees with the paint" class the drain
    // above closes, reached through the store instead of through the DOM, so it
    // has to close here too or the guarantee is not one.
    //
    // Everything still held at this moment belongs to the page being replaced:
    // a hit deletes its key, so anything left is unconsumed. Dropping it costs
    // an in-flight `async render()` from the outgoing page a round-trip, never
    // wrong data.
    seeds.clear();
    seedFns.clear();
  }
  // The lazy scan must not run again once the live document has been handled: a
  // second pass finds nothing to ingest but would close the window this scan is
  // about to open. Only when it HAS been handled, though. A live SUBTREE scan
  // leaves the rest of the document unscanned, so the lazy pass still owes it.
  if (scopeIsLive || incomingPage) scannedInitial = true;

  // MERGED is `ingested + replaced`, not `ingested`: a key already in the store
  // counts as a replacement, so a scan whose seeds all replace unconsumed ones
  // would otherwise measure as zero and claim the page carried no seeds while
  // naming one. A page navigation can no longer produce that shape (it evicts
  // first), but a re-scan of the same document still can, and the count has to
  // mean "merged by this scan" either way.
  const mergedBefore = stats.ingested + stats.replaced;
  startReportWindow(drainCarriers(scope), mergedBefore);
}

/**
 * Strip every seed carrier under `scope`, returning the dev marker it carried
 * (the page-level block's, the only carrier that has one) or null. Ingests the
 * values unless `discard` is set, which is how an outgoing page's leftovers are
 * removed without ever entering the store.
 * @param {ParentNode & { querySelectorAll: Function }} scope
 * @param {boolean} [discard] strip the carriers but drop their values
 * @returns {string | null}
 */
function drainCarriers(scope, discard) {
  let marker = null;
  // Page-level JSON block(s). The dev marker rides this carrier only, and it is
  // THIS scan's marker that decides whether there is a report to make and what
  // cause it names.
  for (const el of scope.querySelectorAll('script[type="application/json"]#__webjs-seeds, script[type="application/json"][data-webjs-seeds]')) {
    const m = readDevMarker(el.getAttribute?.('data-webjs-dev'));
    if (m !== null) marker = m;
    ingest(discard ? null : el.textContent, el);
  }
  // Per-element carriers (streamed boundaries / future per-component seeding).
  for (const el of scope.querySelectorAll('[data-webjs-seed]')) {
    ingest(discard ? null : el.getAttribute('data-webjs-seed'), el, () => el.removeAttribute('data-webjs-seed'));
  }
  return marker;
}

/**
 * Parse one serialized seed payload and merge it, then run `cleanup` (or remove
 * the element).
 *
 * LAST write wins. A hit DELETES its key (`takeSeed`), so a duplicate can only
 * mean "a later carrier emitted a seed for a key an earlier one left
 * unconsumed", and the later carrier is the one whose paint is on screen.
 *
 * Note what this rule is NOT load-bearing for any more. It was introduced for
 * the cross-PAGE case, where a departed render's value could win a shared key;
 * that case is now closed at the source, because an incoming page evicts the
 * outgoing page's carriers AND its already-ingested seeds before ingesting its
 * own, so no cross-render duplicate can reach here at all. What remains is the
 * within-page case: two carriers in one scan, or a re-scan of the same document,
 * where the later one is still the right answer and first-write-wins would still
 * be the wrong one.
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
          const cut = k.indexOf('/', k.indexOf('/') + 1);
          if (cut > 0) seedFns.add(k.slice(0, cut));
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
  // ingest. No marker at all means there is nothing to report on: production
  // never emits one, and a back/forward restore of a page that WAS scanned
  // carries no block, because it was stripped before the snapshot was
  // serialized. A restore of a page that was NEVER scanned does carry one, and
  // that block is that page's own, so ingesting it and reporting on it are both
  // right.
  if (scanMarker === null) return;
  const epoch = ++windowEpoch;
  openWindow = { epoch, hits: stats.hits, misses: stats.misses, keyMisses: stats.keyMisses, merged: mergedBefore, marker: scanMarker };
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
  const keyMisses = stats.keyMisses - w.keyMisses;
  if (misses === 0) return;
  // Report ONLY a cause this side can prove. A miss is not evidence on its own:
  // EVERY action call routes through `takeSeed`, including ones that were never
  // SSR-invoked and never could have been seeded (a mutation, a `Task` autorun,
  // a `connectedCallback` read, an `optimistic()` call). Warning on those tells
  // a developer whose code is correct to go audit it, on every page view, with
  // no way to silence it, which is the false alarm that trains people to filter
  // the channel out.
  //
  // Two shapes are provable. A `streamed` or `drop` marker is the SERVER saying
  // no seed could ride the page, so every miss on it is explained. And a miss on
  // an action this page DID seed under other arguments (`seedFns`) is a genuine
  // key mismatch, because the action is demonstrably reachable and seeded. A
  // miss on an action that was never seeded at all is left alone: that is the
  // ambiguous case, and the server's `X-Webjs-Seed` states it unambiguously.
  const cause = w.marker === 'streamed'
    ? 'This page streams (a Suspense or <webjs-suspense> boundary), and a streamed render emits no seeds, so every action call on it goes to the network.'
    : w.marker === 'drop'
      ? 'The page\'s seeds could not be serialized, so the whole block was dropped. Something an action returned is not serializer-safe; the server response reports collected above emitted.'
      : keyMisses === 0
        ? null
        : 'The key is the action file hash plus the function name plus the serialized arguments, so an argument the SSR render never used misses (a deliberate refetch after hydration misses too, and is expected). A miss on an action this page never seeded is NOT counted here, because a mutation or a client-only read could never have been seeded.';
  if (cause === null) return;
  // The number and the predicate have to agree. For a server-asserted cause the
  // marker explains EVERY miss, so the total is the right figure and "went to
  // the network" is the right claim. For a key mismatch only the provable subset
  // is explained, and calling that subset the round-trip count understates the
  // traffic: a page mixing one key mismatch with one mutation had 2 calls go out
  // while the line said 1. So that case reports its own count against its own
  // claim, and never speaks for the misses it cannot account for.
  const serverAsserted = w.marker === 'streamed' || w.marker === 'drop';
  const headline = serverAsserted
    ? `${misses} of ${hits + misses} action call(s) in the hydration window went to the network`
    : `${keyMisses} action call(s) in the hydration window asked for a key this page seeded under DIFFERENT arguments`;
  console.warn(
    `[webjs] SSR action seeding: ${headline} `
    + `(${merged} seed(s) on this page, ${seeds.size} still unconsumed). ${cause} `
    + 'See https://webjs.dev/docs/data-fetching for the seeding reference.',
  );
}

/**
 * Look up and CONSUME the seed for an action call. Returns the seeded value
 * (removing it) on a hit, or `SEED_MISS` when there is none. The first call
 * lazily scans the initial document, so the boot path needs no wiring; the
 * router calls `scanSeeds(doc)` with the DETACHED parse of content that arrives
 * later, which is also what tells this module a new page is replacing the one on
 * screen.
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
  // A miss on an action this page DID seed under other arguments is the only
  // miss the client can call a defect; see `seedFns`.
  if (seedFns.has(`${hash}/${fnName}`)) stats.keyMisses++;
  return SEED_MISS;
}

/**
 * The cumulative seed counters for this page session (#1309). `ingested` and
 * `replaced` are what `scanSeeds` merged; `hits` and `misses` are what the
 * generated RPC stubs asked for; `pending` is what is still in the store
 * unconsumed (a non-zero `pending` at rest usually means the seeding component
 * elided, so nothing on the client was ever going to call it).
 * `keyMisses` is the provable subset of `misses`: a call for an action this page
 * DID seed under other arguments, which is the only miss the client can call a
 * defect (see `seedFns`).
 * @returns {{ ingested: number, replaced: number, hits: number, misses: number, keyMisses: number, pending: number }}
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
  stats.keyMisses = 0;
  seedFns.clear();
  openWindow = null;   // drop it silently; a reset is not a page view
  windowEpoch++;       // and burn any in-flight callback rather than let it report
}
