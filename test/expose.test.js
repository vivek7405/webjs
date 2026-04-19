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
  assert.deepEqual(getExposed(fn), { method: 'POST', path: '/api/add', validate: null, cors: null });
});

test('expose() rejects malformed patterns', () => {
  assert.throws(() => expose('POST', () => {}), /bad pattern/);
  assert.throws(() => expose('/api/x', () => {}), /bad pattern/);
});

test('expose() records validate hook when provided', () => {
  const fn = async (x) => x;
  const schema = (i) => { if (!i.ok) throw new Error('bad'); return i; };
  expose('POST /api/x', fn, { validate: schema });
  assert.equal(getExposed(fn).validate, schema);
});

test('expose() normalises cors option', () => {
  const f1 = expose('GET /a', async () => 1, { cors: true });
  assert.deepEqual(getExposed(f1).cors, { origin: '*', credentials: false, maxAge: 86400, headers: null });

  const f2 = expose('GET /b', async () => 1, { cors: 'https://example.com' });
  assert.deepEqual(getExposed(f2).cors, { origin: 'https://example.com', credentials: true, maxAge: 86400, headers: null });

  const f3 = expose('GET /c', async () => 1, { cors: { origin: ['a', 'b'], maxAge: 60, credentials: false } });
  assert.deepEqual(getExposed(f3).cors, { origin: ['a', 'b'], credentials: false, maxAge: 60, headers: null });
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
      import { expose } from '@webjs/core';
      export const add = expose('POST /api/add', async ({ a, b }) => a + b);
      export const get = expose('GET /api/value/:id', async ({ id }) => ({ id: Number(id) }));
    `,
    // Minimal package.json so `import '@webjs/core'` resolves via workspace.
    'package.json': JSON.stringify({ name: 'tmp', type: 'module' }),
  });
  try {
    // Symlink node_modules/@webjs/core → the real package so the scaffold can import it.
    const scopeDir = join(dir, 'node_modules', '@webjs');
    await mkdir(scopeDir, { recursive: true });
    const { symlink } = await import('node:fs/promises');
    const realWebjs = new URL('../packages/core', import.meta.url).pathname;
    await symlink(realWebjs, join(scopeDir, 'core'), 'dir').catch(() => {});

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

test('validate hook rejects bad input with 400 before handler runs', async () => {
  const dir = await scaffold({
    'actions/guarded.server.js': `
      import { expose } from '@webjs/core';
      let called = 0;
      export const make = expose(
        'POST /api/make',
        async ({ name }) => { called++; return { name, called }; },
        { validate: (i) => {
            if (!i || typeof i.name !== 'string' || !i.name) throw new Error('name required');
            return { name: i.name.trim() };
          }
        }
      );
    `,
    'package.json': JSON.stringify({ name: 'tmp', type: 'module' }),
  });
  try {
    const scopeDir = join(dir, 'node_modules', '@webjs');
    await mkdir(scopeDir, { recursive: true });
    const { symlink } = await import('node:fs/promises');
    const realWebjs = new URL('../packages/core', import.meta.url).pathname;
    await symlink(realWebjs, join(scopeDir, 'core'), 'dir').catch(() => {});

    const idx = await buildActionIndex(dir, true);
    const m = matchExposedAction(idx, 'POST', '/api/make');
    assert.ok(m);

    // Missing name → 400
    const bad = await invokeExposedAction(
      idx,
      m.route,
      m.params,
      new Request('http://x/api/make', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
    );
    assert.equal(bad.status, 400);
    const badJson = await bad.json();
    assert.match(badJson.error, /name required/);

    // Good input passes + handler runs
    const ok = await invokeExposedAction(
      idx,
      m.route,
      m.params,
      new Request('http://x/api/make', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '  hello  ' }),
      })
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { name: 'hello', called: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
