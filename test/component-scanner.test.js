/**
 * Verifies the server-side component scanner correctly identifies webjs
 * component classes in a fixture app tree, derives browser-visible URLs,
 * and primes the core registry so `lookupModuleUrl(tag)` works BEFORE
 * any component module is imported.
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

test('extractComponents: finds classes with static tag = "…"', () => {
  const src = `
    import { WebComponent } from 'webjs';
    export class Counter extends WebComponent {
      static tag = 'my-counter';
      render() {}
    }
  `;
  const comps = extractComponents(src);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].className, 'Counter');
  assert.equal(comps[0].tag, 'my-counter');
});

test('extractComponents: ignores classes without a hyphenated tag', () => {
  assert.deepEqual(
    extractComponents(`class Foo extends HTMLElement { static tag = 'foo'; }`),
    [],
  );
  assert.deepEqual(
    extractComponents(`class Foo extends HTMLElement { static tag = ''; }`),
    [],
  );
  assert.deepEqual(
    extractComponents(`class Foo extends HTMLElement { /* no tag */ }`),
    [],
  );
});

test('extractComponents: handles multiple classes in one file', () => {
  const src = `
    class A extends WebComponent {
      static tag = 'a-el';
    }
    class B extends WebComponent {
      static tag = 'b-el';
    }
  `;
  const comps = extractComponents(src);
  assert.equal(comps.length, 2);
  assert.deepEqual(comps.map((c) => c.tag).sort(), ['a-el', 'b-el']);
});

test('scanComponents: walks an app tree and derives browser-visible URLs', async () => {
  const dir = await scaffold({
    'components/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  static tag = 'my-counter';\n` +
      `  render() {}\n` +
      `}\n`,
    'modules/posts/components/new-post.ts':
      `export class NewPost extends WebComponent {\n` +
      `  static tag = 'new-post';\n` +
      `  render() {}\n` +
      `}\n`,
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
      `export class Real extends WebComponent { static tag = 'real-el'; }`,
    'components/fake.server.ts':
      `export class Hidden extends WebComponent { static tag = 'hidden-server'; }`,
    'components/fake.test.ts':
      `export class AlsoHidden extends WebComponent { static tag = 'hidden-test'; }`,
    'node_modules/something/mod.ts':
      `export class NodeMod extends WebComponent { static tag = 'node-mod'; }`,
  });
  try {
    const comps = await scanComponents(dir);
    const tags = comps.map((c) => c.tag).sort();
    assert.deepEqual(tags, ['real-el']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('primeComponentRegistry: lookupModuleUrl returns correct URL after priming', async () => {
  const dir = await scaffold({
    'components/widget.ts':
      `export class Widget extends WebComponent {\n` +
      `  static tag = 'scan-widget';\n` +
      `  render() {}\n` +
      `}\n`,
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
