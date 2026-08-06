/**
 * Unit tests for the client-side SSR action-seed consumer (#472).
 *
 * Drives `scanSeeds` / `takeSeed` against a minimal fake DOM (the logic is
 * DOM-shaped but framework-agnostic): a page-level `#__webjs-seeds` JSON block
 * and per-element `[data-webjs-seed]` carriers are ingested, and `takeSeed`
 * consumes a seed once (a refetch / arg-change misses and falls back to RPC).
 * The end-to-end "no RPC on hydration" assertion is the e2e network probe.
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { takeSeed, scanSeeds, seedStats, SEED_MISS, __resetSeeds } from '../../src/action-seed-client.js';
import { stringify } from '../../src/serialize.js';

beforeEach(() => __resetSeeds());

/**
 * A fake element exposing the minimal surface scanSeeds touches. `dev` stamps
 * the server's `data-webjs-dev` marker on a page-level block, which is the ONLY
 * thing that turns the dev report on (#1309).
 */
function el(kind, payload, dev) {
  const attrs = {
    'data-webjs-seed': kind === 'seedattr' ? payload : undefined,
    'data-webjs-dev': dev,
  };
  return {
    _kind: kind,
    _removed: false,
    textContent: kind === 'script' ? payload : '',
    getAttribute: (n) => attrs[n] ?? null,
    removeAttribute: (n) => { delete attrs[n]; },
    remove() { this._removed = true; },
  };
}

/** A fake root resolving the two selectors scanSeeds queries. */
function root(els) {
  return {
    querySelectorAll(sel) {
      if (sel.includes('__webjs-seeds')) return els.filter((e) => e._kind === 'script');
      if (sel === '[data-webjs-seed]') return els.filter((e) => e._kind === 'seedattr');
      return [];
    },
  };
}

test('scanSeeds ingests a page-level #__webjs-seeds block; takeSeed returns the value', async () => {
  const payload = await stringify({ 'h/getUser/[1]': { id: 1, name: 'User 1' } });
  const script = el('script', payload);
  scanSeeds(root([script]));
  const got = takeSeed('h', 'getUser', '[1]');
  assert.notEqual(got, SEED_MISS);
  assert.deepEqual(got, { id: 1, name: 'User 1' });
  assert.equal(script._removed, true, 'the consumed seed block is removed');
});

test('takeSeed is consume-once: a second lookup of the same key misses', async () => {
  const payload = await stringify({ 'h/getUser/[1]': 7 });
  scanSeeds(root([el('script', payload)]));
  assert.equal(takeSeed('h', 'getUser', '[1]'), 7);
  assert.equal(takeSeed('h', 'getUser', '[1]'), SEED_MISS, 'a refetch misses and goes to RPC');
});

test('takeSeed misses an unknown key (different args -> RPC)', async () => {
  const payload = await stringify({ 'h/getUser/[1]': 1 });
  scanSeeds(root([el('script', payload)]));
  assert.equal(takeSeed('h', 'getUser', '[2]'), SEED_MISS, 'different args = miss');
  assert.equal(takeSeed('h', 'other', '[1]'), SEED_MISS, 'different fn = miss');
  assert.equal(takeSeed('zz', 'getUser', '[1]'), SEED_MISS, 'different file hash = miss');
});

test('scanSeeds ingests per-element [data-webjs-seed] carriers and strips the attr', async () => {
  const payload = await stringify({ 'h/getThing/[]': { ok: true } });
  const carrier = el('seedattr', payload);
  scanSeeds(root([carrier]));
  assert.deepEqual(takeSeed('h', 'getThing', '[]'), { ok: true });
  assert.equal(carrier.getAttribute('data-webjs-seed'), null, 'the attribute is removed after ingest');
});

test('last-write-wins: a later render\'s seed replaces an unconsumed earlier one', async () => {
  // This was first-write-wins until #1309. Its stated rationale ("an
  // already-consumed seed is never clobbered") described a case that cannot
  // occur, because a hit DELETES its key, so a duplicate could only ever mean
  // "a later render seeded a key an earlier render left unconsumed" and the old
  // rule handed the component the value from the render no longer on screen.
  const a = await stringify({ 'h/f/[1]': 'first' });
  const b = await stringify({ 'h/f/[1]': 'second' });
  scanSeeds(root([el('script', a), el('script', b)]));
  assert.equal(takeSeed('h', 'f', '[1]'), 'second');
});

