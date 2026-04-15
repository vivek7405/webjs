import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildActionIndex,
  resolveServerModule,
  serveActionStub,
  invokeAction,
  isServerFile,
  RPC_CONTENT_TYPE,
} from '../packages/server/src/actions.js';
import { stringify as sjStringify, parse as sjParse } from 'superjson';

async function scaffold(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, body);
  }
  return dir;
}

test('superjson wire format round-trips Date / Map / BigInt across invokeAction', async () => {
  const dir = await scaffold({
    'actions/rich.server.js': `
      export async function now() { return new Date(1234567890000); }
      export async function bag() {
        return { big: 9007199254740993n, set: new Set(['a','b']), map: new Map([[1, 'one']]) };
      }
    `,
  });
  try {
    const idx = await buildActionIndex(dir, true);
    const file = resolveServerModule(idx, '/actions/rich.server.js');
    const hash = idx.fileToHash.get(file);
    const tok = 't';
    const headers = { 'content-type': RPC_CONTENT_TYPE, cookie: `webjs_csrf=${tok}`, 'x-webjs-csrf': tok };
    const r1 = await invokeAction(idx, hash, 'now',
      new Request('http://x/__webjs/action/' + hash + '/now',
        { method: 'POST', headers, body: sjStringify([]) }));
    const d = sjParse(await r1.text());
    assert.ok(d instanceof Date, 'Date survived the wire');
    assert.equal(d.getTime(), 1234567890000);

    const r2 = await invokeAction(idx, hash, 'bag',
      new Request('http://x/__webjs/action/' + hash + '/bag',
        { method: 'POST', headers, body: sjStringify([]) }));
    const bag = sjParse(await r2.text());
    assert.equal(typeof bag.big, 'bigint');
    assert.equal(bag.big, 9007199254740993n);
    assert.ok(bag.set instanceof Set); assert.ok(bag.set.has('a'));
    assert.ok(bag.map instanceof Map); assert.equal(bag.map.get(1), 'one');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('detects *.server.js and "use server" pragma files', async () => {
  const dir = await scaffold({
    'actions/a.server.js': 'export const hello = async () => 1',
    'actions/b.js': `'use server';\nexport const bye = async () => 2`,
    'actions/c.js': 'export const plain = () => 3',
  });
  try {
    assert.equal(await isServerFile(join(dir, 'actions/a.server.js')), true);
    assert.equal(await isServerFile(join(dir, 'actions/b.js')), true);
    assert.equal(await isServerFile(join(dir, 'actions/c.js')), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stubs server module and invokes action by hash/fn', async () => {
  const dir = await scaffold({
    'actions/math.server.js': `
      export async function add(a, b) { return a + b; }
      export async function mul(a, b) { return a * b; }
    `,
  });
  try {
    const idx = await buildActionIndex(dir, true);
    const file = resolveServerModule(idx, '/actions/math.server.js');
    assert.ok(file);

    const stub = await serveActionStub(idx, file);
    assert.match(stub, /export const add = /);
    assert.match(stub, /export const mul = /);
    assert.match(stub, /\/__webjs\/action\/[a-f0-9]+\//);

    const hash = idx.fileToHash.get(file);
    // Action RPC is CSRF-protected: must present matching cookie + header.
    const tok = 'test-csrf-token';
    const req = new Request('http://x/__webjs/action/' + hash + '/add', {
      method: 'POST',
      headers: {
        'content-type': RPC_CONTENT_TYPE,
        cookie: `webjs_csrf=${tok}`,
        'x-webjs-csrf': tok,
      },
      body: sjStringify([2, 3]),
    });
    const res = await invokeAction(idx, hash, 'add', req);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), RPC_CONTENT_TYPE);
    assert.equal(sjParse(await res.text()), 5);

    // Without CSRF token → 403
    const unsafe = new Request('http://x/__webjs/action/' + hash + '/add', {
      method: 'POST',
      headers: { 'content-type': RPC_CONTENT_TYPE },
      body: sjStringify([2, 3]),
    });
    const rejected = await invokeAction(idx, hash, 'add', unsafe);
    assert.equal(rejected.status, 403);

    // Mismatched header vs cookie → 403
    const mismatched = new Request('http://x/__webjs/action/' + hash + '/add', {
      method: 'POST',
      headers: {
        'content-type': RPC_CONTENT_TYPE,
        cookie: `webjs_csrf=${tok}`,
        'x-webjs-csrf': 'different',
      },
      body: sjStringify([2, 3]),
    });
    const rejected2 = await invokeAction(idx, hash, 'add', mismatched);
    assert.equal(rejected2.status, 403);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
