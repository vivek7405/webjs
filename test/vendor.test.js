import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  extractPackageName,
  scanBareImports,
  vendorImportMapEntries,
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
  assert.ok(!found.has('webjs'));
  assert.ok(!found.has('superjson'));

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
  const entries = vendorImportMapEntries(new Set(['webjs', 'superjson', 'dayjs']));
  assert.ok(!('webjs' in entries));
  assert.ok(!('superjson' in entries));
  assert.ok('dayjs' in entries);
});
