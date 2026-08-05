/**
 * Structural validation for the webjs VSCode extension (#382, phase 1 of #381).
 *
 * The extension is mostly DECLARATIVE: the value lives in `package.json`'s
 * `contributes` block (grammars, the bundled tsserver plugin, snippets,
 * commands) plus three TextMate injection grammars. None of that runs under
 * `node --test` (it loads inside the VSCode extension host, where the `vscode`
 * module exists). So these tests validate the manifest + grammars as DATA:
 *   - the manifest is internally consistent (every contributed file exists,
 *     every grammar scopeName matches, every command is actually registered);
 *   - each grammar's `begin` regex matches the tagged-template forms it must
 *     (`` html` ``, `` x.html` ``, `` this.a.html` ``) and rejects look-alikes
 *     (`` nothtml` ``, `` xhtml` ``).
 *
 * Dependency-free on purpose: no vscode-textmate / oniguruma. Full tokenization
 * would need the heavy TypeScript base grammar; the begin-pattern is the part
 * that decides whether an embedded block is recognised at all, so a JS RegExp
 * proxy is the high-value, zero-dep check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, '..');
const readJSON = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const manifest = readJSON('package.json');

test('manifest identity is the published webjs extension', () => {
  assert.equal(manifest.name, 'webjs');
  assert.equal(manifest.displayName, 'webjs');
  assert.equal(manifest.publisher, 'webjsdev');
  // private: true is a belt-and-braces guard so the changelog/publish-npm
  // pipeline can never accidentally `npm publish` the extension (it ships to
  // the VS Marketplace + Open VSX instead).
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'commonjs');
  assert.ok(existsSync(join(ROOT, manifest.main.replace(/^\.\//, ''))), 'main entry exists');
  assert.ok(existsSync(join(ROOT, manifest.icon)), 'icon file exists');
});

test('the bundled tsserver plugin is auto-registered (no Lit plugin)', () => {
  const plugins = manifest.contributes.typescriptServerPlugins;
  assert.equal(plugins.length, 1);
  assert.equal(plugins[0].name, '@webjsdev/intellisense');
  assert.equal(plugins[0].enableForWorkspaceTypeScriptVersions, true);
  // The whole point of phase 1: no dependency on any Lit extension/grammar.
  const raw = readFileSync(join(ROOT, 'package.json'), 'utf8');
  assert.ok(!/ts-lit-plugin|lit-html|vscode-lit/i.test(raw), 'no Lit-plugin reference');
});

test('build.mjs produces a self-contained, Lit-free vendored plugin', () => {
  // The vsix must resolve `@webjsdev/intellisense` from its own node_modules, so
  // the build vendors a single CJS bundle there. Prove it is self-contained
  // (no further deps to drag in) and truly Lit-free: the plugin is standalone
  // (#386), so it neither requires nor references ts-lit-plugin.
  execFileSync('node', [join(ROOT, 'scripts/build.mjs')], { stdio: 'pipe' });
  const dir = join(ROOT, 'node_modules/@webjsdev/intellisense');
  assert.ok(existsSync(join(dir, 'index.cjs')), 'vendored bundle exists');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@webjsdev/intellisense');
  assert.equal(pkg.main, 'index.cjs');
  assert.ok(!pkg.dependencies, 'vendored plugin declares no dependencies');
  const bundle = readFileSync(join(dir, 'index.cjs'), 'utf8');
  // No ts-lit-plugin require survives: the plugin is fully standalone.
  assert.ok(!/require\(["'`]ts-lit-plugin["'`]\)/.test(bundle), 'bundle does not require ts-lit-plugin');
  // webjs's own resolver logic IS bundled in.
  assert.match(bundle, /register/, 'webjs registration scan is present');
});

test('every contributed grammar file exists and is self-consistent', () => {
  const grammars = manifest.contributes.grammars;
  assert.equal(grammars.length, 3);
  const injectTargets = ['source.js', 'source.jsx', 'source.js.jsx', 'source.ts', 'source.tsx'];
  for (const g of grammars) {
    assert.ok(existsSync(join(ROOT, g.path)), `${g.path} exists`);
    assert.deepEqual(g.injectTo, injectTargets, `${g.scopeName} injects into all JS/TS scopes`);
    const grammar = readJSON(g.path);
    assert.equal(grammar.scopeName, g.scopeName, 'scopeName matches the manifest');
    assert.ok(grammar.injectionSelector, 'has an injectionSelector');
    assert.ok(grammar.repository?.['webjs-substitution'], 'has the ${...} substitution rule');
  }
});

test('snippets file is referenced for both languages and ships the recipes', () => {
  const snippets = manifest.contributes.snippets;
  const langs = snippets.map((s) => s.language).sort();
  assert.deepEqual(langs, ['javascript', 'typescript']);
  for (const s of snippets) assert.ok(existsSync(join(ROOT, s.path)), `${s.path} exists`);
  const body = readJSON(snippets[0].path);
  const prefixes = Object.values(body).map((s) => s.prefix).sort();
  assert.deepEqual(prefixes, ['wjaction', 'wjcomponent', 'wjdynamic', 'wjlayout', 'wjpage', 'wjroute']);
});

test('every contributed command is registered in the extension entry', () => {
  const src = readFileSync(join(ROOT, manifest.main.replace(/^\.\//, '')), 'utf8');
  for (const c of manifest.contributes.commands) {
    assert.match(src, new RegExp(`registerCommand\\(\\s*['"\`]${c.command.replace('.', '\\.')}['"\`]`),
      `${c.command} is wired in extension.js`);
  }
});

/**
 * Compile a TextMate `begin` pattern to a JS RegExp. The patterns use
 * `(?x)` (extended/free-spacing) but contain no literal whitespace or inline
 * comments, so stripping the flag is a faithful conversion.
 */
