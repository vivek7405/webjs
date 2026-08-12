import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildModuleGraph, bareImports, dynamicBareImports } from '../../src/module-graph.js';

/**
 * A bare npm vendor specifier (`dayjs`, `@scope/pkg/sub`) is recorded as a
 * SEPARATE edge class (#754), parallel to the dynamic edges of #751. The static
 * app graph still only tracks relative + `#`-alias edges (so the auth gate /
 * elision are unchanged), but the exact bare specifier is kept so SSR can look
 * it up in the vendor importmap and emit a `modulepreload` for the reached
 * vendor URL, flattening the cross-origin CDN waterfall. Builtins and protocol
 * specifiers are excluded; an html-template example import is masked out.
 */

async function makeApp(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-bareimport-'));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}

test('a bare vendor import is recorded as a bare edge, not a static edge', async () => {
  const dir = await makeApp({
    'components/clock.ts': `import dayjs from 'dayjs';
      export const now = () => dayjs();`,
  });
  const graph = await buildModuleGraph(dir);
  const clock = join(dir, 'components/clock.ts');

  const bare = bareImports(graph);
  assert.ok(bare.get(clock)?.has('dayjs'), 'recorded as a bare (vendor) edge');
  // It is NOT a static graph edge (the gate / elision never resolve it locally).
  assert.ok(!graph.get(clock), 'a file whose only import is a vendor has no static deps');
});

test('the exact specifier (scope + subpath) is preserved', async () => {
  const dir = await makeApp({
    'components/util.ts': `import utc from 'dayjs/plugin/utc';
      import { z } from '@scope/pkg/sub';
      export const u = [utc, z];`,
  });
  const graph = await buildModuleGraph(dir);
  const util = join(dir, 'components/util.ts');
  const bare = bareImports(graph);
  assert.ok(bare.get(util)?.has('dayjs/plugin/utc'), 'subpath specifier kept verbatim');
  assert.ok(bare.get(util)?.has('@scope/pkg/sub'), 'scoped subpath specifier kept verbatim');
});

test('node: builtins and protocol specifiers are NOT bare edges', async () => {
  const dir = await makeApp({
    'components/srv.ts': `import { readFile } from 'node:fs/promises';
      import data from 'data:text/javascript,export default 1';
      import x from 'https://example.com/x.js';
      export const y = [readFile, data, x];`,
  });
  const graph = await buildModuleGraph(dir);
  const srv = join(dir, 'components/srv.ts');
  const set = bareImports(graph).get(srv) || new Set();
  assert.ok(!set.has('node:fs/promises'), 'node: builtin excluded');
  assert.ok(![...set].some((s) => s.startsWith('data:')), 'data: url excluded');
  assert.ok(![...set].some((s) => s.startsWith('https:')), 'absolute url excluded');
});

test('relative + #-alias imports stay static (not bare edges)', async () => {
  const dir = await makeApp({
    'components/host.ts': `import { sib } from './sib.ts';
      import { lib } from '#lib/util.ts';
      import dayjs from 'dayjs';
      export const v = [sib, lib, dayjs];`,
    'components/sib.ts': `export const sib = 1;`,
    'lib/util.ts': `export const lib = 1;`,
    'package.json': JSON.stringify({ name: 'app', type: 'module', imports: { '#*': './*' } }),
  });
  const graph = await buildModuleGraph(dir);
  const host = join(dir, 'components/host.ts');
  const bare = bareImports(graph).get(host) || new Set();
  assert.deepEqual([...bare], ['dayjs'], 'only the vendor is a bare edge');
  // The relative + alias targets ARE static graph edges.
  assert.ok(graph.get(host)?.has(join(dir, 'components/sib.ts')), 'relative is a static edge');
  assert.ok(graph.get(host)?.has(join(dir, 'lib/util.ts')), '#-alias is a static edge');
});

test('a bare import inside an html template is masked out', async () => {
  const dir = await makeApp({
    'components/doc.ts': `import { html } from '@webjsdev/core';
      export const tpl = html\`<pre>import x from 'left-pad';</pre>\`;`,
  });
  const graph = await buildModuleGraph(dir);
  const doc = join(dir, 'components/doc.ts');
  const set = bareImports(graph).get(doc) || new Set();
  // The real @webjsdev/core import is a bare edge; the example inside the
  // template is masked (an analyser never treats example code as an edge).
  assert.ok(set.has('@webjsdev/core'), 'the real vendor import is a bare edge');
  assert.ok(!set.has('left-pad'), 'the templated example import is masked out');
});

test('a real top-level export...from spanning a template body is not a phantom vendor edge', async () => {
  // The EXPORT_FROM_RE counterfactual: here the REAL `export const tpl` keyword
  // is top-level code (NOT blanked), and its lazy `[^'";]+?` reaches a `from
  // 'phantom-pkg'` written INSIDE the template body. The keyword-position mask
  // check does not catch this (the keyword is real); only the specifier
  // opening-quote check does. Reverting that guard re-introduces the phantom
  // `phantom-pkg` vendor edge (and a spurious modulepreload), which this asserts.
  const dir = await makeApp({
    'components/doc.ts': `import { html } from '@webjsdev/core';
      export const tpl = html\`<aside>export { y } from 'phantom-pkg';</aside>\`;`,
  });
  const graph = await buildModuleGraph(dir);
  const doc = join(dir, 'components/doc.ts');
  const set = bareImports(graph).get(doc) || new Set();
  assert.ok(set.has('@webjsdev/core'), 'the real top-level import is a bare edge');
  assert.ok(!set.has('phantom-pkg'),
    'a from-spec reached by EXPORT_FROM_RE spanning into a template is NOT an edge');
});

test('bare edges survive the parse cache on rebuild', async () => {
  const dir = await makeApp({
    'components/clock.ts': `import dayjs from 'dayjs'; export const n = dayjs;`,
  });
  const clock = join(dir, 'components/clock.ts');
  await buildModuleGraph(dir); // warms the parse cache
  // Touch nothing: a second build reads the cached entry (same mtime + size),
  // which must still carry bareDeps.
  const graph2 = await buildModuleGraph(dir);
  assert.ok(bareImports(graph2).get(clock)?.has('dayjs'), 'cached rebuild keeps the bare edge');
});

// --- dynamically-imported vendors (#1399) ---
//
// `await import('dayjs')` needs an importmap entry (or the import fails to
// resolve when it runs) but must NOT be preloaded (lazy by author intent), so
// it is recorded in its own map rather than in `bareImports`, which is what
// the #754 modulepreload hints read.

test('a dynamically-imported vendor is a dynamic bare edge, not a static one', async () => {
  const dir = await makeApp({
    'components/chart.ts': `export async function load() { return import('chart-pkg'); }`,
  });
  const graph = await buildModuleGraph(dir);
  const chart = join(dir, 'components/chart.ts');
  assert.ok(dynamicBareImports(graph).get(chart)?.has('chart-pkg'), 'recorded as a dynamic bare edge');
  assert.ok(!bareImports(graph).get(chart)?.has('chart-pkg'),
    'must stay out of the preload source: the author deferred this fetch');
});

test('a statically AND dynamically imported vendor appears in both maps', async () => {
  const dir = await makeApp({
    'components/both.ts': `import dayjs from 'dayjs';
      export async function more() { return import('dayjs/plugin/utc'); }
      export const d = dayjs;`,
  });
  const graph = await buildModuleGraph(dir);
  const both = join(dir, 'components/both.ts');
  assert.ok(bareImports(graph).get(both)?.has('dayjs'), 'the static one preloads');
  assert.ok(dynamicBareImports(graph).get(both)?.has('dayjs/plugin/utc'), 'the dynamic one does not');
  assert.ok(!bareImports(graph).get(both)?.has('dayjs/plugin/utc'));
});

test('dynamic bare edges survive the parse cache on rebuild', async () => {
  const dir = await makeApp({
    'components/lazy.ts': `export const go = () => import('lazy-pkg');`,
  });
  const lazy = join(dir, 'components/lazy.ts');
  await buildModuleGraph(dir); // warms the parse cache
  const graph2 = await buildModuleGraph(dir);
  assert.ok(dynamicBareImports(graph2).get(lazy)?.has('lazy-pkg'), 'cached rebuild keeps the dynamic bare edge');
});

test('a dynamic import written as example text is not a dynamic bare edge', async () => {
  const dir = await makeApp({
    'components/docs.ts': `export const SAMPLE = \`await import('phantom-pkg')\`;
      export const real = () => import('real-lazy-pkg');`,
  });
  const graph = await buildModuleGraph(dir);
  const docs = join(dir, 'components/docs.ts');
  const found = dynamicBareImports(graph).get(docs);
  assert.ok(found?.has('real-lazy-pkg'), 'the real dynamic import is an edge');
  assert.ok(!found?.has('phantom-pkg'), 'a template-literal sample is not an edge');
});

// --- scanner robustness (moved here from the vendor tests in #1399, where the
// filesystem walk they exercised used to live) ---

test('handles CRLF line endings', async () => {
  const dir = await makeApp({ 'components/a.ts': "import 'crlf-pkg-a';\r\nimport 'crlf-pkg-b';\r\n" });
  const graph = await buildModuleGraph(dir);
  const bare = bareImports(graph).get(join(dir, 'components/a.ts'));
  assert.ok(bare?.has('crlf-pkg-a'), 'CRLF line should not hide imports');
  assert.ok(bare?.has('crlf-pkg-b'));
});

test('handles a UTF-8 BOM at file start', async () => {
  // UTF-8 BOM is the three bytes 0xEF 0xBB 0xBF.
  const dir = await makeApp({ 'components/a.ts': '﻿' + "import 'bom-pkg';" });
  const graph = await buildModuleGraph(dir);
  assert.ok(bareImports(graph).get(join(dir, 'components/a.ts'))?.has('bom-pkg'),
    'BOM at file start should not hide the first import');
});

test('does not crash on an unterminated string literal', async () => {
  // User mid-edit: a half-written file. The scan is regex-based over a
  // redaction mask, so it tolerates this; Node would still fail to LOAD the
  // file, but the scan stays correct for every OTHER file in the project.
  const dir = await makeApp({
    'components/broken.ts': "import 'unterminated\n// some other code",
    'components/ok.ts': "import 'still-found';",
  });
  const graph = await buildModuleGraph(dir);
  // We do not assert what the broken file yields, only that it did not stop
  // the walk.
  assert.ok(bareImports(graph).get(join(dir, 'components/ok.ts'))?.has('still-found'),
    'a broken file must not stop the scan');
});

test('handles a multi-MB file without exploding memory or time', async () => {
  const padding = Array(50000).fill('// boring line\n').join('');
  const dir = await makeApp({ 'components/big.ts': padding + "import 'buried-import';\n" + padding });
  const t0 = Date.now();
  const graph = await buildModuleGraph(dir);
  const elapsed = Date.now() - t0;
  assert.ok(bareImports(graph).get(join(dir, 'components/big.ts'))?.has('buried-import'),
    'an import buried in a large file must be found');
  assert.ok(elapsed < 5000, `scan should complete in under 5s; took ${elapsed}ms`);
});

test('an import string inside a comment is not a bare edge (JSDoc examples etc.)', async () => {
  const dir = await makeApp({
    'components/a.ts': `
    /**
     * Example usage:
     *   import { clsx } from 'clsx';
     */
    // import 'commented-out-pkg';
    import real from 'real-only-pkg';
    export const r = real;
  `,
  });
  const graph = await buildModuleGraph(dir);
  const bare = bareImports(graph).get(join(dir, 'components/a.ts'));
  assert.ok(bare?.has('real-only-pkg'));
  assert.ok(!bare?.has('clsx'), 'a JSDoc-comment import must be skipped');
  assert.ok(!bare?.has('commented-out-pkg'), 'a line-comment import must be skipped');
});
