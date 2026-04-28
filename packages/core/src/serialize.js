/**
 * webjs serializer — JSON-friendly encoding for rich JS types.
 *
 * Replaces superjson with a pure-ESM, dependency-free implementation
 * tuned to the wire surface that React Server Actions support, plus a
 * couple of webjs-specific niceties.
 *
 * Wire format: tagged-inline. Non-JSON values are wrapped in a small
 * object whose tag key is `_$wj`:
 *
 *   { _$wj: "Date",   v: "2026-04-28T12:00:00.000Z" }
 *   { _$wj: "BigInt", v: "12345678901234567890" }
 *   { _$wj: "Map",    v: [[k, v], ...] }       // recursively encoded
 *   { _$wj: "Set",    v: [...] }
 *   { _$wj: "Error",  v: { name, message, stack } }
 *   { _$wj: "Sym",    v: <Symbol.for key> }
 *   { _$wj: "u8",     v: "<base64>" }          // and i8/u16/i16/u32/i32/u8c/f32/f64/buf/dv
 *   { _$wj: "Blob",   v: "<base64>", t: "<mime>" }
 *   { _$wj: "File",   v: "<base64>", n: "<name>", t: "<mime>", m: <lastModified> }
 *   { _$wj: "FD",     v: [[name, encoded], ...] }    // FormData
 *   { _$wj: "undef" } | "NaN" | "Inf" | "-Inf" | "-0"
 *   { _$wj: "Ref",    v: <id> }                // back-reference for cycles / shared refs
 *
 * A container value (object/array/Map/Set) that participates in a
 * cycle or appears more than once gets an `_id` field so refs can
 * back-point to it.
 *
 * Plain-object keys that look like reserved markers (`_$wj`, `__$wj`,
 * `_id`, `__id`, …) are escaped on encode by adding a leading
 * underscore; decode strips one. This makes the format collision-safe
 * for arbitrary user data.
 *
 * ## Public API
 *
 *   stringify(v)        async — JSON.stringify(serialize(v))
 *   serialize(v)        async — produces JSON-safe value
 *
 *   parse(s)            sync  — deserialize(JSON.parse(s))
 *   deserialize(v)      sync  — inverse of serialize
 *
 * The serializer is async because Blob / File / FormData require
 * `await blob.arrayBuffer()` to read their bytes. For payloads that
 * don't include any binary types the cost is just a single Promise
 * tick (microseconds). Single async function keeps the API obvious —
 * AI agents can't pick the wrong variant.
 *
 * (Built-in `JSON.stringify` / `JSON.parse` are unaffected and remain
 * available for plain-JSON use cases.)
 */

const TAG = '_$wj';
const ID_KEY = '_id';

/* ----------------------------------------------------------------- *
 * Public API                                                        *
 * ----------------------------------------------------------------- */

/**
 * Serialize `value` to a JSON string. Async to support Blob / File /
 * FormData (which require `await arrayBuffer()` to read their bytes).
 *
 * @param {unknown} value
 * @returns {Promise<string>}
 */
export async function stringify(value) {
  return JSON.stringify(await serialize(value));
}

/**
 * Inverse of `stringify`. Synchronous — no async types need awaiting
 * during decode (binary is already inlined as base64).
 *
 * @param {string} text
 * @returns {unknown}
 */
export function parse(text) {
  return deserialize(JSON.parse(text));
}

/**
 * Serialize `value` to a JSON-safe shape (plain JSON values + tagged
 * marker objects for rich types). Use `stringify` if you also need
 * the JSON string.
 *
 * @param {unknown} value
 * @returns {Promise<unknown>}
 */
export async function serialize(value) {
  const ctx = newEncodeCtx();
  await countRefs(value, ctx);
  return encodeOne(value, ctx);
}

/**
 * Inverse of `serialize`. Synchronous.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
export function deserialize(value) {
  return decode(value, newDecodeCtx());
}

/* ----------------------------------------------------------------- *
 * Encode                                                            *
 * ----------------------------------------------------------------- */

