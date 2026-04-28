import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  extractPackageName,
  scanBareImports,
  vendorImportMapEntries,
  bundlePackage,
  serveVendorBundle,
  clearVendorCache,
} from '../packages/server/src/vendor.js';

// --- extractPackageName ---

test('extractPackageName: plain package', () => {
  assert.equal(extractPackageName('dayjs'), 'dayjs');
});

test('extractPackageName: scoped package', () => {
  assert.equal(extractPackageName('@tanstack/query-core'), '@tanstack/query-core');
});

test('extractPackageName: deep path returns root', () => {
  assert.equal(extractPackageName('dayjs/locale/en'), 'dayjs');
});

test('extractPackageName: scoped deep path returns scope/name', () => {
  assert.equal(extractPackageName('@tanstack/query-core/utils'), '@tanstack/query-core');
});

test('extractPackageName: relative import returns null', () => {
  assert.equal(extractPackageName('./foo'), null);
  assert.equal(extractPackageName('../bar'), null);
});

test('extractPackageName: absolute import returns null', () => {
  assert.equal(extractPackageName('/baz'), null);
});

test('extractPackageName: protocol URL returns null', () => {
  assert.equal(extractPackageName('https://cdn.example.com/lib.js'), null);
  assert.equal(extractPackageName('data:text/javascript,1'), null);
});

test('extractPackageName: empty string returns null', () => {
  assert.equal(extractPackageName(''), null);
});

// --- scanBareImports ---

test('scanBareImports: finds bare specifiers in source files', async () => {
  const dir = join(tmpdir(), `webjs-test-vendor-${Date.now()}`);
  await mkdir(dir, { recursive: true });

  await writeFile(join(dir, 'a.js'), `
    import dayjs from 'dayjs';
    import { something } from '@scope/lib';
    import './local.js';
  `);
  await writeFile(join(dir, 'b.ts'), `
    import { z } from 'zod';
    const d = await import('dynamic-pkg');
  `);
  // Server files should be skipped
  await writeFile(join(dir, 'c.server.ts'), `
    import pg from 'pg';
  `);

  const found = await scanBareImports(dir);

  assert.ok(found.has('dayjs'));
  assert.ok(found.has('@scope/lib'));
  assert.ok(found.has('zod'));
  assert.ok(found.has('dynamic-pkg'));
  assert.ok(!found.has('pg'), 'server-only imports should be skipped');
  assert.ok(!found.has('./local.js'), 'relative imports should be excluded');
  // Built-ins should never appear
  assert.ok(!found.has('@webjskit/core'));

  await rm(dir, { recursive: true, force: true });
});

test('scanBareImports: skips node_modules and _private dirs', async () => {
  const dir = join(tmpdir(), `webjs-test-vendor-skip-${Date.now()}`);
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  await mkdir(join(dir, '_private'), { recursive: true });

  await writeFile(join(dir, 'node_modules', 'x.js'), `import 'should-not-find';`);
  await writeFile(join(dir, '_private', 'y.js'), `import 'also-hidden';`);
  await writeFile(join(dir, 'app.js'), `import 'visible';`);

  const found = await scanBareImports(dir);
  assert.ok(found.has('visible'));
  assert.ok(!found.has('should-not-find'));
  assert.ok(!found.has('also-hidden'));

  await rm(dir, { recursive: true, force: true });
});

// --- vendorImportMapEntries ---

test('vendorImportMapEntries: generates correct URLs', () => {
  const entries = vendorImportMapEntries(new Set(['dayjs', '@tanstack/query']));
  assert.equal(entries['dayjs'], '/__webjs/vendor/dayjs.js');
  assert.equal(entries['@tanstack/query'], '/__webjs/vendor/%40tanstack%2Fquery.js');
});

test('vendorImportMapEntries: skips built-ins', () => {
  const entries = vendorImportMapEntries(new Set(['@webjskit/core', 'dayjs']));
  assert.ok(!('@webjskit/core' in entries));
  assert.ok('dayjs' in entries);
});

// --- extractPackageName: edge cases ---

test('extractPackageName: __webjs-prefixed specifier returns null', () => {
  // The implementation treats specifiers starting with "__" as non-bundleable
  // (framework-internal URLs like /__webjs/...).
  assert.equal(extractPackageName('__webjs/vendor/x'), null);
});

test('extractPackageName: lone @scope with no package name returns null', () => {
  assert.equal(extractPackageName('@scope'), null);
});

// --- bundlePackage + serveVendorBundle ---
//
// These exercise the esbuild path against a tiny, dependency-free package
// that's already installed in node_modules (`picocolors`). A single esbuild
// invocation usually completes in ~50–150ms.

test('bundlePackage: bundles a real package → ESM source', async () => {
  clearVendorCache();
  const code = await bundlePackage('picocolors', process.cwd(), false);
  assert.equal(typeof code, 'string');
  assert.ok(code.length > 0, 'bundle should be non-empty');
  // ESM bundles should export something.
  assert.ok(/export\s*(?:default|{)/.test(code), 'expected ESM exports');
});

test('bundlePackage: second call hits the in-memory cache', async () => {
  // Prime
  const first = await bundlePackage('picocolors', process.cwd(), false);
  // Second call should return the exact same cached string without rebuilding
  const second = await bundlePackage('picocolors', process.cwd(), false);
  assert.equal(first, second);
});

test('bundlePackage: unknown package → null', async () => {
  clearVendorCache();
  const code = await bundlePackage('this-pkg-definitely-does-not-exist-xyz', process.cwd(), false);
  assert.equal(code, null);
});

test('clearVendorCache: subsequent bundlePackage call re-builds', async () => {
  await bundlePackage('picocolors', process.cwd(), false);   // populates cache
  clearVendorCache();
  // Re-build should still work (and return a string).
  const code = await bundlePackage('picocolors', process.cwd(), false);
  assert.equal(typeof code, 'string');
  assert.ok(code.length > 0);
});

test('serveVendorBundle: known package → 200 JS response with cache headers', async () => {
  clearVendorCache();
  const resp = await serveVendorBundle('picocolors', process.cwd(), false);
  assert.equal(resp.status, 200);
  assert.equal(
    resp.headers.get('content-type'),
    'application/javascript; charset=utf-8',
  );
  assert.equal(
    resp.headers.get('cache-control'),
    'public, max-age=31536000, immutable',
  );
  const body = await resp.text();
  assert.ok(body.length > 0);
});

test('serveVendorBundle: dev=true uses no-cache', async () => {
  clearVendorCache();
  const resp = await serveVendorBundle('picocolors', process.cwd(), true);
  assert.equal(resp.status, 200);
  assert.equal(resp.headers.get('cache-control'), 'no-cache');
});

test('serveVendorBundle: unknown package → 404 JS response', async () => {
  clearVendorCache();
  const resp = await serveVendorBundle('this-pkg-does-not-exist-abc', process.cwd(), false);
  assert.equal(resp.status, 404);
  assert.equal(
    resp.headers.get('content-type'),
    'application/javascript; charset=utf-8',
  );
  const body = await resp.text();
  assert.ok(body.includes('this-pkg-does-not-exist-abc'));
});
