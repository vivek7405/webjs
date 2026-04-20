/**
 * Unit tests for CORS header handling in actions.js — exercised by
 * `expose()`d REST endpoints. Covers corsHeadersFor / buildPreflightResponse
 * / withCors across wildcard, allow-list, credentials, and mismatch cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  corsHeadersFor,
  buildPreflightResponse,
  withCors,
} from '../packages/server/src/actions.js';

/** @param {object} cors */
function route(cors) {
  return { method: 'POST', pattern: /^\/x$/, paramNames: [], file: '', fnName: 'x', validate: null, cors };
}
/** @param {string|null} origin @param {string} [method] */
function req(origin, method = 'POST', extra = {}) {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Request('http://localhost/x', { method, headers });
}

// --- corsHeadersFor ---

test('corsHeadersFor: no cors config → null', () => {
  assert.equal(corsHeadersFor(route(null), req('https://a')), null);
});

test('corsHeadersFor: wildcard * allows any origin with access-control-allow-origin: *', () => {
  const h = corsHeadersFor(route({ origin: '*', credentials: false, maxAge: 0, headers: null }), req('https://evil'));
  assert.ok(h);
  assert.equal(h.get('access-control-allow-origin'), '*');
});

test('corsHeadersFor: exact string origin matches', () => {
  const h = corsHeadersFor(route({ origin: 'https://a.com', credentials: false, maxAge: 0, headers: null }), req('https://a.com'));
  assert.ok(h);
  assert.equal(h.get('access-control-allow-origin'), 'https://a.com');
});

test('corsHeadersFor: exact string origin mismatch → null', () => {
  assert.equal(
    corsHeadersFor(route({ origin: 'https://a.com', credentials: false, maxAge: 0, headers: null }), req('https://b.com')),
    null,
  );
});

test('corsHeadersFor: array allow-list matches included origin (echoes back)', () => {
  const h = corsHeadersFor(
    route({ origin: ['https://a.com', 'https://b.com'], credentials: false, maxAge: 0, headers: null }),
    req('https://b.com'),
  );
  assert.ok(h);
  assert.equal(h.get('access-control-allow-origin'), 'https://b.com');
});

test('corsHeadersFor: array allow-list rejects non-member origin → null', () => {
  assert.equal(
    corsHeadersFor(
      route({ origin: ['https://a.com', 'https://b.com'], credentials: false, maxAge: 0, headers: null }),
      req('https://c.com'),
    ),
    null,
  );
});

test('corsHeadersFor: credentials=true adds access-control-allow-credentials', () => {
  const h = corsHeadersFor(
    route({ origin: 'https://a.com', credentials: true, maxAge: 0, headers: null }),
    req('https://a.com'),
  );
  assert.ok(h);
  assert.equal(h.get('access-control-allow-credentials'), 'true');
});

test('corsHeadersFor: no Origin header → allowed (server-to-server style) with `vary: Origin`', () => {
  const h = corsHeadersFor(route({ origin: 'https://a.com', credentials: false, maxAge: 0, headers: null }), req(null));
  assert.ok(h);
  // With no origin header, the configured origin value flows through as null → empty
  // but the header block is still built; vary header must be present for CDN correctness.
  assert.equal(h.get('vary'), 'Origin');
});

test('corsHeadersFor: always sets vary: Origin when headers built', () => {
  const h = corsHeadersFor(route({ origin: '*', credentials: false, maxAge: 0, headers: null }), req('https://x'));
  assert.ok(h);
  assert.equal(h.get('vary'), 'Origin');
});

// --- buildPreflightResponse ---

test('buildPreflightResponse: no cors → 403', () => {
  const resp = buildPreflightResponse(route(null), req('https://a', 'OPTIONS'));
  assert.equal(resp.status, 403);
});

test('buildPreflightResponse: cors match → 204 + allow-methods/headers/max-age', () => {
  const r = route({ origin: '*', credentials: false, maxAge: 600, headers: null });
  const resp = buildPreflightResponse(r, req('https://a', 'OPTIONS', {
    'access-control-request-headers': 'content-type,authorization',
  }));
  assert.equal(resp.status, 204);
  assert.equal(resp.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(resp.headers.get('access-control-allow-headers'), 'content-type,authorization');
  assert.equal(resp.headers.get('access-control-max-age'), '600');
});

test('buildPreflightResponse: cors.headers overrides request Access-Control-Request-Headers', () => {
  const r = route({ origin: '*', credentials: false, maxAge: 86400, headers: ['x-custom'] });
  const resp = buildPreflightResponse(r, req('https://a', 'OPTIONS', {
    'access-control-request-headers': 'content-type',
  }));
  assert.equal(resp.headers.get('access-control-allow-headers'), 'x-custom');
});

test('buildPreflightResponse: defaults to content-type when neither cors.headers nor request header set', () => {
  const r = route({ origin: '*', credentials: false, maxAge: 86400, headers: null });
  const resp = buildPreflightResponse(r, req('https://a', 'OPTIONS'));
  assert.equal(resp.headers.get('access-control-allow-headers'), 'content-type');
});

test('buildPreflightResponse: origin mismatch → 403 (no exposure)', () => {
  const r = route({ origin: 'https://a.com', credentials: false, maxAge: 0, headers: null });
  const resp = buildPreflightResponse(r, req('https://evil', 'OPTIONS'));
  assert.equal(resp.status, 403);
});

// --- withCors ---

test('withCors: route without cors → original response passes through', () => {
  const orig = Response.json({ ok: true });
  const out = withCors(orig, route(null), req('https://a'));
  assert.equal(out, orig);
});

test('withCors: route with matching cors applies allow-origin header', async () => {
  const orig = Response.json({ ok: true });
  const r = route({ origin: '*', credentials: false, maxAge: 0, headers: null });
  const out = withCors(orig, r, req('https://a'));
  assert.equal(out.headers.get('access-control-allow-origin'), '*');
  // Body/status should survive.
  assert.equal(out.status, 200);
  assert.deepEqual(await out.json(), { ok: true });
});

test('withCors: route with cors but mismatched origin → response passes through (headers not applied)', () => {
  const orig = Response.json({ ok: true });
  const r = route({ origin: 'https://a.com', credentials: false, maxAge: 0, headers: null });
  const out = withCors(orig, r, req('https://b.com'));
  assert.equal(out, orig);
  assert.equal(out.headers.get('access-control-allow-origin'), null);
});

test('withCors: preserves existing response headers (e.g., content-type)', () => {
  const orig = new Response('ok', { status: 201, headers: { 'x-trace': 'abc', 'content-type': 'text/plain' } });
  const r = route({ origin: '*', credentials: false, maxAge: 0, headers: null });
  const out = withCors(orig, r, req('https://a'));
  assert.equal(out.status, 201);
  assert.equal(out.headers.get('x-trace'), 'abc');
  assert.equal(out.headers.get('content-type'), 'text/plain');
  assert.equal(out.headers.get('access-control-allow-origin'), '*');
});
