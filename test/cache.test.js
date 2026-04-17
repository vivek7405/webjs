import { test } from 'node:test';
import assert from 'node:assert/strict';

import { memoryStore, getStore, setStore } from '../packages/server/src/cache.js';

test('memoryStore get returns null for missing key', async () => {
  const store = memoryStore();
  assert.equal(await store.get('nope'), null);
});

test('memoryStore set then get round-trips a value', async () => {
  const store = memoryStore();
  await store.set('k', 'v');
  assert.equal(await store.get('k'), 'v');
});

test('memoryStore delete removes a key', async () => {
  const store = memoryStore();
  await store.set('k', 'v');
  await store.delete('k');
  assert.equal(await store.get('k'), null);
});

test('memoryStore increment creates key starting at 1', async () => {
  const store = memoryStore();
  const n = await store.increment('counter');
  assert.equal(n, 1);
  assert.equal(await store.get('counter'), '1');
});

test('memoryStore increment increases existing key', async () => {
  const store = memoryStore();
  await store.increment('c');
  await store.increment('c');
  const n = await store.increment('c');
  assert.equal(n, 3);
});

test('memoryStore TTL expiry returns null after expiry', async () => {
  const store = memoryStore();
  await store.set('tmp', 'val', 1); // 1ms TTL
  // Wait for expiry
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(await store.get('tmp'), null);
});

test('memoryStore increment resets expired key', async () => {
  const store = memoryStore();
  await store.increment('c', 1); // 1ms TTL
  await new Promise((r) => setTimeout(r, 10));
  const n = await store.increment('c');
  assert.equal(n, 1);
});

test('memoryStore LRU eviction removes oldest entry', async () => {
  const store = memoryStore({ maxSize: 3 });
  await store.set('a', '1');
  await store.set('b', '2');
  await store.set('c', '3');
  // Adding a 4th should evict 'a' (oldest)
  await store.set('d', '4');
  assert.equal(await store.get('a'), null);
  assert.equal(await store.get('b'), '2');
  assert.equal(await store.get('d'), '4');
});

test('memoryStore get refreshes LRU order', async () => {
  const store = memoryStore({ maxSize: 3 });
  await store.set('a', '1');
  await store.set('b', '2');
  await store.set('c', '3');
  // Touch 'a' so it becomes most recently used
  await store.get('a');
  // Adding 'd' should now evict 'b' (oldest after refresh)
  await store.set('d', '4');
  assert.equal(await store.get('a'), '1');
  assert.equal(await store.get('b'), null);
});

test('getStore returns a memoryStore by default', async () => {
  // Reset to default by setting null-ish — we test via API
  const store = getStore();
  await store.set('test-key', 'hello');
  assert.equal(await store.get('test-key'), 'hello');
});

test('setStore swaps the default store', async () => {
  const custom = memoryStore();
  await custom.set('custom', 'yes');
  setStore(custom);
  assert.equal(await getStore().get('custom'), 'yes');
  // Restore default
  setStore(memoryStore());
});
