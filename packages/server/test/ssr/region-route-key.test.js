/**
 * Unit tests for the region route-key derivation (Pillar 1, #1013).
 *
 * The client router's structural rebuild keys each children-boundary COMMENT
 * pair with a segment + route-key (#1015) and picks its swap tier by comparing
 * a boundary's OLD vs NEW route-key: changed -> wholesale replace anchored at
 * the parent boundary (Next remount parity), same -> bounded same-route morph
 * (state kept, the searchParams-only-nav case). These are the pure server-side
 * building blocks that derive `segment` (the pattern) and `route-key` (the
 * resolved path).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  _pageSegmentPath, _regionRouteKey, _wrapWithChildrenMarker,
  _boundarySegmentPath, _layoutsForBoundary,
} from '../../src/ssr.js';

test('pageSegmentPath derives the page own segment (full route pattern)', () => {
  assert.equal(_pageSegmentPath('/x/app/page.ts'), '/');
  assert.equal(_pageSegmentPath('/x/app/blog/[slug]/page.tsx'), '/blog/[slug]');
  assert.equal(_pageSegmentPath('/x/app/files/[...rest]/page.js'), '/files/[...rest]');
  assert.equal(_pageSegmentPath('/x/app/(marketing)/about/page.ts'), '/(marketing)/about');
});

test('regionRouteKey: static segments have a constant key', () => {
  assert.equal(_regionRouteKey('/', {}), '/');
  assert.equal(_regionRouteKey('/docs', {}), '/docs');
  assert.equal(_regionRouteKey('/docs/components', {}), '/docs/components');
});

test('regionRouteKey: dynamic [param] is substituted', () => {
  assert.equal(_regionRouteKey('/blog/[slug]', { slug: 'a' }), '/blog/a');
  assert.equal(_regionRouteKey('/blog/[slug]', { slug: 'b' }), '/blog/b');
  assert.equal(_regionRouteKey('/[org]/[repo]', { org: 'webjsdev', repo: 'webjs' }), '/webjsdev/webjs');
});

test('regionRouteKey: route groups are dropped (not in the URL)', () => {
  assert.equal(_regionRouteKey('/(marketing)/about', {}), '/about');
  assert.equal(_regionRouteKey('/(marketing)', {}), '/');
  assert.equal(_regionRouteKey('/(shop)/[id]', { id: '7' }), '/7');
});

test('regionRouteKey: catch-all value is already slash-joined', () => {
  assert.equal(_regionRouteKey('/files/[...rest]', { rest: 'a/b/c' }), '/files/a/b/c');
  assert.equal(_regionRouteKey('/files/[...rest]', { rest: 'a' }), '/files/a');
});

test('regionRouteKey: optional catch-all collapses when empty', () => {
  assert.equal(_regionRouteKey('/shop/[[...slug]]', {}), '/shop');
  assert.equal(_regionRouteKey('/shop/[[...slug]]', { slug: '' }), '/shop');
  assert.equal(_regionRouteKey('/shop/[[...slug]]', { slug: 'x/y' }), '/shop/x/y');
});

test('regionRouteKey: Next remount-vs-preserve semantics by construction', () => {
  // /blog/a -> /blog/b : the page region key changes (remount), the '/' layout
  // region key is constant (preserved). This is the whole two-tier decision.
  const pageA = _regionRouteKey('/blog/[slug]', { slug: 'a' });
  const pageB = _regionRouteKey('/blog/[slug]', { slug: 'b' });
  assert.notEqual(pageA, pageB); // page remounts on a param change
  assert.equal(_regionRouteKey('/', { slug: 'a' }), _regionRouteKey('/', { slug: 'b' })); // layout preserved

  // /blog/a -> /blog/a?x=1 : params are identical (searchParams excluded by
  // construction), so every region key is unchanged -> morph, state preserved.
  assert.equal(pageA, _regionRouteKey('/blog/[slug]', { slug: 'a' }));
});

test('regionRouteKey: param values are encoded so a comment can never be terminated', () => {
  // The route-key rides inside the boundary COMMENT and params are
  // user-controlled: '-->' in a value must not close the comment early.
  // encodeURIComponent removes '<', '>', ':' (comment + delimiter safety).
  assert.equal(_regionRouteKey('/blog/[slug]', { slug: 'a-->b' }), '/blog/a--%3Eb');
  assert.equal(_regionRouteKey('/blog/[slug]', { slug: 'a:b' }), '/blog/a%3Ab');
  // Catch-all values are encoded per piece: literal '/' separators survive.
  assert.equal(_regionRouteKey('/files/[...rest]', { rest: 'a/b-->c' }), '/files/a/b--%3Ec');
});

test('regionRouteKey: STATIC pieces encode only the delimiter characters', () => {
  // ':' would mis-split the segment:route-key parses, ',' the have-entry
  // list, '%' the decode. Normal folder names stay byte-identical; a weird
  // one keeps the no-delimiter invariant every parse relies on.
  assert.equal(_regionRouteKey('/v1.2/docs', {}), '/v1.2/docs');
  assert.equal(_regionRouteKey('/a:b', {}), '/a%3Ab');
  assert.equal(_regionRouteKey('/a,b', {}), '/a%2Cb');
  assert.equal(_regionRouteKey('/a%b', {}), '/a%25b');
});

test('wrapWithChildrenMarker: emits the keyed boundary pair (segment + route-key open, segment close)', () => {
  const r = _wrapWithChildrenMarker('CHILD', '/blog/[slug]', { slug: 'a' });
  assert.equal(r._$webjs, 'template');
  assert.equal(r.strings[0], '<!--wj:children:/blog/[slug]:/blog/a-->');
  assert.equal(r.strings[1], '<!--/wj:children:/blog/[slug]-->');
  assert.deepEqual(r.values, ['CHILD']);
});

test('wrapWithChildrenMarker: a static segment has a constant route-key', () => {
  const r = _wrapWithChildrenMarker('X', '/', {});
  assert.equal(r.strings[0], '<!--wj:children:/:/-->');
  assert.equal(r.strings[1], '<!--/wj:children:/-->');
});

/* ------------ boundary segment derivation (#1298) ------------ */

