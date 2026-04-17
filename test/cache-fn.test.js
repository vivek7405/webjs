import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cache } from '../packages/server/src/cache-fn.js';
import { setStore, memoryStore } from '../packages/server/src/cache.js';

// Use a fresh store for each test file run
setStore(memoryStore());

test('cache returns cached result on second call', async () => {
  let calls = 0;
  const fn = cache(async () => { calls++; return { n: 42 }; }, { key: 'test-a', ttl: 60 });
  const r1 = await fn();
  const r2 = await fn();
  assert.deepEqual(r1, { n: 42 });
  assert.deepEqual(r2, { n: 42 });
  assert.equal(calls, 1);
});

test('cache respects TTL — recomputes after expiry', async () => {
  let calls = 0;
  const fn = cache(async () => ++calls, { key: 'test-ttl', ttl: 0.001 }); // ~1ms
  await fn();
  await new Promise((r) => setTimeout(r, 15));
  const r = await fn();
  assert.equal(calls, 2);
  assert.equal(r, 2);
});

test('cache invalidate clears cache', async () => {
  let calls = 0;
  const fn = cache(async () => ++calls, { key: 'test-inv', ttl: 60 });
  await fn();
  assert.equal(calls, 1);
  await fn.invalidate();
  await fn();
  assert.equal(calls, 2);
});

test('different args produce different cache entries', async () => {
  let calls = 0;
  const fn = cache(async (id) => { calls++; return id; }, { key: 'test-args', ttl: 60 });
  assert.equal(await fn(1), 1);
  assert.equal(await fn(2), 2);
  assert.equal(calls, 2);
  // Cached hits
  assert.equal(await fn(1), 1);
  assert.equal(calls, 2);
});
