import { stringify, parse } from '@webjskit/core';

/**
 * @typedef {Object} Serializer
 * A pluggable serializer that controls how webjs server actions encode and
 * decode values on the RPC wire.
 *
 * **AI hint:** The default serializer uses webjs's built-in
 * (`@webjskit/core` `stringify` / `parse`) so rich types — Date, Map, Set,
 * BigInt, TypedArrays, Blob/File/FormData, cycles — survive the
 * client/server round-trip. To swap in a different wire format (e.g.
 * plain JSON, msgpack), call `setSerializer()` with an object that
 * implements `serialize`, `deserialize`, and `contentType`.
 *
 * @property {(value: unknown) => Promise<string>} serialize
 *   Encode a value to a string suitable for an HTTP response body.
 *   Async to support binary types (Blob/File/FormData) which require
 *   an `await arrayBuffer()` step.
 * @property {(str: string) => unknown} deserialize
 *   Decode a string produced by `serialize` back to the original value.
 *   Sync — binary is already inlined as base64 in the wire format.
 * @property {string} contentType
 *   The MIME content-type header value to use for RPC responses.
 */

/**
 * Default serializer backed by webjs's built-in `stringify` / `parse`.
 *
 * Handles Date, Map, Set, BigInt, TypedArrays, ArrayBuffer, DataView,
 * Blob, File, FormData, registered Symbols, undefined, NaN/Infinity/-0,
 * Error, and cycles / shared references.
 *
 * @type {Serializer}
 */
export const defaultSerializer = {
  async serialize(value) {
    return stringify(value);
  },
  deserialize(str) {
    return parse(str);
  },
  contentType: 'application/vnd.webjs+json',
};

/** @type {Serializer} */
let current = defaultSerializer;

/**
 * Return the active serializer.
 *
 * **AI hint:** Use this in server-side code that needs to encode or decode
 * RPC payloads. It returns whatever serializer was set via `setSerializer`,
 * or the default webjs serializer if none was set.
 *
 * @returns {Serializer}
 */
export function getSerializer() {
  return current;
}

/**
 * Replace the active serializer with a custom implementation.
 *
 * **AI hint:** Call this at application startup (before any requests are
 * handled) to swap the wire format for server actions. The serializer
 * must implement `serialize(value) => Promise<string>`,
 * `deserialize(str) => unknown`, and expose a `contentType` string.
 *
 * ```js
 * import { setSerializer } from '@webjskit/server';
 *
 * setSerializer({
 *   serialize: async (v) => JSON.stringify(v),
 *   deserialize: JSON.parse,
 *   contentType: 'application/json',
 * });
 * ```
 *
 * @param {Serializer} serializer
 */
export function setSerializer(serializer) {
  if (!serializer || typeof serializer.serialize !== 'function' || typeof serializer.deserialize !== 'function') {
    throw new Error('setSerializer: serializer must have serialize() and deserialize() methods');
  }
  current = serializer;
}
