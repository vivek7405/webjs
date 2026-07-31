/**
 * Unit: serveActionStub generates a verb-aware client stub (#488). A GET file
 * gets a GET stub (args in the URL, reads the SSR seed); a PUT a body stub.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serveActionStub, hashFile } from '../../src/actions.js';

let dir;
before(() => { dir = mkdtempSync(join(tmpdir(), 'webjs-stubgen-')); });
after(() => { rmSync(dir, { recursive: true, force: true }); });

async function stubFor(filename, src) {
  const abs = join(dir, filename);
  writeFileSync(abs, src);
  const hash = await hashFile(abs);
  const idx = { fileToHash: new Map([[abs, hash]]), hashToFile: new Map([[hash, abs]]), dev: false, appDir: dir };
  return serveActionStub(idx, abs);
}

test('a GET action stub rides the URL, reads the seed, no CSRF on the read', async () => {
  const stub = await stubFor('get-user.server.js',
    `'use server';\nexport const method='GET';\nexport const cache=60;\nexport async function getUser(id){return {id};}\n`);
  assert.match(stub, /generated server-action stub \(GET\)/);
  assert.match(stub, /'\?a=' \+ encodeURIComponent/, 'GET args ride the URL');
  assert.match(stub, /__seedTake/, 'GET reads the SSR seed (#472)');
  assert.match(stub, /__stale\(key\)/, 'GET consults the tag-stale cache');
  assert.match(stub, /const sig = __sig\(\)/, 'the active abort signal is captured synchronously (#492)');
  assert.match(stub, /signal: sig/, 'the fetch binds the captured abort signal');
  assert.match(stub, /export const getUser = /);
});

test('a PUT action stub sends a body with CSRF (and still reads the SSR seed)', async () => {
  const stub = await stubFor('replace.server.js',
    `'use server';\nexport const method='PUT';\nexport async function replace(id,d){return {id};}\n`);
  assert.match(stub, /generated server-action stub \(PUT\)/);
  // Every verb reads the seed (#472): a default-POST async-render read is seeded
  // regardless of verb; a true mutation simply misses.
  assert.match(stub, /__seedTake/, 'all verbs read the SSR seed');
  assert.doesNotMatch(stub, /__stale\(key\)/, 'a mutation does not consult the browser-cache staleness');
  assert.match(stub, /export const replace = /);
});

test('a DELETE action stub rides the URL and sends no CSRF token', async () => {
  const stub = await stubFor('del.server.js',
    `'use server';\nexport const method='DELETE';\nexport async function del(id){return {ok:1};}\n`);
  assert.match(stub, /generated server-action stub \(DELETE\)/);
  assert.match(stub, /'\?a=' \+ encodeURIComponent/);
  // CSRF is enforced server-side by an Origin / Sec-Fetch-Site check (#659),
  // so the stub reads no cookie and sends no x-webjs-csrf header.
  assert.doesNotMatch(stub, /__csrf\(\)|x-webjs-csrf/);
});

test('config exports are excluded from the action function list', async () => {
  const stub = await stubFor('cfg.server.js',
    `'use server';\nexport const method='GET';\nexport const tags=(id)=>['t'+id];\nexport const validate=(x)=>x;\nexport async function getThing(id){return {id};}\n`);
  assert.match(stub, /export const getThing = /);
  assert.doesNotMatch(stub, /export const tags = \(\.\.\.args\)/, 'tags is config, not an action');
  assert.doesNotMatch(stub, /export const validate = \(\.\.\.args\)/, 'validate is config, not an action');
});

test('a default-POST action (no method) sends a body', async () => {
  const stub = await stubFor('log.server.js',
    `'use server';\nexport async function logEvent(e){return {ok:1};}\n`);
  assert.match(stub, /generated server-action stub \(POST\)/);
  assert.match(stub, /export const logEvent = /);
});

test('every stub can decode a streamed result (#489): imports + __readStream', async () => {
  // Streaming is detected on the RESPONSE content type at runtime, so EVERY
  // stub (regardless of verb) carries the decode path.
  const stub = await stubFor('s.server.js',
    `'use server';\nexport async function* s(){ yield 1; }\n`);
  assert.match(stub, /createFrameDecoder as __frameDec/, 'the frame decoder is imported');
  assert.match(stub, /STREAM_CONTENT_TYPE as __STREAM_CT/, 'the stream MIME constant is imported');
  assert.match(stub, /ct\.includes\(__STREAM_CT\)/, '__handle branches on the stream content type');
  assert.match(stub, /async function\* __readStream/, 'the stub defines the stream reader');
  assert.match(stub, /f\.type === __F_CHUNK\) yield __p/, 'a CHUNK frame yields a deserialized value');
  assert.match(stub, /f\.type === __F_ERR\) throw/, 'an ERROR frame throws');
});

// --- Form-action identity on the generated stub (#1155) ----------------------
//
// The stub's `$$webjsAction` stamp is the ENTIRE client half of form binding:
// a shipping component re-renders its template on hydration, and
// `bindFormActionElement` reads the identity synchronously off the function it
// was handed. Every client-side test hand-stamps a fake stub, so without these
// the real generator could stop stamping and the whole suite would stay green
// while a hydrated form lost its identity field.

test('every exported stub carries its own <hash>/<fn> identity', async () => {
  const stub = await stubFor('save.server.js',
    `'use server';\nexport async function save(input){return input;}\nexport async function touch(){return 1;}\n`);
  assert.match(stub, /Object\.defineProperty\(fn, "\$\$webjsAction"/, 'the stamp uses the shared key');
  assert.match(stub, /__HASH \+ '\/' \+ name/, 'and builds <hash>/<fn> from the file hash');
  assert.match(stub, /export const save = __id\(\(\.\.\.args\) => __call\("save", args\), "save"\)/);
  assert.match(stub, /export const touch = __id\(\(\.\.\.args\) => __call\("touch", args\), "touch"\)/);
});

test('a default export is stamped too', async () => {
  const stub = await stubFor('default.server.js',
    `'use server';\nexport default async function (input){return input;}\n`);
  assert.match(stub, /export default __id\(\(\.\.\.args\) => __call\('default', args\), 'default'\)/);
});

test('the stamp is non-enumerable, so a namespace import and a spread are unchanged', async () => {
  // `defineProperty` is the load-bearing choice over a plain assignment, whose
  // default IS enumerable: the identity would then show up in
  // `Object.keys(actions)` and in `{ ...action }`, quietly changing what an app
  // sees. Asserted by running the emitted stamp rather than by reading the
  // source, since `defineProperty`'s non-enumerable default is exactly the part
  // the source does not spell out.
  const stub = await stubFor('ns.server.js', `'use server';\nexport async function go(){return 1;}\n`);
  assert.doesNotMatch(stub, /fn\.\$\$webjsAction\s*=/, 'never a bare assignment');
  // The whole LINE, not up to the first `;`: the helper's body contains its own
  // statements, so a `[^;]+` capture truncates it into a syntax error.
  const line = stub.split('\n').find((l) => l.startsWith('const __id = '));
  assert.ok(line, 'the stub defines the stamp helper');
  // eslint-disable-next-line no-new-func
  const __id = new Function('__HASH', `${line}\nreturn __id;`)('abc1234567');
  const fn = __id(() => {}, 'go');
  assert.equal(fn.$$webjsAction, 'abc1234567/go', 'the identity reads back');
  assert.deepEqual(Object.keys(fn), [], 'and is invisible to Object.keys');
  assert.deepEqual({ ...fn }, {}, 'and to a spread');
});

test('the stub identity MATCHES the identity the server resolver produces', async () => {
  // The two halves are computed by different code on different sides, and a
  // drift between them is a form that submits an identity the dispatcher
  // cannot resolve. Pin them to the same string.
  const abs = join(dir, 'match.server.js');
  writeFileSync(abs, `'use server';\nexport async function pick(){return 1;}\n`);
  const hash = await hashFile(abs);
  const idx = { fileToHash: new Map([[abs, hash]]), hashToFile: new Map([[hash, abs]]), dev: false, appDir: dir };
  const stub = await serveActionStub(idx, abs);
  assert.match(stub, new RegExp(`const __HASH = ${JSON.stringify(hash)};`));

  const { resolveActionIdentity } = await import('../../src/form-action-identity.js');
  const { __actionWrap, registerActionHooks } = await import('../../src/action-seed.js');
  await registerActionHooks({ seed: false });
  const fn = async () => 1;
  __actionWrap(abs, 'pick', fn);
  assert.equal(await resolveActionIdentity(idx, fn), `${hash}/pick`,
    'the server resolves the same string the stub stamps');
});
