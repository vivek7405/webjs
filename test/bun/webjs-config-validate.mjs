/**
 * Cross-runtime proof that boot-time config validation (#1300) warns and lets
 * the boot continue on BOTH Node and Bun. It sits inside `createRequestHandler`,
 * which is the boot path the node:http shell and the `Bun.serve` shell both go
 * through, so it is runtime-sensitive by AGENTS.md's own wording. Run from the
 * repo root:
 *
 *   node test/bun/webjs-config-validate.mjs
 *   bun  test/bun/webjs-config-validate.mjs
 *
 * Asserts, on whichever runtime executes it: a typo'd key in the package.json
 * config block produces exactly one warning, the handler still boots and serves,
 * and a clean config warns not at all. The failure this guards against is a
 * runtime where the schema read or the boot wiring behaves differently and turns
 * a warning into a dead app.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequestHandler } from '../../packages/server/src/dev.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const CONFIG_WARNING = 'block in package.json has';

function makeApp(block) {
  const appDir = mkdtempSync(join(tmpdir(), 'webjs-cfg-validate-'));
  mkdirSync(join(appDir, 'app'), { recursive: true });
  writeFileSync(join(appDir, 'app', 'page.js'), `export default function Home() { return 'home'; }\n`);
  writeFileSync(
    join(appDir, 'package.json'),
    JSON.stringify({ name: 'fixture', type: 'module', webjs: block }),
  );
  return appDir;
}

function capturingLogger() {
  const warns = [];
  return { warns, logger: { info: () => {}, warn: (m) => warns.push(String(m)), error: () => {} } };
}

// A typo'd key warns once, and the app still boots and serves.
{
  const { warns, logger } = capturingLogger();
  const h = await createRequestHandler({ appDir: makeApp({ redirect: [] }), dev: false, logger });
  await h.warmup?.();
  const res = await h.handle(new Request('http://localhost/'));
  assert.equal(res.status, 200, `a config typo cost the app its boot on ${runtime}`);

  const found = warns.filter((w) => w.includes(CONFIG_WARNING));
  assert.equal(found.length, 1, `expected one config warning on ${runtime}, got ${found.length}`);
  assert.match(found[0], /redirect/, `the warning did not name the typo on ${runtime}`);
}

// A clean config says nothing, so a healthy app's boot output is unchanged.
{
  const { warns, logger } = capturingLogger();
  const h = await createRequestHandler({
    appDir: makeApp({ elide: false, trailingSlash: 'never' }),
    dev: false,
    logger,
  });
  await h.warmup?.();
  assert.deepEqual(
    warns.filter((w) => w.includes(CONFIG_WARNING)),
    [],
    `a clean config warned on ${runtime}`,
  );
}

console.log(`config validation warns and boots on ${runtime}`);
