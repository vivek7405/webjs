/**
 * Differential elision test, SSR layer (issue #181).
 *
 * Elision's defining invariant is that removing the elided JS NEVER changes
 * observable output. Rather than enumerate the heuristic's long tail of
 * inputs with example-based assertions (which missed #169 and #179), this
 * test verifies the invariant DIRECTLY: it renders a corpus of blog routes
 * with elision ON (default) and OFF (`WEBJS_ELIDE=0`) in one process and
 * asserts the served HTML is byte-identical once the JS-loaded set (the
 * importmap, the boot module script, the modulepreload hints, and the
 * build-id hash derived from them) is masked out. Only the DANGEROUS
 * direction (elision changed what the SSR emits) can fail here; the SAFE
 * direction (over-ship) lives entirely inside the masked region.
 *
 * The browser-after-hydration half of the invariant (a wrongly-dropped
 * module breaking an interaction) is covered by the `differential elision`
 * cases in `test/e2e/e2e.test.mjs`.
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '../../index.js';
// The masker is SHARED with `webjs elision --verify` (#1308), so the app-facing
// guard and this one can never disagree about what "the JS-loaded set" is. The
// counterfactual at the bottom of this file therefore guards it for both.
import { maskJsSet } from '../../src/elision-differential.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOG = resolve(HERE, '../../../../examples/blog');

// A corpus spanning the elision shapes: a mixed page (display-only badges +
// interactive components), an inert fully-static route, a route whose
// display-only component is force-shipped by cross-module observation
// (#169), a fully-static page that drops its own module from the boot, and a
// bare async-render leaf whose module is elided yet whose SSR'd data is in the
// first paint (#474, /async-leaf renders <inline-quote>).
const ROUTES = ['/', '/static-info', '/observed', '/about', '/async-leaf'];

/**
 * The set of module URLs the page preloads (the JS-loaded set), keyed by
 * PATHNAME with the content-hash `?v` query (#243) stripped. The `?v` of a
 * module that imports a display-only component legitimately DIFFERS on vs off,
 * because elision strips that import from the served body, so the body bytes
 * (and thus the content hash) differ. That hash difference is part of the same
 * JS-loaded set the differential invariant masks; the subset check here is
 * about WHICH modules are preloaded, not their cache-busting query.
 */
function preloadSet(html) {
  return new Set(
    [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1].split('?')[0]),
  );
}

const on = {};
const off = {};

before(async () => {
  const ORIG = process.env.WEBJS_ELIDE;
  try {
    // Elision ON: warm fully (so the memoized verdict is locked) before the
    // env flips for the second handler.
    delete process.env.WEBJS_ELIDE;
    const hOn = await createRequestHandler({ appDir: BLOG, dev: false });
    if (hOn.warmup) await hOn.warmup();
    for (const r of ROUTES) {
      const resp = await hOn.handle(new Request('http://localhost' + r));
      on[r] = { status: resp.status, html: await resp.text() };
    }
    // Elision OFF via the env override: a fresh handler instance reads it on
    // its own first warm.
    process.env.WEBJS_ELIDE = '0';
    const hOff = await createRequestHandler({ appDir: BLOG, dev: false });
    if (hOff.warmup) await hOff.warmup();
    for (const r of ROUTES) {
      const resp = await hOff.handle(new Request('http://localhost' + r));
      off[r] = { status: resp.status, html: await resp.text() };
    }
  } finally {
    if (ORIG === undefined) delete process.env.WEBJS_ELIDE;
    else process.env.WEBJS_ELIDE = ORIG;
  }
});

for (const r of ROUTES) {
  test(`observable SSR output is identical on vs off for ${r}`, () => {
    assert.equal(on[r].status, off[r].status, 'same status');
    assert.ok(on[r].status < 400, `route ${r} should render (got ${on[r].status})`);
    const a = maskJsSet(on[r].html);
    const b = maskJsSet(off[r].html);
    if (a !== b) {
      // Surface the first divergence for a readable failure.
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      assert.fail(
        `elision changed observable output for ${r} near offset ${i}:\n` +
        `ON : ...${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}\n` +
        `OFF: ...${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`,
      );
    }
    assert.equal(a, b);
  });
}

