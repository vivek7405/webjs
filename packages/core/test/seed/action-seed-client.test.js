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
  assert.deepEqual(seedStats(), { ingested: 2, replaced: 1, hits: 0, misses: 0, keyMisses: 0, pending: 2 });
  takeSeed('h', 'f', '[1]');
  takeSeed('h', 'f', '[999]');
  assert.deepEqual(seedStats(), { ingested: 2, replaced: 1, hits: 1, misses: 1, keyMisses: 1, pending: 1 });
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
  assert.match(warns[0], /1 of 2 action call\(s\) in the hydration window cost a network round-trip/);
  assert.match(warns[0], /under DIFFERENT arguments/);
});

test('a page with NO seeds stays SILENT, because the client cannot tell why', async () => {
  // Deliberately no line here. Every action call routes through `takeSeed`,
  // including ones that were never SSR-invoked and never could have been seeded
  // (a mutation, a `Task` autorun, a `connectedCallback` read). On a page that
  // emitted no seeds those are indistinguishable from a broken seeding path, so
  // a warning would tell a developer whose code is correct to check a
  // `'use server'` directive that is already right, on every page view. The
  // server's `X-Webjs-Seed: collected=0` states that case unambiguously instead.
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({}), 'ok')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.deepEqual(warns, []);
});

test('a streamed page names streaming as the cause', async () => {
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({}), 'streamed')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /This page streams/);
});

test('a miss on an action the page never seeded stays SILENT', async () => {
  // The false alarm this branch had to lose. A mutation, a `Task` autorun and a
  // `connectedCallback` read all route through the same lookup and could never
  // have been seeded, so a miss on an action the page did not seed at all is not
  // evidence of anything. Only a miss on an action the page DID seed, under
  // other arguments, is a provable key mismatch.
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({ 'h/getUser/[1]': 1 }), 'ok')]));
    takeSeed('h', 'getUser', '[1]');    // hit
    takeSeed('h', 'createTodo', '[{}]'); // a mutation: never seedable, must not warn
  });
  assert.deepEqual(warns, []);
});

test('a serializer DROP names that cause, not the unmatched-keys one', async () => {
  // The marker the server emits when `stringify` threw and the whole payload was
  // dropped. Its block is empty by construction, so without this branch the
  // report would fall to the silent `merged === 0` case and the one failure the
  // counts exist to expose would say nothing in the browser at all.
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({}), 'drop')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.equal(warns.length, 1);
  assert.match(warns[0], /could not be serialized/);
  assert.match(warns[0], /collected above emitted/, 'and points at the header that confirms it');
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

test('an empty page after a seeded one does not inherit the seeded one\'s count', async () => {
  // `merged` is measured from BEFORE this scan, so the second page reads 0 and
  // stays silent rather than inheriting page one's count and claiming a key
  // mismatch it has no evidence for.
  const { warns } = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 1 }), 'ok')]));
    takeSeed('h', 'f', '[1]');
  });
  assert.deepEqual(warns, []);
  const second = await withReporter(async () => {
    scanSeeds(root([el('script', await stringify({}), 'ok')]));
    takeSeed('h', 'unseeded', '[9]');
  });
  assert.deepEqual(second.warns, [], 'no inherited count, so no unmatched-keys claim');
});

test('a scan whose seeds all REPLACE unconsumed ones still counts as seeds merged', async () => {
  // The merged baseline is `ingested + replaced`, not `ingested`. A re-scan that
  // re-emits a key the store still holds makes every seed a replacement, so
  // counting only `ingested` measures zero and the report falls to the silent
  // branch even though the page plainly carried a seed.
  const payload = await stringify({ 'h/elided/[1]': 'never-consumed' });
  const first = await withReporter(async () => {
    scanSeeds(root([el('script', payload, 'ok')]));
    takeSeed('h', 'elided', '[99]');
  });
  assert.equal(first.warns.length, 1);
  assert.match(first.warns[0], /1 seed\(s\) on this page/);
  assert.match(first.warns[0], /under DIFFERENT arguments/);

  const second = await withReporter(async () => {
    scanSeeds(root([el('script', payload, 'ok')]));
    takeSeed('h', 'elided', '[99]');
  });
  assert.equal(second.warns.length, 1);
  assert.match(second.warns[0], /1 seed\(s\) on this page/, 'a replacement is still a seed on the page');
  assert.match(second.warns[0], /under DIFFERENT arguments/, 'and the cause must not flip');
});

