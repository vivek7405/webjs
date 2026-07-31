/**
 * Unit tests for SSR action-result seeding (#472), the pure pieces that need
 * neither the process-global load hook nor a running app:
 *   - export-name extraction for the facade,
 *   - the `__actionWrap` Proxy: records inside a collector, passthrough outside,
 *     non-function passthrough, and a function's own custom property
 *     forwarding through the Proxy,
 *   - `collectSeeds` ambient collection across a nested async chain,
 *   - key determinism (server key === the client stub's lookup key),
 *   - `buildSeedScript` (empty -> '', HTML-escaped, round-trips through parse).
 *
 * The load-hook + facade path is covered in seed-hook.test.js (isolated process,
 * because `module.registerHooks` is process-global).
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  __actionWrap,
  extractExportNames,
  buildSeedFacade,
  collectSeeds,
  buildSeedScript,
  registerActionHooks,
  actionIdentityOf,
} from '../../src/action-seed.js';
import { hashFile } from '../../src/actions.js';
import { stringify, parse } from '@webjsdev/core';

const FILE = '/app/actions/users.server.js';

// `__actionWrap` only builds the recording Proxy when seed collection is on,
// so the wrap tests below have to say so. Identity registration is separate and
// unconditional, which the identity tests at the bottom of this file pin.
before(async () => { await registerActionHooks({ seed: true }); });

test('extractExportNames finds function / const / class / list / default exports', () => {
  const src = `
    'use server';
    export async function getUser(id) {}
    export function getPosts() {}
    export const VERSION = '1';
    export let counter = 0;
    export class Thing {}
    const a = 1, b = 2;
    export { a, b as bee };
    export default function () {}
  `;
  const { names, hasDefault, hasStar } = extractExportNames(src);
  assert.ok(names.includes('getUser'));
  assert.ok(names.includes('getPosts'));
  assert.ok(names.includes('VERSION'));
  assert.ok(names.includes('counter'));
  assert.ok(names.includes('Thing'));
  assert.ok(names.includes('a'));
  assert.ok(names.includes('bee'), 'the EXPORTED name of `b as bee` is `bee`');
  assert.ok(!names.includes('b'), 'the local name is not the exported binding');
  assert.equal(hasDefault, true);
  assert.equal(hasStar, false);
});

test('extractExportNames flags a star re-export (skips faceting)', () => {
  const { hasStar } = extractExportNames(`export * from './other.js';`);
  assert.equal(hasStar, true);
});

test('buildSeedFacade emits an export* catch-all so a MISSED export is fail-open (#535)', () => {
  // `export const { BRAND } = ...` is a destructuring export. The
  // identifier-after-`const` regex in extractExportNames does NOT match it, so
  // BRAND is the canonical "missed" export. Before the catch-all, the facade
  // omitted BRAND entirely, so `import { BRAND }` resolved to `undefined` and
  // crashed the importer. The facade must now carry BRAND via `export *`.
  const src =
    `'use server';\n` +
    `export async function getUser(id) { return id; }\n` +
    `export const { BRAND } = { BRAND: 'acme' };\n`;
  const facade = buildSeedFacade('file:///app/x.server.js', '/app/x.server.js', src);
  assert.ok(facade, 'a use-server module is faceted');
  assert.match(
    facade,
    /export \* from "file:\/\/\/app\/x\.server\.js\?webjs-seed-orig"/,
    'the facade re-exports everything via a star catch-all (the fail-open guard)',
  );
  assert.match(facade, /export const getUser = __w\(/, 'an enumerated export is still wrapped + seeded');
  assert.doesNotMatch(
    facade,
    /export const BRAND =/,
    'the destructuring export is NOT enumerated (the regex misses it), so it relies on the star',
  );
});

test('__actionWrap records a resolved async result inside a collector', async () => {
  const real = async (id) => ({ id, name: `user-${id}` });
  const wrapped = __actionWrap(FILE, 'getUser', real);
  const { value, collector } = await collectSeeds(async () => {
    return wrapped(5);
  });
  assert.deepEqual(value, { id: 5, name: 'user-5' });
  const hash = await hashFile(FILE);
  const key = `${hash}/getUser/${await stringify([5])}`;
  assert.ok(collector.has(key), `collector should hold key ${key}`);
  assert.deepEqual(collector.get(key), { id: 5, name: 'user-5' });
});

test('a streamed result (#489) is NOT seeded, and does not drop other seeds', async () => {
  const stream = __actionWrap(FILE, 'tokens', async function* () { yield 'a'; });
  const normal = __actionWrap(FILE, 'getUser', async (id) => ({ id }));
  const { collector } = await collectSeeds(async () => {
    const gen = stream(); // an async generator (streamable), must not record
    await normal(7);       // a normal value, must still record
    // Drain the generator so it actually runs, proving the guard is on the
    // RESULT shape (streamable), not on whether the value was consumed.
    for await (const _ of gen) { /* drain */ }
    return null;
  });
  const streamKey = `${await hashFile(FILE)}/tokens/${await stringify([])}`;
  const normalKey = `${await hashFile(FILE)}/getUser/${await stringify([7])}`;
  assert.equal(collector.has(streamKey), false, 'the streamed generator is not seeded');
  assert.ok(collector.has(normalKey), 'the normal action is still seeded alongside it');
  // The script must serialize cleanly (a recorded stream would have thrown here).
  const script = await buildSeedScript(collector);
  assert.match(script, /__webjs-seeds/);
});