test('the mixed page actually elides JS on the ON side (the diff is not vacuous)', () => {
  // Proves elision did real work AND the WEBJS_ELIDE override flipped it: the
  // ON preload set must be a STRICT subset of OFF, and the display-only
  // badge modules present off must be absent on. If this ever became equal,
  // the identical-output assertions above would be passing trivially.
  const onSet = preloadSet(on['/'].html);
  const offSet = preloadSet(off['/'].html);
  assert.ok(offSet.size > onSet.size, `off should preload more than on (off=${offSet.size}, on=${onSet.size})`);
  for (const url of onSet) assert.ok(offSet.has(url), `on-preloaded ${url} must also be off-preloaded (subset)`);
  const dropped = [...offSet].filter((u) => !onSet.has(u));
  assert.ok(
    dropped.some((u) => /build-stamp|vendor-badge|muted-text/.test(u)),
    `a display-only badge module should be dropped on the ON side; dropped=${JSON.stringify(dropped)}`,
  );
});

test('a bare async-render leaf is elided ON yet renders identical SSR (#474)', () => {
  // /async-leaf renders <inline-quote>, a bare async-render display-only leaf.
  // OFF preloads its module; ON drops it (the import is stripped, the preload
  // hint and importmap entry go with it), yet the SSR'd quote is byte-identical
  // on both sides (already asserted by the per-route diff above) AND present.
  const onSet = preloadSet(on['/async-leaf'].html);
  const offSet = preloadSet(off['/async-leaf'].html);
  assert.ok(
    [...offSet].some((u) => /inline-quote/.test(u)),
    `OFF must preload the bare-async leaf module; off=${JSON.stringify([...offSet])}`,
  );
  assert.ok(
    ![...onSet].some((u) => /inline-quote/.test(u)),
    `ON must elide the bare-async leaf module; on=${JSON.stringify([...onSet])}`,
  );
  assert.ok(
    /What you read is what runs\./.test(on['/async-leaf'].html),
    'the elided leaf\'s async data is still baked into the ON first paint (PE-safe)',
  );
});

test('served module source reflects each handler\'s own elision verdict (no cross-handler cache bleed)', async () => {
  // Regression: the transformed-source cache used to be module-global keyed
  // on (path, mtime), but the cached bytes bake in a handler's elision
  // verdict. Booting an ON handler then an OFF handler in one process made
  // the OFF handler serve the ON handler's already-elided source for the
  // same path. A multi-tenant embedder running createRequestHandler per app
  // with different elision settings hit the same poisoning. The cache is now
  // per-handler (state.tsCache). ON is warmed FIRST here so a shared cache
  // would be poisoned by the time OFF reads it.
  const ORIG = process.env.WEBJS_ELIDE;
  // The OFF handler keeps the import; in PROD its relative specifier is also
  // versioned with `?v=<hash>` (#369), so allow that optional query suffix.
  const IMPORT = /import\s+['"][^'"]*build-stamp\.ts(?:\?v=[0-9a-f]+)?['"]/;
  try {
    delete process.env.WEBJS_ELIDE;
    const hOn = await createRequestHandler({ appDir: BLOG, dev: false });
    if (hOn.warmup) await hOn.warmup();
    const onSrc = await (await hOn.handle(new Request('http://localhost/app/page.ts'))).text();

    process.env.WEBJS_ELIDE = '0';
    const hOff = await createRequestHandler({ appDir: BLOG, dev: false });
    if (hOff.warmup) await hOff.warmup();
    const offSrc = await (await hOff.handle(new Request('http://localhost/app/page.ts'))).text();

    // The page side-effect-imports the display-only <build-stamp>. ON strips
    // that import (the module is never downloaded); OFF keeps it.
    assert.ok(!IMPORT.test(onSrc), 'ON handler must strip the elided build-stamp import from the served page source');
    assert.ok(IMPORT.test(offSrc), 'OFF handler must keep the build-stamp import (cross-handler cache bleed would strip it)');
  } finally {
    if (ORIG === undefined) delete process.env.WEBJS_ELIDE;
    else process.env.WEBJS_ELIDE = ORIG;
  }
});

test('counterfactual: the masked diff is sensitive to a real body change', () => {
  // The comparator must not pass vacuously by masking too much. A dropped
  // NEEDED module manifests, in the worst case, as missing rendered output;
  // prove the diff catches a body divergence (here, a custom-element tag and
  // its SSR content removed from one side, simulating that worst case).
  const base = on['/'].html;
  const broken = base.replace(/<build-stamp[\s\S]*?<\/build-stamp>/, '');
  assert.notEqual(broken, base, 'precondition: the corpus renders <build-stamp>');
  assert.notEqual(maskJsSet(broken), maskJsSet(base), 'the masked diff must flag a removed rendered element');
});