function newEncodeCtx() {
  return {
    refCount: new Map(),  // obj → number of references
    idOf: new Map(),      // obj → assigned id (only for multi-ref)
    emitted: new Set(),   // ids already emitted as the canonical encoding
    nextId: 0,
    blobBytes: new Map(), // Blob → Uint8Array (precomputed during countRefs)
  };
}

/**
 * Pass 1: walk the value, count references, pre-read Blob/File bytes.
 * Async because `Blob.arrayBuffer()` is async. Iterative (uses an
 * explicit stack) to avoid recursion limits on deeply nested values.
 */
async function countRefs(value, ctx) {
  const stack = [value];
  while (stack.length) {
    const v = stack.pop();
    if (!isCountableObject(v)) continue;
    const cur = ctx.refCount.get(v) || 0;
    ctx.refCount.set(v, cur + 1);
    if (cur > 0) continue;  // already traversed children
    if (typeof Blob !== 'undefined' && v instanceof Blob) {
      const buf = new Uint8Array(await v.arrayBuffer());
      ctx.blobBytes.set(v, buf);
      continue;
    }
    if (typeof FormData !== 'undefined' && v instanceof FormData) {
      for (const [, val] of v.entries()) {
        if (typeof val !== 'string') stack.push(val);
      }
      continue;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) stack.push(v[i]);
    } else if (v instanceof Map) {
      for (const [k, val] of v) { stack.push(k); stack.push(val); }
    } else if (v instanceof Set) {
      for (const item of v) stack.push(item);
    } else if (isPlainObject(v)) {
      for (const k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) stack.push(v[k]);
      }
    }
  }
  // Assign ids only to objects with multiple refs (cycles or shared refs).
  for (const [obj, count] of ctx.refCount) {
    if (count > 1) ctx.idOf.set(obj, ctx.nextId++);
  }
}

function encodeOne(v, ctx) {
  // Primitives + sentinel-tagged values
  if (v === null) return null;
  if (v === undefined) return { [TAG]: 'undef' };
  const t = typeof v;
  if (t === 'string' || t === 'boolean') return v;
  if (t === 'number') {
    if (Number.isNaN(v)) return { [TAG]: 'NaN' };
    if (v === Infinity) return { [TAG]: 'Inf' };
    if (v === -Infinity) return { [TAG]: '-Inf' };
    if (Object.is(v, -0)) return { [TAG]: '-0' };
    return v;
  }
  if (t === 'bigint') return { [TAG]: 'BigInt', v: v.toString() };
  if (t === 'symbol') {
    const k = Symbol.keyFor(v);
    if (k === undefined) {
      throw new TypeError('Cannot serialize a local Symbol; only Symbol.for() registered symbols are supported.');
    }
    return { [TAG]: 'Sym', v: k };
  }
  if (t === 'function') {
    throw new TypeError('Cannot serialize a function.');
  }

  // Object types — first check for repeat reference
  const id = ctx.idOf.get(v);
  if (id !== undefined && ctx.emitted.has(id)) {
    return { [TAG]: 'Ref', v: id };
  }
  if (id !== undefined) ctx.emitted.add(id);

  // Containers + tagged leaf values
  let out;
  if (v instanceof Date) {
    out = { [TAG]: 'Date', v: Number.isNaN(v.getTime()) ? null : v.toISOString() };
  } else if (v instanceof Error) {
    out = { [TAG]: 'Error', v: { name: v.name, message: v.message, stack: v.stack || null } };
  } else if (typeof Blob !== 'undefined' && v instanceof Blob) {
    const bytes = ctx.blobBytes.get(v);
    if (typeof File !== 'undefined' && v instanceof File) {
      out = { [TAG]: 'File', v: bytesToB64(bytes), n: v.name, t: v.type || '', m: v.lastModified };
    } else {
      out = { [TAG]: 'Blob', v: bytesToB64(bytes), t: v.type || '' };
    }
  } else if (typeof FormData !== 'undefined' && v instanceof FormData) {
    const entries = [];
    for (const [k, val] of v.entries()) entries.push([k, encodeOne(val, ctx)]);
    out = { [TAG]: 'FD', v: entries };
  } else if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) {
    out = encodeBinary(v);
  } else if (v instanceof Map) {
    const entries = [];
    for (const [k, val] of v) entries.push([encodeOne(k, ctx), encodeOne(val, ctx)]);
    out = { [TAG]: 'Map', v: entries };
  } else if (v instanceof Set) {
    const items = [];
    for (const item of v) items.push(encodeOne(item, ctx));
    out = { [TAG]: 'Set', v: items };
  } else if (Array.isArray(v)) {
    out = v.map((item) => encodeOne(item, ctx));
  } else {
    // Plain object (or class instance — degrades to plain object,
    // matching React's behavior).
    out = {};
    for (const k in v) {
      if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
      const escaped = isReservedKey(k) ? '_' + k : k;
      out[escaped] = encodeOne(v[k], ctx);
    }
  }

  if (id !== undefined) {
    if (Array.isArray(out)) {
      // Arrays can't carry ids inline; wrap in a tagged container.
      return { [TAG]: 'Arr', [ID_KEY]: id, v: out };
    }
    out[ID_KEY] = id;
  }
  return out;
}

