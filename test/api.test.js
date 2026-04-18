/**
 * handleApi() dispatcher tests — exercises every branch of
 * packages/server/src/api.js (method dispatch, 405 with allow header,
 * plain-object → Response.json shortcut, params injection, dev cache bust).
 *
 * Uses throw-away API modules written to os.tmpdir() so the tests don't
 * pollute the repo.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleApi } from '../packages/server/src/api.js';

let dir;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'webjs-api-'));

  await writeFile(join(dir, 'greet.js'), `
    export async function GET(req, { params }) {
      return new Response('hi ' + params.name);
    }
    export async function POST(req) {
      const body = await req.json();
      return Response.json({ echoed: body });
    }
  `);

  await writeFile(join(dir, 'plain.js'), `
    export async function GET() {
      return { ok: true, n: 1 };
    }
  `);

  await writeFile(join(dir, 'only-get.js'), `
    export async function GET() { return new Response('g'); }
  `);

  await writeFile(join(dir, 'params-read.js'), `
    export async function GET(req) {
      return Response.json({ params: req.params });
    }
  `);
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('handleApi: GET handler invoked, params forwarded', async () => {
  const route = { file: join(dir, 'greet.js') };
  const req = new Request('http://x/api/greet/ada');
  const resp = await handleApi(route, { name: 'ada' }, req, false);
  assert.equal(resp.status, 200);
  assert.equal(await resp.text(), 'hi ada');
});

test('handleApi: POST handler can read JSON body and return Response.json', async () => {
  const route = { file: join(dir, 'greet.js') };
  const req = new Request('http://x/api/greet/ada', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello: 'world' }),
  });
  const resp = await handleApi(route, { name: 'ada' }, req, false);
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), { echoed: { hello: 'world' } });
});

test('handleApi: plain-object return → Response.json shortcut', async () => {
  const route = { file: join(dir, 'plain.js') };
  const req = new Request('http://x/api/plain');
  const resp = await handleApi(route, {}, req, false);
  assert.equal(resp.headers.get('content-type')?.includes('application/json'), true);
  assert.deepEqual(await resp.json(), { ok: true, n: 1 });
});

test('handleApi: unsupported method → 405 with allow header listing supported methods', async () => {
  const route = { file: join(dir, 'only-get.js') };
  const req = new Request('http://x/api/only-get', { method: 'DELETE' });
  const resp = await handleApi(route, {}, req, false);
  assert.equal(resp.status, 405);
  assert.equal(resp.headers.get('allow'), 'GET');
});

test('handleApi: allow header lists all exported handlers', async () => {
  const route = { file: join(dir, 'greet.js') };
  const req = new Request('http://x/api/greet/z', { method: 'PATCH' });
  const resp = await handleApi(route, { name: 'z' }, req, false);
  assert.equal(resp.status, 405);
  const allow = resp.headers.get('allow') || '';
  assert.ok(allow.includes('GET'));
  assert.ok(allow.includes('POST'));
});

test('handleApi: params are also attached to the Request object', async () => {
  const route = { file: join(dir, 'params-read.js') };
  const req = new Request('http://x/api/params-read');
  const resp = await handleApi(route, { id: '42', slug: 'hello' }, req, false);
  const body = await resp.json();
  assert.deepEqual(body, { params: { id: '42', slug: 'hello' } });
});

test('handleApi: dev=true cache-busts the import (re-reads the module from disk)', async () => {
  const file = join(dir, 'live.js');
  await writeFile(file, `export async function GET() { return new Response('v1'); }`);

  const route = { file };
  const r1 = await handleApi(route, {}, new Request('http://x/api/live'), true);
  assert.equal(await r1.text(), 'v1');

  // Overwrite module and call again with dev=true; cache-busting query should
  // force re-import.
  await writeFile(file, `export async function GET() { return new Response('v2'); }`);
  const r2 = await handleApi(route, {}, new Request('http://x/api/live'), true);
  assert.equal(await r2.text(), 'v2');
});
