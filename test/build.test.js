/**
 * buildBundle() tests — exercises the esbuild-driven prod bundle generator
 * in packages/server/src/build.js against an on-disk app fixture.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildBundle, exists } from '../packages/server/src/build.js';

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-build-')); });
after(() => { if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true }); });

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

test('buildBundle: emits .webjs/bundle.js for a normal app', async () => {
  const appDir = makeApp({
    // Side-effect imports: esbuild tree-shakes pure exports, so each module
    // attaches a marker on globalThis so the bundle has actual content.
    'app/page.js':
      `globalThis.__page = true;\nexport default () => 'home';\n`,
    'app/about/page.js':
      `globalThis.__about = true;\nexport default () => 'about';\n`,
    'components/greeter.js':
      `globalThis.__greet = true;\nexport const g = 'hi';\n`,
  });
  const result = await buildBundle({ appDir, minify: false, sourcemap: false });
  assert.ok(result.bundleFile);
  assert.ok(existsSync(result.bundleFile));
  assert.ok(result.entries.length >= 3, `expected >= 3 entries, got ${result.entries.length}`);
  const code = readFileSync(result.bundleFile, 'utf8');
  assert.ok(code.length > 0);
  assert.ok(/__page/.test(code));
  assert.ok(/__greet/.test(code));
});

test('buildBundle: empty app → bundleFile=null, no crash', async () => {
  const appDir = mkdtempSync(join(tmpRoot, 'empty-'));
  const prev = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    const result = await buildBundle({ appDir });
    assert.equal(result.bundleFile, null);
    assert.deepEqual(result.entries, []);
    assert.ok(warns.some(w => /no client-side entries/i.test(w)));
  } finally {
    console.warn = prev;
  }
});

test('buildBundle: excludes .server.js, route.js, middleware.js', async () => {
  const appDir = makeApp({
    'app/page.js': `export default () => 'ok';\n`,
    'components/widget.js': `export const w = 1;\n`,
    'components/db.server.js': `export const secret = 'NOPE';\n`,
    'app/api/posts/route.js': `export async function GET() { return new Response(''); }\n`,
    'app/middleware.js': `export default (req, next) => next();\n`,
  });
  const result = await buildBundle({ appDir, minify: false, sourcemap: false });
  for (const entry of result.entries) {
    assert.ok(!/\.server\.js$/.test(entry), `server file must not be in entries: ${entry}`);
    assert.ok(!/route\.js$/.test(entry), `route.js must not be in entries: ${entry}`);
    assert.ok(!/middleware\.js$/.test(entry), `middleware.js must not be in entries: ${entry}`);
  }
});

test('buildBundle: respects custom outDir', async () => {
  const appDir = makeApp({
    'app/page.js': `export default () => 'ok';\n`,
    'components/widget.js': `export const w = 1;\n`,
  });
  const outDir = join(tmpRoot, 'custom-out');
  const result = await buildBundle({ appDir, outDir, minify: false, sourcemap: false });
  assert.ok(result.bundleFile.startsWith(outDir),
    `bundle should be under outDir, got ${result.bundleFile}`);
});

test('buildBundle: honours minify=true (smaller bundle)', async () => {
  const appDir = makeApp({
    'app/page.js': `globalThis.__page = true;\nexport default () => 'ok';\n`,
    'components/widget.js':
      `globalThis.greetEveryoneWithAVeryLongFunctionName = function (personName) {\n` +
      `  return 'hello ' + personName + ', welcome to the app, here is a longish string to pad things out';\n` +
      `};\n`,
  });
  const unmin = await buildBundle({ appDir, outDir: join(tmpRoot, 'unmin'), minify: false, sourcemap: false });
  const min = await buildBundle({ appDir, outDir: join(tmpRoot, 'min'), minify: true, sourcemap: false });
  const unminSize = readFileSync(unmin.bundleFile).length;
  const minSize = readFileSync(min.bundleFile).length;
  assert.ok(minSize < unminSize, `minified (${minSize}) should be < unminified (${unminSize})`);
});

test('exists(): true for existing path, false otherwise', async () => {
  assert.equal(await exists(tmpRoot), true);
  assert.equal(await exists(join(tmpRoot, 'does-not-exist')), false);
});
