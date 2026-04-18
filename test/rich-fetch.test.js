/**
 * Unit tests for richFetch — the fetch wrapper that round-trips rich JS
 * types (Date, Map, Set, BigInt, URL, RegExp, undefined) via superjson.
 *
 * Installs a fake global fetch per test, asserts request shape + response
 * decoding against fixtures. No network IO.
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { stringify as sjStringify } from 'superjson';

import { richFetch } from '../packages/core/src/rich-fetch.js';

const RPC = 'application/vnd.webjs+json';

/** @type {(() => Promise<Response>) | null} */
let lastFetch = null;
/** @type {RequestInit | undefined} */
let lastInit;
/** @type {string | URL | undefined} */
let lastUrl;

function mockFetch(responder) {
  lastFetch = responder;
  globalThis.fetch = async (url, init) => {
    lastUrl = url;
    lastInit = init;
    return responder(url, init);
  };
}

afterEach(() => {
  lastFetch = null;
  lastInit = undefined;
  lastUrl = undefined;
});

function respond(body, init = {}) {
  const headers = new Headers(init.headers || {});
  return new Response(body, { ...init, headers });
}

/* ------------------------------------------------------------------
 * Request headers
 * ------------------------------------------------------------------ */

test('sets Accept to application/vnd.webjs+json by default', async () => {
  mockFetch(() => respond('{"ok":true}', { headers: { 'content-type': 'application/json' } }));
  await richFetch('/api/ping');
  const h = new Headers(lastInit.headers);
  assert.equal(h.get('accept'), RPC);
});

test('does NOT overwrite a caller-supplied Accept header', async () => {
  mockFetch(() => respond('ok', { headers: { 'content-type': 'text/plain' } }));
  await richFetch('/api/ping', { headers: { Accept: 'text/html' } });
  const h = new Headers(lastInit.headers);
  assert.equal(h.get('accept'), 'text/html');
});

/* ------------------------------------------------------------------
 * Request body encoding
 * ------------------------------------------------------------------ */

test('encodes plain-object body with superjson + sets content-type', async () => {
  mockFetch(() => respond(sjStringify({ ok: true }), { headers: { 'content-type': RPC } }));
  await richFetch('/api/posts', {
    method: 'POST',
    body: { title: 'hi', publishAt: new Date(2026, 0, 1) },
  });
  const h = new Headers(lastInit.headers);
  assert.equal(h.get('content-type'), RPC);
  // Body should be a superjson string containing the Date as {"type":"Date"}
  const sjPayload = JSON.parse(lastInit.body);
  assert.ok(sjPayload.json);
  assert.ok(sjPayload.meta);
});

test('respects caller-supplied Content-Type on object body (no override)', async () => {
  mockFetch(() => respond('ok'));
  await richFetch('/api/posts', {
    method: 'POST',
    body: { x: 1 },
    headers: { 'Content-Type': 'application/json' },
  });
  const h = new Headers(lastInit.headers);
  assert.equal(h.get('content-type'), 'application/json');
});

test('passes FormData through unchanged', async () => {
  mockFetch(() => respond('ok'));
  const fd = new FormData();
  fd.append('x', '1');
  await richFetch('/api/upload', { method: 'POST', body: fd });
  assert.strictEqual(lastInit.body, fd, 'FormData body not reserialised');
});

test('passes Blob through unchanged', async () => {
  mockFetch(() => respond('ok'));
  const blob = new Blob(['hello']);
  await richFetch('/api/upload', { method: 'POST', body: blob });
  assert.strictEqual(lastInit.body, blob);
});

test('passes ArrayBuffer through unchanged', async () => {
  mockFetch(() => respond('ok'));
  const buf = new ArrayBuffer(8);
  await richFetch('/api/upload', { method: 'POST', body: buf });
  assert.strictEqual(lastInit.body, buf);
});

test('passes URLSearchParams through unchanged', async () => {
  mockFetch(() => respond('ok'));
  const params = new URLSearchParams({ a: '1' });
  await richFetch('/api/form', { method: 'POST', body: params });
  assert.strictEqual(lastInit.body, params);
});

