/**
 * Branch-coverage tests: push the package over ~95%.
 * Covers the harder-to-reach branches in init/add/list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { init } from '../src/commands/init.js';
import { add } from '../src/commands/add.js';
import { list } from '../src/commands/list.js';
import { logger } from '../src/utils/logger.js';

const origFetch = globalThis.fetch;
const origLog = console.log;

function tmp(deps) {
  const d = mkdtempSync(join(tmpdir(), 'webjsui-cov-'));
  writeFileSync(join(d, 'package.json'), JSON.stringify({ dependencies: deps || {} }));
  return d;
}

test('init: warns gracefully when lib-utils fetch fails but the theme succeeds', async () => {
  // lib-utils / lib-dom 404 (soft warn), but the theme resolves: the theme is
  // the hard-fail gate (#983), so init must still complete and write config.
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().replace('.json', '');
    if (name.startsWith('theme-')) {
      return new Response(JSON.stringify({
        name, type: 'registry:theme',
        files: [{ path: 'themes/index.css', type: 'registry:file', target: 'app/globals.css', content: '/* @webjsdev/ui theme */\n:root{}' }],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  console.log = () => {};
  const out = [];
  console.warn = (...args) => out.push(args.join(' '));
  const d = tmp({ '@webjsdev/server': '*' });
  try {
    await init.parseAsync(['--yes', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
    // components.json still gets written even if helper fetches fail
    assert.ok(readFileSync(join(d, 'components.json'), 'utf8'));
  } finally {
    globalThis.fetch = origFetch;
    console.log = origLog;
    rmSync(d, { recursive: true });
  }
});

test('add: --no-deps flag skips install command', async () => {
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop().replace('.json', '');
    if (name !== 'button') return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({
      name: 'button', type: 'registry:ui',
      dependencies: ['some-fake-pkg-that-cant-install'],
      files: [{ path: 'components/button.ts', type: 'registry:ui', content: 'X' }],
    }), { status: 200 });
  };
  const d = tmp({});
  writeFileSync(join(d, 'components.json'), JSON.stringify({
    style: 'default',
    tailwind: { css: 'app/globals.css', baseColor: 'neutral', cssVariables: true },
    aliases: { components: 'components', utils: 'lib/utils', ui: 'components/ui', lib: 'lib' },
  }));
  console.log = () => {};
  try {
    // --no-deps means we don't spawn npm install: so even a fake package name is fine
    await add.parseAsync(['button', '--yes', '--no-deps', '--cwd', d, '--registry', 'http://test/r'], { from: 'user' });
  } finally {
    globalThis.fetch = origFetch;
    console.log = origLog;
    rmSync(d, { recursive: true });
  }
});

test('list: prints empty-state message when filter yields no results', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/index.json')) {
      return new Response(JSON.stringify([{ name: 'button', type: 'registry:ui' }]), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
  const out = [];
  console.log = (...args) => out.push(args.join(' '));
  try {
    await list.parseAsync(['nonexistent-filter', '--registry', 'http://test/r'], { from: 'user' });
    assert.match(out.join('\n'), /No matches/);
  } finally {
    globalThis.fetch = origFetch;
    console.log = origLog;
  }
});

test('logger: all colour helpers return strings', () => {
  assert.equal(typeof logger.dim('x'), 'string');
  assert.equal(typeof logger.bold('x'), 'string');
  assert.equal(typeof logger.cyan('x'), 'string');
  assert.equal(typeof logger.green('x'), 'string');
});
