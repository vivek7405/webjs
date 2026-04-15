import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expose, getExposed } from '../packages/core/index.js';
import {
  buildActionIndex,
  matchExposedAction,
  invokeExposedAction,
} from '../packages/server/src/actions.js';

test('expose() tags the function and parses pattern', () => {
  const fn = async (x) => x + 1;
  const exposed = expose('POST /api/add', fn);
  assert.equal(exposed, fn);
  assert.deepEqual(getExposed(fn), { method: 'POST', path: '/api/add' });
});

test('expose() rejects malformed patterns', () => {
  assert.throws(() => expose('POST', () => {}), /bad pattern/);
  assert.throws(() => expose('/api/x', () => {}), /bad pattern/);
});

async function scaffold(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-'));
  for (const [rel, body] of Object.entries(files)) {
    const p = join(dir, rel);
    await mkdir(join(p, '..'), { recursive: true });
    await writeFile(p, body);
  }
  return dir;
}

test('action scanner discovers expose()d routes and invokes them over HTTP', async () => {
  // Use a relative import so the scaffolded module can find webjs via the workspace.
  const dir = await scaffold({
    'actions/math.server.js': `
      import { expose } from 'webjs';
      export const add = expose('POST /api/add', async ({ a, b }) => a + b);
      export const get = expose('GET /api/value/:id', async ({ id }) => ({ id: Number(id) }));
    `,
    // Minimal package.json so `import 'webjs'` resolves via workspace.
    'package.json': JSON.stringify({ name: 'tmp', type: 'module' }),
  });
  try {
    // Symlink node_modules/webjs → the real package so the scaffold can import it.
    const modulesDir = join(dir, 'node_modules');
    await mkdir(modulesDir, { recursive: true });
    const { symlink } = await import('node:fs/promises');
    const realWebjs = new URL('../packages/core', import.meta.url).pathname;
    await symlink(realWebjs, join(modulesDir, 'webjs'), 'dir').catch(() => {});

    const idx = await buildActionIndex(dir, true);
    assert.equal(idx.httpRoutes.length, 2);

    // POST /api/add
    const post = matchExposedAction(idx, 'POST', '/api/add');
    assert.ok(post);
    const addReq = new Request('http://x/api/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 2, b: 3 }),
    });
    const addRes = await invokeExposedAction(idx, post.route, post.params, addReq);
    assert.equal(addRes.status, 200);
    assert.equal(await addRes.json(), 5);

    // GET /api/value/42 — path param converted to string
    const get = matchExposedAction(idx, 'GET', '/api/value/42');
    assert.ok(get);
    assert.deepEqual(get.params, { id: '42' });
    const getReq = new Request('http://x/api/value/42');
    const getRes = await invokeExposedAction(idx, get.route, get.params, getReq);
    assert.deepEqual(await getRes.json(), { id: 42 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