/** Encode a typed array / ArrayBuffer / DataView as a tagged base64 value. */
function encodeBinary(v) {
  if (v instanceof ArrayBuffer) {
    return { [TAG]: 'buf', v: bytesToB64(new Uint8Array(v)) };
  }
  if (v instanceof DataView) {
    return { [TAG]: 'dv', v: bytesToB64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  }
  // Typed array
  const ctor = v.constructor.name;
  const tag = TYPED_ARRAY_TAG[ctor];
  if (!tag) {
    throw new TypeError(`Unsupported typed array: ${ctor}`);
  }
  const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return { [TAG]: tag, v: bytesToB64(u8) };
}

const TYPED_ARRAY_TAG = {
  Int8Array: 'i8',
  Uint8Array: 'u8',
  Uint8ClampedArray: 'u8c',
  Int16Array: 'i16',
  Uint16Array: 'u16',
  Int32Array: 'i32',
  Uint32Array: 'u32',
  Float32Array: 'f32',
  Float64Array: 'f64',
  BigInt64Array: 'bi64',
  BigUint64Array: 'bu64',
};

const TAG_TO_TYPED_ARRAY = {
  i8: Int8Array,
  u8: Uint8Array,
  u8c: Uint8ClampedArray,
  i16: Int16Array,
  u16: Uint16Array,
  i32: Int32Array,
  u32: Uint32Array,
  f32: Float32Array,
  f64: Float64Array,
  bi64: typeof BigInt64Array !== 'undefined' ? BigInt64Array : null,
  bu64: typeof BigUint64Array !== 'undefined' ? BigUint64Array : null,
};

/* ----------------------------------------------------------------- *
 * Decode                                                            *
 * ----------------------------------------------------------------- */

function newDecodeCtx() {
  return {
    refs: new Map(),  // id → object (mutable; populated as we decode)
  };
}

function decode(v, ctx) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) {
    const out = [];
    for (let i = 0; i < v.length; i++) out.push(decode(v[i], ctx));
    return out;
  }
  const tag = v[TAG];
  if (typeof tag === 'string') {
    return decodeTagged(v, tag, ctx);
  }
  // Plain object
  const out = {};
  const id = v[ID_KEY];
  if (typeof id === 'number') ctx.refs.set(id, out);
  for (const k in v) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    if (k === ID_KEY) continue;
    const realKey = isEscapedReservedKey(k) ? k.slice(1) : k;
    out[realKey] = decode(v[k], ctx);
  }
  return out;
}

