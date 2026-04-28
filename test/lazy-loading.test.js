import { test } from 'node:test';
import assert from 'node:assert/strict';

import { register, isLazy, lookupModuleUrl } from '../packages/core/src/registry.js';
import { WebComponent } from '../packages/core/src/component.js';
import { setVendorEntries, buildImportMap } from '../packages/server/src/importmap.js';

// --- Lazy flag in registry ---

test('registry: non-lazy component has lazy=false', () => {
  class EagerComp extends WebComponent {}
  register('test-eager-comp', EagerComp);
  assert.equal(isLazy('test-eager-comp'), false);
});

test('registry: lazy component has lazy=true', () => {
  class LazyComp extends WebComponent {
    static lazy = true;
  }
  register('test-lazy-comp', LazyComp);
  assert.equal(isLazy('test-lazy-comp'), true);
});

test('registry: unknown tag returns false for isLazy', () => {
  assert.equal(isLazy('nonexistent-tag'), false);
});

// --- Dynamic import map entries ---

test('setVendorEntries: adds entries to import map', () => {
  setVendorEntries({ 'dayjs': '/__webjs/vendor/dayjs.js' });
  const map = buildImportMap();
  assert.equal(map.imports['dayjs'], '/__webjs/vendor/dayjs.js');
  // Built-ins should still be there
  assert.equal(map.imports['@webjskit/core'], '/__webjs/core/index.js');
  // Clean up
  setVendorEntries({});
});

test('setVendorEntries: overwrite replaces previous entries', () => {
  setVendorEntries({ 'pkg-a': '/a.js', 'pkg-b': '/b.js' });
  let map = buildImportMap();
  assert.ok('pkg-a' in map.imports);
  assert.ok('pkg-b' in map.imports);

  setVendorEntries({ 'pkg-c': '/c.js' });
  map = buildImportMap();
  assert.ok(!('pkg-a' in map.imports), 'old entries should be gone');
  assert.ok('pkg-c' in map.imports);
  // Clean up
  setVendorEntries({});
});

test('import map always includes lazy-loader entry', () => {
  const map = buildImportMap();
  assert.equal(map.imports['@webjskit/core/lazy-loader'], '/__webjs/core/src/lazy-loader.js');
});
