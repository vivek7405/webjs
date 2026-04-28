/**
 * Tests for the webjs serializer (`packages/core/src/serialize.js`).
 *
 * Covers the full wire surface: leaf typed values, special numbers,
 * cycles + shared refs, typed arrays / ArrayBuffer / DataView, registered
 * symbols, plain-object key escaping, and binary types
 * (Blob / File / FormData).
 *
 * The serializer's public API is `stringify` (async) + `parse` (sync).
 * `serialize` (async) returns the JSON-safe value before stringifying;
 * `deserialize` (sync) inverts it.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  stringify, parse, serialize, deserialize,
} from '../packages/core/src/serialize.js';

// Round-trip helper.
const roundTrip = async (v) => parse(await stringify(v));

describe('serialize: primitives + plain values', () => {
  test('null / true / false / strings / finite numbers', async () => {
    for (const v of [null, true, false, '', 'hello', 0, 1, -1, 3.14, 1e20]) {
      assert.equal(await roundTrip(v), v);
    }
  });

  test('plain objects + arrays', async () => {
    const v = { a: 1, b: [1, 2, { c: 'x' }], d: null };
    assert.deepEqual(await roundTrip(v), v);
  });

  test('nested objects round-trip', async () => {
    const v = { x: { y: { z: { w: 42 } } } };
    assert.deepEqual(await roundTrip(v), v);
  });
});

describe('serialize: special numbers', () => {
  test('NaN, Infinity, -Infinity round-trip exactly', async () => {
    assert.ok(Number.isNaN(await roundTrip(NaN)));
    assert.equal(await roundTrip(Infinity), Infinity);
    assert.equal(await roundTrip(-Infinity), -Infinity);
  });

  test('-0 preserves sign', async () => {
    const r = await roundTrip(-0);
    assert.ok(Object.is(r, -0));
  });

  test('inside arrays / objects', async () => {
    const v = { a: NaN, b: [Infinity, -Infinity, -0] };
    const r = await roundTrip(v);
    assert.ok(Number.isNaN(r.a));
    assert.equal(r.b[0], Infinity);
    assert.equal(r.b[1], -Infinity);
    assert.ok(Object.is(r.b[2], -0));
  });
});

describe('serialize: undefined', () => {
  test('top-level undefined', async () => {
    assert.equal(await roundTrip(undefined), undefined);
  });

  test('undefined inside object property', async () => {
    const r = await roundTrip({ a: undefined, b: 1 });
    assert.deepEqual(Object.keys(r), ['a', 'b']);
    assert.equal(r.a, undefined);
    assert.equal(r.b, 1);
  });

  test('undefined inside array (preserves position)', async () => {
    const r = await roundTrip([1, undefined, 3]);
    assert.equal(r.length, 3);
    assert.equal(r[0], 1);
    assert.equal(r[1], undefined);
    assert.equal(r[2], 3);
  });
});

describe('serialize: BigInt', () => {
  test('round-trips small and large bigints', async () => {
    for (const v of [0n, 1n, -1n, 12345678901234567890n, -12345678901234567890n]) {
      const r = await roundTrip(v);
      assert.equal(typeof r, 'bigint');
      assert.equal(r, v);
    }
  });
});

describe('serialize: Date', () => {
  test('round-trips a valid date', async () => {
    const v = new Date('2026-04-28T12:34:56.789Z');
    const r = await roundTrip(v);
    assert.ok(r instanceof Date);
    assert.equal(r.getTime(), v.getTime());
  });

  test('round-trips an invalid date', async () => {
    const v = new Date(NaN);
    const r = await roundTrip(v);
    assert.ok(r instanceof Date);
    assert.ok(Number.isNaN(r.getTime()));
  });
});

describe('serialize: Map', () => {
  test('Map<string, number>', async () => {
    const m = new Map([['a', 1], ['b', 2]]);
    const r = await roundTrip(m);
    assert.ok(r instanceof Map);
    assert.equal(r.get('a'), 1);
    assert.equal(r.get('b'), 2);
  });

  test('Map with non-primitive keys/values (rich types)', async () => {
    const k1 = new Date('2020-01-01T00:00:00Z');
    const k2 = { id: 1n };
    const v1 = new Set([1, 2]);
    const m = new Map([[k1, v1], [k2, 'value2']]);
    const r = await roundTrip(m);
    assert.ok(r instanceof Map);
    const keys = [...r.keys()];
    assert.equal(keys.length, 2);
    assert.ok(keys[0] instanceof Date && keys[0].getTime() === k1.getTime());
    assert.equal(typeof keys[1].id, 'bigint');
    assert.equal(keys[1].id, 1n);
    const vals = [...r.values()];
    assert.ok(vals[0] instanceof Set);
    assert.deepEqual([...vals[0]], [1, 2]);
    assert.equal(vals[1], 'value2');
  });
});

describe('serialize: Set', () => {
  test('Set<primitive>', async () => {
    const s = new Set([1, 2, 3, 'x']);
    const r = await roundTrip(s);
    assert.ok(r instanceof Set);
    assert.equal(r.size, 4);
    assert.deepEqual([...r], [1, 2, 3, 'x']);
  });

  test('Set with rich items', async () => {
    const s = new Set([new Date('2020-01-01T00:00:00Z'), 1n, undefined]);
    const r = await roundTrip(s);
    assert.ok(r instanceof Set);
    assert.equal(r.size, 3);
  });
});

describe('serialize: Error', () => {
  test('round-trips name + message + stack', async () => {
    const e = new TypeError('boom');
    const r = await roundTrip(e);
    assert.ok(r instanceof Error);
    assert.equal(r.name, 'TypeError');
    assert.equal(r.message, 'boom');
  });
});

describe('serialize: registered Symbols', () => {
  test('Symbol.for() round-trips', async () => {
    const s = Symbol.for('webjs/test/sym');
    const r = await roundTrip(s);
    assert.equal(typeof r, 'symbol');
    assert.equal(r, s);
  });

  test('local Symbol throws a clear error', async () => {
    const s = Symbol('local');
    await assert.rejects(stringify(s), /local Symbol/);
  });
});

describe('serialize: cycles + shared refs', () => {
  test('self-referential object', async () => {
    const o = { name: 'a' };
    o.self = o;
    const r = await roundTrip(o);
    assert.equal(r.name, 'a');
    assert.equal(r.self, r);
  });

  test('shared reference (same object referenced twice)', async () => {
    const shared = { label: 'shared' };
    const v = { a: shared, b: shared };
    const r = await roundTrip(v);
    assert.equal(r.a.label, 'shared');
    assert.equal(r.a, r.b);
  });

  test('Map referencing itself as a value', async () => {
    const m = new Map();
    m.set('self', m);
    const r = await roundTrip(m);
    assert.ok(r instanceof Map);
    assert.equal(r.get('self'), r);
  });

  test('array referencing itself', async () => {
    /** @type {any[]} */
    const a = [1, 2];
    a.push(a);
    const r = await roundTrip(a);
    assert.equal(r[0], 1);
    assert.equal(r[1], 2);
    assert.equal(r[2], r);
  });
});