test('__actionWrap is a passthrough OUTSIDE a collector (the RPC endpoint path)', async () => {
  let ran = false;
  const real = async () => { ran = true; return 42; };
  const wrapped = __actionWrap(FILE, 'fn', real);
  // No collectSeeds wrapper -> no ambient store -> no recording, just the call.
  const out = await wrapped();
  assert.equal(out, 42);
  assert.equal(ran, true);
});

test('__actionWrap passes a non-function export through untouched', () => {
  assert.equal(__actionWrap(FILE, 'VERSION', '1.0'), '1.0');
  const obj = { a: 1 };
  assert.equal(__actionWrap(FILE, 'CONFIG', obj), obj);
});

test('__actionWrap forwards a function\'s own custom properties through the Proxy', () => {
  // The facade Proxy must be transparent: any metadata a framework or app
  // attaches to the action function (its own enumerable / non-enumerable props)
  // is readable through the wrapper, so the wrap never hides attached config.
  const fn = async () => 'pong';
  /** @type any */ (fn).__custom = { method: 'GET', path: '/ping' };
  const wrapped = __actionWrap(FILE, 'ping', fn);
  assert.deepEqual(/** @type any */ (wrapped).__custom, { method: 'GET', path: '/ping' },
    'a custom property is read through the Proxy');
});

test('collectSeeds collects across a nested async chain, keyed by args', async () => {
  const getUser = __actionWrap(FILE, 'getUser', async (id) => ({ id }));
  const getPosts = __actionWrap(FILE, 'getPosts', async (uid) => [uid]);
  async function component(id) {
    const u = await getUser(id);
    const p = await getPosts(id);
    return `${u.id}/${p.length}`;
  }
  const { value, collector } = await collectSeeds(async () => {
    const a = await component(5);
    const b = await component(7);
    return `${a},${b}`;
  });
  assert.equal(value, '5/1,7/1');
  const hash = await hashFile(FILE);
  assert.ok(collector.has(`${hash}/getUser/${await stringify([5])}`));
  assert.ok(collector.has(`${hash}/getUser/${await stringify([7])}`));
  assert.ok(collector.has(`${hash}/getPosts/${await stringify([5])}`));
  assert.equal(collector.size, 4, 'one seed per distinct (fn, args) call');
});

test('the recorded key equals the key a client stub would compute', async () => {
  // The stub computes: takeSeed(HASH, fn, await stringify(args)). Prove the
  // server records under EXACTLY that key for the same args.
  const wrapped = __actionWrap(FILE, 'getUser', async (id) => id);
  const { collector } = await collectSeeds(async () => wrapped(99));
  const stubHash = await hashFile(FILE); // the stub embeds this same value
  const stubArgsKey = await stringify([99]); // the stub computes this client-side
  const stubKey = `${stubHash}/getUser/${stubArgsKey}`;
  assert.ok(collector.has(stubKey), 'server key matches the stub lookup key');
});

test('buildSeedScript: empty collector yields an empty string', async () => {
  assert.equal(await buildSeedScript(new Map()), '');
  assert.equal(await buildSeedScript(null), '');
});

test('buildSeedScript: emits an escaped application/json block that round-trips', async () => {
  const collector = new Map();
  collector.set('h/getUser/[1]', { id: 1, name: '<script>alert(1)</script>', joined: new Date('2020-01-01T00:00:00.000Z') });
  const html = await buildSeedScript(collector);
  assert.match(html, /^<script type="application\/json" id="__webjs-seeds">/);
  assert.match(html, /<\/script>$/);
  // No RAW `</script>` or angle brackets inside the payload (escaped to <).
  const inner = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
  assert.ok(!inner.includes('<'), 'no raw < inside the payload');
  assert.ok(!inner.includes('>'), 'no raw > inside the payload');
  // The client reads textContent and parse()s it: the escapes decode back.
  const obj = parse(inner);
  const seed = obj['h/getUser/[1]'];
  assert.equal(seed.name, '<script>alert(1)</script>', 'rich payload survives');
  assert.ok(seed.joined instanceof Date, 'Date round-trips through the seed wire');
  assert.equal(seed.joined.getUTCFullYear(), 2020);
});

// --- Identity (#1155) --------------------------------------------------------
//
// A bound `<form action=${action}>` resolves through this registry, so it has
// to be populated whatever the seed switch says. The two halves are tested
// apart because the seed switch is exactly what could accidentally gate both.

test('__actionWrap registers identity for the value it hands back', () => {
  const fn = async () => 'x';
  const out = __actionWrap(FILE, 'saveUser', fn);
  assert.deepEqual(actionIdentityOf(out), { file: FILE, fnName: 'saveUser' });
});

test('identity is registered for the ORIGINAL too, not only the wrapper', () => {
  // Which of the two a caller holds depends on the seed switch, and a page that
  // imported the module before the switch was read would otherwise resolve
  // nothing.
  const fn = async () => 'x';
  __actionWrap(FILE, 'saveUser', fn);
  assert.deepEqual(actionIdentityOf(fn), { file: FILE, fnName: 'saveUser' });
});

test('identity survives seed collection being turned off', async () => {
  await registerActionHooks({ seed: false });
  const fn = async () => 'x';
  const out = __actionWrap(FILE, 'offSwitch', fn);
  assert.equal(out, fn, 'with collection off there is no Proxy to pay for');
  assert.deepEqual(actionIdentityOf(out), { file: FILE, fnName: 'offSwitch' });
  await registerActionHooks({ seed: true });
});

test('a non-function export registers no identity', () => {
  assert.equal(actionIdentityOf(__actionWrap(FILE, 'VERSION', '1.0')), null);
  assert.equal(actionIdentityOf(undefined), null);
});