test('staleness counterfactual: a soft nav\'s seed wins over the previous page\'s unconsumed one', async () => {
  // Two SEPARATE scans, the shape `applySwap` produces: render 1 seeds a key
  // nothing consumes (its component elided), then a soft navigation scans
  // render 2's block for the same key. Reverting `ingest` to first-write-wins
  // makes this return 'render-1-value'.
  scanSeeds(root([el('script', await stringify({ 'h/getUser/[1]': 'render-1-value' }))]));
  scanSeeds(root([el('script', await stringify({ 'h/getUser/[1]': 'render-2-value' }))]));
  assert.equal(takeSeed('h', 'getUser', '[1]'), 'render-2-value');
});

test('takeSeed never throws when there is no document (server / no carriers)', () => {
  // No scanSeeds call, no global document: the lazy first scan no-ops.
  assert.equal(takeSeed('h', 'f', '[1]'), SEED_MISS);
});

// --- Dev observability (#1309) ----------------------------------------------
//
// The report is gated by the SERVER's `data-webjs-dev` marker, never by
// `process.env.NODE_ENV`: esbuild folds that comparison to a constant in the
// built core browser bundle and `publicEnvShim` defines `window.process.env` on
// every page, so a NODE_ENV guard here would not merely be dropped, it would
// silently invert. An unmarked carrier is production, and must stay silent.

/**
 * Stub `requestIdleCallback` and `console.warn` for one body, run whatever the
 * scan scheduled, and return the warnings it produced.
 */
async function withReporter(body) {
  const origIdle = globalThis.requestIdleCallback;
  const origWarn = console.warn;
  const queued = [];
  const warns = [];
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); return queued.length; };
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    await body();
    for (const fn of queued) fn();
  } finally {
    if (origIdle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = origIdle;
    console.warn = origWarn;
  }
  return { warns, scheduled: queued.length };
}

test('seedStats reports ingested / replaced / hits / misses / pending', async () => {
  const a = await stringify({ 'h/f/[1]': 'one', 'h/f/[2]': 'two' });
  const b = await stringify({ 'h/f/[1]': 'one-again' });
  scanSeeds(root([el('script', a), el('script', b)]));
  assert.deepEqual(seedStats(), { ingested: 2, replaced: 1, hits: 0, misses: 0, pending: 2 });
  takeSeed('h', 'f', '[1]');
  takeSeed('h', 'f', '[999]');
  assert.deepEqual(seedStats(), { ingested: 2, replaced: 1, hits: 1, misses: 1, pending: 1 });
});

test('a marked carrier schedules exactly one report; an unmarked one schedules none', async () => {
  const payload = await stringify({ 'h/f/[1]': 1 });
  const marked = await withReporter(() => scanSeeds(root([el('script', payload, 'ok')])));
  assert.equal(marked.scheduled, 1, 'the dev marker turns reporting on');

  __resetSeeds();
  // The prod-silence counterfactual: the SAME payload with no marker.
  const unmarked = await withReporter(() => scanSeeds(root([el('script', payload)])));
  assert.equal(unmarked.scheduled, 0, 'production schedules nothing at all');
  assert.deepEqual(unmarked.warns, []);
});

test('the report fires only on a defect: every call hitting stays silent', async () => {
  const payload = await stringify({ 'h/f/[1]': 1 });
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', payload, 'ok')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.deepEqual(warns, [], 'a healthy line every page view trains developers to filter it out');
});

test('one miss inside the window logs one line naming the unmatched-keys cause', async () => {
  const payload = await stringify({ 'h/f/[1]': 1 });
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', payload, 'ok')]));
    takeSeed('h', 'f', '[1]');
    takeSeed('h', 'f', '[2]');
  });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /1 of 2 hydration action call\(s\) missed the seed/);
  assert.match(warns[0], /carried seeds, but not for these calls/);
});