test('the cause comes from the window\'s OWN marker, not a later scan\'s', async () => {
  // A soft nav CLOSES the window it lands in and opens its own, so the incoming
  // page's marker must not reach the report for the window it did not measure.
  // Before the marker moved into the window, a buffered page's unmatched-key miss
  // was reported as "this page streams" whenever the next page happened to.
  const origIdle = globalThis.requestIdleCallback;
  const origWarn = console.warn;
  const warns = [];
  const queued = [];
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); };
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 1 }), 'ok')]));
    takeSeed('h', 'f', '[2]');
    // A soft nav to a STREAMED page, before the idle callback for page one fires.
    scanSeeds(root([el('script', await stringify({}), 'streamed')]));
    queued.forEach((fn) => fn());
  } finally {
    if (origIdle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = origIdle;
    console.warn = origWarn;
  }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /under DIFFERENT arguments/, 'the buffered page keeps its own cause');
  assert.ok(warns[0].indexOf('This page streams') === -1, 'the later page\'s marker must not leak in');
});

/** Drive scans and calls with the idle callback under test control. */
async function withWindows(body) {
  const origIdle = globalThis.requestIdleCallback;
  const origWarn = console.warn;
  const warns = [];
  const queued = [];
  globalThis.requestIdleCallback = (fn) => { queued.push(fn); };
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    await body();
    queued.forEach((fn) => fn());
  } finally {
    if (origIdle === undefined) delete globalThis.requestIdleCallback;
    else globalThis.requestIdleCallback = origIdle;
    console.warn = origWarn;
  }
  return warns;
}

test('a soft nav BEFORE the idle callback does not lend its seeds to the previous page', async () => {
  // Page A carried NO seeds and took a miss, so it must stay silent (the client
  // cannot prove a defect there). Page B arrives with three seeds before A's
  // callback fires. If A's window stays open across the navigation, B's seeds
  // are counted into it and page A reports a key mismatch it has no evidence of.
  const warns = await withWindows(async () => {
    scanSeeds(root([el('script', await stringify({}), 'ok')]));
    takeSeed('h', 'f', '[1]');
    scanSeeds(root([el('script', await stringify({ 'h/g/[1]': 1, 'h/g/[2]': 2, 'h/g/[3]': 3 }), 'ok')]));
  });
  // Page A carried none, so it is silent. That IS the discriminator: if page B's
  // three seeds leaked into page A's window, `merged` would be 3 and page A
  // would report the unmatched-keys cause for a page that has no evidence of one.
  assert.deepEqual(warns, [], 'page A stays silent rather than borrowing page B\'s seeds');
});

test('a HEALTHY page is not blamed for the next page\'s correct misses', async () => {
  // Page A: one seed, one hit, no defect, so it must stay silent. Page B streams
  // and its two misses are correct and expected. Leaving A's window open across
  // the nav charges them to A, printing a defect line for a page that has none,
  // and B never gets a report of its own.
  const warns = await withWindows(async () => {
    scanSeeds(root([el('script', await stringify({ 'h/f/[1]': 1 }), 'ok')]));
    takeSeed('h', 'f', '[1]');
    scanSeeds(root([el('script', await stringify({}), 'streamed')]));
    takeSeed('h', 'g', '[1]');
    takeSeed('h', 'g', '[2]');
  });
  assert.equal(warns.length, 1, 'page A silent, page B reported: one line, not two and not zero');
  assert.match(warns[0], /2 of 2 action call\(s\) in the hydration window/, 'the line belongs to page B');
  assert.match(warns[0], /This page streams/, 'and names page B\'s own cause');
});
