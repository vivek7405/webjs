import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { scanBareImports, reachedBareImports, prunePinToReachable } from '../../src/vendor.js';
import { buildModuleGraph } from '../../src/module-graph.js';
import { browserEntryFiles } from '../../src/browser-entries.js';
import { scanComponents } from '../../src/component-scanner.js';
import { buildRouteTable } from '../../src/router.js';
import { analyzeElision } from '../../src/component-elision.js';

/**
 * The pin/runtime parity invariant (#197, #446), asserted directly rather than
 * left implicit inside a scan test.
 *
 * A pinned app and an unpinned app must serve the SAME importmap. That holds
 * not because the two sides compute the same set, but because the runtime
 * INTERSECTS a committed pin down to its own reachable set via
 * `prunePinToReachable`. Which only works while the pin is a SUPERSET of the
 * runtime set, so the two sides are deliberately asymmetric (#1399):
 *
 *   - pin side (`scanBareImports`, used by `pinAll` / `webjs doctor`): rooted
 *     at the browser-bound entries with NO elision analysis. Cheaper, and a
 *     superset by construction.
 *   - runtime side (`reachedBareImports` with the dev server's skip set):
 *     the same roots, additionally pruned of elided / inert / import-only
 *     modules and the subtrees behind them.
 *
 * This file is what fails if a future change narrows the pin path without
 * narrowing the runtime path.
 */

async function makeApp(files) {
  const dir = join(tmpdir(), `webjs-test-scan-parity-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'parity-fixture', private: true }));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}

/** The three analyses `dev.js` runs, plus the skip set it derives from them. */
async function runtimeScan(dir) {
  const graph = await buildModuleGraph(dir);
  const components = await scanComponents(dir);
  const routeTable = await buildRouteTable(dir);
  const routeModules = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) routeModules.add(page.file);
    for (const f of page.layouts || []) routeModules.add(f);
  }
  const r = await analyzeElision(components, [...routeModules], graph, (f) => readFile(f, 'utf8'), dir);
  const skip = new Set([...r.elidableComponents, ...r.inertRouteModules, ...r.importOnlyRouteModules.keys()]);
  return reachedBareImports(graph, [...browserEntryFiles(routeTable, components)], dir, skip);
}

test('the runtime vendor set is a subset of the pin set, and a build script is in neither', async () => {
  const dir = await makeApp({
    'app/page.ts': `import '../components/counter.ts';
      import '../components/badge.ts';
      export default function Page() { return null; }`,
    // Shipping: an @click is an interactivity signal, so it is never elided.
    'components/counter.ts': `import { WebComponent, html, prop } from '@webjsdev/core';
      import { z } from 'zod';
      class Counter extends WebComponent({ count: prop(Number) }) {
        render() { return html\`<button @click=\${() => this.count++}>\${z}\${this.count}</button>\`; }
      }
      Counter.register('x-counter');`,
    // Display-only: no interactivity signal, so elision drops it and dayjs
    // with it (the #170 property).
    'components/badge.ts': `import { WebComponent, html } from '@webjsdev/core';
      import dayjs from 'dayjs';
      class Badge extends WebComponent({}) {
        render() { return html\`<span>\${dayjs().format()}</span>\`; }
      }
      Badge.register('x-badge');`,
    // Unreachable from any browser entry: the #1399 repro.
    'scripts/build.mjs': `import { chromium } from 'playwright';\nexport const c = chromium;`,
  });

  const pin = await scanBareImports(dir);
  const runtime = await runtimeScan(dir);

  assert.ok([...runtime].every((s) => pin.has(s)),
    `runtime must be a subset of pin; runtime=${JSON.stringify([...runtime])} pin=${JSON.stringify([...pin])}`);
  assert.ok(pin.has('zod') && runtime.has('zod'), 'a shipping vendor is in both');
  assert.ok(pin.has('dayjs'), 'the pin superset keeps an elided-only vendor');
  assert.ok(!runtime.has('dayjs'), 'the runtime set drops an elided-only vendor');
  assert.ok(!pin.has('playwright') && !runtime.has('playwright'),
    'an unreachable build script is in neither set');

  // The served-map parity statement, in the terms #197 wrote it: a committed
  // pin, pruned to the runtime's reachable set, serves what an unpinned app
  // serves.
  const pinAsImportMap = Object.fromEntries([...pin].map((s) => [s, `https://cdn.example.com/${s}.js`]));
  const { imports } = prunePinToReachable(pinAsImportMap, {}, runtime);
  assert.ok(!('dayjs' in imports), 'a pinned app serves no dayjs entry either');
  assert.ok('zod' in imports, 'the shipping vendor survives the prune');

  await rm(dir, { recursive: true, force: true });
});
