/**
 * Bun parity test for circular re-exports between 'use server' modules (#1208).
 *
 * Proves that two 'use server' modules that re-export from each other load
 * without throwing ReferenceError on Bun as well as Node.
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
