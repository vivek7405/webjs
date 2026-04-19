import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildModuleGraph, transitiveDeps } from '../packages/server/src/module-graph.js';

test('buildModuleGraph: builds graph from source files', async () => {
  const dir = join(tmpdir(), `webjs-test-graph-${Date.now()}`);
  await mkdir(join(dir, 'components'), { recursive: true });

  await writeFile(join(dir, 'page.ts'), `
    import { html } from '@webjskit/core';
    import './components/counter.ts';
    import './components/header.ts';
  `);
  await writeFile(join(dir, 'components', 'counter.ts'), `
    import { WebComponent, html } from '@webjskit/core';
    import './shared.ts';
  `);
  await writeFile(join(dir, 'components', 'header.ts'), `
    import { WebComponent, html } from '@webjskit/core';
    import './shared.ts';
  `);
  await writeFile(join(dir, 'components', 'shared.ts'), `
    export const VERSION = '1.0';
  `);

  const graph = await buildModuleGraph(dir);

  // page.ts should import counter and header
  const pageDeps = graph.get(join(dir, 'page.ts'));
  assert.ok(pageDeps, 'page.ts should have deps');
  assert.ok(pageDeps.has(join(dir, 'components', 'counter.ts')));
  assert.ok(pageDeps.has(join(dir, 'components', 'header.ts')));

  // counter.ts should import shared.ts
  const counterDeps = graph.get(join(dir, 'components', 'counter.ts'));
  assert.ok(counterDeps, 'counter.ts should have deps');
  assert.ok(counterDeps.has(join(dir, 'components', 'shared.ts')));

  // Bare specifiers (e.g. '@webjskit/core') should NOT be in the graph — only
  // relative imports resolve to absolute paths.
  if (pageDeps) {
    for (const dep of pageDeps) {
      assert.ok(dep.startsWith('/'), 'all deps should be absolute paths');
    }
  }

  await rm(dir, { recursive: true, force: true });
});

test('transitiveDeps: returns all transitive dependencies', async () => {
  const dir = join(tmpdir(), `webjs-test-transitive-${Date.now()}`);
  await mkdir(join(dir, 'components'), { recursive: true });

  await writeFile(join(dir, 'page.ts'), `
    import './components/a.ts';
  `);
  await writeFile(join(dir, 'components', 'a.ts'), `
    import './b.ts';
  `);
  await writeFile(join(dir, 'components', 'b.ts'), `
    import './c.ts';
  `);
  await writeFile(join(dir, 'components', 'c.ts'), `
    export const x = 1;
  `);

  const graph = await buildModuleGraph(dir);
  const deps = transitiveDeps(graph, [join(dir, 'page.ts')], dir);

  // Should include a.ts, b.ts, c.ts (transitive chain)
  assert.ok(deps.includes(join(dir, 'components', 'a.ts')));
  assert.ok(deps.includes(join(dir, 'components', 'b.ts')));
  assert.ok(deps.includes(join(dir, 'components', 'c.ts')));
  // Should NOT include the entry file itself
  assert.ok(!deps.includes(join(dir, 'page.ts')));

  await rm(dir, { recursive: true, force: true });
});

test('transitiveDeps: handles cycles without infinite loop', async () => {
  const dir = join(tmpdir(), `webjs-test-cycle-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, 'a.js'), `import './b.js';`);
  await writeFile(join(dir, 'b.js'), `import './a.js';`);

  const graph = await buildModuleGraph(dir);
  // Should not hang
  const deps = transitiveDeps(graph, [join(dir, 'a.js')], dir);
  assert.ok(deps.includes(join(dir, 'b.js')));
  assert.ok(!deps.includes(join(dir, 'a.js')), 'entry should not appear in deps');

  await rm(dir, { recursive: true, force: true });
});

test('transitiveDeps: deduplicates shared deps', async () => {
  const dir = join(tmpdir(), `webjs-test-dedup-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  // Both a and b import shared
  await writeFile(join(dir, 'a.js'), `import './shared.js';`);
  await writeFile(join(dir, 'b.js'), `import './shared.js';`);
  await writeFile(join(dir, 'shared.js'), `export const x = 1;`);

  const graph = await buildModuleGraph(dir);
  const deps = transitiveDeps(graph, [join(dir, 'a.js'), join(dir, 'b.js')], dir);

  // shared.js should appear only once
  const sharedCount = deps.filter(d => d.endsWith('shared.js')).length;
  assert.equal(sharedCount, 1);

  await rm(dir, { recursive: true, force: true });
});

test('buildModuleGraph: skips node_modules and _private', async () => {
  const dir = join(tmpdir(), `webjs-test-graph-skip-${Date.now()}`);
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  await mkdir(join(dir, '_private'), { recursive: true });

  await writeFile(join(dir, 'app.js'), `import './local.js';`);
  await writeFile(join(dir, 'local.js'), `export const x = 1;`);
  await writeFile(join(dir, 'node_modules', 'lib.js'), `import 'x';`);
  await writeFile(join(dir, '_private', 'secret.js'), `import 'y';`);

  const graph = await buildModuleGraph(dir);
  assert.ok(graph.has(join(dir, 'app.js')));
  assert.ok(!graph.has(join(dir, 'node_modules', 'lib.js')));
  assert.ok(!graph.has(join(dir, '_private', 'secret.js')));

  await rm(dir, { recursive: true, force: true });
});