test('a page with NO seeds names that cause instead of the unmatched-keys one', async () => {
  const { warns } = await withReporter(async () => {
    // The dev marker with an empty payload, which is what a page that seeded
    // nothing emits in dev.
    scanSeeds(root([el('script', await stringify({}), 'ok')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /carried no seeds at all/);
  assert.match(warns[0], /'use server'/);
});

test('a streamed page names streaming as the cause', async () => {
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({}), 'streamed')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /This page streams/);
});

test('fault injection: a throwing console.warn never propagates into takeSeed', async () => {
  const origIdle = globalThis.requestIdleCallback;
  const origWarn = console.warn;
  const queued = [];
  globalThis.requestIdleCallback = (fn) => queued.push(fn);
  console.warn = () => { throw new Error('logger exploded'); };
  try {
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 42 }), 'ok')]));
    assert.equal(takeSeed('h', 'f', '[1]'), 42);
    assert.equal(takeSeed('h', 'f', '[2]'), SEED_MISS);
    for (const fn of queued) fn(); // must not throw
  } finally {
    if (origIdle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = origIdle;
    console.warn = origWarn;
  }
});

test('with no requestIdleCallback the report still runs, on the setTimeout fallback', async () => {
  const origWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 1 }), 'ok')]));
    takeSeed('h', 'f', '[2]');
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    console.warn = origWarn;
  }
  assert.equal(warns.length, 1, 'the 250ms fallback fired');
});

test('a post-hydration miss is NOT charged to the next page (window starts at the scan)', async () => {
  // The report window is the HYDRATION window, scan to idle. A miss after it is
  // correct behaviour (consume-once, so a deliberate refetch is supposed to
  // miss), so it must not bank up and be blamed on the next page.
  const origIdle = globalThis.requestIdleCallback;
  const origWarn = console.warn;
  const warns = [];
  let queued = [];
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); };
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    // Page A: one seed, one hit, clean.
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 1 }), 'ok')]));
    takeSeed('h', 'f', '[1]');
    queued.forEach((fn) => fn());
    queued = [];
    assert.deepEqual(warns, [], 'page A is clean');

    // Still on page A, AFTER the report: three legitimate refetches.
    takeSeed('h', 'f', '[1]');
    takeSeed('h', 'f', '[1]');
    takeSeed('h', 'f', '[1]');

    // Page B (a soft nav): one seed, one hit, also clean.
    scanSeeds(root([el('script', await stringify({ 'h/f/[2]': 2 }), 'ok')]));
    takeSeed('h', 'f', '[2]');
    queued.forEach((fn) => fn());
  } finally {
    if (origIdle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = origIdle;
    console.warn = origWarn;
  }
  assert.deepEqual(warns, [], 'page A\'s post-hydration refetches are not blamed on page B');
});

test('a scan with NO marker (a back/forward restore) schedules nothing', async () => {
  // The restore path scans a snapshot carrying no seed block at all, because the
  // first scan removed it before the snapshot was serialized. A sticky marker
  // would schedule a report and read the cause off the PREVIOUS page.
  const origIdle = globalThis.requestIdleCallback;
  const origWarn = console.warn;
  const warns = [];
  const queued = [];
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); };
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    // A real dev page first, so a marker HAS been seen.
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 1 }), 'ok')]));
    takeSeed('h', 'f', '[1]');
    queued.splice(0).forEach((fn) => fn());

    // Now the restore: a scan finding no carrier at all, then the restored
    // components re-running their renders and missing (correctly).
    scanSeeds(root([]));
    takeSeed('h', 'f', '[1]');
    takeSeed('h', 'f', '[2]');
    assert.equal(queued.length, 0, 'no report is scheduled for a markerless scan');
    queued.splice(0).forEach((fn) => fn());
  } finally {
    if (origIdle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = origIdle;
    console.warn = origWarn;
  }
  assert.deepEqual(warns, [], 'and no wrong-cause line is printed');
});

test('the cause still distinguishes an empty page after an earlier seeded one', async () => {
  // `ingested` is measured from BEFORE this scan, so a second page that carried
  // no seeds reports "carried no seeds at all" rather than inheriting page one's
  // count and reporting the unmatched-keys cause.
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 1 }), 'ok')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.deepEqual(warns, []);
  const second = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({}), 'ok')]));
    takeSeed('h', 'f', '[9]');
  });
  assert.equal(second.warns.length, 1);
  assert.match(second.warns[0], /carried no seeds at all/);
});