test('boundarySegmentPath derives a boundary file own segment', () => {
  assert.equal(_boundarySegmentPath('/x/app/error.ts'), '/');
  assert.equal(_boundarySegmentPath('/x/app/docs/error.js'), '/docs');
  assert.equal(_boundarySegmentPath('/x/app/docs/not-found.tsx'), '/docs');
  assert.equal(_boundarySegmentPath('/x/app/admin/forbidden.ts'), '/admin');
  assert.equal(_boundarySegmentPath('/x/app/admin/unauthorized.ts'), '/admin');
  // Route groups are KEPT, for the same reason layoutSegmentPath keeps them:
  // two routes at one URL prefix under different (group) layouts must not look
  // like a shared layout.
  assert.equal(_boundarySegmentPath('/x/app/(marketing)/about/not-found.ts'), '/(marketing)/about');
});

test('layoutsForBoundary keeps the boundary own segment and every ancestor', () => {
  // Next hierarchy: layout -> error -> page, so error.js sits INSIDE its
  // segment layout and that layout DOES wrap it. A deeper layout never
  // rendered, so it is excluded.
  const layouts = ['/x/app/layout.ts', '/x/app/docs/layout.ts', '/x/app/docs/deep/layout.ts'];
  assert.deepEqual(_layoutsForBoundary(layouts, '/docs'), ['/x/app/layout.ts', '/x/app/docs/layout.ts']);
  assert.deepEqual(_layoutsForBoundary(layouts, '/'), ['/x/app/layout.ts']);
  assert.deepEqual(_layoutsForBoundary(layouts, '/docs/deep'), layouts);
  assert.deepEqual(_layoutsForBoundary([], '/docs'), []);
  assert.deepEqual(_layoutsForBoundary(undefined, '/docs'), []);
});

test('layoutsForBoundary breaks the prefix test on a segment', () => {
  // '/doc' must never match '/docs': a plain startsWith would wrap a boundary
  // in a layout from an unrelated sibling route.
  assert.deepEqual(_layoutsForBoundary(['/x/app/doc/layout.ts'], '/docs'), []);
  assert.deepEqual(_layoutsForBoundary(['/x/app/docs/layout.ts'], '/docs-archive'), []);
});