function beginRegExp(pattern) {
  const stripped = pattern.replace(/^\(\?x\)/, '');
  assert.ok(!/^\(\?x\)/.test(stripped), 'flag stripped once');
  return new RegExp(stripped);
}

const TAGS = [
  { tag: 'html', file: './syntaxes/webjs-html.json' },
  { tag: 'css', file: './syntaxes/webjs-css.json' },
  { tag: 'svg', file: './syntaxes/webjs-svg.json' },
];

for (const { tag, file } of TAGS) {
  test(`${tag}\` begin pattern matches the real forms and rejects look-alikes`, () => {
    const grammar = readJSON(file);
    const begin = grammar.patterns[0].begin;
    const re = beginRegExp(begin);
    // The grammar opens an embedded block for these:
    assert.match(`${tag}\``, re, `bare ${tag}\``);
    assert.match(`x.${tag}\``, re, `member ${tag}\``);
    assert.match(`this.a.${tag}\``, re, `nested member ${tag}\``);
    assert.match(`  ${tag}\``, re, `leading whitespace before ${tag}\``);
    // And must NOT open one for a word that merely ends in the tag name:
    assert.doesNotMatch(`not${tag}\``, re, `not${tag}\` is not a ${tag} template`);
    assert.doesNotMatch(`x${tag}\``, re, `x${tag}\` is not a ${tag} template`);
    // The content is scoped to the right embedded language.
    assert.equal(
      grammar.patterns[0].contentName,
      `meta.embedded.block.${tag === 'svg' ? 'svg' : tag}`,
    );
  });
}

// --- webjs.create name validation stays in step with the CLI (#1066) -------
//
// The input box duplicates the CLI's app-name rule, because the extension
// bundle cannot require `@webjsdev/cli` at runtime. Duplication drifts: this
// box kept a lowercase-only regex after the CLI dropped that clause, and had
// been refusing `my.app` / `my_app` for far longer than that. So cross-check
// the two implementations over a table instead of asserting the regex text,
// which would just re-encode the copy.
//
// Drift in EITHER direction is a bug. Stricter blocks a name `webjs create`
// would accept. Looser is worse than it looks: an accepted name is shelled
// straight out to the CLI, so it fails later in the terminal, which is exactly
// what a prompt-time validator exists to prevent.
test('webjs.create input validation matches the CLI app-name rule exactly', async () => {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');

  const extPath = fileURLToPath(new URL('../src/extension.js', import.meta.url));
  // `vscode` is host-provided and unavailable here, so stub it out. Only the
  // pure validator is under test; nothing in it touches the host.
  const src = readFileSync(extPath, 'utf8').replace(
    /const vscode = require\('vscode'\);/,
    'const vscode = {};',
  );
  const mod = { exports: {} };
  const req = createRequire(extPath);
  new Function('module', 'exports', 'require', src)(mod, mod.exports, req);
  const { validateAppName } = mod.exports;
  assert.equal(typeof validateAppName, 'function', 'extension exports validateAppName');

  const { checkAppName } = await import('../../../cli/lib/app-name.js');

  const NAMES = [
    'my-app', 'MyApp', 'TaskFlow', 'my.app', 'my_app', 'a', '9', 'My_App.v2',
    '-app', '.app', '_app', '-', 'bad name', "bad'name", 'bad`name', 'bad$' + '{x}',
    'node_modules', 'NODE_MODULES', 'favicon.ico', 'Favicon.ICO',
    'a'.repeat(214), 'a'.repeat(215), '',
  ];
  for (const name of NAMES) {
    const cliOk = checkAppName(name).ok;
    const extOk = validateAppName(name) === null;
    assert.equal(
      extOk,
      cliOk,
      `${JSON.stringify(name)}: extension says ${extOk ? 'valid' : 'invalid'}, CLI says ${cliOk ? 'valid' : 'invalid'}`,
    );
  }
});
