import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { add, rewriteUtilsImport } from '../src/commands/add.js';

const origFetch = globalThis.fetch;

const REG = {
  button: {
    name: 'button', type: 'registry:ui',
    dependencies: ['@webjsdev/core'],
    registryDependencies: ['lib-utils'],
    files: [{ path: 'components/button.ts', type: 'registry:ui', content: 'export const Button = "btn";' }],
  },
  card: {
    name: 'card', type: 'registry:ui',
    dependencies: ['@webjsdev/core'],
    registryDependencies: ['button'],
    files: [{ path: 'components/card.ts', type: 'registry:ui', content: 'export const Card = "card";' }],
  },
  'lib-utils': {
    name: 'lib-utils', type: 'registry:lib',
    files: [{ path: 'lib/utils.ts', type: 'registry:lib', content: 'export const cn = () => "";', target: 'lib/utils.ts' }],
  },
  dialog: {
    name: 'dialog', type: 'registry:ui',
    dependencies: ['@webjsdev/core', '@floating-ui/dom'],
    files: [{ path: 'components/dialog.ts', type: 'registry:ui', content: 'export const Dialog = "dlg";' }],
  },
};

function stubFetch() {
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().replace('.json', '');
    if (!REG[name]) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(REG[name]), { status: 200 });
  };
}

function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'webjsui-add-'));
  // Pre-seed a components.json so `add` proceeds
  writeFileSync(join(d, 'components.json'), JSON.stringify({
    $schema: 'https://ui.webjs.dev/schema.json',
    style: 'default',
    tailwind: { css: 'app/globals.css', baseColor: 'neutral', cssVariables: true },
    aliases: { components: 'components', utils: 'lib/utils', ui: 'components/ui', lib: 'lib' },
  }));
  return d;
}

