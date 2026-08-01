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
let actionUrl, utilUrl, exoticUrl, c1Url, c2Url;

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

