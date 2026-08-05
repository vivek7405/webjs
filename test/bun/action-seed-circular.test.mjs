/**
 * Bun parity test for circular re-exports between 'use server' modules (#1208).
 *
 * Proves that two 'use server' modules that re-export from each other load
 * without throwing ReferenceError on Bun as well as Node.
 *
 * The facade SOURCE is runtime-neutral (Bun and Node both call
 * `buildSeedFacade`), so a hoisting or export-classification mistake in it is a
 * cross-runtime bug. Only the INSTALL differs: Bun goes through a `Bun.plugin`
 * `onLoad`, which must return contents for EVERY filter match, so a facade
 * change that throws degrades differently there than under Node's `nextLoad`.
 * That is why the classification and load-time-call cases are asserted on Bun
 * too rather than trusted to the Node suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { seedingEnabled, registerActionHooks } from '../../packages/server/src/action-seed.js';

test('circular re-export between use-server modules loads on Bun / Node (#1208)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-bun-circular-'));
  try {
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

    if (!seedingEnabled()) await registerActionHooks({ seed: true });

    const c1Url = pathToFileURL(c1).toString();
    const mod1 = await import(c1Url);
    assert.equal(typeof mod1.ring, 'function');
    assert.equal(typeof mod1.helper, 'function');
    assert.equal(await mod1.ring(10), 11);
    assert.equal(await mod1.helper(10), 20);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a circular action CALLED during module evaluation loads on Bun / Node (#1208)', async () => {
  // The stricter half: `e2` calls back into `e1.ring()` while `e1`'s facade body
  // is still suspended on its own import, so only the hoisted function
  // declaration exists. Any facade module-scope binding the function body reads
  // must be hoisted too, or the whole load is a ReferenceError.
  const dir = mkdtempSync(join(tmpdir(), 'webjs-bun-eager-'));
  try {
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

    if (!seedingEnabled()) await registerActionHooks({ seed: true });

    const mod1 = await import(pathToFileURL(e1).toString());
    assert.equal(await mod1.ring(5), 6);
    const mod2 = await import(pathToFileURL(e2).toString());
    assert.equal(await mod2.EAGER, 2, 'the load-time call resolved through the facade');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list-exported values stay values on Bun / Node', async () => {
  // The facade classifies each export into a hoisted function or a plain value
  // binding. A value misclassified as a function reaches importers as a
  // callable, which is a wrong-data bug rather than a crash, so it needs a
  // runtime assertion on both runtimes.
  const dir = mkdtempSync(join(tmpdir(), 'webjs-bun-consts-'));
  try {
    const f = join(dir, 'consts.server.js');
    writeFileSync(
      f,
      `'use server';\n` +
        `const VERSION = '2.0';\n` +
        `const LIMITS = { max: 10 };\n` +
        `async function fetchThing(id) { return id; }\n` +
        `export { VERSION, LIMITS, fetchThing };\n`,
    );

    if (!seedingEnabled()) await registerActionHooks({ seed: true });

    const mod = await import(pathToFileURL(f).toString());
    assert.equal(mod.VERSION, '2.0', 'a list-exported string is a string, not a function');
    assert.deepEqual(mod.LIMITS, { max: 10 });
    assert.equal(typeof mod.fetchThing, 'function');
    assert.equal(await mod.fetchThing(7), 7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
