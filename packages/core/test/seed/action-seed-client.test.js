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

import { takeSeed, scanSeeds, SEED_MISS, __resetSeeds } from '../../src/action-seed-client.js';
import { stringify } from '../../src/serialize.js';

beforeEach(() => __resetSeeds());

/** A fake element exposing the minimal surface scanSeeds touches. */
function el(kind, payload) {
  const attrs = { 'data-webjs-seed': kind === 'seedattr' ? payload : undefined };
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
