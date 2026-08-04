import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { add } from '../src/commands/add.js';
import { init } from '../src/commands/init.js';

// Counterfactuals for the #819 lib/dom.ts split on the external
// `webjs ui add` / `webjs ui init` distribution path. Overlay components
// import onBeforeCache from '../lib/dom.ts' (a module kept separate from the
// pure cn() in '../lib/utils.ts' so the elision analyzer does not pin every
// cn importer to the browser). The add/init commands must ship that dom
// module AND rewrite the registry-relative import, or the emitted component
// carries a broken '../lib/dom.ts' specifier.

const origFetch = globalThis.fetch;

const REG = {
  'lib-utils': {
    name: 'lib-utils',
    type: 'registry:lib',
    files: [
      {
        path: 'lib/utils.ts',
        type: 'registry:lib',
        target: 'lib/utils.ts',
        content: 'export const cn = () => "";\nexport function ensureId() {}\n',
      },
    ],
  },
  'lib-dom': {
    name: 'lib-dom',
    type: 'registry:lib',
    files: [
      {
        path: 'lib/dom.ts',
        type: 'registry:lib',
        target: 'lib/dom.ts',
        content: 'export function onBeforeCache() { return () => {}; }\n',
      },
    ],
  },
  // Imports BOTH the pure utils helper and the dom helper.
  dialog: {
    name: 'dialog',
    type: 'registry:ui',
    registryDependencies: ['lib-utils', 'lib-dom'],
    files: [
      {
        path: 'components/dialog.ts',
        type: 'registry:ui',
        content:
          `import { ensureId } from '../lib/utils.ts';\n` +
          `import { onBeforeCache } from '../lib/dom.ts';\n` +
          `export const Dialog = 'dlg';\n`,
      },
    ],
  },
  // Imports ONLY the dom helper (the sonner shape): the old rewrite
  // early-returned when there was no utils import, leaving this one broken.
  sonner: {
    name: 'sonner',
    type: 'registry:ui',
    registryDependencies: ['lib-dom'],
    files: [
      {
        path: 'components/sonner.ts',
        type: 'registry:ui',
        content:
          `import { onBeforeCache } from '../lib/dom.ts';\n` +
          `export const Sonner = 'toast';\n`,
      },
    ],
  },
  'theme-neutral': {
    name: 'theme-neutral',
    type: 'registry:theme',
    files: [
      {
        path: 'themes/index.css',
        type: 'registry:file',
        target: 'app/globals.css',
        content: '/* @webjsdev/ui theme */\n:root { --primary: #000; }\n',
      },
    ],
  },
};

function stubFetch() {
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().replace('.json', '');
    if (!REG[name]) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(REG[name]), { status: 200 });
  };
}

function tmpAdd() {
  const d = mkdtempSync(join(tmpdir(), 'webjsui-domsplit-add-'));
  writeFileSync(
    join(d, 'components.json'),
    JSON.stringify({
      $schema: 'https://ui.webjs.dev/schema.json',
      style: 'default',
      tailwind: { css: 'app/globals.css', baseColor: 'neutral', cssVariables: true },
      aliases: { components: 'components', utils: 'lib/utils', ui: 'components/ui', lib: 'lib' },
    }),
  );
  return d;
}

test('add: dialog ships lib/dom.ts and rewrites the ../lib/dom.ts import', async () => {
  stubFetch();
  const d = tmpAdd();
  try {
    await add.parseAsync(
      ['dialog', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/domsplit-dialog'],
      { from: 'user' },
    );
    assert.ok(existsSync(join(d, 'lib', 'dom.ts')), 'lib/dom.ts must be written');
    assert.ok(existsSync(join(d, 'lib', 'utils.ts')), 'lib/utils.ts must be written');

    const body = readFileSync(join(d, 'components', 'ui', 'dialog.ts'), 'utf8');
    assert.doesNotMatch(body, /['"]\.\.\/lib\/dom\.ts['"]/, 'no literal ../lib/dom.ts may survive');
    assert.doesNotMatch(body, /['"]\.\.\/lib\/utils\.ts['"]/, 'no literal ../lib/utils.ts may survive');
    // components/ui/dialog.ts -> lib/dom.ts is ../../lib/dom.ts
    assert.match(body, /from '\.\.\/\.\.\/lib\/dom\.ts'/);
    assert.match(body, /from '\.\.\/\.\.\/lib\/utils\.ts'/);
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

test('add: sonner (dom-only import) still gets ../lib/dom.ts rewritten', async () => {
  stubFetch();
  const d = tmpAdd();
  try {
    await add.parseAsync(
      ['sonner', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/domsplit-sonner'],
      { from: 'user' },
    );
    assert.ok(existsSync(join(d, 'lib', 'dom.ts')), 'lib/dom.ts must be written for a dom-only component');

    const body = readFileSync(join(d, 'components', 'ui', 'sonner.ts'), 'utf8');
    assert.doesNotMatch(
      body,
      /['"]\.\.\/lib\/dom\.ts['"]/,
      'sonner imports only dom.ts, yet its import must still be rewritten',
    );
    assert.match(body, /from '\.\.\/\.\.\/lib\/dom\.ts'/);
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});

// The two helpers must land as SIBLINGS, because that adjacency is what
// `add`'s import rewriting assumes when it resolves '../lib/dom.ts' (it takes
// the dirname of the resolved utils path). #1129 moved the pair from
// lib/utils.ts + lib/dom.ts into lib/utils/, matching what `webjs create`
// scaffolds; the adjacency, not the directory, is the invariant.
test('init: writes dom.ts alongside the cn helper', async () => {
  stubFetch();
  const d = mkdtempSync(join(tmpdir(), 'webjsui-domsplit-init-'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { '@webjsdev/server': '*' } }));
  try {
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/domsplit-init'], { from: 'user' });
    assert.ok(existsSync(join(d, 'lib', 'utils', 'cn.ts')), 'lib/utils/cn.ts must be written');
    assert.ok(existsSync(join(d, 'lib', 'utils', 'dom.ts')), 'lib/utils/dom.ts must be written');
    assert.match(readFileSync(join(d, 'lib', 'utils', 'dom.ts'), 'utf8'), /onBeforeCache/);
  } finally {
    globalThis.fetch = origFetch;
    rmSync(d, { recursive: true });
  }
});
