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
} from '../packages/server/src/actions.js';

async function scaffold(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, body);
  }
  return dir;
}

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
    const req = new Request('http://x/__webjs/action/' + hash + '/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([2, 3]),
    });
    const res = await invokeAction(idx, hash, 'add', req);
    assert.equal(res.status, 200);
    assert.equal(await res.json(), 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
