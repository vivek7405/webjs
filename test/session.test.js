import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Session,
  cookieSessionStorage,
  storeSessionStorage,
} from '../packages/server/src/session.js';
import { memoryStore } from '../packages/server/src/cache.js';

// ---------------------------------------------------------------------------
// Session class
// ---------------------------------------------------------------------------

test('Session get/set/has round-trip', () => {
  const s = new Session();
  assert.equal(s.has('name'), false);
  s.set('name', 'Alice');
  assert.equal(s.get('name'), 'Alice');
  assert.equal(s.has('name'), true);
});

test('Session unset removes a key', () => {
  const s = new Session();
  s.set('a', 1);
  s.unset('a');
  assert.equal(s.has('a'), false);
  assert.equal(s.get('a'), undefined);
});

test('Session flash value is readable', () => {
  const s = new Session();
  s.flash('msg', 'hello');
  assert.equal(s.get('msg'), 'hello');
  assert.equal(s.has('msg'), true);
});

test('Session dirty tracking', () => {
  const s = new Session();
  assert.equal(s.dirty, false);
  s.set('x', 1);
  assert.equal(s.dirty, true);
});

test('Session destroy clears data and marks destroyed', () => {
  const s = new Session();
  s.set('a', 1);
  s.destroy();
  assert.equal(s.destroyed, true);
  assert.equal(s.get('a'), undefined);
  assert.equal(s.has('a'), false);
});

test('Session set throws after destroy', () => {
  const s = new Session();
  s.destroy();
  assert.throws(() => s.set('a', 1), /destroyed/);
});

test('Session regenerateId changes id and marks dirty', () => {
  const s = new Session();
  const oldId = s.id;
  s.regenerateId();
  assert.notEqual(s.id, oldId);
  assert.equal(s.dirty, true);
});

test('Session regenerateId with deleteOld records old id', () => {
  const s = new Session('old-id');
  s.regenerateId(true);
  assert.equal(s.deleteId, 'old-id');
  assert.notEqual(s.id, 'old-id');
});

test('Session constructor restores initial data and flash', () => {
  const s = new Session('sid', { data: { a: 1 }, flash: { m: 'hi' } });
  assert.equal(s.id, 'sid');
  assert.equal(s.get('a'), 1);
  assert.equal(s.get('m'), 'hi');
});

// ---------------------------------------------------------------------------
// cookieSessionStorage
// ---------------------------------------------------------------------------

test('cookieSessionStorage read/save round-trip', async () => {
  const storage = cookieSessionStorage();

  // New session
  const s = await storage.read(null);
  s.set('userId', 42);
  const cookie = await storage.save(s);
  assert.equal(typeof cookie, 'string');

  // Restore session
  const s2 = await storage.read(cookie);
  assert.equal(s2.get('userId'), 42);
});

test('cookieSessionStorage save returns null when not dirty', async () => {
  const storage = cookieSessionStorage();
  const cookie = JSON.stringify({ id: 'x', data: { a: 1 }, flash: {} });
  const s = await storage.read(cookie);
  // Read existing data without modifying => no flash, so not dirty
  // Actually flash size > 0 marks dirty, but empty flash won't.
  // We need a session that truly isn't dirty: read with no flash.
  const s2 = await storage.read(JSON.stringify({ id: 'y', data: { a: 1 }, flash: {} }));
  assert.equal(await storage.save(s2), null);
});

test('cookieSessionStorage save returns empty string on destroy', async () => {
  const storage = cookieSessionStorage();
  const s = await storage.read(null);
  s.set('a', 1);
  s.destroy();
  assert.equal(await storage.save(s), '');
});

// ---------------------------------------------------------------------------
// storeSessionStorage
// ---------------------------------------------------------------------------

test('storeSessionStorage read/save round-trip with mock store', async () => {
  const store = memoryStore();
  const storage = storeSessionStorage({ store });

  const s = await storage.read(null);
  s.set('role', 'admin');
  const cookie = await storage.save(s);
  assert.equal(typeof cookie, 'string');

  // Restore
  const s2 = await storage.read(cookie);
  assert.equal(s2.get('role'), 'admin');
});

test('storeSessionStorage returns empty string on destroy', async () => {
  const store = memoryStore();
  const storage = storeSessionStorage({ store });

  const s = await storage.read(null);
  s.set('a', 1);
  const cookie = await storage.save(s);

  const s2 = await storage.read(cookie);
  s2.destroy();
  assert.equal(await storage.save(s2), '');
  // Data should be cleared from store
  assert.equal(await store.get(`session:${cookie}`), null);
});

test('storeSessionStorage save returns null when not dirty', async () => {
  const store = memoryStore();
  const storage = storeSessionStorage({ store });

  // Pre-populate store
  const sid = 'existing-sid';
  await store.set(`session:${sid}`, JSON.stringify({ data: { x: 1 }, flash: {} }));
  const s = await storage.read(sid);
  assert.equal(await storage.save(s), null);
});