describe('serialize: typed arrays + binary', () => {
  test('Uint8Array round-trips with same bytes', async () => {
    const a = new Uint8Array([1, 2, 3, 255]);
    const r = await roundTrip(a);
    assert.ok(r instanceof Uint8Array);
    assert.deepEqual([...r], [1, 2, 3, 255]);
  });

  test('Float32Array preserves values', async () => {
    const a = new Float32Array([1.5, -2.5, 3.14]);
    const r = await roundTrip(a);
    assert.ok(r instanceof Float32Array);
    assert.equal(r.length, 3);
    assert.ok(Math.abs(r[0] - 1.5) < 1e-6);
    assert.ok(Math.abs(r[1] - -2.5) < 1e-6);
  });

  test('ArrayBuffer round-trips', async () => {
    const buf = new ArrayBuffer(4);
    new Uint8Array(buf).set([10, 20, 30, 40]);
    const r = await roundTrip(buf);
    assert.ok(r instanceof ArrayBuffer);
    assert.deepEqual([...new Uint8Array(r)], [10, 20, 30, 40]);
  });

  test('DataView round-trips', async () => {
    const buf = new ArrayBuffer(4);
    const dv = new DataView(buf);
    dv.setUint32(0, 0xdeadbeef);
    const r = await roundTrip(dv);
    assert.ok(r instanceof DataView);
    assert.equal(r.getUint32(0), 0xdeadbeef);
  });
});

