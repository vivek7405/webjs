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
} from '../../src/component-scanner.js';
import { lookupModuleUrl } from '../../../core/src/registry.js';

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
    import { WebComponent } from '@webjsdev/core';
    export class Counter extends WebComponent {
      render() {}
    }
    Counter.register('my-counter');
  `;
  const comps = extractComponents(src);
  assert.equal(comps.length, 1);
  assert.equal(comps[0].className, 'Counter');
  assert.equal(comps[0].tag, 'my-counter');
});

test('extractComponents: accepts single and double quotes', () => {
  assert.deepEqual(
    extractComponents(`MyEl.register("my-el");`),
    [{ tag: 'my-el', className: 'MyEl' }],
  );
  assert.deepEqual(
    extractComponents(`MyEl.register('my-el');`),
    [{ tag: 'my-el', className: 'MyEl' }],
  );
});

test('extractComponents: ignores tags without hyphens (HTML spec)', () => {
  assert.deepEqual(
    extractComponents(`Foo.register('foo');`),
    [],
  );
});

test('extractComponents: handles multiple components per file', () => {
  const src = `
    class A extends WebComponent {}
    class B extends WebComponent {}
    A.register('a-el');
    B.register('b-el');
  `;
  const comps = extractComponents(src);
  assert.equal(comps.length, 2);
  assert.deepEqual(comps.map((c) => c.tag).sort(), ['a-el', 'b-el']);
});

test('scanComponents: walks an app tree and derives browser-visible URLs', async () => {
  const dir = await scaffold({
    'components/counter.ts':
      `export class Counter extends WebComponent { render() {} }\n` +
      `Counter.register('my-counter');\n`,
    'modules/posts/components/new-post.ts':
      `export class NewPost extends WebComponent { render() {} }\n` +
      `NewPost.register('new-post');\n`,
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
      `export class Real extends WebComponent {}\nReal.register('real-el');\n`,
    'components/fake.server.ts':
      `export class Hidden extends WebComponent {}\nHidden.register('hidden-server');\n`,
    'components/fake.test.ts':
      `export class AlsoHidden extends WebComponent {}\nAlsoHidden.register('hidden-test');\n`,
    'node_modules/something/mod.ts':
      `export class NodeMod extends WebComponent {}\nNodeMod.register('node-mod');\n`,
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
      `Good.register('good-el');\n`,
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

test('findOrphanComponents: a COMPUTED template-literal tag is an orphan (#1308)', async () => {
  // The two scans in this file must agree on what a literal tag is. When the
  // orphan scan used its own looser pattern, a redacted interpolated template
  // (`A.register(`${p}__STR_1__`)`) satisfied it but NOT `extractComponents`,
  // so the class was neither a component nor an orphan and disappeared from
  // every surface: the dev warning, the elision report, the CLI section, and
  // the doctor check. An interpolated template is the most idiomatic way to
  // write a computed tag, so this is the shape the report most needs to catch.
  //
  // A LITERAL backtick tag is the counterpart and must NOT be an orphan;
  // both are asserted here so a fix in either direction cannot pass silently.
  const dir = await scaffold({
    'components/computed.ts': `const p = 'my';\nexport class Computed extends WebComponent {\n  render() {}\n}\nComputed.register(\`\${p}-badge\`);\n`,
    'components/literal.ts': `export class Literal extends WebComponent {\n  render() {}\n}\nLiteral.register(\`ok-badge\`);\n`,
  });
  try {
    const orphans = await findOrphanComponents(dir);
    assert.deepEqual(orphans.map((o) => o.className).sort(), ['Computed'],
      'the interpolated tag is an orphan; the literal backtick tag is a real registration');
    const comps = await scanComponents(dir);
    assert.deepEqual(comps.map((c) => c.tag).sort(), ['ok-badge'],
      'and the two scans agree: exactly the one the orphan scan did NOT flag is the component');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOrphanComponents: a SIBLING-registered class is not an orphan (#1308)', async () => {
  // Registration is an APP-WIDE fact; the declaration is per-file. A class
  // declared in one module and registered by a sibling is a legitimate pattern
  // (the native `customElements.define` form the scanner header calls equally
  // supported), and `scanComponents` already reports it as a real component
  // with a tag. Reporting it as an orphan too was a false accusation, and once
  // an orphan became a `webjs doctor` warning that false warning is what makes
  // an author stop reading them.
  const dir = await scaffold({
    'components/badge.ts': `export class Badge extends WebComponent {\n  render() {}\n}\n`,
    'components/register.ts': `import { Badge } from './badge.ts';\ncustomElements.define('my-badge', Badge);\n`,
    // A genuinely unregistered class in the same tree, so this cannot pass by
    // the scan going blind.
    'components/forgotten.ts': `export class Forgotten extends WebComponent {\n  render() {}\n}\n`,
  });
  try {
    const orphans = await findOrphanComponents(dir);
    assert.deepEqual(orphans.map((o) => o.className).sort(), ['Forgotten'],
      'only the class nothing registers anywhere is an orphan');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOrphanComponents: a class in a CODE SAMPLE is not an orphan (#1308)', async () => {
  // Every docs page writes `class X extends WebComponent` inside an `html`
  // template to SHOW the reader what a component looks like. Scanning raw
  // source counted each of those as a real unregistered class: the repo's own
  // website reported 17 false orphans this way. Now that an orphan is a
  // `webjs doctor` WARNING and not just dev-console noise, a false one is a
  // check that cries wolf on a healthy app, so the scan redacts strings and
  // templates exactly like `extractComponents` already did.
  const dir = await scaffold({
    'app/docs/page.ts':
      `import { html } from '@webjsdev/core';\n` +
      'export default () => html`\n' +
      '  <pre>class Sample extends WebComponent {\n' +
      '    render() { return html`<p>hi</p>`; }\n' +
      '  }</pre>\n' +
      '`;\n',
    'lib/prose.ts': `export const doc = "class Quoted extends WebComponent {}";\n`,
    // A REAL orphan in the same tree, so this cannot pass by the scan going blind.
    'components/orphan.ts': `export class Orphan extends WebComponent {\n  render() {}\n}\n`,
  });
  try {
    const orphans = await findOrphanComponents(dir);
    assert.deepEqual(orphans.map((o) => o.className).sort(), ['Orphan'],
      'only the real declaration is an orphan; the sample and the string are not');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('primeComponentRegistry: lookupModuleUrl returns URL after priming', async () => {
  const dir = await scaffold({
    'components/widget.ts':
      `export class Widget extends WebComponent { render() {} }\n` +
      `Widget.register('scan-widget');\n`,
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

test('scanComponents mtime cache: unchanged scan is stable, a file edit is picked up', async () => {
  // Incremental rebuild (#141): the scan reuses an mtime-keyed cache so a
  // rebuild re-reads only changed files. Correctness guard: an edit that adds
  // a component must still be discovered (cache invalidated by mtime), and an
  // unchanged re-scan returns the same set.
  const dir = await scaffold({
    'components/a.ts': `import { WebComponent } from '@webjsdev/core';\nexport class A extends WebComponent {}\nA.register('comp-a');\n`,
    'components/plain.ts': `export const x = 1;\n`,
  });
  try {
    const first = await scanComponents(dir);
    assert.deepEqual(first.map(c => c.tag).sort(), ['comp-a']);
    const again = await scanComponents(dir);
    assert.deepEqual(again.map(c => c.tag).sort(), ['comp-a'], 'unchanged re-scan is stable');

    await new Promise(r => setTimeout(r, 12)); // ensure a distinct mtime
    await writeFile(join(dir, 'components/plain.ts'),
      `import { WebComponent } from '@webjsdev/core';\nexport class P extends WebComponent {}\nP.register('comp-p');\n`);
    const third = await scanComponents(dir);
    assert.deepEqual(third.map(c => c.tag).sort(), ['comp-a', 'comp-p'], 'edited file is re-scanned');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