test('add: writes a single component to components/ui/', async () => {
  stubFetch();
  const d = tmp();
  try {
    await add.parseAsync(['button', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    const buttonPath = join(d, 'components', 'ui', 'button.ts');
    assert.ok(existsSync(buttonPath), 'button.ts should exist');
    assert.equal(readFileSync(buttonPath, 'utf8'), 'export const Button = "btn";');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: resolves transitive registry dependencies', async () => {
  stubFetch();
  const d = tmp();
  try {
    await add.parseAsync(['card', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.ok(existsSync(join(d, 'components', 'ui', 'card.ts')), 'card should be added');
    assert.ok(existsSync(join(d, 'components', 'ui', 'button.ts')), 'transitive button should be added');
    assert.ok(existsSync(join(d, 'lib', 'utils.ts')), 'transitive lib-utils should be added');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: multiple components at once', async () => {
  stubFetch();
  const d = tmp();
  try {
    await add.parseAsync(['button', 'dialog', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.ok(existsSync(join(d, 'components', 'ui', 'button.ts')));
    assert.ok(existsSync(join(d, 'components', 'ui', 'dialog.ts')));
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// The shared helpers follow the `utils` ALIAS, not the registry manifest's
// pinned `target` (#1129): the alias is what component imports are rewritten
// to, so honouring the manifest instead left a copy nothing imported. This
// fixture's alias is `lib/utils`, so the helper still lands at lib/utils.ts,
// but now because the alias says so. The sibling test below is the one that
// proves the alias actually drives it.
test('add: places the lib helper at the utils alias, not in components/ui', async () => {
  stubFetch();
  const d = tmp();
  try {
    await add.parseAsync(['card', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.ok(existsSync(join(d, 'lib', 'utils.ts')));
    assert.ok(!existsSync(join(d, 'components', 'ui', 'utils.ts')));
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: a non-default utils alias moves the lib helper, overriding the manifest target', async () => {
  stubFetch();
  const d = mkdtempSync(join(tmpdir(), 'webjsui-add-alias-'));
  writeFileSync(
    join(d, 'components.json'),
    JSON.stringify({
      $schema: 'https://ui.webjs.dev/schema.json',
      style: 'default',
      tailwind: { css: 'styles/globals.css', baseColor: 'neutral', cssVariables: true },
      aliases: { components: 'components', utils: 'src/shared/cn', ui: 'components/ui', lib: 'lib' },
    }),
  );
  try {
    await add.parseAsync(['card', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.ok(existsSync(join(d, 'src', 'shared', 'cn.ts')), 'helper follows the alias');
    assert.equal(existsSync(join(d, 'lib', 'utils.ts')), false, 'nothing at the manifest target');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: fails fast if components.json is missing', async () => {
  stubFetch();
  const d = mkdtempSync(join(tmpdir(), 'webjsui-add-noconf-'));
  const origExit = process.exit;
  const origError = console.error;
  const origInfo = console.log;
  process.exit = ((c) => { throw new Error('exit:' + c); });
  console.error = () => {};
  console.log = () => {};
  try {
    await assert.rejects(
      () => add.parseAsync(['button', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' }),
      /exit:1/,
    );
  } finally {
    process.exit = origExit;
    console.error = origError;
    console.log = origInfo;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: fails fast if no components specified', async () => {
  stubFetch();
  const d = tmp();
  const origExit = process.exit;
  const origError = console.error;
  const origInfo = console.log;
  process.exit = ((c) => { throw new Error('exit:' + c); });
  console.error = () => {};
  console.log = () => {};
  try {
    await assert.rejects(
      () => add.parseAsync(['--cwd', d, '--registry', 'http://test/r'], { from: 'user' }),
      /exit:1/,
    );
  } finally {
    process.exit = origExit;
    console.error = origError;
    console.log = origInfo;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: --overwrite replaces existing files without prompt', async () => {
  stubFetch();
  const d = tmp();
  const { mkdirSync } = await import('node:fs');
  try {
    mkdirSync(join(d, 'components', 'ui'), { recursive: true });
    writeFileSync(join(d, 'components', 'ui', 'button.ts'), 'OLD');
    await add.parseAsync(['button', '--overwrite', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.equal(readFileSync(join(d, 'components', 'ui', 'button.ts'), 'utf8'), 'export const Button = "btn";');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

/* -------------------- example strip / lean copied file (#983) -------------------- */

test('add: strips the worked @example from a Tier-1 helper and leaves a pointer', async () => {
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().replace('.json', '');
    if (name === 'accordion') {
      return new Response(JSON.stringify({
        name: 'accordion', type: 'registry:ui',
        files: [{
          path: 'components/accordion.ts', type: 'registry:ui',
          content:
            '/**\n * Accordion helpers.\n *\n * a11y: same name on each <details> for exclusive-open.\n *\n * @example\n * ```html\n * <div class=${accordionClass()}></div>\n * ```\n */\nexport const accordionClass = () => \'w-full\';\n',
        }],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  const d = tmp();
  try {
    await add.parseAsync(['accordion', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/strip'], { from: 'user' });
    const body = readFileSync(join(d, 'components', 'ui', 'accordion.ts'), 'utf8');
    assert.doesNotMatch(body, /@example/, 'the worked example is stripped');
    assert.doesNotMatch(body, /<div class=/, 'the structural snippet does not persist');
    assert.match(body, /npx @webjsdev\/ui view accordion/, 'a pointer to the full example is left');
    assert.match(body, /a11y: same name/, 'the lean header (a11y note) is kept');
    assert.match(body, /export const accordionClass/, 'the helper code is untouched');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: leaves a Tier-2 custom-element file whole (no example strip)', async () => {
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().replace('.json', '');
    if (name === 'my-dialog') {
      return new Response(JSON.stringify({
        name: 'my-dialog', type: 'registry:ui',
        files: [{
          path: 'components/my-dialog.ts', type: 'registry:ui',
          content:
            '/**\n * Dialog element.\n *\n * @example\n * ```html\n * <ui-dialog></ui-dialog>\n * ```\n */\nclass Dialog extends WebComponent({}) {}\nDialog.register(\'ui-dialog\');\n',
        }],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  const d = tmp();
  try {
    await add.parseAsync(['my-dialog', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/keep'], { from: 'user' });
    const body = readFileSync(join(d, 'components', 'ui', 'my-dialog.ts'), 'utf8');
    assert.match(body, /@example/, 'a Tier-2 element keeps its example');
    assert.match(body, /<ui-dialog>/);
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: local-first (no --registry) installs a real component, strips its example, self-heals theme', async () => {
  // No fetch stub and no --registry: resolves from the PACKAGED registry.
  globalThis.fetch = async () => { throw new Error('should not fetch (local-first)'); };
  const d = mkdtempSync(join(tmpdir(), 'webjsui-add-real-'));
  writeFileSync(join(d, 'components.json'), JSON.stringify({
    style: 'default',
    tailwind: { css: 'styles/globals.css', baseColor: 'neutral', cssVariables: true },
    aliases: { components: 'components', utils: 'lib/utils', ui: 'components/ui', lib: 'lib' },
  }));
  const origLog = console.log;
  console.log = () => {};
  try {
    await add.parseAsync(['accordion', '--yes', '--no-deps', '--cwd', d], { from: 'user' });
    const body = readFileSync(join(d, 'components', 'ui', 'accordion.ts'), 'utf8');
    assert.doesNotMatch(body, /@example/, 'the real example is stripped from the copied file');
    assert.match(body, /npx @webjsdev\/ui view accordion/, 'the pointer is left');
    assert.match(body, /export const accordionClass/, 'the helper code is preserved');
    // Self-heal planted the theme tokens.
    assert.match(readFileSync(join(d, 'styles', 'globals.css'), 'utf8'), /@webjsdev\/ui theme/);
  } finally {
    console.log = origLog;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('ensureTheme: returns a failure (does not throw) when css path / baseColor is missing', async () => {
  // Defensive: a direct caller passing an incomplete config must get a
  // structured failure, never a synchronous crash on join(cwd, undefined). #983.
  const { ensureTheme } = await import('../src/utils/theme.js');
  const r1 = await ensureTheme('/tmp/x', 'neutral', undefined);
  assert.equal(r1.status, 'failed');
  const r2 = await ensureTheme('/tmp/x', undefined, 'styles/globals.css');
  assert.equal(r2.status, 'failed');
});

/* -------------------- rewriteUtilsImport (unit tests) -------------------- */

test('rewriteUtilsImport: maps to lib/utils/cn alias for a Tier-1 file', () => {
  const cwd = '/app';
  const config = {
    resolvedPaths: {
      utils: '/app/lib/utils/cn.ts',
    },
  };
  const target = '/app/components/ui/button.ts';
  const content =
    `import { cn } from '../lib/utils.ts';\nexport const buttonClass = () => cn('p-2');`;
  const out = rewriteUtilsImport(content, target, config);
  assert.match(out, /from '\.\.\/\.\.\/lib\/utils\/cn\.ts'/);
  assert.doesNotMatch(out, /from '\.\.\/lib\/utils\.ts'/);
});

test('rewriteUtilsImport: handles the legacy lib/utils alias (cn at lib/utils.ts)', () => {
  const config = { resolvedPaths: { utils: '/app/lib/utils.ts' } };
  const out = rewriteUtilsImport(
    `import { cn } from '../lib/utils.ts';`,
    '/app/components/ui/button.ts',
    config,
  );
  assert.match(out, /from '\.\.\/\.\.\/lib\/utils\.ts'/);
});

test('rewriteUtilsImport: handles src/lib (vite default)', () => {
  const config = { resolvedPaths: { utils: '/app/src/lib/utils.ts' } };
  const out = rewriteUtilsImport(
    `import { cn } from '../lib/utils.ts';`,
    '/app/src/components/ui/button.ts',
    config,
  );
  assert.match(out, /from '\.\.\/\.\.\/lib\/utils\.ts'/);
});

test('rewriteUtilsImport: handles double-quoted form', () => {
  const config = { resolvedPaths: { utils: '/app/lib/utils/cn.ts' } };
  const out = rewriteUtilsImport(
    `import { cn } from "../lib/utils.ts";`,
    '/app/components/ui/button.ts',
    config,
  );
  assert.match(out, /from "\.\.\/\.\.\/lib\/utils\/cn\.ts"/);
});

test('rewriteUtilsImport: no-op when content has no utils import', () => {
  const config = { resolvedPaths: { utils: '/app/lib/utils/cn.ts' } };
  const out = rewriteUtilsImport(
    `export const x = 1;`,
    '/app/components/ui/x.ts',
    config,
  );
  assert.equal(out, 'export const x = 1;');
});

test('rewriteUtilsImport: gracefully no-ops if config lacks resolvedPaths.utils', () => {
  const out = rewriteUtilsImport(
    `import { cn } from '../lib/utils.ts';`,
    '/app/components/ui/button.ts',
    {},
  );
  // Returns content unchanged so we never crash; the file may still be
  // broken, but that's a configuration error in components.json.
  assert.match(out, /from '\.\.\/lib\/utils\.ts'/);
});

/* -------------------- integration: add rewrites the import -------------------- */

test('add: rewrites a registry component\'s ../lib/utils.ts import to the user\'s aliases.utils path', async () => {
  // Local stub of fetch that returns a button.ts whose body imports
  // the registry-relative '../lib/utils.ts'. After `add`, the written
  // file should reference the user's lib/utils/cn.ts instead.
  const origFetchLocal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().replace('.json', '');
    if (name === 'button') {
      return new Response(JSON.stringify({
        name: 'button', type: 'registry:ui',
        files: [{
          path: 'components/button.ts',
          type: 'registry:ui',
          content: `import { cn } from '../lib/utils.ts';\nexport const buttonClass = () => cn('p-2');\n`,
        }],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  const d = mkdtempSync(join(tmpdir(), 'webjsui-add-rewrite-'));
  writeFileSync(join(d, 'components.json'), JSON.stringify({
    $schema: 'https://ui.webjs.dev/schema.json',
    style: 'default',
    tailwind: { css: 'app/globals.css', baseColor: 'neutral', cssVariables: true },
    aliases: { components: 'components', utils: 'lib/utils/cn', ui: 'components/ui', lib: 'lib' },
  }));
  try {
    // Unique --registry URL so the in-memory fetcher cache (keyed by URL)
    // doesn't return content from an earlier test that reused 'button'.
    await add.parseAsync(['button', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/rewrite'], { from: 'user' });
    const body = readFileSync(join(d, 'components', 'ui', 'button.ts'), 'utf8');
    assert.match(body, /from '\.\.\/\.\.\/lib\/utils\/cn\.ts'/);
    assert.doesNotMatch(body, /from '\.\.\/lib\/utils\.ts'/);
  } finally {
    globalThis.fetch = origFetchLocal;
    rmSync(d, { recursive: true });
  }
});

// `--yes` means "do not prompt me", not "replace my edited source". Since
// #1129 the helper sits at the `utils` alias, the file webjs create generates
// and the docs tell you to retune, so add must leave it alone there.
test('add: --yes does not replace an existing cn helper', async () => {
  stubFetch();
  const d = tmp();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, 'lib'), { recursive: true });
    writeFileSync(join(d, 'lib', 'utils.ts'), 'export const MINE = 1;\n');
    await add.parseAsync(['card', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.match(readFileSync(join(d, 'lib', 'utils.ts'), 'utf8'), /MINE/, 'edited helper survives --yes');
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: --overwrite does replace it', async () => {
  stubFetch();
  const d = tmp();
  try {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(d, 'lib'), { recursive: true });
    writeFileSync(join(d, 'lib', 'utils.ts'), 'export const MINE = 1;\n');
    await add.parseAsync(['card', '--yes', '--overwrite', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    assert.doesNotMatch(readFileSync(join(d, 'lib', 'utils.ts'), 'utf8'), /MINE/);
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// Same contract as the init hint (#1264): a printed command has to resolve for
// whoever is reading it, and the bare `webjsui` bin name does not.
test('add: the missing-config hint prints a resolvable command (#1264)', async () => {
  stubFetch();
  const d = mkdtempSync(join(tmpdir(), 'webjsui-add-hint-'));
  const origExit = process.exit;
  const origError = console.error;
  const origLog = console.log;
  const out = [];
  process.exit = ((c) => { throw new Error('exit:' + c); });
  console.error = (...args) => out.push(args.join(' '));
  console.log = (...args) => out.push(args.join(' '));
  try {
    await assert.rejects(
      () => add.parseAsync(['button', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' }),
      /exit:1/,
    );
  } finally {
    process.exit = origExit;
    console.error = origError;
    console.log = origLog;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
  const text = out.join('\n');
  assert.match(text, /npx @webjsdev\/ui init/);
  assert.doesNotMatch(text, /npx webjsui/);
});

test('add: the no-components hint prints resolvable commands (#1264)', async () => {
  stubFetch();
  const d = tmp();
  const origExit = process.exit;
  const origError = console.error;
  const origLog = console.log;
  const out = [];
  process.exit = ((c) => { throw new Error('exit:' + c); });
  console.error = (...args) => out.push(args.join(' '));
  console.log = (...args) => out.push(args.join(' '));
  try {
    await assert.rejects(
      () => add.parseAsync(['--cwd', d, '--registry', 'http://test/r'], { from: 'user' }),
      /exit:1/,
    );
  } finally {
    process.exit = origExit;
    console.error = origError;
    console.log = origLog;
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
  const text = out.join('\n');
  assert.match(text, /npx @webjsdev\/ui add button/);
  assert.match(text, /npx @webjsdev\/ui list/);
  assert.doesNotMatch(text, /npx webjsui/);
});
