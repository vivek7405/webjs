import { stringify as wjStringify, parse as wjParse } from '@webjskit/core';
import { getRequest } from './context.js';
import { RPC_CONTENT_TYPE } from './actions.js';

/**
 * Content-negotiated JSON helper for API routes (`route.js` handlers).
 *
 *   // GET /api/posts
 *   import { json } from '@webjskit/server';
 *   export async function GET() {
 *     return json(await listPosts());   // plain Prisma rows with Date columns
 *   }
 *
 * The helper reads the in-flight Request from the AsyncLocalStorage
 * request context. If the caller sent `Accept: application/vnd.webjs+json`
 * (e.g. via the `richFetch` client helper), the response body is
 * encoded with the webjs serializer so rich types (Date, Map, Set,
 * BigInt, TypedArrays, Blob, File, FormData, cycles) survive. Otherwise
 * the response is plain `application/json`, unchanged behaviour for
 * curl / external consumers.
 *
 * Passing an options object with `{ status, headers }` mirrors
 * `Response.json(data, init)`.
 *
 * @template T
 * @param {T} data
 * @param {ResponseInit} [init]
 * @returns {Promise<Response>} async because the rich path may need to
 *   read bytes from Blob/File/FormData; plain-JSON path resolves
 *   immediately.
 */
export async function json(data, init = {}) {
  const req = getRequest();
  const accept = req?.headers.get('accept') || '';
  const wantsRich = accept.includes(RPC_CONTENT_TYPE);

  const headers = new Headers(init.headers || {});
  if (wantsRich) {
    headers.set('content-type', RPC_CONTENT_TYPE);
    headers.append('vary', 'Accept');
    return new Response(await wjStringify(data), { ...init, headers });
  }
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.append('vary', 'Accept');
  return new Response(JSON.stringify(data), { ...init, headers });
}

/**
 * Parse a request body using the webjs serializer when the client sent
 * our content type, otherwise as plain JSON. Handy for route handlers
 * that accept rich bodies from the `richFetch` helper but plain JSON
 * from everyone else.
 *
 * @param {Request} req
 */
export async function readBody(req) {
  const ct = req.headers.get('content-type') || '';
  const text = await req.text();
  if (!text) return null;
  if (ct.includes(RPC_CONTENT_TYPE)) return wjParse(text);
  return JSON.parse(text);
}

export { RPC_CONTENT_TYPE };
