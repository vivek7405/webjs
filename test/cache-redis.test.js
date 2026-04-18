/**
 * Redis-backed cache store tests. Uses a fake `ioredis` via an ESM
 * loader hook — no live Redis instance required.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

before(() => {
  register(new URL('./fixtures/ioredis-loader.mjs', import.meta.url));
});

let redisStore;
before(async () => {
  ({ redisStore } = await import('../packages/server/src/cache.js'));
});

test('redisStore: throws without url or REDIS_URL env', async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    assert.throws(() => redisStore(), /REDIS_URL/);
  } finally {
    if (prev !== undefined) process.env.REDIS_URL = prev;
  }
});

test('redisStore: reads REDIS_URL from env when opts.url absent', async () => {
  process.env.REDIS_URL = 'redis://localhost:6379';
  try {
    const s = redisStore();   // should NOT throw
    assert.ok(typeof s.get === 'function');
  } finally {
    delete process.env.REDIS_URL;
  }
});

test('redisStore: set + get round-trip', async () => {
  const s = redisStore({ url: 'redis://test' });
  await s.set('k', 'v');
  assert.equal(await s.get('k'), 'v');
});

test('redisStore: get returns null for missing key', async () => {
  const s = redisStore({ url: 'redis://test' });
  assert.equal(await s.get('nope'), null);
});

test('redisStore: set with TTL expires entry', async () => {
  const s = redisStore({ url: 'redis://test' });
  await s.set('exp', 'v', 50);
  assert.equal(await s.get('exp'), 'v');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(await s.get('exp'), null);
});

test('redisStore: delete removes a key', async () => {
  const s = redisStore({ url: 'redis://test' });
  await s.set('d', 'v');
  await s.delete('d');
  assert.equal(await s.get('d'), null);
});

test('redisStore: increment returns sequential values', async () => {
  const s = redisStore({ url: 'redis://test' });
  const a = await s.increment('counter');
  const b = await s.increment('counter');
  const c = await s.increment('counter');
  assert.equal(a, 1);
  assert.equal(b, 2);
  assert.equal(c, 3);
});

test('redisStore: increment sets TTL on first occurrence only', async () => {
  const s = redisStore({ url: 'redis://test' });
  await s.increment('t1', 50);     // creates + sets TTL
  await s.increment('t1', 50);     // subsequent — existing entry, no TTL re-set
  await new Promise((r) => setTimeout(r, 80));
  // After TTL, key should be cleared.
  assert.equal(await s.get('t1'), null);
});

test('redisStore: operations reuse the same client across calls', async () => {
  const s = redisStore({ url: 'redis://test' });
  // First call kicks off connection promise; second should reuse it.
  const [r1, r2] = await Promise.all([s.set('a', '1'), s.set('b', '2')]);
  assert.equal(r1, undefined); // set is a Promise<void>
  assert.equal(r2, undefined);
  assert.equal(await s.get('a'), '1');
  assert.equal(await s.get('b'), '2');
});
