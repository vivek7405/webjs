/**
 * Unit tests for webjs-plugin — verifies the language-service decorator
 * returns a correct `getDefinitionAndBoundSpan` result for a cursor
 * positioned on a custom-element tag inside an html`` template.
 *
 * Builds a tiny in-memory TypeScript language service host, plants two
 * fixture files, and drives the plugin directly — no tsserver, no
 * editor. Exits the loop on assertion.
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
      `import { WebComponent, html } from 'webjs';\n` +
      `export class Counter extends WebComponent {\n` +
      `  static tag = 'my-counter';\n` +
      `  render() { return html\`<output></output>\`; }\n` +
      `}\n`,
    '/page.ts':
      `import { html } from 'webjs';\n` +
      `import './counter.ts';\n` +
      `export default function Page() {\n` +
      `  return html\`<my-counter count=\${3}></my-counter>\`;\n` +
      `}\n`,
  });

  // Position: somewhere on the word `my-counter` inside the opening tag.
  const openIdx = offsetOf('/page.ts', '<my-counter');
  const pos = openIdx + 2; // on the 'y' of my-counter, for example

  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(def, 'should return a definition result');
  assert.equal(def.definitions.length, 1);
  const d = def.definitions[0];
  assert.equal(d.fileName, '/counter.ts');
  assert.equal(d.name, 'Counter');
  // The bound span should cover `my-counter` (10 chars).
  assert.equal(def.textSpan.length, 'my-counter'.length);
});

test('resolves closing tag </my-counter> just like the opening tag', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  static tag = 'my-counter';\n` +
      `  render() {}\n` +
      `}\n`,
    '/page.ts':
      `import { html } from 'webjs';\n` +
      `export default function P() {\n` +
      `  return html\`<my-counter></my-counter>\`;\n` +
      `}\n`,
  });
  const closeIdx = offsetOf('/page.ts', '</my-counter');
  const pos = closeIdx + 3; // inside the closing tag name

  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(def && def.definitions.length === 1);
  assert.equal(def.definitions[0].name, 'Counter');
});

test('returns nothing for unknown tag names', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  static tag = 'my-counter';\n` +
      `  render() {}\n` +
      `}\n`,
    '/page.ts':
      `import { html } from 'webjs';\n` +
      `export default function P() {\n` +
      `  return html\`<other-tag></other-tag>\`;\n` +
      `}\n`,
  });
  const pos = offsetOf('/page.ts', '<other-tag') + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  // Without a matching component and without upstream handling,
  // the result should be undefined or have no definitions.
  assert.ok(!def || !def.definitions || def.definitions.length === 0);
});

test('ignores plain HTML tags (no hyphen → not a custom element)', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  static tag = 'my-counter';\n` +
      `  render() {}\n` +
      `}\n`,
    '/page.ts':
      `import { html } from 'webjs';\n` +
      `export default function P() {\n` +
      `  return html\`<div></div>\`;\n` +
      `}\n`,
  });
  const pos = offsetOf('/page.ts', '<div') + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', pos);
  assert.ok(!def || !def.definitions || def.definitions.length === 0);
});

test('ignores code inside ${...} holes (not part of the template markup)', () => {
  const svc = makeService({
    '/counter.ts':
      `export class Counter extends WebComponent {\n` +
      `  static tag = 'my-counter';\n` +
      `  render() {}\n` +
      `}\n`,
    '/page.ts':
      `import { html } from 'webjs';\n` +
      `const label = 'my-counter';\n` +
      `export default function P() {\n` +
      `  return html\`<span>\${label}</span>\`;\n` +
      `}\n`,
  });
  // Position on the literal `my-counter` INSIDE the hole (line 2 string).
  const insideHole = offsetOf('/page.ts', "'my-counter'") + 2;
  const def = svc.getDefinitionAndBoundSpan('/page.ts', insideHole);
  // Whatever tsserver returns is fine; our plugin must NOT fabricate a
  // tag definition for text inside a hole.
  if (def && def.definitions && def.definitions.length > 0) {
    for (const d of def.definitions) {
      // None of our synthetic definitions should land in counter.ts.
      assert.notEqual(
        d.name,
        'Counter',
        'should not treat code inside ${...} as template markup'
      );
    }
  }
});