test('passes typed-array views through unchanged', async () => {
  mockFetch(() => respond('ok'));
  const bytes = new Uint8Array([1, 2, 3]);
  await richFetch('/api/bin', { method: 'POST', body: bytes });
  assert.strictEqual(lastInit.body, bytes);
});

test('passes ReadableStream through unchanged', async () => {
  mockFetch(() => respond('ok'));
  const stream = new ReadableStream({ start(c) { c.enqueue('x'); c.close(); } });
  await richFetch('/api/stream', { method: 'POST', body: stream });
  assert.strictEqual(lastInit.body, stream);
});

test('leaves null body alone', async () => {
  mockFetch(() => respond('ok'));
  await richFetch('/api/x', { method: 'POST', body: null });
  assert.strictEqual(lastInit.body, null);
});

test('leaves string body alone', async () => {
  mockFetch(() => respond('ok'));
  await richFetch('/api/x', { method: 'POST', body: 'raw' });
  assert.strictEqual(lastInit.body, 'raw');
});

/* ------------------------------------------------------------------
 * Response decoding by content-type
 * ------------------------------------------------------------------ */

test('decodes superjson response when content-type is RPC', async () => {
  const d = new Date(2026, 0, 1);
  mockFetch(() => respond(sjStringify({ when: d }), { headers: { 'content-type': RPC } }));
  const out = /** @type any */ (await richFetch('/x'));
  assert.ok(out.when instanceof Date);
  assert.equal(out.when.getTime(), d.getTime());
});

test('decodes plain JSON response when content-type is application/json', async () => {
  mockFetch(() =>
    respond(JSON.stringify({ n: 42 }), { headers: { 'content-type': 'application/json' } }),
  );
  const out = /** @type any */ (await richFetch('/x'));
  assert.deepEqual(out, { n: 42 });
});

test('returns raw text for non-JSON content-types', async () => {
  mockFetch(() => respond('plain text', { headers: { 'content-type': 'text/plain' } }));
  const out = await richFetch('/x');
  assert.equal(out, 'plain text');
});

test('returns null for an empty RPC response', async () => {
  mockFetch(() => respond('', { headers: { 'content-type': RPC } }));
  const out = await richFetch('/x');
  assert.equal(out, null);
});

test('returns null for an empty JSON response', async () => {
  mockFetch(() => respond('', { headers: { 'content-type': 'application/json' } }));
  const out = await richFetch('/x');
  assert.equal(out, null);
});

test('handles missing content-type — returns raw text', async () => {
  mockFetch(() => new Response('mystery'));
  const out = await richFetch('/x');
  assert.equal(out, 'mystery');
});

/* ------------------------------------------------------------------
 * Error handling
 * ------------------------------------------------------------------ */

test('throws Error with status + body on non-2xx response', async () => {
  mockFetch(() =>
    respond(JSON.stringify({ error: 'bad input' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    }),
  );
  let caught;
  try { await richFetch('/api/fail'); } catch (e) { caught = e; }
  assert.ok(caught, 'should throw');
  assert.equal(caught.message, 'bad input');
  assert.equal(caught.status, 400);
  assert.deepEqual(caught.body, { error: 'bad input' });
});

test('throws default message when response has no .error field', async () => {
  mockFetch(() => respond('', { status: 500 }));
  let caught;
  try { await richFetch('/api/fail'); } catch (e) { caught = e; }
  assert.ok(caught.message.includes('/api/fail'));
  assert.ok(caught.message.includes('500'));
  assert.equal(caught.status, 500);
});

test('throws with status even when body parse yields null', async () => {
  mockFetch(() =>
    respond('', { status: 404, headers: { 'content-type': RPC } }),
  );
  let caught;
  try { await richFetch('/api/missing'); } catch (e) { caught = e; }
  assert.equal(caught.status, 404);
  assert.equal(caught.body, null);
});
