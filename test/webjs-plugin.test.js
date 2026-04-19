/**
 * Unit tests for webjs-plugin — verifies the language-service decorator
 * returns a correct `getDefinitionAndBoundSpan` result for a cursor
 * positioned on a custom-element tag inside an html`` template.
 *
 * Builds a tiny in-memory TypeScript language service host, plants two
 * fixture files, and drives the plugin directly — no tsserver, no
 * editor.
 *
 * The plugin recognises the web-standard convention:
 *
 *     class Counter extends WebComponent { … }
 *     Counter.register('my-counter');
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let ts, createPlugin;
const files = {};

before(() => {
  ts = require('typescript');
  createPlugin = require('../packages/webjs-plugin/src/index.js');
});

/**
 * Create a minimal in-memory language service and wrap it with the plugin.
 * Returns the decorated service.
 */
function makeService(fileMap) {
  Object.assign(files, fileMap);
  const host = {
    getScriptFileNames: () => Object.keys(files),
    getScriptVersion: (f) => String(files[f]?.length ?? 0),
    getScriptSnapshot: (f) =>
      files[f] === undefined ? undefined : ts.ScriptSnapshot.fromString(files[f]),
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: false,
      noEmit: true,
      lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files[f] !== undefined,
    readFile: (f) => files[f],
  };
  const inner = ts.createLanguageService(host, ts.createDocumentRegistry());
  const plugin = createPlugin({ typescript: ts });
  const proxy = plugin.create({
    languageService: inner,
    languageServiceHost: host,
    project: {
      projectService: { logger: { info: () => {} } },
    },
    serverHost: {},
    config: {},
  });
  return proxy;
}

/** Find the offset of `needle` in `files[file]` (first occurrence). */
function offsetOf(file, needle) {
  const i = files[file].indexOf(needle);
  if (i < 0) throw new Error(`"${needle}" not found in ${file}`);
  return i;
}

test('resolves <my-counter> inside html`` to the Counter class', () => {
  const svc = makeService({
    '/counter.ts':
      `import { WebComponent, html } from '@webjskit/core';\n` +
      `export class Counter extends WebComponent {\n` +
      `  render() { return html\`<output></output>\`; }\n` +
      `}\n` +
      `Counter.register('my-counter');\n`,
    '/page.ts':
      `import { html } from '@webjskit/core';\n` +
      `import './counter.ts';\n` +
      `export default function Page() {\n` +
      `  return html\`<my-counter count=\${3}></my-counter>\`;\n` +
      `}\n`,
  });

  const openIdx = offsetOf('/page.ts', '<my-counter');
  const pos = openIdx + 2;

  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(def, 'should return a definition result');
  assert.equal(def.definitions.length, 1);
  const d = def.definitions[0];
  assert.equal(d.fileName, '/counter.ts');
  assert.equal(d.name, 'Counter');
  assert.equal(def.textSpan.length, 'my-counter'.length);
});

test('resolves closing tag </my-counter> just like the opening tag', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  render() {}\n` +
      `}\n` +
      `Counter.register('my-counter');\n`,
    '/page.ts':
      `import { html } from '@webjskit/core';\n` +
      `export default function P() {\n` +
      `  return html\`<my-counter></my-counter>\`;\n` +
      `}\n`,
  });
  const closeIdx = offsetOf('/page.ts', '</my-counter');
  const pos = closeIdx + 3;

  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(def && def.definitions.length === 1);
  assert.equal(def.definitions[0].name, 'Counter');
});

test('returns nothing for unknown tag names', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  render() {}\n` +
      `}\n` +
      `Counter.register('my-counter');\n`,
    '/page.ts':
      `import { html } from '@webjskit/core';\n` +
      `export default function P() {\n` +
      `  return html\`<other-tag></other-tag>\`;\n` +
      `}\n`,
  });
  const pos = offsetOf('/page.ts', '<other-tag') + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(!def || !def.definitions || def.definitions.length === 0);
});

test('ignores plain HTML tags (no hyphen → not a custom element)', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  render() {}\n` +
      `}\n` +
      `Counter.register('my-counter');\n`,
    '/page.ts':
      `import { html } from '@webjskit/core';\n` +
      `export default function P() {\n` +
      `  return html\`<div></div>\`;\n` +
      `}\n`,
  });
  const pos = offsetOf('/page.ts', '<div') + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(!def || !def.definitions || def.definitions.length === 0);
});

/* ================================================================
 * CSS class name → css`` rule navigation
 * ================================================================ */

test('resolves a class name inside html`class="…"` to the css`` rule', () => {
  const svc = makeService({
    '/page.ts':
      `import { html, css } from '@webjskit/core';\n` +
      `const STYLES = css\`\n` +
      `  .page-home {\n` +
      `    .hero-title { font-size: 2rem; }\n` +
      `    .hero-lede  { color: gray; }\n` +
      `  }\n` +
      `\`;\n` +
      `export default function Home() {\n` +
      `  return html\`\n` +
      `    <style>\${STYLES.text}</style>\n` +
      `    <div class="page-home">\n` +
      `      <h1 class="hero-title">Hi</h1>\n` +
      `    </div>\n` +
      `  \`;\n` +
      `}\n`,
  });

  // Cursor on "hero-title" inside <h1 class="hero-title">.
  const idx = files['/page.ts'].indexOf('class="hero-title"');
  const pos = idx + 'class="'.length + 3; // inside 'hero-title'
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(def && def.definitions.length >= 1, 'expected a css definition');
  assert.equal(def.definitions[0].fileName, '/page.ts');
  assert.equal(def.textSpan.length, 'hero-title'.length);
});