describe('serialize: object key collision protection', () => {
  test('user object with `_$wj` key passes through safely', async () => {
    const v = { _$wj: 'just a string' };
    const r = await roundTrip(v);
    assert.deepEqual(r, v);
  });

  test('user object with `_id` key is preserved', async () => {
    const v = { _id: 'user-id-not-our-id' };
    const r = await roundTrip(v);
    assert.deepEqual(r, v);
  });

  test('escaped marker keys round-trip when nested', async () => {
    const v = { a: { _$wj: 'tricky', _id: 'also-tricky' }, b: 1 };
    const r = await roundTrip(v);
    assert.deepEqual(r, v);
  });
});

describe('serialize: unsupported types throw', () => {
  test('functions throw', async () => {
    await assert.rejects(stringify(() => {}), /function/);
  });
});

describe('serialize: binary types (Blob / File / FormData)', () => {
  test('Blob round-trips with same bytes + type', async () => {
    if (typeof Blob === 'undefined') return;
    const b = new Blob([new Uint8Array([1, 2, 3, 255])], { type: 'application/octet-stream' });
    const r = await roundTrip(b);
    assert.ok(r instanceof Blob);
    assert.equal(r.type, 'application/octet-stream');
    const bytes = new Uint8Array(await r.arrayBuffer());
    assert.deepEqual([...bytes], [1, 2, 3, 255]);
  });

  test('File round-trips with name + lastModified', async () => {
    if (typeof File === 'undefined') return;
    const f = new File([new Uint8Array([42])], 'test.bin', { type: 'application/octet-stream', lastModified: 1700000000000 });
    const r = await roundTrip(f);
    assert.ok(r instanceof File);
    assert.equal(r.name, 'test.bin');
    assert.equal(r.type, 'application/octet-stream');
    assert.equal(r.lastModified, 1700000000000);
  });

  test('FormData round-trips with mixed string + Blob entries', async () => {
    if (typeof FormData === 'undefined' || typeof Blob === 'undefined') return;
    const fd = new FormData();
    fd.append('name', 'Alice');
    fd.append('avatar', new Blob([new Uint8Array([1, 2])], { type: 'image/png' }));
    const r = await roundTrip(fd);
    assert.ok(r instanceof FormData);
    assert.equal(r.get('name'), 'Alice');
    const av = r.get('avatar');
    assert.ok(av instanceof Blob || av instanceof File);
    const bytes = new Uint8Array(await av.arrayBuffer());
    assert.deepEqual([...bytes], [1, 2]);
  });

  test('plain (non-binary) values still work through the same API', async () => {
    const v = { a: 1, b: new Date('2020-01-01T00:00:00Z'), c: 1n };
    const r = await roundTrip(v);
    assert.equal(r.a, 1);
    assert.ok(r.b instanceof Date);
    assert.equal(r.c, 1n);
  });
});

describe('serialize: realistic mixed payload', () => {
  test('a server-action-shaped object round-trips with rich types', async () => {
    const v = {
      id: 1n,
      createdAt: new Date('2026-04-28T00:00:00Z'),
      tags: new Set(['a', 'b']),
      metadata: new Map([['version', 1], ['author', 'alice']]),
      flags: { active: true, deletedAt: undefined },
      counts: [1, NaN, Infinity, -0],
    };
    const r = await roundTrip(v);
    assert.equal(r.id, 1n);
    assert.ok(r.createdAt instanceof Date);
    assert.deepEqual([...r.tags], ['a', 'b']);
    assert.equal(r.metadata.get('version'), 1);
    assert.equal(r.metadata.get('author'), 'alice');
    assert.equal(r.flags.active, true);
    assert.ok('deletedAt' in r.flags);
    assert.equal(r.flags.deletedAt, undefined);
    assert.equal(r.counts[0], 1);
    assert.ok(Number.isNaN(r.counts[1]));
    assert.equal(r.counts[2], Infinity);
    assert.ok(Object.is(r.counts[3], -0));
  });
});

describe('serialize: serialize/deserialize bypass JSON.stringify', () => {
  test('serialize returns a JSON-safe object', async () => {
    const out = await serialize({ d: new Date('2020-01-01T00:00:00Z'), n: 1n });
    const text = JSON.stringify(out);
    const back = deserialize(JSON.parse(text));
    assert.ok(back.d instanceof Date);
    assert.equal(back.n, 1n);
  });
});
