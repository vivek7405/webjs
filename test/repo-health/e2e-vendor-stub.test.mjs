/**
 * The e2e's vendor stub (#1228), tested on its own.
 *
 * `test/e2e/fixtures/stub-jspm.mjs` is what keeps the `differential elision
 * (#181)` block off the public internet, and it is the kind of thing that can
 * rot silently: it patches `globalThis.fetch` inside a spawned server, so a
 * mistake shows up as the block going flaky again months later rather than as
 * a failure anyone can trace back. Two properties are worth pinning.
 *
 * The load-bearing trick is that `dayjs.min.js` is UMD, which in module scope
 * finds no `exports`, no `module`, and no AMD `define`, so it takes its global
 * branch and the appended line re-exports that. If a future dayjs changed its
 * wrapper the map would still look right and the module would export nothing.
 * Proving that end to end means importing the emitted `data:` URL, which Bun
 * cannot do, so it lives in `e2e-vendor-stub-module.test.mjs` on its own.
 *
 * The other property is the refusal. The stub answers ONLY what it can serve
 * from this repo and passes everything else through, because answering with a
 * partial map is worse than not answering at all: an absent importmap entry is
 * an unresolved-bare-specifier error that kills the whole page's module graph,
 * which is the exact failure the fixture exists to remove.
 *
 * Importing the fixture patches `globalThis.fetch` for this process. node:test
 * runs each file in its own process, so that is contained here. The sentinel
 * below is installed BEFORE the import so the fixture captures it as its
 * pass-through target, which keeps this test off the network entirely.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** @type {Array<string>} */
const passedThrough = [];
const SENTINEL = new Response('sentinel', { status: 418 });
globalThis.fetch = async (input) => {
  passedThrough.push(typeof input === 'string' ? input : String(input && input.url));
  return SENTINEL.clone();
};

const { packageName, subpath, localImportsFor } = await import('../e2e/fixtures/stub-jspm.mjs');

/** @param {string[]} install */
const generate = (install) => globalThis.fetch('https://api.jspm.io/generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ install, flattenScope: true, env: ['browser', 'production', 'module'], provider: 'jspm.io' }),
});

test('an install string yields its package name and subpath', () => {
  assert.equal(packageName('dayjs'), 'dayjs');
  assert.equal(packageName('dayjs@1.11.21'), 'dayjs');
  assert.equal(packageName('dayjs@1.11.21/plugin/utc'), 'dayjs');
  assert.equal(packageName('@scope/pkg@1.0.0/sub'), '@scope/pkg');
  assert.equal(packageName('@scope/pkg'), '@scope/pkg');
  assert.equal(subpath('dayjs@1.11.21'), '');
  assert.equal(subpath('dayjs@1.11.21/plugin/utc'), '/plugin/utc');
  assert.equal(subpath('dayjs'), '');
});

test('a known package resolves to a data: URL', async () => {
  const res = await generate(['dayjs@1.11.21']);
  assert.equal(res.status, 200, 'the stub answered rather than passing through');
  const body = await res.json();
  assert.match(body.map.imports.dayjs, /^data:text\/javascript;base64,/);
  // That the emitted module actually EXPORTS anything is asserted in
  // e2e-vendor-stub-module.test.mjs, which is node-only (see the note there).
});

test('anything the repo cannot serve passes through to the real API', async () => {
  for (const install of [
    ['left-pad@1.3.0'],                 // not in LOCAL_VENDORS
    ['dayjs@1.11.21', 'left-pad@1.3.0'], // one serviceable, one not
    ['dayjs@1.11.21/plugin/utc'],        // a subpath needs its own entry
    [],                                  // a request naming no installs at all
  ]) {
    const res = await generate(install);
    assert.equal(res.status, 418, `expected pass-through for ${JSON.stringify(install)}`);
  }
  assert.equal(passedThrough.length, 4);
  assert.ok(passedThrough.every((u) => u.includes('api.jspm.io')));
});

test('a body the stub cannot read passes through rather than being answered', async () => {
  // The guard that reads `init.body`. A caller that sent no body, a non-string
  // one, or malformed JSON leaves the stub with nothing to serve, and the one
  // thing it must not do there is answer with an empty map, which would be an
  // importmap missing every entry the page needs.
  const before = passedThrough.length;
  for (const init of [
    { method: 'POST' },
    { method: 'POST', body: new Uint8Array([1, 2, 3]) },
    { method: 'POST', body: '{ not json' },
  ]) {
    const res = await globalThis.fetch('https://api.jspm.io/generate', init);
    assert.equal(res.status, 418);
  }
  assert.equal(passedThrough.length, before + 3);
});

test('a non-jspm url is never intercepted', async () => {
  const before = passedThrough.length;
  const res = await globalThis.fetch('https://example.test/thing');
  assert.equal(res.status, 418);
  assert.equal(passedThrough.length, before + 1);
});

test('localImportsFor refuses rather than answering a partial map', () => {
  assert.equal(localImportsFor([]), null);
  assert.equal(localImportsFor(['left-pad@1.3.0']), null);
  assert.equal(localImportsFor(['dayjs@1.11.21', 'left-pad@1.3.0']), null);
  const ok = localImportsFor(['dayjs@1.11.21']);
  assert.deepEqual(Object.keys(ok || {}), ['dayjs']);
});