test('resolves a class name defined in ANOTHER file via program-wide index', () => {
  const svc = makeService({
    '/layout.ts':
      `import { html, css } from '@webjskit/core';\n` +
      `const STYLES = css\`\n` +
      `  .banner { padding: 8px; background: lightyellow; }\n` +
      `\`;\n` +
      `export default function L({ children }) {\n` +
      `  return html\`<style>\${STYLES.text}</style><main>\${children}</main>\`;\n` +
      `}\n`,
    '/page.ts':
      `import { html } from '@webjskit/core';\n` +
      `export default function P() {\n` +
      `  return html\`<p class="banner">hi</p>\`;\n` +
      `}\n`,
  });

  const idx = files['/page.ts'].indexOf('class="banner"');
  const pos = idx + 'class="'.length + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(def && def.definitions.length >= 1);
  assert.equal(def.definitions[0].fileName, '/layout.ts');
});

test('picks the correct class when class="a b c" has multiple tokens', () => {
  const svc = makeService({
    '/page.ts':
      `import { html, css } from '@webjskit/core';\n` +
      `const STYLES = css\`\n` +
      `  .btn         { padding: 8px; }\n` +
      `  .btn-primary { background: orange; }\n` +
      `\`;\n` +
      `export default function Page() {\n` +
      `  return html\`<style>\${STYLES.text}</style><a class="btn btn-primary" href="/">Go</a>\`;\n` +
      `}\n`,
  });

  const attrStart = files['/page.ts'].indexOf('class="btn btn-primary"');
  const valueStart = attrStart + 'class="'.length;
  // Cursor on 'btn' (first token): offset valueStart + 1.
  const defFirst = svc.getDefinitionAndBoundSpan('/page.ts', valueStart + 1);
  assert.ok(defFirst);
  assert.equal(defFirst.textSpan.length, 'btn'.length);
  assert.equal(defFirst.definitions[0].name, '.btn');

  // Cursor on 'btn-primary' (second token): offset valueStart + 'btn '.length + 1.
  const defSecond = svc.getDefinitionAndBoundSpan('/page.ts', valueStart + 'btn '.length + 1);
  assert.ok(defSecond);
  assert.equal(defSecond.textSpan.length, 'btn-primary'.length);
  assert.equal(defSecond.definitions[0].name, '.btn-primary');
});

test('does not crash on unknown class names (returns no definition)', () => {
  const svc = makeService({
    '/page.ts':
      `import { html } from '@webjskit/core';\n` +
      `export default function P() {\n` +
      `  return html\`<p class="nowhere-defined">x</p>\`;\n` +
      `}\n`,
  });
  const idx = files['/page.ts'].indexOf('class="nowhere-defined"');
  const pos = idx + 'class="'.length + 3;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(!def || !def.definitions || def.definitions.length === 0);
});

test('numeric decimals inside css`` are not mistaken for class names', () => {
  const svc = makeService({
    '/page.ts':
      `import { html, css } from '@webjskit/core';\n` +
      `const STYLES = css\`\n` +
      `  .hero {\n` +
      `    padding: 1.5rem;\n` +
      `    margin: 2.25rem 0;\n` +
      `  }\n` +
      `\`;\n` +
      `export default function P() {\n` +
      `  return html\`<style>\${STYLES.text}</style><div class="hero">hi</div>\`;\n` +
      `}\n`,
    '/other.ts':
      `import { html } from '@webjskit/core';\n` +
      `export default function O() {\n` +
      `  return html\`<div class="5rem">x</div>\`;\n` +
      `}\n`,
  });
  // The class `.hero` should still be found.
  const idx = files['/page.ts'].indexOf('class="hero"');
  const pos = idx + 'class="'.length + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(def && def.definitions.length >= 1);
  // And a "class name" that looks like `5rem` shouldn't accidentally match
  // the `1.5rem` fragment in the css literal.
  const idx2 = files['/other.ts'].indexOf('class="5rem"');
  const pos2 = idx2 + 'class="'.length + 1;
  const def2 = svc.getDefinitionAndBoundSpan('/other.ts', pos2);
  assert.ok(!def2 || !def2.definitions || def2.definitions.length === 0);
});

test('ignores code inside ${...} holes (not part of the template markup)', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  render() {}\n` +
      `}\n` +
      `Counter.register('my-counter');\n`,
    '/page.ts':
      `import { html } from '@webjskit/core';\n` +
      `const label = 'my-counter';\n` +
      `export default function P() {\n` +
      `  return html\`<span>\${label}</span>\`;\n` +
      `}\n`,
  });
  const insideHole = offsetOf('/page.ts', "'my-counter'") + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', insideHole);
  if (def && def.definitions && def.definitions.length > 0) {
    for (const d of def.definitions) {
      assert.notEqual(
        d.name,
        'Counter',
        'should not treat code inside ${...} as template markup'
      );
    }
  }
});
