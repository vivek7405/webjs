import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { list } from '../src/commands/list.js';
import { view } from '../src/commands/view.js';
import { info } from '../src/commands/info.js';

const origFetch = globalThis.fetch;
const origLog = console.log;

const ITEMS = [
  { name: 'button', type: 'registry:ui', description: 'A button' },
  { name: 'card', type: 'registry:ui', description: 'A card' },
  { name: 'lib-utils', type: 'registry:lib' },
];

function stubFetch() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/index.json')) {
      return new Response(JSON.stringify(ITEMS), { status: 200 });
    }
    const name = u.split('/').pop().replace('.json', '');
    if (name === 'button') {
      return new Response(JSON.stringify({
        name: 'button', type: 'registry:ui', description: 'A button',
        files: [{ path: 'components/button.ts', type: 'registry:ui', content: '// button source' }],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

function captureLog(fn) {
  const out = [];
  console.log = (...args) => out.push(args.join(' '));
  return fn().finally(() => { console.log = origLog; }).then(() => out.join('\n'));
}

test('list: prints all registry:ui items', async () => {
  stubFetch();
  try {
    const output = await captureLog(() =>
      list.parseAsync(['--registry', 'http://test/r'], { from: 'user' }),
    );
    assert.match(output, /button/);
    assert.match(output, /card/);
    // libs are filtered out: only ui-typed entries
    assert.doesNotMatch(output, /lib-utils/);
  } finally { globalThis.fetch = origFetch; }
});

test('list: filters by substring', async () => {
  stubFetch();
  try {
    const output = await captureLog(() =>
      list.parseAsync(['card', '--registry', 'http://test/r'], { from: 'user' }),
    );
    assert.match(output, /card/);
    assert.doesNotMatch(output, /^\s*button\s*$/m);
  } finally { globalThis.fetch = origFetch; }
});

test('view: prints component source', async () => {
  stubFetch();
  try {
    const output = await captureLog(() =>
      view.parseAsync(['button', '--registry', 'http://test/r'], { from: 'user' }),
    );
    assert.match(output, /button source/);
    assert.match(output, /components\/button\.ts/);
  } finally { globalThis.fetch = origFetch; }
});

test('info: reports missing config, and no longer prints a project type', async () => {
  const d = mkdtempSync(join(tmpdir(), 'webjsui-info-'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { '@webjsdev/server': '*' } }));
  try {
    const output = await captureLog(() =>
      info.parseAsync(['--cwd', d], { from: 'user' }),
    );
    assert.match(output, /components\.json/);
    // #1129: the project-type line is gone along with the detection it read.
    assert.doesNotMatch(output, /Project/);
    // #1264: the repair command it points at has to resolve for the reader.
    assert.match(output, /npx @webjsdev\/ui init/);
    assert.doesNotMatch(output, /`webjsui init`/);
  } finally { rmSync(d, { recursive: true }); }
});

test('info: reports config when present, read from the file not inferred', async () => {
  const d = mkdtempSync(join(tmpdir(), 'webjsui-info-cfg-'));
  // A Next-shaped dependency set with a components.json that carries its own
  // paths. Nothing about the host project is inspected any more, so the values
  // reported are exactly the ones on disk. This is why #1129 needed no
  // migration: an already-initialised project keeps reading its own file.
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
  writeFileSync(join(d, 'components.json'), JSON.stringify({
    style: 'default',
    tailwind: { css: 'app/globals.css', baseColor: 'zinc', cssVariables: true },
    aliases: { components: 'components', utils: 'lib/utils' },
  }));
  try {
    const output = await captureLog(() =>
      info.parseAsync(['--cwd', d], { from: 'user' }),
    );
    assert.match(output, /zinc/);
    assert.match(output, /app\/globals\.css/);
    assert.match(output, /lib\/utils/);
    assert.doesNotMatch(output, /next/);
  } finally { rmSync(d, { recursive: true }); }
});
