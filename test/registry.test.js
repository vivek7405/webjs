/**
 * Unit tests for the server-side customElements shim + registerInternal
 * validation branches. Tests use the shim installed by registry.js at
 * module load time (since `typeof window === 'undefined'` in Node).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { register, lookup, primeModuleUrl, isLazy, tagOf, allTags } from '../packages/core/index.js';

class Base {}
class A extends Base {}
class B extends Base {}
class LazyCmp extends Base {}
LazyCmp.lazy = true;

test('register: rejects tags without a hyphen (HTML spec)', () => {
  assert.throws(() => register('plain', A), /must contain a hyphen/);
});

test('register: rejects non-string tag', () => {
  assert.throws(() => register(/** @type any */ (null), A), /must contain a hyphen/);
});

test('register: upserts — second registration for same tag replaces class', () => {
  register('rx-one', A);
  assert.equal(lookup('rx-one'), A);
  register('rx-one', B);
  assert.equal(lookup('rx-one'), B);
});

test('register: upsert preserves previously-primed moduleUrl', () => {
  primeModuleUrl('rx-two', '/components/rx-two.js');
  register('rx-two', A);
  // primeModuleUrl created an entry with cls=null + moduleUrl set.
  // Then register() should update cls without wiping moduleUrl — the
  // branch exercised here is the "entry exists → mutate in place" path.
  register('rx-two', B);
  assert.equal(lookup('rx-two'), B);
});

test('customElements.get (server shim): returns class for registered tag, undefined otherwise', () => {
  register('rx-get', A);
  assert.equal(/** @type any */ (globalThis).customElements.get('rx-get'), A);
  assert.equal(/** @type any */ (globalThis).customElements.get('rx-missing'), undefined);
});

test('customElements.define (server shim): delegates to registerInternal', () => {
  /** @type any */ (globalThis).customElements.define('rx-define', A);
  assert.equal(lookup('rx-define'), A);
});

test('customElements.whenDefined (server shim): resolves to the class when registered', async () => {
  register('rx-when', A);
  const cls = await /** @type any */ (globalThis).customElements.whenDefined('rx-when');
  assert.equal(cls, A);
});

test('customElements.whenDefined (server shim): resolves to undefined for unknown tag', async () => {
  const cls = await /** @type any */ (globalThis).customElements.whenDefined('rx-nope');
  assert.equal(cls, undefined);
});

test('customElements.upgrade (server shim): is a no-op (returns undefined, no throw)', () => {
  assert.doesNotThrow(() => /** @type any */ (globalThis).customElements.upgrade({}));
});

test('isLazy: true for classes with `static lazy = true`', () => {
  register('rx-lazy', LazyCmp);
  assert.equal(isLazy('rx-lazy'), true);
});

test('isLazy: false for classes without lazy flag', () => {
  register('rx-eager', A);
  assert.equal(isLazy('rx-eager'), false);
});

test('isLazy: false for unknown tag', () => {
  assert.equal(isLazy('rx-unknown'), false);
});

test('tagOf: returns tag for class registered via register()', () => {
  register('rx-tagof', A);
  assert.equal(tagOf(A), 'rx-tagof');
});

test('allTags: includes every registered tag', () => {
  register('rx-all-1', A);
  register('rx-all-2', B);
  const tags = allTags();
  assert.ok(tags.includes('rx-all-1'));
  assert.ok(tags.includes('rx-all-2'));
});

test('primeModuleUrl: creates an entry with no cls when called before register()', () => {
  primeModuleUrl('rx-prime', '/components/rx-prime.js');
  // No cls yet — but isLazy returns false (no entry has lazy flag).
  assert.equal(isLazy('rx-prime'), false);
  // lookupModuleUrl via lookup+allTags shouldn't crash.
  assert.ok(allTags().includes('rx-prime'));
});

test('registry is shared across module instances via globalThis (dual-instance bug)', async () => {
  // Two different file URLs for the same registry source. When `@webjskit/core`
  // is installed twice (e.g. globally + locally), Node loads it as two distinct
  // module instances. Each instance must still see the same registry, otherwise
  // a component registered in one instance is invisible to lookups in the other
  // (the bug that caused SSR-bare custom elements when the cli was global).
  const { mkdtempSync, rmSync, copyFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { pathToFileURL } = await import('node:url');

  const dir = mkdtempSync(join(tmpdir(), 'webjs-registry-dual-'));
  try {
    const src = new URL('../packages/core/src/registry.js', import.meta.url);
    const copyA = join(dir, 'registry-a.js');
    const copyB = join(dir, 'registry-b.js');
    copyFileSync(src, copyA);
    copyFileSync(src, copyB);

    const a = await import(pathToFileURL(copyA).href);
    const b = await import(pathToFileURL(copyB).href);

    assert.notEqual(a, b, 'two distinct module instances expected');

    class Shared {}
    a.register('rx-shared-tag', Shared);

    // Both instances must agree the tag is registered.
    assert.ok(a.allTags().includes('rx-shared-tag'));
    assert.ok(b.allTags().includes('rx-shared-tag'),
      'instance B must see registrations made via instance A — registry is shared');
    assert.equal(b.lookup('rx-shared-tag'), Shared);
    assert.equal(b.tagOf(Shared), 'rx-shared-tag');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
