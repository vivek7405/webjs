/**
 * Cross-runtime proof that the vendor specifier scan (#1399) is IDENTICAL
 * under whichever runtime runs it:
 *
 *   node test/bun/vendor-scan.mjs
 *   bun  test/bun/vendor-scan.mjs
 *
 * WebJs runs on Node 24+ AND Bun (#508), and an app scaffolded with `--runtime
 * bun` runs its whole analysis under Bun, so a vendor set that differed
 * between runtimes would serve a Bun author a different importmap from the
 * same source. The scan is `readdir` plus regular expressions over a redaction
 * mask with no runtime-specific API, so there is nothing legitimate to skip
 * and this file carries no DENYLIST entry.
 *
 * Both entry points are asserted, because they answer deliberately different
 * questions and the relation between them is load-bearing: `scanBareImports`
 * is the out-of-process pin-side superset (no elision pruning) and
 * `reachedBareImports` is the dev server's in-process runtime set (pruned).
 * `prunePinToReachable` intersects the first down to the second, so a runtime
 * set that stopped being a subset would break pinned/unpinned parity (#197).
 *
 * Imports are RELATIVE on purpose: a bare `@webjsdev/server` specifier
 * resolves through the primary checkout's node_modules in a linked worktree,
 * which would test a different copy of the source than the branch. Run from
 * the repo root so `@webjsdev/core` resolves for the fixture's components.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanBareImports, reachedBareImports } from '../../packages/server/src/vendor.js';
import { buildModuleGraph } from '../../packages/server/src/module-graph.js';
import { browserEntryFiles } from '../../packages/server/src/browser-entries.js';
import { scanComponents } from '../../packages/server/src/component-scanner.js';
import { buildRouteTable } from '../../packages/server/src/router.js';
import { analyzeElision } from '../../packages/server/src/component-elision.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const dir = mkdtempSync(join(tmpdir(), 'webjs-vendor-scan-x-'));

const write = (rel, src) => {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, src);
};

try {
  write('package.json', JSON.stringify({ name: 'vendor-scan-fixture', type: 'module' }));

  // Interactive: an @event binding ships it, so its vendor is in BOTH sets.
  write('components/counter.js', `
import { WebComponent, html } from '@webjsdev/core';
import { z } from 'zod';
export class Counter extends WebComponent {
  render() { return html\`<button @click=\${() => {}}>\${z}</button>\`; }
}
Counter.register('my-counter');
`);
  // Display-only: elided, so its vendor is in the pin superset only (#170).
  write('components/badge.js', `
import { WebComponent, html } from '@webjsdev/core';
import dayjs from 'dayjs';
export class Badge extends WebComponent {
  render() { return html\`<span>\${dayjs().format()}</span>\`; }
}
Badge.register('my-badge');
`);
  // Server-only: reached (the browser fetches a stub) but its source never
  // ships, so its driver import must not be vendored.
  write('lib/db.server.js', "import pg from 'pg';\nexport const db = pg;");
  // Unreachable from any browser entry: the literal #1399 repro.
  write('scripts/generate-og.mjs', "import { chromium } from 'playwright';\nexport const c = chromium;");
  // A browser entry `buildRouteTable` does not discover (dev.js attaches it
  // separately), so both sides have to attach it or the subset relation breaks.
  write('instrumentation-client.js', "import * as a from 'analytics-sdk';\na.init();");
  // A docs code sample in a template literal. The old comment-only scanner
  // could not tell it from a real import.
  write('app/page.js', `
import { html } from '@webjsdev/core';
import '../components/counter.js';
import '../components/badge.js';
import '../lib/db.server.js';
export const SAMPLE = \`import { eq } from 'drizzle-orm';\`;
export default () => html\`<my-counter></my-counter><my-badge></my-badge>\`;
`);

  const pin = [...await scanBareImports(dir)].sort();

  const graph = await buildModuleGraph(dir);
  const components = await scanComponents(dir);
  const routeTable = await buildRouteTable(dir);
  const routeModules = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) routeModules.add(page.file);
    for (const f of page.layouts || []) routeModules.add(f);
  }
  const r = await analyzeElision(components, [...routeModules], graph, async (f) => readFileSync(f, 'utf8'), dir);
  const skip = new Set([...r.elidableComponents, ...r.inertRouteModules, ...r.importOnlyRouteModules.keys()]);
  const rt = [...reachedBareImports(graph, [...browserEntryFiles(routeTable, components)], dir, skip)].sort();

  assert.deepEqual(pin, ['analytics-sdk', 'dayjs', 'zod'],
    'pin side: reachable vendors with no elision pruning, so the elided badge keeps dayjs and '
    + 'instrumentation-client keeps analytics-sdk; pg is behind a server boundary and '
    + 'playwright / drizzle-orm were never edges');
  assert.deepEqual(rt, ['analytics-sdk', 'zod'],
    'runtime side: the same roots, pruned of the elided component and the subtree behind it');
  assert.ok(rt.every((s) => pin.includes(s)),
    'the runtime set must stay a subset of the pin set (#197 relies on it)');

  console.log(`OK  vendor scan is identical on ${runtime}: pin=${JSON.stringify(pin)} runtime=${JSON.stringify(rt)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
