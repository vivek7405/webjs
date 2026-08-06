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
  const { fnNames, valNames, names, hasDefault } = extractExportNames(src);
  assert.ok(names.includes('getUser'));
  assert.ok(names.includes('getPosts'));
  assert.ok(names.includes('VERSION'));
  assert.ok(names.includes('counter'));
  assert.ok(names.includes('Thing'));
  assert.ok(names.includes('a'));
  assert.ok(names.includes('bee'), 'the EXPORTED name of `b as bee` is `bee`');
  assert.ok(!names.includes('b'), 'the local name is not the exported binding');
  assert.equal(hasDefault, true);

  assert.deepEqual(fnNames.sort(), ['getUser', 'getPosts'].sort());
  assert.deepEqual(valNames.sort(), ['VERSION', 'counter', 'Thing', 'a', 'bee'].sort());
});

test('buildSeedFacade memoizes the action wrap behind a HOISTED (var) memo', () => {
  const src = `'use server';\nexport async function submitData(d) { return d; }\n`;
  const facade = buildSeedFacade('file:///app/s.server.js', '/app/s.server.js', src);
  assert.match(facade, /const fn = _fn_submitData \|\| \(_fn_submitData = __w\(/, 'the wrap is memoized, not redone per call');
  // `var`, not `let`. The exported function is hoisted so a circular
  // `'use server'` pair can call it before this facade's body runs (#1208); a
  // `let` memo would be in TDZ at that moment and throw. The runtime proof is
  // in seed-hook.test.js, but pin the emitted keyword here too, because this is
  // the line that silently re-breaks the cycle if someone "modernises" it.
  assert.match(facade, /var _fn_submitData;/);
  assert.doesNotMatch(facade, /let _fn_submitData;/);
});

test('a memo variable never collides with a real export name', () => {
  // A module exporting both `ping` and `_fn_ping` would emit `var _fn_ping`
  // beside `export function _fn_ping`: a duplicate declaration, i.e. a
  // SyntaxError in generated source. The load hook's try/catch cannot contain
  // that (the parse happens after the hook returns), so it would be a hard
  // crash rather than the fail-open degradation the feature promises.
  const src = `'use server';\nexport async function ping() {}\nexport async function _fn_ping() {}\n`;
  const facade = buildSeedFacade('file:///app/y.server.js', '/app/y.server.js', src);
  const declared = [...facade.matchAll(/^(?:var|export function) ([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.equal(new Set(declared).size, declared.length, `no duplicate declaration, got: ${declared.join(', ')}`);
});

test('export classification: value only on positive evidence, undecidable falls back to a function', () => {
  // The two buckets fail in opposite directions, so the fallback direction is
  // the decision: a VALUE emitted as a function is handed to importers as a
  // callable, while a FUNCTION emitted as a const loses the hoisting that makes
  // a circular re-export load (#1208). Only positive value evidence (literal /
  // object / `new` / class) may demote a name.
  const val = extractExportNames(
    `'use server';\nconst VERSION = '1.0';\nconst cache = new Map();\nconst cfg = { a: 1 };\nexport { VERSION, cache, cfg };\n`,
  );
  assert.deepEqual(val.fnNames, [], 'literal / new / object-literal consts are values, not callables');
  assert.deepEqual(val.valNames.sort(), ['VERSION', 'cache', 'cfg']);

  // A higher-order-wrapped action has a call-expression right-hand side, which
  // is undecidable, so it must stay in the hoisted bucket.
  const hof = extractExportNames(
    `'use server';\nconst createPost = withAuth(async (input) => input);\nexport { createPost };\n`,
  );
  assert.deepEqual(hof.fnNames, ['createPost']);
  assert.deepEqual(hof.valNames, []);

  // A name re-exported from ANOTHER module is never locally declared, so it can
  // never look like a value. This is the #1208 shape and must stay hoisted.
  const reexport = extractExportNames(
    `'use server';\nexport { helper } from './c2.server.js';\nexport async function ring(x) { return x + 1; }\n`,
  );
  assert.deepEqual(reexport.fnNames.sort(), ['helper', 'ring']);
  assert.deepEqual(reexport.valNames, []);
});

test('a TS-annotated direct export const arrow is a function, not a value', () => {
  // `export const create: Handler = async (i) => ...` is an ordinary shape, and
  // the direct-export regex only recognises a BARE `function` / arrow right-hand
  // side, so the annotation used to push it into the value bucket and cost it
  // the hoisting a circular import needs (#1208).
  const { fnNames, valNames } = extractExportNames(
    `'use server';\nexport const createTodo: Handler = async (i) => i;\n`,
  );
  assert.deepEqual(fnNames, ['createTodo']);
  assert.deepEqual(valNames, []);

  // The promotion is on positive function evidence only: a genuine value export
  // must not be dragged along with it.
  const plain = extractExportNames(`'use server';\nexport const VERSION = '1.0';\nexport const CFG = { a: 1 };\n`);
  assert.deepEqual(plain.fnNames, []);
  assert.deepEqual(plain.valNames.sort(), ['CFG', 'VERSION']);
});

test('extraction reads code position only, not comments or strings', () => {
  // The scan runs over a redacted copy, so a declaration written in prose
  // cannot demote a real exported function to a value binding.
  const src =
    `'use server';\n` +
    `// const submitOrder = 'not a real declaration';\n` +
    `const note = 'const submitOrder = 1';\n` +
    `export async function submitOrder(o) { return o; }\n` +
    `export { submitOrder as submit };\n`;
  const { fnNames, valNames } = extractExportNames(src);
  assert.ok(fnNames.includes('submit'), 'the commented-out const must not demote the export');
  assert.ok(!valNames.includes('submit'));
});

test('`export { default as X } from` does not fabricate a default export', () => {
  // It re-exports ANOTHER module's default under a named binding, so this
  // module has no default of its own. Claiming one makes the facade emit
  // `export default __w(..., __orig.default)`, i.e. `export default undefined`,
  // turning what was a loud link-time error for importers into a silent one.
  const { hasDefault } = extractExportNames(
    `'use server';\nexport { default as Helper } from './h.server.js';\nexport async function go() {}\n`,
  );
  assert.equal(hasDefault, false);
  const facade = buildSeedFacade(
    'file:///app/x.server.js',
    '/app/x.server.js',
    `'use server';\nexport { default as Helper } from './h.server.js';\nexport async function go() {}\n`,
  );
  assert.doesNotMatch(facade, /export default/);
});

test('a star re-export is FACETED, not passed through (#1155)', () => {
  // It used to bail out to a passthrough, on the reasoning that an
  // unenumerable re-export must not be silently dropped. #538 then gave the
  // facade its own `export * from` catch-all, which covers exactly that, and
  // the bail-out was left behind. Keeping it became a correctness bug once
  // action IDENTITY started riding the facade: a passthrough means the function
  // is never registered, so `<form action=${fn}>` throws "is not a server
  // action" at SSR while the same export works fine over RPC.
  const src =
    `'use server';\n` +
    `export * from './shared.server.js';\n` +
    `export async function createTodo(fd) { return fd; }\n`;
  const facade = buildSeedFacade('file:///app/t.server.js', '/app/t.server.js', src);
  assert.ok(facade, 'a star re-export is faceted like any other module');
  assert.match(facade, /export (?:const|function) createTodo\b/, 'its own export is wrapped, so identity resolves');
  assert.match(facade, /export \* from "file:\/\/\/app\/t\.server\.js\?webjs-seed-orig"/,
    'the star catch-all carries the re-exported bindings');
});

test('the word "export" in a comment does not change how a module loads', () => {
  // This used to be decided by a `/\bexport\s*\*/` test over the raw source,
  // and `\s*` spans newlines, so the word `export` ending a JSDoc line matched
  // the next line's leading `*` and suppressed the facade. Since identity rides
  // the facade, reflowing a doc comment could turn a working bound form into a
  // 500 on the page rendering it. There is no such test any more (the star case
  // facades like everything else), so the guarantee is now structural, and this
  // pins it end to end: prose in, a wrapped export out.
  const src =
    `'use server';\n` +
    `/**\n` +
    ` * Submit feedback. This module has exactly one export\n` +
    ` */\n` +
    `export async function submitFeedback(fd) { return fd; }\n`;
  const facade = buildSeedFacade('file:///app/f.server.js', '/app/f.server.js', src);
  assert.ok(facade, 'the module is faceted');
  assert.match(facade, /export (?:const|function) submitFeedback\b/, 'so its identity registers');
});

test('a re-exported action keeps the identity of its DEFINING module', () => {
  // A barrel (`export { createTodo } from './create.server.js'`) is faceted too,
  // and its body evaluates AFTER the module it re-exports from, so an
  // unconditional registration re-filed the function under the BARREL. The
  // dispatcher would then load the barrel to run it and read `validate` /
  // `middleware` / `method` / `invalidates` off a namespace carrying none of
  // them, running a form submission with the action's validation and auth
  // middleware silently skipped.
  const real = async () => 'ok';
  __actionWrap('/app/modules/todo/actions/create.server.js', 'createTodo', real);
  __actionWrap('/app/modules/todo/actions/index.server.js', 'createTodo', real);
  assert.deepEqual(actionIdentityOf(real), {
    file: '/app/modules/todo/actions/create.server.js',
    fnName: 'createTodo',
  });
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
  assert.match(facade, /export (?:const|function) getUser\b/, 'an enumerated export is still wrapped + seeded');
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

// --- Dev observability (#1309) ----------------------------------------------
//
// The determinism assertion is reached through `__actionWrap` + `collectSeeds`,
// the same path a real render takes. `registerActionHooks` sets `_seedEnabled`
// / `_devMode` BEFORE its `_registered` idempotency guard, so a second call in a
// test still flips the flags. Each test uses its own function NAME because the
// warning is deduped per `hash/fn` for the process lifetime.

/** Run `fn` with `console.warn` captured; returns the captured messages. */
async function withWarn(fn, impl) {
  const orig = console.warn;
  const seen = [];
  console.warn = impl || ((...a) => seen.push(a.join(' ')));
  try { await fn(); } finally { console.warn = orig; }
  return seen;
}

/** One `collectSeeds` render calling `fn` through the wrap with each arg list. */
async function renderCalling(fnName, impl, argLists) {
  const wrapped = __actionWrap(FILE, fnName, impl);
  return collectSeeds(async () => { for (const args of argLists) await wrapped(...args); });
}

test('dev warns once when one render returns two DIFFERENT results for the same args', async () => {
  await registerActionHooks({ seed: true, dev: true });
  let n = 0;
  const warns = await withWarn(() => renderCalling('flaky', async () => ({ n: ++n }), [[1], [1], [1]]));
  assert.equal(warns.length, 1, 'deduped per action function, however many duplicates');
  assert.match(warns[0], /two DIFFERENT results for the SAME arguments/);
  assert.match(warns[0], /"flaky"/);
});

test('dev does NOT warn for structurally equal but distinct objects', async () => {
  await registerActionHooks({ seed: true, dev: true });
  // `Object.is` fails on two fresh objects, so this only passes if the fallback
  // compares through the serializer, which is what actually reaches a client.
  const warns = await withWarn(() => renderCalling('fresh', async () => ({ id: 1, at: new Date(0) }), [[1], [1]]));
  assert.deepEqual(warns, []);
});

test('dev does NOT warn for the same function called with DIFFERENT args', async () => {
  await registerActionHooks({ seed: true, dev: true });
  // The counterfactual for comparing on the FULL key: keying the check on
  // `hash/fn` makes this fire on every legitimate second call.
  const warns = await withWarn(() => renderCalling('perArg', async (id) => ({ id }), [[1], [2], [3]]));
  assert.deepEqual(warns, []);
});

test('the determinism assertion is dev-only', async () => {
  await registerActionHooks({ seed: true, dev: false });
  let n = 0;
  const warns = await withWarn(() => renderCalling('prodFlaky', async () => ({ n: ++n }), [[1], [1]]));
  assert.deepEqual(warns, []);
  await registerActionHooks({ seed: true, dev: true });
});

test('fail-open: a throwing console.warn still records the seed and still emits the block', async () => {
  await registerActionHooks({ seed: true, dev: true });
  let n = 0;
  let collector;
  await withWarn(
    async () => { ({ collector } = await renderCalling('throwyWarn', async () => ({ n: ++n }), [[1], [1]])); },
    () => { throw new Error('logger exploded'); },
  );
  const key = `${await hashFile(FILE)}/throwyWarn/${await stringify([1])}`;
  assert.ok(collector.has(key), 'the seed is recorded even when the diagnostic throws');
  assert.deepEqual(collector.get(key), { n: 2 }, 'the LAST result wins, as documented');
  const html = await buildSeedScript(collector);
  assert.ok(html.includes('__webjs-seeds'), 'the block still serializes');
});

test('buildSeedScript: the dev marker is emitted even for an EMPTY collector', async () => {
  const empty = await buildSeedScript(new Map(), { dev: true });
  assert.match(empty, /^<script type="application\/json" id="__webjs-seeds" data-webjs-dev="ok">/);
  // The body is a real (empty) payload, so the client's `ingest` parses it and
  // reads the marker rather than bailing on a malformed block.
  assert.deepEqual(parse(empty.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')), {});
  assert.match(await buildSeedScript(null, { dev: true, reason: 'streamed' }), /data-webjs-dev="streamed"/);
});

test('buildSeedScript: prod output is byte-identical to before the marker', async () => {
  // The prod-leak counterfactual. Passing `dev: false` (or nothing) must not
  // change a single byte of what shipped before #1309.
  assert.equal(await buildSeedScript(new Map()), '');
  assert.equal(await buildSeedScript(new Map(), { dev: false }), '');
  assert.equal(await buildSeedScript(null, {}), '');
  const collector = new Map([['h/f/[1]', { ok: true }]]);
  const bare = await buildSeedScript(collector);
  assert.equal(await buildSeedScript(collector, { dev: false }), bare);
  assert.equal(await buildSeedScript(collector, { reason: 'streamed' }), bare);
  assert.ok(!bare.includes('data-webjs-dev'), 'no marker attribute in prod');
});
