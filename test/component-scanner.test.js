/**
 * Verifies the server-side component scanner correctly identifies webjs
 * component classes in a fixture app tree, derives browser-visible URLs,
 * and primes the core registry so `lookupModuleUrl(tag)` works BEFORE
 * any component module is imported.
 *
 * The scanner recognises the web-standard `customElements.define('tag',
 * Class)` convention.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractComponents,
  scanComponents,
  primeComponentRegistry,
  findOrphanComponents,
} from '../packages/server/src/component-scanner.js';
import { lookupModuleUrl } from '../packages/core/src/registry.js';

async function scaffold(files) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-scan-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(join(abs, '..'), { recursive: true });
    await writeFile(abs, body);
  }
  return dir;
}

test('extractComponents: finds customElements.define(tag, Class) calls', () => {
  const src = `
    import { WebComponent } from 'webjs';
    export class Counter extends WebComponent {
      render() {}
    }
    customElements.define('my-counter', Counter);
  `;
  const comps = extractComponents(src);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].className, 'Counter');
  assert.equal(comps[0].tag, 'my-counter');
});

test('extractComponents: accepts single and double quotes', () => {
  assert.deepEqual(
    extractComponents(`customElements.define("my-el", MyEl);`),
    [{ tag: 'my-el', className: 'MyEl' }],
  );
  assert.deepEqual(
    extractComponents(`customElements.define('my-el', MyEl);`),
    [{ tag: 'my-el', className: 'MyEl' }],
  );
});

test('extractComponents: ignores tags without hyphens (HTML spec)', () => {
  assert.deepEqual(
    extractComponents(`customElements.define('foo', Foo);`),
    [],
  );
});

test('extractComponents: handles multiple components per file', () => {
  const src = `
    class A extends WebComponent {}
    class B extends WebComponent {}
    customElements.define('a-el', A);
    customElements.define('b-el', B);
  `;
  const comps = extractComponents(src);
  assert.equal(comps.length, 2);
  assert.deepEqual(comps.map((c) => c.tag).sort(), ['a-el', 'b-el']);
});

test('scanComponents: walks an app tree and derives browser-visible URLs', async () => {
  const dir = await scaffold({
    'components/counter.ts':
      `export class Counter extends WebComponent { render() {} }\n` +
      `customElements.define('my-counter', Counter);\n`,
    'modules/posts/components/new-post.ts':
      `export class NewPost extends WebComponent { render() {} }\n` +
      `customElements.define('new-post', NewPost);\n`,
  });
  try {
    const comps = await scanComponents(dir);
    const byTag = Object.fromEntries(comps.map((c) => [c.tag, c.moduleUrl]));
    assert.equal(byTag['my-counter'], '/components/counter.ts');
    assert.equal(byTag['new-post'], '/modules/posts/components/new-post.ts');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scanComponents: skips .server.ts, .test.ts, and node_modules', async () => {
  const dir = await scaffold({
    'components/real.ts':
      `export class Real extends WebComponent {}\ncustomElements.define('real-el', Real);\n`,
    'components/fake.server.ts':
      `export class Hidden extends WebComponent {}\ncustomElements.define('hidden-server', Hidden);\n`,
    'components/fake.test.ts':
      `export class AlsoHidden extends WebComponent {}\ncustomElements.define('hidden-test', AlsoHidden);\n`,
    'node_modules/something/mod.ts':
      `export class NodeMod extends WebComponent {}\ncustomElements.define('node-mod', NodeMod);\n`,
  });
  try {
    const comps = await scanComponents(dir);
    const tags = comps.map((c) => c.tag).sort();
    assert.deepEqual(tags, ['real-el']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOrphanComponents: flags class extending WebComponent with no customElements.define', async () => {
  const dir = await scaffold({
    'components/orphan.ts':
      `export class Orphan extends WebComponent {\n` +
      `  render() {}\n` +
      `}\n`, // forgot the customElements.define call
    'components/good.ts':
      `export class Good extends WebComponent {\n` +
      `  render() {}\n` +
      `}\n` +
      `customElements.define('good-el', Good);\n`,
  });
  try {
    const orphans = await findOrphanComponents(dir);
    const names = orphans.map((o) => o.className).sort();
    assert.deepEqual(names, ['Orphan']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOrphanComponents: ignores files with no WebComponent subclass', async () => {
  const dir = await scaffold({
    'lib/util.ts': `export function noop() {}\n`,
  });
  try {
    const orphans = await findOrphanComponents(dir);
    assert.equal(orphans.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('primeComponentRegistry: lookupModuleUrl returns URL after priming', async () => {
  const dir = await scaffold({
    'components/widget.ts':
      `export class Widget extends WebComponent { render() {} }\n` +
      `customElements.define('scan-widget', Widget);\n`,
  });
  try {
    await primeComponentRegistry(dir);
    assert.equal(
      lookupModuleUrl('scan-widget'),
      '/components/widget.ts',
      'priming should register the URL into the core registry before the module is imported'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
