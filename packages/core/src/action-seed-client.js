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
 * marker (see `noteDevMarker`).
 */
const stats = { ingested: 0, replaced: 0, hits: 0, misses: 0 };

/** `null` in prod. In dev, the `data-webjs-dev` value the server stamped. */
let devMarker = null;
/** One scheduled report at a time. */
let reportScheduled = false;
/**
 * Generation of the pending report. A scheduled idle callback outlives the state
 * it was scheduled against (`__resetSeeds` between tests is the reachable case),
 * and once `windowStart` no longer moves at report time, a stale callback would
 * re-report the CURRENT window a second time. Each schedule takes a token and a
 * reset burns it, so a superseded callback is a no-op instead.
 */
let reportEpoch = 0;
/**
 * Counter snapshot at the START of the pending report's window, taken when the
 * report is SCHEDULED rather than when it runs. That difference is the whole
 * correctness of the metric: the window has to be the hydration window (scan to
 * idle), because a miss AFTER it is correct behaviour (the seed is consume-once,
 * so a deliberate refetch or an argument change is SUPPOSED to miss). Snapshot
 * at report end instead and those legitimate misses bank up and get charged to
 * the next page on the next soft navigation, which reports a defect on a page
 * that has none.
 */
let windowStart = { hits: 0, misses: 0, ingested: 0 };

/**
 * Merge any seeds found under `root` into the global store, then remove the
 * carriers so a re-scan (a streamed boundary, a soft navigation) never
 * re-ingests stale data. Reads both the page-level `#__webjs-seeds` JSON block
 * and per-element `[data-webjs-seed]` carriers. Idempotent and fail-open: a
 * malformed payload is skipped, never thrown.
 * @param {ParentNode & { querySelectorAll?: Function }} [root]
 */
export function scanSeeds(root) {
  const scope = root || (typeof document !== 'undefined' ? document : null);
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  // Read BEFORE ingesting: the report distinguishes "the page carried no seeds
  // at all" from "it carried seeds, but not for these calls", and that turns on
  // how many THIS scan merged.
  const ingestedBefore = stats.ingested;
  // Page-level JSON block(s). The dev marker rides this carrier only, and
  // whether THIS scan found one is what decides if there is a report to make.
  let sawMarker = false;
  for (const el of scope.querySelectorAll('script[type="application/json"]#__webjs-seeds, script[type="application/json"][data-webjs-seeds]')) {
    if (noteDevMarker(el.getAttribute?.('data-webjs-dev'))) sawMarker = true;
    ingest(el.textContent, el);
  }
  // Per-element carriers (streamed boundaries / future per-component seeding).
  for (const el of scope.querySelectorAll('[data-webjs-seed]')) {
    ingest(el.getAttribute('data-webjs-seed'), el, () => el.removeAttribute('data-webjs-seed'));
  }
  scheduleSeedReport(sawMarker, ingestedBefore);
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
 * Record the server's dev marker, the ONLY dev signal this bundle can trust (a
 * `process.env.NODE_ENV` comparison here is a compile-time constant, see
 * `stats`). Absent in production, so the reporting below never runs there.
 * @param {string | null | undefined} v the `data-webjs-dev` attribute value
 * @returns {boolean} whether this carrier actually carried a marker
 */
function noteDevMarker(v) {
  if (typeof v !== 'string') return false;
  devMarker = v || 'ok';
  return true;
}

/**
 * Schedule the one dev report for this page view. The window it measures runs
 * from the scan to the idle callback, which IS the hydration window: a miss
 * inside it is a wasted round-trip, while a miss AFTER it is correct (the seed
 * is consume-once, so a deliberate refetch or an argument change is supposed to
 * miss). A slow `async render()` whose call lands after idle is undercounted,
 * which is a false negative rather than a false alarm.
 * @param {boolean} sawMarker whether THIS scan found a `data-webjs-dev` marker
 * @param {number} ingestedBefore `stats.ingested` as it stood before this scan
 */
function scheduleSeedReport(sawMarker, ingestedBefore) {
  // Gated on THIS scan having found a marker, not on one ever having been seen.
  // A back/forward restore scans a snapshot carrying no seed block at all (the
  // first scan removed it before the snapshot was serialized), so a sticky
  // marker would schedule a report whose cause is read off the PREVIOUS page:
  // "the page carried no seeds at all, check the 'use server' head" is wrong
  // advice for a back button, and a stale `streamed` marker is wrong the other
  // way. No marker in this scan means nothing to report on.
  if (!sawMarker || reportScheduled) return;
  reportScheduled = true;
  const epoch = ++reportEpoch;
  windowStart = { hits: stats.hits, misses: stats.misses, ingested: ingestedBefore };
  const run = () => {
    if (epoch !== reportEpoch) return; // superseded; the newer generation owns the flag
    reportScheduled = false;
    try { reportSeeds(); } catch { /* diagnostics never break a page */ }
  };
  try {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1000 });
    else setTimeout(run, 250);
  } catch {
    reportScheduled = false;
  }
}

/**
 * One dev console line per page view, and ONLY on a defect. A healthy line every
 * navigation trains a developer to filter the channel out, and the healthy
 * numbers are already on the server's access-log line for every request.
 */
function reportSeeds() {
  const hits = stats.hits - windowStart.hits;
  const misses = stats.misses - windowStart.misses;
  const ingested = stats.ingested - windowStart.ingested;
  if (misses === 0) return;
  const cause = devMarker === 'streamed'
    ? 'This page streams (a Suspense or <webjs-suspense> boundary), and a streamed render emits no seeds, so every action call on it goes to the network.'
    : ingested === 0
      ? 'The page carried no seeds at all. Check that the action lives in a *.server.{js,ts} file whose head declares \'use server\', and that a component actually awaited it during the SSR render.'
      : 'The page carried seeds, but not for these calls. The key is the action file hash plus the function name plus the serialized arguments, so a different argument misses (a deliberate refetch after hydration misses too, and is expected).';
  console.warn(
    `[webjs] SSR action seeding: ${misses} of ${hits + misses} hydration action call(s) missed the seed and cost a network round-trip `
    + `(${ingested} seed(s) on this page, ${seeds.size} still unconsumed). ${cause} `
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
  devMarker = null;
  reportScheduled = false;
  reportEpoch++; // burn any in-flight callback rather than let it report a reset window
  windowStart = { hits: 0, misses: 0, ingested: 0 };
}