function decodeTagged(v, tag, ctx) {
  const id = v[ID_KEY];
  switch (tag) {
    case 'undef': return undefined;
    case 'NaN':   return NaN;
    case 'Inf':   return Infinity;
    case '-Inf':  return -Infinity;
    case '-0':    return -0;
    case 'BigInt': return BigInt(v.v);
    case 'Sym':   return Symbol.for(v.v);
    case 'Date':  return v.v == null ? new Date(NaN) : new Date(v.v);
    case 'Error': {
      const e = new Error(v.v.message);
      e.name = v.v.name;
      if (v.v.stack) e.stack = v.v.stack;
      if (typeof id === 'number') ctx.refs.set(id, e);
      return e;
    }
    case 'Map': {
      const m = new Map();
      if (typeof id === 'number') ctx.refs.set(id, m);
      for (const [k, val] of v.v) m.set(decode(k, ctx), decode(val, ctx));
      return m;
    }
    case 'Set': {
      const s = new Set();
      if (typeof id === 'number') ctx.refs.set(id, s);
      for (const item of v.v) s.add(decode(item, ctx));
      return s;
    }
    case 'Arr': {
      const arr = [];
      if (typeof id === 'number') ctx.refs.set(id, arr);
      for (const item of v.v) arr.push(decode(item, ctx));
      return arr;
    }
    case 'Ref': {
      const ref = ctx.refs.get(v.v);
      if (ref === undefined) {
        throw new TypeError(`Dangling reference: id=${v.v}`);
      }
      return ref;
    }
    case 'Blob': {
      if (typeof Blob === 'undefined') throw new TypeError('Blob is not available in this environment.');
      const bytes = b64ToBytes(v.v);
      return new Blob([bytes], { type: v.t || '' });
    }
    case 'File': {
      if (typeof File === 'undefined') throw new TypeError('File is not available in this environment.');
      const bytes = b64ToBytes(v.v);
      return new File([bytes], v.n, { type: v.t || '', lastModified: v.m });
    }
    case 'FD': {
      if (typeof FormData === 'undefined') throw new TypeError('FormData is not available in this environment.');
      const fd = new FormData();
      for (const [k, val] of v.v) {
        const decoded = decode(val, ctx);
        fd.append(k, decoded);
      }
      return fd;
    }
    default: {
      // Typed arrays + binary buffers
      if (tag === 'buf') {
        const bytes = b64ToBytes(v.v);
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      if (tag === 'dv') {
        const bytes = b64ToBytes(v.v);
        return new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      }
      const Ctor = TAG_TO_TYPED_ARRAY[tag];
      if (Ctor) {
        const bytes = b64ToBytes(v.v);
        const sliced = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        return new Ctor(sliced);
      }
      throw new TypeError(`Unknown serialization tag: ${tag}`);
    }
  }
}

/* ----------------------------------------------------------------- *
 * Helpers                                                           *
 * ----------------------------------------------------------------- */

function isCountableObject(v) {
  // Returns true for any object that countRefs should visit. Includes
  // Blob/FormData (so countRefs can pre-read their bytes via async
  // arrayBuffer) and the leaf typed values (Date/Error/typed arrays /
  // ArrayBuffer / DataView), which countRefs records but doesn't
  // traverse into.
  return v !== null && typeof v === 'object';
}

function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
}

/** A user-supplied object key that would collide with our marker syntax. */
function isReservedKey(k) {
  return /^_+\$wj$/.test(k) || /^_+id$/.test(k);
}

/** A key on the wire that was escaped because it would have been reserved. */
function isEscapedReservedKey(k) {
  return /^__+\$wj$/.test(k) || /^__+id$/.test(k);
}

const _hasBuffer = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

function bytesToB64(u8) {
  if (_hasBuffer) return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64ToBytes(b64) {
  if (_hasBuffer) {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
