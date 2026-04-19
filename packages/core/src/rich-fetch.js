import { stringify as sjStringify, parse as sjParse } from 'superjson';

const RPC_CONTENT_TYPE = 'application/vnd.webjs+json';

/**
 * `richFetch(url, init?)` — drop-in `fetch` for calling your own API routes
 * when you want rich types to round-trip (`Date`, `Map`, `Set`, `BigInt`, …).
 *
 * - Adds `Accept: application/vnd.webjs+json` to the request so a
 *   server-side `json(data)` helper encodes with superjson.
 * - If the response content-type matches, decodes with superjson and
 *   returns the rich value.
 * - Otherwise decodes with plain `.json()` (so any route you haven't
 *   opted in on still works).
 * - Request bodies: if `init.body` is a plain object (not string /
 *   FormData / Blob / ArrayBuffer / ReadableStream), it's superjson-
 *   stringified and the request content-type is set to our vendor type.
 *
 * ```js
 * import { richFetch } from '@webjskit/core';
 * const posts = await richFetch('/api/posts');       // Post[]; createdAt is Date
 * await richFetch('/api/posts', {                    // rich body
 *   method: 'POST',
 *   body: { publishAt: new Date(2026, 0, 1) },
 * });
 * ```
 *
 * @template T
 * @param {string | URL} url
 * @param {RequestInit & { body?: any }} [init]
 * @returns {Promise<T>}
 */
export async function richFetch(url, init = {}) {
  const headers = new Headers(init.headers || {});
  if (!headers.has('accept')) headers.set('accept', RPC_CONTENT_TYPE);

  let body = init.body;
  if (
    body != null &&
    typeof body === 'object' &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !(body instanceof URLSearchParams) &&
    !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) &&
    !ArrayBuffer.isView(body)
  ) {
    body = sjStringify(body);
    if (!headers.has('content-type')) headers.set('content-type', RPC_CONTENT_TYPE);
  }

  const res = await fetch(url, { ...init, headers, body });
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  const parsed = ct.includes(RPC_CONTENT_TYPE)
    ? (text ? sjParse(text) : null)
    : ct.includes('application/json')
    ? (text ? JSON.parse(text) : null)
    : text;
  if (!res.ok) {
    const msg = (parsed && parsed.error) || `richFetch ${url} -> ${res.status}`;
    const err = /** @type any */ (new Error(msg));
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}
