/**
 * Integration test for the SSR action-seed LOAD HOOK (#472).
 *
 * `module.registerHooks` is process-global, so this lives in its own file (the
 * node test runner isolates files into separate processes). It proves the
 * facade actually intercepts a real `import` of a `'use server'` module:
 *   - a faceted action records into the ambient collector when called inside
 *     `collectSeeds`, and is a transparent passthrough outside it,
 *   - a `.server.js` WITHOUT `'use server'` is NOT faceted (no seeding),
 *   - a non-function export passes through.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { registerActionHooks, seedingEnabled, collectSeeds, actionIdentityOf } from '../../src/action-seed.js';
import { hashFile } from '../../src/actions.js';
import { stringify } from '@webjsdev/core';

let dir;
let actionUrl, utilUrl, exoticUrl, c1Url, c2Url, eagerUrl, eager2Url, collideUrl, constsUrl;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'webjs-seedhook-'));
  const action = join(dir, 'users.server.js');
  writeFileSync(
    action,
    `'use server';\n` +
      `export async function getUser(id) { return { id, name: 'user-' + id }; }\n` +
      `export const VERSION = '1.0';\n`,
  );
  // A `.server.js` WITHOUT the 'use server' directive: a server-only utility.
  const util = join(dir, 'helpers.server.js');
  writeFileSync(util, `export async function helper(x) { return x * 2; }\n`);
  // A `'use server'` module with an export the facade's regex MISSES: the
  // destructuring `export const { BRAND }` is not matched by the
  // identifier-after-`const` pattern, so it is the canonical fail-open case (#535).
  const exotic = join(dir, 'exotic.server.js');
  writeFileSync(
    exotic,
    `'use server';\n` +
      `export async function getThing(id) { return id * 10; }\n` +
      `export const { BRAND, REGION } = { BRAND: 'acme', REGION: 'us' };\n`,
  );
  actionUrl = pathToFileURL(action).toString();
  utilUrl = pathToFileURL(util).toString();
  exoticUrl = pathToFileURL(exotic).toString();

  // Circular re-export pair (#1208)
  const c1 = join(dir, 'c1.server.js');
  const c2 = join(dir, 'c2.server.js');
  writeFileSync(
    c1,
    `'use server';\n` +
      `export { helper } from './c2.server.js';\n` +
      `export async function ring(x) { return x + 1; }\n`,
  );
  writeFileSync(
    c2,
    `'use server';\n` +
      `export { ring } from './c1.server.js';\n` +
      `export async function helper(x) { return x * 2; }\n`,
  );
  c1Url = pathToFileURL(c1).toString();
  c2Url = pathToFileURL(c2).toString();

  // A circular pair where one module CALLS the other during its own module-body
  // evaluation, i.e. while the callee's facade body has not run yet. Only the
  // hoisted binding exists at that moment, so anything the exported function
  // reads from facade module scope must be hoisted too.
  const e1 = join(dir, 'e1.server.js');
  const e2 = join(dir, 'e2.server.js');
  writeFileSync(
    e1,
    `'use server';\n` +
      `export { helper } from './e2.server.js';\n` +
      `export async function ring(x) { return x + 1; }\n`,
  );
  writeFileSync(
    e2,
    `'use server';\n` +
      `import { ring } from './e1.server.js';\n` +
      `export const EAGER = ring(1);\n` +
      `export async function helper(x) { return x * 2; }\n`,
  );
  eagerUrl = pathToFileURL(e1).toString();
  eager2Url = pathToFileURL(e2).toString();

  // A module exporting a name that collides with the facade's memo-variable
  // naming scheme. A collision is a duplicate declaration in generated source,
  // which is a SyntaxError the load hook cannot catch.
  const collide = join(dir, 'collide.server.js');
  writeFileSync(
    collide,
    `'use server';\n` +
      `export async function ping() { return 1; }\n` +
      `export async function _fn_ping() { return 2; }\n`,
  );
  collideUrl = pathToFileURL(collide).toString();

  // A `'use server'` module whose non-function exports leave via an export LIST
  // rather than an inline `export const`.
  const consts = join(dir, 'consts.server.js');
  writeFileSync(
    consts,
    `'use server';\n` +
      `const VERSION = '2.0';\n` +
      `const LIMITS = { max: 10 };\n` +
      `async function fetchThing(id) { return id; }\n` +
      `export { VERSION, LIMITS, fetchThing };\n`,
  );
  constsUrl = pathToFileURL(consts).toString();

  // Install the global hook BEFORE importing the fixtures (ESM caches by URL).
  await registerActionHooks({ seed: true });
});

after(() => { rmSync(dir, { recursive: true, force: true }); });

test('registerActionHooks marks seeding enabled', () => {
  assert.equal(seedingEnabled(), true);
});

test('a faceted action records inside a collector and passes through outside', async () => {
  const mod = await import(actionUrl);
  assert.equal(typeof mod.getUser, 'function');
  assert.equal(mod.VERSION, '1.0', 'non-function export passes through the facade');

  // Inside a collector: records.
  const { value, collector } = await collectSeeds(async () => mod.getUser(3));
  assert.deepEqual(value, { id: 3, name: 'user-3' });
  const hash = await hashFile((await import('node:url')).fileURLToPath(actionUrl));
  assert.ok(collector.has(`${hash}/getUser/${await stringify([3])}`));

  // Outside a collector: transparent passthrough, no throw, correct value.
  const out = await mod.getUser(9);
  assert.deepEqual(out, { id: 9, name: 'user-9' });
});

test('a .server.js WITHOUT use server is NOT faceted (no seeding)', async () => {
  const mod = await import(utilUrl);
  const { value, collector } = await collectSeeds(async () => mod.helper(21));
  assert.equal(value, 42, 'the util still runs');
  assert.equal(collector.size, 0, 'a non-action util records no seed');
});

test('an export the facade regex MISSES flows through the export* catch-all, not undefined (#535)', async () => {
  const mod = await import(exoticUrl);
  // The catch-all carries the destructuring exports through unwrapped: they
  // RESOLVE (not undefined) instead of crashing the importer. Without the
  // `export * from '?webjs-seed-orig'` line in the facade, these are undefined.
  assert.equal(mod.BRAND, 'acme', 'a regex-missed export resolves through the catch-all (fail-open)');
  assert.equal(mod.REGION, 'us', 'every missed binding flows through, not just the first');
  // The enumerated export is still faceted: it records inside a collector.
  assert.equal(typeof mod.getThing, 'function');
  const { value, collector } = await collectSeeds(async () => mod.getThing(4));
  assert.equal(value, 40, 'the enumerated action still runs and is seeded');
  assert.equal(collector.size, 1, 'the enumerated action seeds; the missed (unwrapped) ones do not');
});

test('circular re-export between two use-server modules loads without throwing (#1208)', async () => {
  const mod1 = await import(c1Url);
  assert.equal(typeof mod1.ring, 'function');
  assert.equal(typeof mod1.helper, 'function');
  assert.equal(await mod1.ring(5), 6);
  assert.equal(await mod1.helper(5), 10);
});

test('a circular action CALLED during module evaluation loads without throwing (#1208)', async () => {
  // The stricter half of #1208. The test above imports the cycle and calls
  // afterwards, by which point every facade body has run, so it passes even if
  // the facade keeps per-function state in a `let`. Here `e2` calls back into
  // `e1.ring()` while `e1`'s facade body is still suspended on its own import,
  // so ONLY the hoisted function declaration exists. Any facade module-scope
  // binding the function body reads must therefore be hoisted as well: a `let`
  // memo throws `Cannot access '_fn_ring' before initialization` here and turns
  // the whole module load into a ReferenceError, which is precisely the failure
  // #1208 was filed for.
  const mod = await import(eagerUrl);
  assert.equal(await mod.ring(5), 6, 'the action still works after the cycle settles');
  // `EAGER` holds whatever the module-body call to `ring(1)` produced, so it is
  // the proof the call actually went through the facade rather than throwing.
  const mod2 = await import(eager2Url);
  assert.equal(await mod2.EAGER, 2, 'the load-time call resolved through the facade');
});

test('an export colliding with the memo naming scheme still loads (fail-open, no SyntaxError)', async () => {
  const mod = await import(collideUrl);
  assert.equal(await mod.ping(), 1);
  assert.equal(await mod._fn_ping(), 2);
});

test('a list-exported const stays a value, and a list-exported function stays callable', async () => {
  // The classification bug this pins: a non-function exported via `export { ... }`
  // used to land in the function bucket, so the facade emitted
  // `export function VERSION(...)` and importers received a callable instead of
  // the string. The sibling function in the same list must keep working.
  const mod = await import(constsUrl);
  assert.equal(mod.VERSION, '2.0', 'a list-exported string is a string, not a function');
  assert.deepEqual(mod.LIMITS, { max: 10 }, 'a list-exported object is the object');
  assert.equal(typeof mod.fetchThing, 'function');
  const { value, collector } = await collectSeeds(async () => mod.fetchThing(7));
  assert.equal(value, 7);
  assert.equal(collector.size, 1, 'the list-exported action is still faceted and seeds');
});

