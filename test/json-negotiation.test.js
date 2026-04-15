import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stringify as sjStringify, parse as sjParse } from 'superjson';

import { json, readBody } from '../packages/server/src/json.js';
import { withRequest } from '../packages/server/src/context.js';

test('json() returns plain JSON when Accept is not vendor', async () => {
  const req = new Request('http://x/api/x', { headers: { accept: 'application/json' } });
  const res = await withRequest(req, () => json({ n: 1, d: new Date(1234567890000) }));
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  const body = await res.json();
  assert.equal(body.n, 1);
  assert.equal(typeof body.d, 'string');
  // Vary header present (caching correctness)
  assert.match(res.headers.get('vary') || '', /Accept/i);
});

test('json() superjson-encodes when Accept is application/vnd.webjs+json', async () => {
  const req = new Request('http://x/api/x', { headers: { accept: 'application/vnd.webjs+json' } });
  const res = await withRequest(req, () => json({ d: new Date(1234567890000), big: 2n ** 64n }));
  assert.equal(res.headers.get('content-type'), 'application/vnd.webjs+json');
  const parsed = sjParse(await res.text());
  assert.ok(parsed.d instanceof Date);
  assert.equal(parsed.d.getTime(), 1234567890000);
  assert.equal(parsed.big, 2n ** 64n);
});

test('readBody() parses superjson when content-type matches, JSON otherwise', async () => {
  // rich body
  const r1 = new Request('http://x/', {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.webjs+json' },
    body: sjStringify({ d: new Date(9999999999) }),
  });
  const b1 = await readBody(r1);
  assert.ok(b1.d instanceof Date);

  // plain body
  const r2 = new Request('http://x/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ n: 42 }),
  });
  const b2 = await readBody(r2);
  assert.equal(b2.n, 42);
});
