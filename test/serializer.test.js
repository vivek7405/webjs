import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultSerializer,
  getSerializer,
  setSerializer,
} from '../packages/server/src/serializer.js';

test('defaultSerializer round-trips plain objects', () => {
  const obj = { a: 1, b: 'hello', c: [1, 2, 3] };
  const str = defaultSerializer.serialize(obj);
  const out = defaultSerializer.deserialize(str);
  assert.deepEqual(out, obj);
});

test('defaultSerializer round-trips Date objects', () => {
  const d = new Date('2025-01-15T00:00:00.000Z');
  const str = defaultSerializer.serialize(d);
  const out = defaultSerializer.deserialize(str);
  assert.ok(out instanceof Date);
  assert.equal(out.toISOString(), d.toISOString());
});

test('defaultSerializer round-trips Map and Set', () => {
  const m = new Map([['a', 1]]);
  const s = new Set([1, 2, 3]);
  const data = { m, s };
  const str = defaultSerializer.serialize(data);
  const out = defaultSerializer.deserialize(str);
  assert.ok(out.m instanceof Map);
  assert.equal(out.m.get('a'), 1);
  assert.ok(out.s instanceof Set);
  assert.equal(out.s.has(2), true);
});

test('defaultSerializer has expected contentType', () => {
  assert.equal(defaultSerializer.contentType, 'application/vnd.webjs+json');
});

test('getSerializer returns defaultSerializer initially', () => {
  assert.equal(getSerializer(), defaultSerializer);
});

test('setSerializer swaps the active serializer', () => {
  const custom = {
    serialize: JSON.stringify,
    deserialize: JSON.parse,
    contentType: 'application/json',
  };
  setSerializer(custom);
  assert.equal(getSerializer(), custom);
  // Restore
  setSerializer(defaultSerializer);
  assert.equal(getSerializer(), defaultSerializer);
});

test('setSerializer throws on invalid input', () => {
  assert.throws(() => setSerializer(null), /serialize/);
  assert.throws(() => setSerializer({ serialize: 'nope' }), /serialize/);
});
