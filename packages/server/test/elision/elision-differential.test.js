/**
 * The shared differential primitives (#1308).
 *
 * `maskJsSet` itself is guarded by the counterfactual in
 * `differential-elision.test.js` (a removed rendered element must still flag),
 * which now covers BOTH consumers because there is one definition. What that
 * file does not cover is `staticPageRoutes`, the corpus builder `webjs elision
 * --verify` renders on both sides, so it is tested here.
 *
 * The corpus is where a silent under-test hides: a normalization bug that
 * dropped every route would make `--verify` pass vacuously, which is exactly
 * the failure the command's zero-route exit code exists to catch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { maskJsSet, staticPageRoutes } from '../../src/elision-differential.js';

test('the root route is /', () => {
  assert.deepEqual(staticPageRoutes({ pages: [{ routeDir: '.' }] }), ['/']);
  assert.deepEqual(staticPageRoutes({ pages: [{ routeDir: '' }] }), ['/']);
});

test('a dynamic page is excluded (rendering it would mean inventing params)', () => {
  const table = { pages: [
    { routeDir: 'blog', paramNames: [] },
    { routeDir: 'blog/[slug]', paramNames: ['slug'] },
    { routeDir: 'docs/[...rest]', paramNames: ['rest'] },
  ] };
  assert.deepEqual(staticPageRoutes(table), ['/blog']);
});

test('route groups and _private segments drop out of the URL', () => {
  const table = { pages: [
    { routeDir: '(marketing)/about' },
    { routeDir: 'shop/_internal/cart' },
    { routeDir: '(a)/(b)' },
  ] };
  assert.deepEqual(staticPageRoutes(table), ['/', '/about', '/shop/cart']);
});

test('output is sorted and deduped', () => {
  // Two route dirs can normalize to the same URL (a group wrapper plus the
  // bare path), and rendering it twice would just be wasted work.
  const table = { pages: [
    { routeDir: 'z' }, { routeDir: 'a' }, { routeDir: '(g)/a' },
  ] };
  assert.deepEqual(staticPageRoutes(table), ['/a', '/z']);
});

test('a missing or empty page list yields an empty corpus, never a throw', () => {
  assert.deepEqual(staticPageRoutes({}), []);
  assert.deepEqual(staticPageRoutes({ pages: [] }), []);
  assert.deepEqual(staticPageRoutes(undefined), []);
});

test('maskJsSet removes the whole JS-loaded set and normalises whitespace', () => {
  const html =
    '<head><script type="importmap" data-webjs-build="abc">{"imports":{}}</script>' +
    '<link rel="modulepreload" href="/a.js"><link rel="preconnect" href="https://cdn">' +
    '<script type="module">import "/a.js";</script></head><body> <p>hello</p> </body>';
  const masked = maskJsSet(html);
  assert.ok(!masked.includes('importmap'));
  assert.ok(!masked.includes('modulepreload'));
  assert.ok(!masked.includes('preconnect'));
  assert.ok(!masked.includes('data-webjs-build'));
  assert.ok(masked.includes('<p>hello</p>'), 'observable output survives');
});
