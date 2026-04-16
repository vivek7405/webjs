import { stringify, parse } from 'superjson';

/**
 * @typedef {Object} Serializer
 * A pluggable serializer that controls how webjs server actions encode and
 * decode values on the RPC wire.
 *
 * **AI hint:** The default serializer uses superjson so rich types (Date,
 * Map, Set, BigInt, etc.) survive the client/server round-trip. To swap in
 * a different wire format (e.g. devalue, plain JSON, msgpack), call
 * `setSerializer()` with an object that implements `serialize`,
 * `deserialize`, and `contentType`.
 *
 * @property {(value: unknown) => string} serialize
 *   Encode a value to a string suitable for an HTTP response body.
 * @property {(str: string) => unknown} deserialize
 *   Decode a string produced by `serialize` back to the original value.
 * @property {string} contentType
 *   The MIME content-type header value to use for RPC responses.
 */

/**
 * Default serializer backed by superjson.
 *
 * Handles Date, Map, Set, BigInt, RegExp, undefined, Error, and other
 * types that plain `JSON.stringify` drops or mangles.
 *
 * @type {Serializer}
 */
export const defaultSerializer = {
  serialize(value) {
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
 * or the default superjson serializer if none was set.
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
 * must implement `serialize(value) => string`,
 * `deserialize(str) => unknown`, and expose a `contentType` string.
 *
 * ```js
 * import { setSerializer } from '@webjs/server';
 *
 * setSerializer({
 *   serialize: JSON.stringify,
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
