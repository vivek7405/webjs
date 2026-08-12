import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm, symlink, readFile as readFileFs } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';

import {
  extractPackageName,
  scanBareImports,
  reachedBareImports,
  vendorImportMapEntries,
  getPackageVersion,
  jspmGenerate,
  clearVendorCache,
  pinAll,
  unpinPackage,
  listPinned,
  readPinFile,
  resolveVendorImports,
  serveDownloadedBundle,
  SUPPORTED_PROVIDERS,
  normalizeProvider,
  auditPinned,
  findOutdated,
  updatePinned,
} from '../../src/vendor.js';
import { buildModuleGraph } from '../../src/module-graph.js';
import { browserEntryFiles } from '../../src/browser-entries.js';
import { scanComponents } from '../../src/component-scanner.js';
import { buildRouteTable } from '../../src/router.js';
import { withJspmDouble } from '../../../../test/fixtures/jspm-double.mjs';

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

test('extractPackageName: __webjs-prefixed specifier returns null', () => {
  assert.equal(extractPackageName('__webjs/vendor/x'), null);
});

test('extractPackageName: lone @scope with no package name returns null', () => {
  assert.equal(extractPackageName('@scope'), null);
});

// --- scanBareImports ---
//
// The scan is rooted in the module graph (#1399), so every fixture below is a
// real minimal app: a `package.json`, an `app/page.ts` the route table finds,
// and whatever the page reaches from there. A loose file in a bare temp dir is
// unreachable by construction and contributes nothing, which is the point.

/**
 * Write a minimal app under a fresh temp dir. Keys are app-relative paths.
 * A `package.json` is supplied unless the fixture writes its own.
 */
async function makeVendorApp(slug, files) {
  const dir = join(tmpdir(), `webjs-test-vendor-${slug}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  if (!files['package.json']) {
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'scan-fixture', private: true }));
  }
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
  return dir;
}

test('scanBareImports: finds bare specifiers in source files', async () => {
  const dir = await makeVendorApp('basic', {
    'app/page.ts': `
      import dayjs from 'dayjs';
      import { something } from '@scope/lib';
      import './local.js';
      import '../b.ts';
      import { core } from '@webjsdev/core';
      export default function Page() { return [dayjs, something, core]; }
    `,
    'app/local.js': `export const local = 1;`,
    'b.ts': `
      import { z } from 'zod';
      const d = await import('dynamic-pkg');
      export const b = [z, d];
    `,
    'c.server.ts': `import pg from 'pg';\nexport const c = pg;`,
  });

  const found = await scanBareImports(dir);

  assert.ok(found.has('dayjs'));
  assert.ok(found.has('@scope/lib'));
  assert.ok(found.has('zod'), 'a specifier one hop from the page is reached');
  assert.ok(found.has('dynamic-pkg'), 'a dynamic-import specifier is reached');
  assert.ok(!found.has('pg'), 'server-only imports should be skipped');
  assert.ok(!found.has('./local.js'), 'relative imports should be excluded');
  assert.ok(!found.has('@webjsdev/core'), 'core is served locally, never vendored');

  await rm(dir, { recursive: true, force: true });
});

test('scanBareImports: skips server-only @webjsdev pkgs (#713)', async () => {
  const dir = await makeVendorApp('server-only', {
    // A page that legitimately imports a server-only framework pkg name directly
    // (defensive: even if surfaced, it must not reach the jspm path).
    'app/page.ts': `import dayjs from 'dayjs';
     import '@webjsdev/cli/bin/webjs.js';
     import '@webjsdev/server/some';
     import '@webjsdev/mcp';
     export default function Page() { return dayjs; }`,
  });

  const found = await scanBareImports(dir);

  assert.ok(found.has('dayjs'), 'a real browser vendor is still scanned');
  assert.ok(![...found].some((s) => s.startsWith('@webjsdev/cli')), 'no @webjsdev/cli specifier leaks');
  assert.ok(![...found].some((s) => s.startsWith('@webjsdev/server')), 'server-only @webjsdev/server excluded');
  assert.ok(![...found].some((s) => s.startsWith('@webjsdev/mcp')), 'server-only @webjsdev/mcp excluded');

  await rm(dir, { recursive: true, force: true });
});

test('scanBareImports: skips import type statements (TS erases them)', async () => {
  const dir = await makeVendorApp('typeimport-skip', {
    'app/page.ts': `
      import type { WebSocket } from 'ws';
      import type { Database as DB } from 'pg';
      import dayjs from 'dayjs';
      export default function Page() { return dayjs; }
    `,
  });

  const found = await scanBareImports(dir);
  assert.ok(found.has('dayjs'), 'real value imports remain');
  assert.ok(!found.has('ws'), 'type-only imports must be skipped');
  assert.ok(!found.has('pg'), 'type-only imports must be skipped');

  await rm(dir, { recursive: true, force: true });
});

test('scanBareImports: preserves full specifiers including subpaths', async () => {
  const dir = await makeVendorApp('subpath', {
    'app/page.ts': `
      import dayjs from 'dayjs';
      import utc from 'dayjs/plugin/utc';
      import timezone from 'dayjs/plugin/timezone';
      import { Turbo } from '@hotwired/turbo';
      import frame from '@hotwired/turbo/elements/turbo-frame';
      export default function Page() { return [dayjs, utc, timezone, Turbo, frame]; }
    `,
  });

  const found = await scanBareImports(dir);
  assert.ok(found.has('dayjs'), 'root dayjs import preserved');
  assert.ok(found.has('@hotwired/turbo'), 'root scoped import preserved');
  assert.ok(found.has('dayjs/plugin/utc'), 'subpath import preserved with full path');
  assert.ok(found.has('dayjs/plugin/timezone'), 'second subpath import preserved');
  assert.ok(found.has('@hotwired/turbo/elements/turbo-frame'), 'scoped subpath preserved');

  await rm(dir, { recursive: true, force: true });
});

// Replaces the four name-list tests this block used to carry (route/middleware,
// test//tests/, dot-dirs, *.config.*). Their subject was an exclusion LIST that
// no longer exists: reachability decides, so the filename is irrelevant and an
// unreferenced module drops out even when no name rule would ever have caught it.
test('scanBareImports: an unreachable file contributes nothing, whatever it is called', async () => {
  const dir = await makeVendorApp('unreachable', {
    'app/page.ts': `import '../components/widget.ts';\nexport default function Page() { return null; }`,
    'components/widget.ts': `import real from 'real-dep';\nexport const w = real;`,
    'scripts/generate-og.mjs': `import { chromium } from 'playwright';\nexport const c = chromium;`,
    'web-test-runner.config.js': `import { x } from 'tooling-pkg';\nexport const t = x;`,
    'test/helper.ts': `import 'test-only-pkg';`,
    '.github/tool.js': `import 'dot-dir-pkg';`,
    'app/api/x/route.ts': `import pg from 'pg';\nexport const GET = () => pg;`,
    'middleware.ts': `import 'root-mw-pkg';\nexport default async (req, next) => next();`,
    // A plain unreferenced module at the app root. No name-based exclusion
    // would ever have caught this one; only reachability does.
    'orphan.ts': `import 'orphan-pkg';`,
  });

  const found = await scanBareImports(dir);
  assert.ok(found.has('real-dep'), 'a specifier a page reaches is found');
  for (const spec of ['playwright', 'tooling-pkg', 'test-only-pkg', 'dot-dir-pkg', 'pg', 'root-mw-pkg', 'orphan-pkg']) {
    assert.ok(!found.has(spec), `${spec} is unreachable from any browser entry and must not be vendored`);
  }

  await rm(dir, { recursive: true, force: true });
});

test('scanBareImports: a bare specifier imported only from scripts/ never reaches the result', async () => {
  // The literal #1399 repro: website/scripts/generate-og.mjs imports playwright,
  // which jspm 401s on every cold analysis.
  const dir = await makeVendorApp('scripts-dir', {
    'app/page.ts': `import dayjs from 'dayjs';\nexport default function Page() { return dayjs; }`,
    'scripts/generate-og.mjs': `import { chromium } from 'playwright';\nexport const c = chromium;`,
  });

  const found = await scanBareImports(dir);
  assert.ok(found.has('dayjs'), 'the page vendor is still found');
  assert.ok(!found.has('playwright'), 'a build script is not a browser entry');

  await rm(dir, { recursive: true, force: true });
});

test('scanBareImports: an import written inside a template literal is not a vendor specifier', async () => {
  // website/lib/samples.ts holds docs code samples in exported template
  // literals. The old comment-stripping scanner could not tell them from real
  // imports, so drizzle-orm was sent to jspm on every cold analysis.
  const dir = await makeVendorApp('template-sample', {
    'app/page.ts': `
      import { z } from 'zod';
      export const ACTION_SAMPLE = \`
        'use server';
        import { eq } from 'drizzle-orm';
        export async function x() {}
      \`;
      export default function Page() { return [z, ACTION_SAMPLE]; }
    `,
  });

  const found = await scanBareImports(dir);
  assert.ok(found.has('zod'), 'the real import is found');
  assert.ok(!found.has('drizzle-orm'), 'an import written as example text is not an edge');

  await rm(dir, { recursive: true, force: true });
});

test('scanBareImports: a specifier reachable only through a dynamic import is retained', async () => {
  // The importmap must cover a lazily-imported module's specifier even though
  // the preload set (transitiveDeps) deliberately ignores dynamic edges: the
  // import has to resolve when it finally runs.
  const dir = await makeVendorApp('dynamic-only', {
    'app/page.ts': `export default async function Page() { const m = await import('../chart.ts'); return m; }`,
    'chart.ts': `import c from 'chart-pkg';\nexport default c;`,
  });

  const found = await scanBareImports(dir);
  assert.ok(found.has('chart-pkg'), 'a dynamically-reached vendor still needs an importmap entry');

  await rm(dir, { recursive: true, force: true });
});

test('reachedBareImports: the elision skip set prunes a specifier and the subtree behind it', async () => {
  // badge (elided) imports dayjs plus a relative ./fmt.ts that imports fmt-pkg;
  // counter (shipping) imports zod and the same shared-pkg as badge.
  const dir = await makeVendorApp('skip', {
    'app/page.ts': `import '../components/badge.ts';\nimport '../components/counter.ts';\nexport default function Page() { return null; }`,
    'components/badge.ts': `import dayjs from 'dayjs';\nimport sh from 'shared-pkg';\nimport { f } from './fmt.ts';\nexport const b = [dayjs, sh, f];`,
    'components/fmt.ts': `import fmt from 'fmt-pkg';\nexport const f = fmt;`,
    'components/counter.ts': `import { z } from 'zod';\nimport sh from 'shared-pkg';\nexport const c = [z, sh];`,
  });

  const graph = await buildModuleGraph(dir);
  const components = await scanComponents(dir);
  const routeTable = await buildRouteTable(dir);
  const entries = [...browserEntryFiles(routeTable, components)];
  const skip = new Set([join(dir, 'components', 'badge.ts')]);
  const found = reachedBareImports(graph, entries, dir, skip);

  assert.ok(!found.has('dayjs'), 'dayjs is only in the elided component, should drop');
  assert.ok(!found.has('fmt-pkg'), 'the subtree behind an elided component drops with it');
  assert.ok(found.has('zod'), 'zod is in a shipping component, should stay');
  assert.ok(found.has('shared-pkg'), 'a dep shared with a shipping file is retained');

  await rm(dir, { recursive: true, force: true });
});
// --- getPackageVersion ---

test('getPackageVersion: returns installed version for a known package', () => {
  // picocolors is installed in this repo. The exact version varies
  // across npm bumps; assert the shape and non-empty value.
  const v = getPackageVersion('picocolors', process.cwd());
  assert.ok(v, 'expected a version string');
  assert.match(v, /^\d+\.\d+\.\d+/);
});

test('getPackageVersion: returns null for unresolvable package', () => {
  const v = getPackageVersion('this-package-truly-does-not-exist-xyz-123', process.cwd());
  assert.equal(v, null);
});

// --- jspmGenerate ---
//
// These used to hit api.jspm.io, which is how a jspm outage redded the required
// CI job on a documentation-only PR (#1149, #1150). They resolve through
// `test/fixtures/jspm-double.mjs` now. The one test that genuinely needs the
// real API lives in `jspm-cdn.live.test.js`, which both runners skip unless
// `WEBJS_REQUIRE_NETWORK=1`.

test('jspmGenerate: empty install list returns empty map', async () => {
  clearVendorCache();
  // No double needed: an empty list short-circuits before any call.
  const result = await jspmGenerate([]);
  assert.deepEqual(result, {});
});

test('jspmGenerate: resolves a package to a CDN URL', async () => {
  await withJspmDouble({}, async () => {
    const result = await jspmGenerate(['picocolors@1.1.1']);
    const url = result['picocolors'];
    assert.ok(url, 'expected picocolors entry in result');
    assert.match(url, /^https:\/\/ga\.jspm\.io\/npm:picocolors@1\.1\.1/);
  });
});

test('jspmGenerate: second call with same installs hits in-process cache', async () => {
  await withJspmDouble({}, async (double) => {
    const first = await jspmGenerate(['picocolors@1.1.1']);
    // Per-install cache: each call rebuilds a merged container but the
    // underlying URL is the cached Promise's resolved value, so the URL
    // is identical and no second HTTP round-trip fires.
    const second = await jspmGenerate(['picocolors@1.1.1']);
    assert.deepEqual(first, second, 'cached call returns the same URLs');
    // Against the live CDN this test could only compare the two results, which
    // stays true even if a second round trip fired. The double can count, so
    // the cache claim in the comment above is now actually asserted.
    assert.equal(double.generateCalls.length, 1, 'the second call must not reach the API');
  });
});

test('jspmGenerate: install order does not affect OUR merged output (deterministic mock, no live CDN)', async () => {
  // The property under test is OUR per-package resolve + merge being
  // order-independent, NOT the live CDN's transitive-resolution stability. The
  // old test hit ga.jspm.io twice and `deepEqual`d the results, which flaked
  // (#312): the live CDN occasionally resolved a transitive in one ordering but
  // not the other. Mock the generate endpoint so each install resolves to a
  // FIXED fragment, isolating our code from the live CDN.
  const fragment = (pkg) => {
    const name = pkg.replace(/@[^@]*$/, ''); // strip the trailing @version
    return { [name]: `https://ga.jspm.io/npm:${pkg}/mock.js` };
  };
  const mock = async (_url, opts) => {
    const { install } = JSON.parse(opts.body); // unified call sends the whole set in one install[]
    const imports = {};
    for (const i of install) Object.assign(imports, fragment(i));
    return { ok: true, status: 200, json: async () => ({ map: { imports } }) };
  };
  await withMockedFetch(mock, async () => {
    clearVendorCache();
    const a = await jspmGenerate(['picocolors@1.1.1', 'clsx@2.1.1']);
    clearVendorCache(); // force b to re-resolve through the mock, not the in-process cache
    const b = await jspmGenerate(['clsx@2.1.1', 'picocolors@1.1.1']);
    assert.deepEqual(a, b, 'merged output must be order-independent');
    assert.deepEqual(
      a,
      {
        picocolors: 'https://ga.jspm.io/npm:picocolors@1.1.1/mock.js',
        clsx: 'https://ga.jspm.io/npm:clsx@2.1.1/mock.js',
      },
      'each requested package resolved to its fixed fragment',
    );
  });
});

/* ---------- jspmGenerate failure modes (mocked fetch, no network) ---------- */

function withMockedFetch(mockFn, body) {
  const original = globalThis.fetch;
  globalThis.fetch = mockFn;
  return body().finally(() => { globalThis.fetch = original; });
}

test('jspmGenerate: fetch rejection (network error) returns empty map, does not throw', async () => {
  clearVendorCache();
  await withMockedFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    const r = await jspmGenerate(['fake-pkg-x@1.0.0']);
    assert.deepEqual(r, {}, 'network error must yield empty map');
  });
});

test('jspmGenerate: 5xx response returns empty map', async () => {
  clearVendorCache();
  await withMockedFetch(async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
  }), async () => {
    const r = await jspmGenerate(['fake-pkg-y@1.0.0']);
    assert.deepEqual(r, {});
  });
});

test('jspmGenerate: non-ok response with JSON error body extracts the error detail', async () => {
  clearVendorCache();
  await withMockedFetch(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: 'Unable to resolve npm:fake-pkg-z@1.0.0' }),
  }), async () => {
    const r = await jspmGenerate(['fake-pkg-z@1.0.0']);
    assert.deepEqual(r, {}, 'failed install must produce no importmap entry');
  });
});

test('jspmGenerate: non-ok response with NON-JSON body does not crash', async () => {
  clearVendorCache();
  await withMockedFetch(async () => ({
    ok: false,
    status: 500,
    json: async () => { throw new Error('not JSON'); },
  }), async () => {
    // Must not throw despite the json() throwing.
    const r = await jspmGenerate(['fake-pkg-w@1.0.0']);
    assert.deepEqual(r, {});
  });
});

test('jspmGenerate: 200 with missing map.imports returns empty', async () => {
  clearVendorCache();
  await withMockedFetch(async () => ({
    ok: true,
    json: async () => ({}),  // no `map.imports`
  }), async () => {
    const r = await jspmGenerate(['ok-pkg@1.0.0']);
    assert.deepEqual(r, {});
  });
});

test('jspmGenerate: 200 with map.imports as non-object returns empty', async () => {
  clearVendorCache();
  await withMockedFetch(async () => ({
    ok: true,
    json: async () => ({ map: { imports: 'not-an-object' } }),
  }), async () => {
    // The current code returns whatever `.map.imports` is. A non-object
    // would propagate but the importmap module's setVendorEntries would
    // store it; buildImportMap would spread `...nonObject`. JS spreads
    // non-objects to nothing. So practically, no entries get added.
    // What we assert here: no throw.
    const r = await jspmGenerate(['ok-pkg-2@1.0.0']);
    // The function returns whatever shape; just verify it didn't throw.
    assert.ok(r !== undefined);
  });
});

test('jspmGenerate: 200 with malformed JSON does not crash', async () => {
  clearVendorCache();
  await withMockedFetch(async () => ({
    ok: true,
    json: async () => { throw new SyntaxError('Unexpected token'); },
  }), async () => {
    const r = await jspmGenerate(['malformed-pkg@1.0.0']);
    assert.deepEqual(r, {});
  });
});

test('jspmGenerate: per-package isolation, one bad install does not poison good ones', async () => {
  // Mix a known-good package with a known-bad one. jspm 401s the WHOLE batch
  // when any single install is unresolvable, but the good one MUST still
  // resolve through the per-install probes. This is the regression test for
  // the batched-call bug where one unresolvable dep collapsed the entire
  // importmap.
  //
  // The double models the whole-batch 401 rather than answering a partial map,
  // because that premise is what the probe path exists for. It is re-checked
  // against the real API by `jspm-cdn.live.test.js`.
  const bad = 'this-package-truly-does-not-exist-xyz-789@99.0.0';
  await withJspmDouble({ unresolvable: [bad] }, async () => {
    const result = await jspmGenerate(['picocolors@1.1.1', bad]);
    assert.ok(result['picocolors'], 'good package must resolve despite bad neighbor');
    assert.match(result['picocolors'], /^https:\/\/ga\.jspm\.io\//);
    assert.equal(result['this-package-truly-does-not-exist-xyz-789'], undefined,
      'the unresolvable install must be dropped, not faked');
  });
});

/* ---------- #446: unified whole-set resolution + 401 fallback + parity ---------- */

test('jspmGenerate #446: multi-install set resolves in ONE generate call (unified, not per-package)', async () => {
  // The core of the fix: a >1 install set hits api.jspm.io ONCE with the
  // whole install[] array, so jspm computes one mutually-consistent graph,
  // instead of one isolated call per package (which skewed direct vs
  // transitive versions). Counterfactual: revert jspmGenerate to the old
  // per-package loop and this drops to two calls, each with a single install.
  /** @type {Array<string[]>} */
  const callInstalls = [];
  const mock = async (_url, opts) => {
    const { install } = JSON.parse(opts.body);
    callInstalls.push(install);
    const imports = {};
    for (const i of install) {
      const name = i.replace(/@[^@]*$/, '');
      imports[name] = `https://ga.jspm.io/npm:${i}/mock.js`;
    }
    return { ok: true, status: 200, json: async () => ({ map: { imports } }) };
  };
  await withMockedFetch(mock, async () => {
    clearVendorCache();
    await jspmGenerate(['picocolors@1.1.1', 'clsx@2.1.1']);
    assert.equal(callInstalls.length, 1, 'exactly one generate call for the whole set');
    assert.deepEqual(
      [...callInstalls[0]].sort(),
      ['clsx@2.1.1', 'picocolors@1.1.1'],
      'the single call carried BOTH installs',
    );
  });
});

test('jspmGenerate #446: a conflicting graph cannot skew a version (deterministic mock)', async () => {
  // The consequence half of the #446 fix, and the one that actually caught the
  // shipped bug. The test above proves the CALL is unified; this proves what
  // that buys, that no served entry can end up on a different version than the
  // graph agreed on.
  //
  // The repro from the issue: @codemirror/view is requested pinned at 6.39.0
  // while @codemirror/lint needs a newer view (^6.42). Resolving each install
  // in isolation produced TWO different view URLs (6.39 direct, 6.43 via lint)
  // merged last-write-wins, so a served entry imported a symbol another served
  // entry lacked.
  //
  // The mock answers a UNIFIED call (both installs together) with the coherent
  // graph, and a per-package call with the skewed view that install alone
  // implies. That asymmetry is what makes this discriminating: revert
  // jspmGenerate to the old per-package loop and lint's isolated call hands
  // back view@6.43.0, which wins last-write and reds the final assertion.
  //
  // Deliberately a mock rather than the live CDN. The live version of this
  // test pinned @codemirror/lint@6.9.6, and when that version stopped
  // resolving on jspm.io it failed on every run and blocked main for everyone
  // (#1218). The version range is the problem: only lint 6.9.6 and 6.9.7 carry
  // the `^6.42.0` view range that creates the conflict at all, and NEITHER
  // resolves on jspm.io today, so there is no live fixture left that expresses
  // this shape. The same class of live-CDN rot already forced the ordering
  // test onto a mock in #312. A regression guard for shipped behaviour must
  // not depend on a third party continuing to host one exact version.
  const COHERENT = {
    '@codemirror/view': 'https://ga.jspm.io/npm:@codemirror/view@6.39.0/dist/index.js',
    '@codemirror/lint': 'https://ga.jspm.io/npm:@codemirror/lint@6.9.6/dist/index.js',
    '@codemirror/state': 'https://ga.jspm.io/npm:@codemirror/state@6.6.0/dist/index.js',
  };
  // What lint ALONE would drag in: a newer view than the pinned one.
  const SKEWED_VIEW = 'https://ga.jspm.io/npm:@codemirror/view@6.43.0/dist/index.js';

  const mock = async (_url, opts) => {
    const { install } = JSON.parse(opts.body);
    const imports = install.length > 1
      ? { ...COHERENT }
      : install[0].startsWith('@codemirror/lint')
        ? { '@codemirror/lint': COHERENT['@codemirror/lint'], '@codemirror/view': SKEWED_VIEW, '@codemirror/state': COHERENT['@codemirror/state'] }
        : { '@codemirror/view': COHERENT['@codemirror/view'] };
    return { ok: true, status: 200, json: async () => ({ map: { imports } }) };
  };

  await withMockedFetch(mock, async () => {
    clearVendorCache();
    const map = await jspmGenerate(['@codemirror/view@6.39.0', '@codemirror/lint@6.9.6']);
    assert.ok(map['@codemirror/view'], 'view resolves');
    assert.ok(map['@codemirror/lint'], 'lint resolves');
    assert.ok(map['@codemirror/state'], 'the transitive @codemirror/state lint pulls in is present');
    // The discriminating invariant: the served view entry is the version the
    // WHOLE graph agreed on (6.39.0, the requested one), NOT lint's transitive
    // 6.43.x that the old per-package merge let win last-write. A skew here is
    // the missing-export crash from the issue.
    assert.equal(map['@codemirror/view'], COHERENT['@codemirror/view'],
      'view stays at the version the unified graph chose, no transitive skew');
  });
});

test('jspmGenerate #446 fallback: an unresolvable install does not collapse the map', async () => {
  // Preserve the per-package-isolation safety property. The unified call
  // 401s because one install (a private/server-only dep) is unresolvable.
  // The fallback must probe each install alone, drop the bad one, and
  // re-run the unified call over the resolvable subset so the survivors
  // are still coherent and the good packages keep their entries.
  /** @type {Array<string[]>} */
  const calls = [];
  const BAD = '@acme/private@0.1.0';
  const mock = async (_url, opts) => {
    const { install } = JSON.parse(opts.body);
    calls.push(install);
    // Any batch that includes the bad install fails the WHOLE batch (jspm's
    // 401-on-any-unresolvable behaviour).
    if (install.includes(BAD)) {
      return { ok: false, status: 401, json: async () => ({ error: 'Error: Not Found' }) };
    }
    const imports = {};
    for (const i of install) {
      const name = i.replace(/@[^@]*$/, '');
      imports[name] = `https://ga.jspm.io/npm:${i}/mock.js`;
    }
    return { ok: true, status: 200, json: async () => ({ map: { imports } }) };
  };
  await withMockedFetch(mock, async () => {
    clearVendorCache();
    const map = await jspmGenerate(['picocolors@1.1.1', 'clsx@2.1.1', BAD]);
    assert.ok(map['picocolors'], 'good package survives despite the bad neighbour');
    assert.ok(map['clsx'], 'second good package survives too');
    assert.equal(map['@acme/private'], undefined, 'the unresolvable install dropped out');
    // The survivors were re-resolved together (coherence restored): there is
    // a final unified call carrying exactly the two good installs.
    const reunified = calls.find(c => !c.includes(BAD) && c.length === 2);
    assert.ok(reunified, 'a unified re-run over the resolvable subset fired');
    assert.deepEqual([...reunified].sort(), ['clsx@2.1.1', 'picocolors@1.1.1']);
  });
});

test('jspmGenerate #446 fallback: a GOOD package whose probe blips transiently is NOT dropped', async () => {
  // The at-risk path. The unified batch 401s PERMANENTLY (a genuinely
  // unresolvable BAD install), so the fallback probes each install alone.
  // picocolors is GOOD but its isolated probe hits a transient 503 (a network
  // blip mid-probe). The old code computed the resolvable set purely from a
  // non-empty fragment, so a transient-failed good package looked identical to
  // an unresolvable one and got DROPPED. The fix must NOT drop it: a transient
  // probe failure flags the whole resolve for retry (ok=false) and serves the
  // merged fragments without evicting anyone. On the RETRY (blip cleared) the
  // good package must survive in the map. We observe ok=false through
  // resolveVendorImports, and survival through the second resolve.
  const dir = await makeLiveApp('446-probe-blip', 'picocolors', '1.1.1');
  // Add the second good dep + the unresolvable one to the app's node_modules.
  await mkdir(join(dir, 'node_modules', 'clsx'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'clsx', 'package.json'),
    JSON.stringify({ name: 'clsx', version: '2.1.1', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', 'clsx', 'index.js'), 'export default 1;\n');
  await mkdir(join(dir, 'node_modules', '@acme', 'private'), { recursive: true });
  await writeFile(join(dir, 'node_modules', '@acme', 'private', 'package.json'),
    JSON.stringify({ name: '@acme/private', version: '0.1.0', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', '@acme', 'private', 'index.js'), 'export default 1;\n');

  const BAD = '@acme/private@0.1.0';
  let blipPicocolors = true; // the first picocolors probe 503s, later ones succeed
  const mock = async (url, opts) => {
    const u = String(url);
    if (!u.includes('api.jspm.io')) {
      // computeLiveIntegrity GETs each resolved URL; answer with bytes so the
      // resolve completes (integrity is fail-open anyway).
      return bundleResponse(new TextEncoder().encode(`// ${u}`));
    }
    const { install } = JSON.parse(opts.body);
    // A batch that includes the unresolvable install 401s (permanent).
    if (install.includes(BAD)) {
      return { ok: false, status: 401, json: async () => ({ error: 'Error: Not Found' }) };
    }
    // The isolated picocolors probe blips with a transient 503 the first time.
    if (install.length === 1 && install[0] === 'picocolors@1.1.1' && blipPicocolors) {
      blipPicocolors = false;
      return { ok: false, status: 503, json: async () => ({}) };
    }
    const imports = {};
    for (const i of install) imports[i.replace(/@[^@]*$/, '')] = `https://ga.jspm.io/npm:${i}/mock.js`;
    return { ok: true, status: 200, json: async () => ({ map: { imports } }) };
  };
  try {
    await withMockedFetch(mock, async () => {
      const thunk = async () => new Set(['picocolors', 'clsx', '@acme/private']);
      clearVendorCache();
      const first = await resolveVendorImports(dir, thunk);
      // picocolors must NOT be permanently dropped: it is served from the
      // merged fragments where it could (clsx resolved), and the transient
      // probe flags the resolve for retry rather than evicting it.
      assert.equal(first.ok, false,
        'a transient probe failure flags the whole resolve for retry, not a silent drop');
      assert.equal(first.imports['@acme/private'], undefined,
        'the genuinely unresolvable install is still absent');

      // The retry (blip cleared) must surface picocolors coherently.
      clearVendorCache();
      const second = await resolveVendorImports(dir, thunk);
      assert.ok(second.imports['picocolors'],
        'on retry the good package that blipped survives in the map');
      assert.ok(second.imports['clsx'], 'the other good package is present too');
      assert.equal(second.ok, true, 'the retry resolves cleanly (only a permanent 401 remains, tolerated)');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('jspmGenerate #446 fallback: a transient failure still serves a partial map and flags retry', async () => {
  // A 5xx is transient (not an unresolvable install), so the fallback must
  // not strip anything; it serves merged per-install fragments so the app is
  // no worse off, and the live resolve reports ok=false so ensureReady retries.
  // We assert through resolveVendorImports so the ok flag is observable.
  const dir = await makeLiveApp('446-transient', 'dayjs', '1.11.20');
  let firstCall = true;
  const mock = async (url, opts) => {
    const u = String(url);
    if (!u.includes('api.jspm.io')) throw new Error(`unexpected fetch ${u}`);
    const { install } = JSON.parse(opts.body);
    // The whole-set unified call comes first and 503s; the per-install
    // fallback probes then resolve.
    if (install.length > 1 && firstCall) { firstCall = false; return { ok: false, status: 503, json: async () => ({}) }; }
    const imports = {};
    for (const i of install) imports[i.replace(/@[^@]*$/, '')] = `https://ga.jspm.io/npm:${i}/mock.js`;
    return { ok: true, status: 200, json: async () => ({ map: { imports } }) };
  };
  try {
    clearVendorCache();
    await withMockedFetch(mock, async () => {
      // Two installs so the unified path is taken. dayjs is the real installed
      // dep; clsx is faked via a second node_modules entry.
      await mkdir(join(dir, 'node_modules', 'clsx'), { recursive: true });
      await writeFile(join(dir, 'node_modules', 'clsx', 'package.json'),
        JSON.stringify({ name: 'clsx', version: '2.1.1', main: 'index.js' }));
      await writeFile(join(dir, 'node_modules', 'clsx', 'index.js'), 'export default 1;\n');
      const r = await resolveVendorImports(dir, async () => new Set(['dayjs', 'clsx']));
      assert.ok(r.imports['dayjs'], 'partial map still served after the transient failure');
      assert.ok(r.imports['clsx'], 'both deps recovered via the per-install fallback');
      assert.equal(r.ok, false, 'transient failure flags the resolve for retry');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('vendor parity #446: runtime live importmap and `vendor pin` agree for the same dep set', async () => {
  // The maintainer invariant: `webjs vendor pin` must snapshot EXACTLY what
  // the unified runtime resolution produces, transitives included. Both
  // paths build the same install[] and call jspmGenerate, so against one
  // deterministic mock the live `vendorImportMapEntries` output and the
  // pinAll importmap must carry the SAME specifier->URL set (including the
  // flattened transitive `@codemirror/state` neither file imports directly).
  //
  // Build an ISOLATED app dir (own node_modules, NOT the symlink
  // makeTempAppWithSource uses) so planting @codemirror packages can't write
  // through into the repo's real node_modules.
  const dir = join(tmpdir(), `webjs-parity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(join(dir, 'app'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
  await writeFile(join(dir, 'app', 'page.ts'),
    `import { EditorView } from '@codemirror/view';\nimport { lintGutter } from '@codemirror/lint';`);
  await mkdir(join(dir, 'node_modules', '@codemirror', 'view'), { recursive: true });
  await mkdir(join(dir, 'node_modules', '@codemirror', 'lint'), { recursive: true });
  await writeFile(join(dir, 'node_modules', '@codemirror', 'view', 'package.json'),
    JSON.stringify({ name: '@codemirror/view', version: '6.39.0', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', '@codemirror', 'view', 'index.js'), 'export const EditorView = 1;\n');
  await writeFile(join(dir, 'node_modules', '@codemirror', 'lint', 'package.json'),
    JSON.stringify({ name: '@codemirror/lint', version: '6.9.6', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', '@codemirror', 'lint', 'index.js'), 'export const lintGutter = 1;\n');

  // Map an install spec (`@scope/name@version`, no subpaths in this test) to
  // its bare specifier and a stable mock URL.
  const specToUrl = {
    '@codemirror/view@6.39.0': ['@codemirror/view', 'https://ga.jspm.io/npm:@codemirror/view@6.39.0/mock.js'],
    '@codemirror/lint@6.9.6': ['@codemirror/lint', 'https://ga.jspm.io/npm:@codemirror/lint@6.9.6/mock.js'],
  };
  const mock = async (url, opts) => {
    // pinAll (default mode) GETs each resolved URL to hash it (fetchIntegrity).
    // Those carry no body; answer them with stable bytes so the pin path runs.
    if (!opts || !opts.body) {
      return bundleResponse(new TextEncoder().encode(`// bundle ${url}`));
    }
    const { install } = JSON.parse(opts.body);
    const imports = {};
    for (const i of install) {
      const entry = specToUrl[i];
      if (entry) imports[entry[0]] = entry[1];
    }
    // The unified call also returns the flattened transitive, regardless of
    // which direct installs were asked for.
    imports['@codemirror/state'] = 'https://ga.jspm.io/npm:@codemirror/state@6.6.0/mock.js';
    return { ok: true, status: 200, json: async () => ({ map: { imports } }) };
  };
  try {
    await withMockedFetch(mock, async () => {
      clearVendorCache();
      const bare = await scanBareImports(dir);
      const runtime = await vendorImportMapEntries(bare, dir);
      clearVendorCache();
      const pinResult = await pinAll(dir);
      assert.ok(!pinResult.failed, 'pin should succeed');
      const pinned = await readPinFile(dir);
      // Same specifier -> URL set on both paths, transitive included.
      assert.deepEqual(
        Object.keys(pinned.imports).sort(),
        Object.keys(runtime).sort(),
        'pin and runtime resolve the SAME specifier set (transitives included)',
      );
      for (const [spec, url] of Object.entries(runtime)) {
        assert.equal(pinned.imports[spec], url, `pin and runtime agree on the URL for ${spec}`);
      }
      assert.ok(pinned.imports['@codemirror/state'],
        'the flattened transitive is persisted by pin, matching the runtime map');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- vendorImportMapEntries (network-gated) ---

test('vendorImportMapEntries: skips built-ins', async () => {
  clearVendorCache();
  const entries = await vendorImportMapEntries(new Set(['@webjsdev/core']), process.cwd());
  assert.ok(!('@webjsdev/core' in entries), '@webjsdev/core is built-in, not vendored');
});

test('vendorImportMapEntries: skips packages with no installed version', async () => {
  clearVendorCache();
  const entries = await vendorImportMapEntries(
    new Set(['this-package-does-not-exist-xyz-456']),
    process.cwd(),
  );
  assert.equal(entries['this-package-does-not-exist-xyz-456'], undefined);
});

test('vendorImportMapEntries: resolves installed packages to jspm.io URLs', async () => {
  await withJspmDouble({}, async () => {
    const entries = await vendorImportMapEntries(new Set(['picocolors']), process.cwd());
    const url = entries['picocolors'];
    assert.ok(url, 'expected picocolors entry');
    assert.match(url, /^https:\/\/ga\.jspm\.io\/npm:picocolors@/);
  });
});

// --- file-based pin (Rails-style committed importmap.json) ---

async function makeTempAppWithSource(sourceFiles) {
  const dir = join(tmpdir(), `webjs-test-pin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(dir, { recursive: true });
  // Symlink node_modules from repo root so picocolors etc. resolve via createRequire.
  await symlink(join(process.cwd(), 'node_modules'), join(dir, 'node_modules'));
  await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
  for (const [path, body] of Object.entries(sourceFiles)) {
    // Refuse paths that would resolve through the symlinked
    // node_modules: writing them clobbers the repo's real packages
    // (previous bug: a sourceFiles entry for
    // 'node_modules/picocolors/package.json' overwrote the real
    // picocolors package.json with a 2-line stub).
    if (path.startsWith('node_modules/') || path.startsWith('node_modules' + sep)) {
      throw new Error(
        `makeTempAppWithSource: refusing to write '${path}' through the symlinked node_modules. ` +
        `Mock packages must be set up some other way.`,
      );
    }
    const full = join(dir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

test('pinAll default: writes importmap.json with jspm.io URLs', async () => {
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    await withJspmDouble({}, async () => {
      const result = await pinAll(dir);
      assert.ok(!result.failed, 'pin should not be flagged failed');
      assert.ok(result.pins.length >= 1, 'should pin picocolors');
      assert.equal(result.pruned.length, 0, 'no orphans on fresh pin');
      assert.equal(result.downloaded, 0, 'default mode does not download');
      const file = await readPinFile(dir);
      assert.ok(file, 'pin file should exist');
      assert.match(file.imports['picocolors'], /^https:\/\/ga\.jspm\.io\/npm:picocolors@/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: a flattened transitive is pinned with a derivable bundle name (#446)', async () => {
  // The unified resolve hoists a transitive to top level, and `pinAll` has to
  // pin it even though it was never a directly scanned install: without it a
  // pinned app's importmap is missing an entry the live path serves, and the
  // browser hits an unresolved bare specifier. `partsByInstall` has no entry
  // for such a spec, so `derivePinParts` recovers the version by locating
  // `<name>@<version>` inside the resolved url.
  //
  // Nothing covered this before. Every pinAll test here resolves picocolors,
  // which has no dependencies, so the live CDN never returned a transitive to
  // exercise the path with. A double can just hand one over.
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    const transitive = 'https://ga.jspm.io/npm:tiny-dep@2.3.4/double.js';
    await withJspmDouble({ transitives: { 'tiny-dep': transitive } }, async () => {
      const result = await pinAll(dir, { download: true });
      const file = await readPinFile(dir);
      assert.ok(file.imports['picocolors'], 'the direct install still pins');
      assert.match(file.imports['tiny-dep'], /^\/__webjs\/vendor\/tiny-dep@2\.3\.4/,
        'the transitive pins under a filename derived from its resolved url');
      const pinned = result.pins.find((p) => p.pkg === 'tiny-dep');
      assert.equal(pinned.version, '2.3.4', 'version recovered from the url, not from the scan');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: returns noBareImports without writing pin file when no bare imports exist', async () => {
  // Previously pinAll's "don't write empty pin" guard only fired when
  // installs.length > 0 && pins.length === 0. An app with zero bare-
  // specifier imports (or pin invoked outside a webjs project) fell
  // through to writePinFile with empty maps, creating a useless
  // `{ imports: {} }` file. The new noBareImports branch surfaces the
  // case to the CLI so it can print a clear message and exit non-zero.
  clearVendorCache();
  const dir = join(tmpdir(), `webjs-pin-empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(join(dir, 'app'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
  await writeFile(join(dir, 'app', 'page.ts'), `export default () => 'no bare imports here';`);
  try {
    // Offline: no bare imports, so pinAll returns before the resolve.
    const result = await pinAll(dir);
    assert.ok(result.noBareImports, 'noBareImports must be true');
    assert.equal(result.failed, undefined, 'failed must be absent (not a failure, just nothing to do)');
    assert.deepEqual(result.pins, []);
    const file = await readPinFile(dir);
    assert.equal(file, null, 'pin file must not exist when there is nothing to pin');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: reports found-but-uninstalled specifiers instead of noBareImports (#953)', async () => {
  // The scan FINDS the specifier but the version gate drops it (no local
  // install), so installs is empty. Previously that was reported identically
  // to "scan found nothing" (noBareImports), which misled the user into
  // thinking their import was never seen. It must now come back as
  // droppedUnresolvable, naming the specifiers, with NO noBareImports and no
  // pin file. No network: an uninstalled package never reaches jspm.
  clearVendorCache();
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';`,
  });
  try {
    // Offline: every specifier is dropped by the version gate, so installs is empty.
    const result = await pinAll(dir);
    assert.equal(result.noBareImports, undefined, 'must NOT claim there were no bare imports');
    assert.ok(Array.isArray(result.droppedUnresolvable), 'droppedUnresolvable must be an array');
    // Counterfactual anchor: reverting the version-gate collection drops this
    // set back to undefined and reinstates the misleading noBareImports path.
    assert.ok(
      result.droppedUnresolvable.includes('three'),
      `dropped set should name three, got ${JSON.stringify(result.droppedUnresolvable)}`,
    );
    assert.ok(
      result.droppedUnresolvable.some((s) => s.startsWith('three/addons/')),
      'dropped set should include the three/addons subpath specifier',
    );
    assert.deepEqual(result.pins, [], 'nothing pinned');
    const file = await readPinFile(dir);
    assert.equal(file, null, 'no pin file when every found specifier is unresolvable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: refuses to write empty pin file when every install fails', async () => {
  // Regression: previously pinAll wrote `{ imports: {} }` when every
  // jspm.io call failed (e.g. brand-new package version not yet on
  // CDN, or unrelated transient errors). The empty pin file would
  // shadow the live-API fallback path on next boot, leaving the
  // browser with no vendor entries and silently breaking every
  // bare-specifier import.
  clearVendorCache();
  // Isolated temp dir (no symlinked node_modules, so we can plant a
  // fake package.json safely). Build minimal app structure by hand.
  const dir = join(tmpdir(), `webjs-pin-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(join(dir, 'node_modules', 'fake-pkg-xyz-no-such-version'), { recursive: true });
  await mkdir(join(dir, 'app'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
  await writeFile(join(dir, 'node_modules', 'fake-pkg-xyz-no-such-version', 'package.json'),
    JSON.stringify({ name: 'fake-pkg-xyz-no-such-version', version: '99.99.99', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', 'fake-pkg-xyz-no-such-version', 'index.js'),
    'export default 1;');
  await writeFile(join(dir, 'app', 'page.ts'),
    `import x from 'fake-pkg-xyz-no-such-version';`);
  try {
    // Drive the failure through the double's unresolvable list rather than by
    // relaxing anything: a refused pin is the CORRECT outcome here, and the
    // assertions below are the contract, not an artifact of the CDN being down.
    await withJspmDouble({ unresolvable: ['fake-pkg-xyz-no-such-version@99.99.99'] }, async () => {
      const result = await pinAll(dir);
      assert.ok(result.failed, 'pin must be flagged failed');
      assert.deepEqual(result.pins, [], 'no pins recorded');
      // Pin file MUST NOT have been written (so live API fallback runs next boot).
      const file = await readPinFile(dir);
      assert.equal(file, null, 'pin file must not exist after total failure');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: warns by name when some installs fail (partial success)', async () => {
  // Regression for the partial-warning bug: the missing-installs
  // list was derived by filtering installs[] (versioned strings)
  // against pinnedSpecs (bare specs), which never matched. The warn
  // always listed ALL installs as missing. Fix derives missing from
  // partsByInstall (bare spec → parts). This test: pin two packages
  // where one resolves (picocolors, a real package) and one fails
  // (fake-pkg-xyz). The warn output must name only the fake one.
  clearVendorCache();
  const dir = join(tmpdir(), `webjs-pin-partial-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(join(dir, 'node_modules', 'picocolors'), { recursive: true });
  await mkdir(join(dir, 'node_modules', 'fake-pkg-xyz-no-such-version'), { recursive: true });
  await mkdir(join(dir, 'app'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
  await writeFile(join(dir, 'node_modules', 'picocolors', 'package.json'),
    JSON.stringify({ name: 'picocolors', version: '1.0.0', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', 'picocolors', 'index.js'), 'export default {};');
  await writeFile(join(dir, 'node_modules', 'fake-pkg-xyz-no-such-version', 'package.json'),
    JSON.stringify({ name: 'fake-pkg-xyz-no-such-version', version: '99.99.99', main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', 'fake-pkg-xyz-no-such-version', 'index.js'), 'export default 1;');
  await writeFile(join(dir, 'app', 'page.ts'),
    `import a from 'picocolors';\nimport b from 'fake-pkg-xyz-no-such-version';`);
  /** @type {string[]} */
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warns.push(args.join(' ')); };
  try {
    await withJspmDouble({ unresolvable: ['fake-pkg-xyz-no-such-version@99.99.99'] }, async (double) => {
      const result = await pinAll(dir);
      // picocolors succeeded so pinAll proceeded; partial-warn must fire.
      assert.equal(result.failed, undefined, 'partial success is not total failure');
      assert.ok(result.pins.length >= 1, 'at least picocolors made it into pins');
      const partial = warns.find(w => w.includes('partial success'));
      assert.ok(partial, `expected partial-success warn; got warns:\n${warns.join('\n')}`);
      const missingLines = warns.filter(w => w.includes('fake-pkg-xyz-no-such-version'));
      assert.ok(missingLines.length > 0, 'fake-pkg-xyz must appear in the missing list');
      // The successful package must NOT appear in the missing list.
      const wronglyListed = warns.find(w =>
        /^\s+picocolors@/.test(w) && !w.includes('partial success')
      );
      assert.equal(wronglyListed, undefined,
        'successful packages must NOT appear in the missing list');
      // The exact trace the permanent-failure ladder takes, which only a
      // counting double can see: the unified call 401s, both installs are
      // probed alone, and the single survivor is then served from the probe's
      // cache rather than re-resolved. Four calls would mean the survivor was
      // fetched twice; two would mean the probes never ran.
      assert.equal(double.generateCalls.length, 3,
        `expected unified + two probes; got ${JSON.stringify(double.generateCalls.map(c => c.installs))}`);
    });
  } finally {
    console.warn = origWarn;
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll --download: writes importmap.json with local URLs + bundle files', async () => {
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    await withJspmDouble({}, async () => {
      const { pins, downloaded } = await pinAll(dir, { download: true });
      assert.ok(pins.length >= 1);
      assert.ok(downloaded >= 1, 'should download at least one bundle');
      const file = await readPinFile(dir);
      assert.match(file.imports['picocolors'], /^\/__webjs\/vendor\/picocolors@.*\.js$/);
      const bundleFilename = file.imports['picocolors'].slice('/__webjs/vendor/'.length);
      const bytes = await readFileFs(join(dir, '.webjs', 'vendor', bundleFilename), 'utf8');
      assert.ok(bytes.length > 0, 'bundle file must contain bytes');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: prune removes orphan bundle files from prior pins', async () => {
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'orphan-package@1.0.0.js'), 'export default {}');
    await withJspmDouble({}, async () => {
      const { pruned } = await pinAll(dir);
      assert.ok(pruned.includes('orphan-package@1.0.0.js'), `expected orphan in pruned list, got: ${pruned.join(', ')}`);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: mode switch from --download to default removes bundles', async () => {
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    await withJspmDouble({}, async () => {
      const first = await pinAll(dir, { download: true });
      assert.ok(first.downloaded >= 1);
      const second = await pinAll(dir);
      assert.ok(second.pruned.length >= 1, 'switching to default mode should prune leftover bundle files');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unpinPackage: removes entry from importmap.json (deletes file when last pin removed)', async () => {
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    await withJspmDouble({}, () => pinAll(dir));
    const r = await unpinPackage(dir, 'picocolors');
    assert.equal(r.removed, true);
    // After the last pin is removed the pin file is deleted so the
    // next boot falls back to live API resolution. Otherwise an
    // empty `{ imports: {} }` would shadow the fallback and serve a
    // broken importmap.
    const file = await readPinFile(dir);
    assert.equal(file, null,
      'pin file should be removed when last pin is unpinned');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unpinPackage: keeps file when other pins remain (deletes only the targeted entry + integrity)', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        'a': 'https://cdn.example/a.js',
        'b': 'https://cdn.example/b.js',
      },
      integrity: {
        'https://cdn.example/a.js': 'sha384-aaaa',
        'https://cdn.example/b.js': 'sha384-bbbb',
      },
    }));
    const r = await unpinPackage(dir, 'a');
    assert.equal(r.removed, true);
    const file = await readPinFile(dir);
    assert.ok(file, 'pin file should still exist');
    assert.equal(file.imports['a'], undefined, 'unpinned entry removed');
    assert.equal(file.imports['b'], 'https://cdn.example/b.js', 'other entry preserved');
    assert.equal(file.integrity['https://cdn.example/a.js'], undefined,
      "unpinned URL's integrity stripped too");
    assert.equal(file.integrity['https://cdn.example/b.js'], 'sha384-bbbb',
      "other integrity preserved");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('unpinPackage: returns removed:false for non-existent package', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({ imports: {} }));
    const r = await unpinPackage(dir, 'not-there');
    assert.equal(r.removed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: parses scoped-package jspm.io URLs (regression: scope `@` was breaking the version regex)', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        '@scope/name': 'https://ga.jspm.io/npm:@scope/name@1.2.3/index.js',
        'plain-pkg': 'https://ga.jspm.io/npm:plain-pkg@4.5.6/index.js',
        '@hotwired/turbo': 'https://ga.jspm.io/npm:@hotwired/turbo@8.0.0/dist/turbo.es2017-esm.js',
      },
      integrity: {
        'https://ga.jspm.io/npm:@scope/name@1.2.3/index.js': 'sha384-xxx',
      },
    }));
    const entries = await listPinned(dir);
    const byPkg = Object.fromEntries(entries.map(e => [e.pkg, e]));
    assert.equal(byPkg['@scope/name'].version, '1.2.3', 'scoped package version extracted');
    assert.equal(byPkg['plain-pkg'].version, '4.5.6', 'plain package still works');
    assert.equal(byPkg['@hotwired/turbo'].version, '8.0.0', 'scoped + subpath URL works');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: returns "(unknown)" version for malformed URLs without crashing', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        'weird': 'https://example.com/not-a-jspm-url.js',
        'no-version': 'https://ga.jspm.io/something/odd.js',
      },
    }));
    const entries = await listPinned(dir);
    const byPkg = Object.fromEntries(entries.map(e => [e.pkg, e]));
    assert.equal(byPkg['weird'].version, '(unknown)');
    assert.equal(byPkg['no-version'].version, '(unknown)');
    assert.equal(byPkg['weird'].url, 'https://example.com/not-a-jspm-url.js');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: returns empty array when pin file does not exist', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    const entries = await listPinned(dir);
    assert.deepEqual(entries, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: parses jspm.io URLs and extracts versions', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        'dayjs': 'https://ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js',
        'clsx': 'https://ga.jspm.io/npm:clsx@2.1.1/dist/clsx.mjs',
      },
    }));
    const entries = await listPinned(dir);
    const dayjs = entries.find(e => e.pkg === 'dayjs');
    assert.ok(dayjs);
    assert.equal(dayjs.version, '1.11.13');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: parses subpath URLs and extracts versions (not subpath as version)', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'dayjs@1.11.13__plugin__utc.js'), 'export default {}');
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        'dayjs': 'https://ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js',
        'dayjs/plugin/utc': '/__webjs/vendor/dayjs@1.11.13__plugin__utc.js',
      },
    }));
    const entries = await listPinned(dir);
    const subpath = entries.find(e => e.pkg === 'dayjs/plugin/utc');
    assert.ok(subpath, 'subpath entry should be listed');
    assert.equal(subpath.version, '1.11.13', 'version should be 1.11.13, not 1.11.13__plugin__utc');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: returns empty array when no pin file', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    const entries = await listPinned(dir);
    assert.deepEqual(entries, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports: prefers committed pin file over live API call', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: { 'fake-pkg': 'https://example.com/fake.js' },
    }));
    let scanned = false;
    const result = await resolveVendorImports(dir, async () => { scanned = true; return new Set(['unrelated']); });
    assert.equal(result.imports['fake-pkg'], 'https://example.com/fake.js');
    assert.deepEqual(result.integrity, {}, 'no integrity field in pin -> empty map');
    assert.equal(scanned, false, 'a pin file must short-circuit BEFORE the bare-import scan (no whole-app walk)');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports: runs the scan thunk only when there is no pin file', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    let scanned = false;
    await resolveVendorImports(dir, async () => { scanned = true; return new Set(); });
    assert.equal(scanned, true, 'unpinned: the scan thunk is invoked to discover bare specifiers');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: returns integrity when present in pin', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: { 'foo': 'https://cdn.example/foo.js' },
      integrity: { 'https://cdn.example/foo.js': 'sha384-abcdef' },
    }));
    const file = await readPinFile(dir);
    assert.deepEqual(file.integrity, { 'https://cdn.example/foo.js': 'sha384-abcdef' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: returns no integrity field on old pin format (backwards-compatible)', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    // Old format: imports only, no integrity field. Must still load.
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: { 'foo': 'https://cdn.example/foo.js' },
    }));
    const file = await readPinFile(dir);
    assert.deepEqual(file.imports, { 'foo': 'https://cdn.example/foo.js' });
    assert.equal(file.integrity, undefined);
    // resolveVendorImports normalises the missing field to {}.
    const r = await resolveVendorImports(dir, async () => new Set());
    assert.deepEqual(r.integrity, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sha384Integrity: returns a sha384-<base64> string', async () => {
  const { sha384Integrity } = await import('../../src/vendor.js');
  const h = await sha384Integrity('hello world');
  assert.match(h, /^sha384-[A-Za-z0-9+/=]+$/);
  // Deterministic: same input always produces same output.
  assert.equal(h, await sha384Integrity('hello world'));
  // Different input produces different output.
  assert.notEqual(h, await sha384Integrity('hello worl'));
});

test('readPinFile + resolveVendorImports: integrity keyed by FINAL URL (post-rewrite)', async () => {
  // Regression check: --download mode rewrites imports to local
  // /__webjs/vendor/<filename> paths, and integrity must key on
  // those (the URL the browser actually fetches), not on the
  // original jspm.io URL. setVendorEntries propagates this verbatim.
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    const pinJson = {
      imports: {
        'dayjs': '/__webjs/vendor/dayjs@1.11.20.js',
        'dayjs/plugin/relativeTime.js': '/__webjs/vendor/dayjs@1.11.20__plugin__relativeTime.js.js',
      },
      integrity: {
        '/__webjs/vendor/dayjs@1.11.20.js': 'sha384-aaaa',
        '/__webjs/vendor/dayjs@1.11.20__plugin__relativeTime.js.js': 'sha384-bbbb',
      },
    };
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify(pinJson));
    const r = await resolveVendorImports(dir, async () => new Set(['dayjs', 'dayjs/plugin/relativeTime.js']));
    assert.equal(r.imports['dayjs'], '/__webjs/vendor/dayjs@1.11.20.js');
    assert.equal(r.integrity['/__webjs/vendor/dayjs@1.11.20.js'], 'sha384-aaaa');
    // Subpath import: integrity keyed by its OWN final URL, not by dayjs's.
    assert.equal(
      r.integrity['/__webjs/vendor/dayjs@1.11.20__plugin__relativeTime.js.js'],
      'sha384-bbbb',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: returns null for corrupt JSON', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), '{not valid json');
    assert.equal(await readPinFile(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: rejects non-object imports field', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    for (const bad of ['"not an object"', 'null', '123', 'true', '[1,2,3]']) {
      await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), `{"imports": ${bad}}`);
      assert.equal(await readPinFile(dir), null, `imports=${bad} must yield null`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: filters out non-string imports values', async () => {
  // A hand-edited or malicious pin file with non-string values would
  // otherwise land structurally invalid entries in the importmap
  // (numbers / objects / nulls) and break browser-side parsing.
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        'valid': 'https://cdn.example/v.js',
        'numeric': 123,
        'nully': null,
        'objy': { x: 1 },
      },
    }));
    const file = await readPinFile(dir);
    assert.deepEqual(file.imports, { 'valid': 'https://cdn.example/v.js' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: rejects URL schemes that could execute attacker code (javascript:, data:)', async () => {
  // Defense: a malicious pin file commit could otherwise inject
  // arbitrary script via the importmap. The browser's importmap
  // parser accepts data: URLs (per spec) and some engines accept
  // javascript:; readPinFile filters these so they never reach the
  // served importmap. Only http(s) URLs and root-relative paths
  // (matching what `webjs vendor pin` itself produces) are allowed.
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        'safe-https': 'https://cdn.example/safe.js',
        'safe-relative': '/__webjs/vendor/foo.js',
        'javascript': 'javascript:alert(1)',
        'data': 'data:text/javascript,alert(1)',
        'blob': 'blob:https://evil.example/abc',
        'file': 'file:///etc/passwd',
        'ftp': 'ftp://example.com/x.js',
      },
    }));
    const file = await readPinFile(dir);
    assert.deepEqual(Object.keys(file.imports).sort(), ['safe-https', 'safe-relative'].sort(),
      'only http(s) and root-relative URLs should survive');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: rejects keys containing control characters', async () => {
  // Newlines in keys would land in the served importmap JSON as escape
  // sequences and could confuse client-side textContent comparison or
  // log injection. Belt-and-suspenders; the browser would accept them
  // but rejecting at parse time keeps the served output predictable.
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: {
        'normal': 'https://x/n.js',
        'has\nnewline': 'https://x/e.js',
        'has\rcr': 'https://x/r.js',
        'hasnull-ish': 'https://x/c.js',
      },
    }));
    const file = await readPinFile(dir);
    assert.deepEqual(Object.keys(file.imports), ['normal']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: rejects integrity values that are not SRI hash strings', async () => {
  // Defense: integrity must look like `sha(256|384|512)-...`. A bogus
  // value (123, null, 'not-a-hash', 'sha999-foo') is dropped so the
  // browser doesn't get a malformed integrity attribute (which would
  // either fail SRI check or be silently ignored, both bad).
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: { 'a': 'https://cdn.example/a.js', 'b': 'https://cdn.example/b.js' },
      integrity: {
        'https://cdn.example/a.js': 'sha384-validhashvalue',
        'https://cdn.example/b.js': 'not-a-hash',
        'https://cdn.example/c.js': 123,
      },
    }));
    const file = await readPinFile(dir);
    assert.equal(file.integrity['https://cdn.example/a.js'], 'sha384-validhashvalue');
    assert.equal(file.integrity['https://cdn.example/b.js'], undefined,
      'bogus integrity string filtered out');
    assert.equal(file.integrity['https://cdn.example/c.js'], undefined,
      'numeric integrity filtered out');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: rejects integrity values with attribute-injection payloads', async () => {
  // A hand-edited or tampered pin file with an integrity value like
  // `sha384-x"><script>alert(1)</script>` would pass a prefix-only
  // /^sha(256|384|512)-/ regex but break out of `integrity="..."`
  // when emitted into HTML. End-to-end regex anchored to the base64
  // alphabet (`[A-Za-z0-9+/=]+`) rejects anything past the valid
  // hash body.
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: { 'a': 'https://cdn.example/a.js' },
      integrity: {
        'https://cdn.example/a.js': 'sha384-x"><script>alert(1)</script>',
      },
    }));
    const file = await readPinFile(dir);
    assert.equal(file.integrity, undefined,
      'attribute-injection payload filtered out, no integrity emitted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: tolerates extra fields in pin JSON (forward-compat)', async () => {
  // A future pin file version might include extra fields (e.g.
  // resolver: 'jspm.io', generatedAt: '...'). readPinFile should
  // ignore them and surface imports + integrity unchanged.
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: { 'x': 'https://cdn.example/x.js' },
      integrity: { 'https://cdn.example/x.js': 'sha384-zzz' },
      resolver: 'jspm.io',
      generatedAt: '2026-01-01T00:00:00Z',
      _comment: 'extra fields should not break parsing',
    }));
    const file = await readPinFile(dir);
    assert.deepEqual(file.imports, { 'x': 'https://cdn.example/x.js' });
    assert.equal(file.integrity['https://cdn.example/x.js'], 'sha384-zzz');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('importMapTag: integrity field omitted when empty, present when populated', async () => {
  const { setVendorEntries, importMapTag } = await import('../../src/importmap.js');
  // Empty integrity → no integrity field in JSON.
  await setVendorEntries({ 'a': 'https://cdn/a.js' }, {});
  let tag = importMapTag();
  assert.ok(!tag.includes('"integrity"'), 'integrity omitted when empty');
  // Populated → integrity field present.
  await setVendorEntries(
    { 'a': 'https://cdn/a.js' },
    { 'https://cdn/a.js': 'sha384-xxxx' },
  );
  tag = importMapTag();
  assert.ok(tag.includes('"integrity"'), 'integrity present when populated');
  assert.ok(tag.includes('"sha384-xxxx"'), 'integrity value emitted');
  // Reset.
  await setVendorEntries({}, {});
});

test('pinAll default mode: writes integrity field alongside imports', async () => {
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    await withJspmDouble({}, async () => {
      await pinAll(dir);
      const file = await readPinFile(dir);
      assert.ok(file.integrity, 'integrity field should be written');
      const url = file.imports['picocolors'];
      assert.ok(url, 'picocolors should pin');
      assert.match(file.integrity[url], /^sha384-/, 'integrity must be sha384 hash of fetched bundle');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll --download: writes integrity matching the on-disk bytes', async () => {
  const dir = await makeTempAppWithSource({
    'app/page.ts': `import pico from 'picocolors';`,
  });
  try {
    await withJspmDouble({}, async () => {
      await pinAll(dir, { download: true });
      const file = await readPinFile(dir);
      assert.ok(file.integrity, 'integrity field should be written');
      const localUrl = file.imports['picocolors'];
      assert.match(localUrl, /^\/__webjs\/vendor\//);
      assert.match(file.integrity[localUrl], /^sha384-/, 'integrity must match downloaded bytes');
      // Recompute hash from the on-disk file to prove it matches.
      const { sha384Integrity } = await import('../../src/vendor.js');
      const filename = localUrl.slice('/__webjs/vendor/'.length);
      const onDisk = await readFileFs(join(dir, '.webjs', 'vendor', filename), 'utf8');
      assert.equal(file.integrity[localUrl], await sha384Integrity(onDisk));
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serveDownloadedBundle: rejects path-traversal filenames', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    const r1 = await serveDownloadedBundle('../../../etc/passwd.js', dir, false);
    assert.equal(r1.status, 400);
    const r2 = await serveDownloadedBundle('subdir/foo.js', dir, false);
    assert.equal(r2.status, 400);
    const r3 = await serveDownloadedBundle('not-a-js-file.txt', dir, false);
    assert.equal(r3.status, 400);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serveDownloadedBundle: serves a real file from .webjs/vendor/', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
    await writeFile(join(dir, '.webjs', 'vendor', 'fake@1.0.0.js'), 'export default 1;');
    const resp = await serveDownloadedBundle('fake@1.0.0.js', dir, false);
    assert.equal(resp.status, 200);
    assert.match(resp.headers.get('content-type') || '', /javascript/);
    const body = await resp.text();
    assert.equal(body, 'export default 1;');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serveDownloadedBundle: missing file returns 404', async () => {
  const dir = await makeTempAppWithSource({});
  try {
    const resp = await serveDownloadedBundle('not-there@1.0.0.js', dir, false);
    assert.equal(resp.status, 404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- provider (--from) parity tests ---

test('SUPPORTED_PROVIDERS lists the four Rails-importmap-rails CDNs', () => {
  assert.deepEqual(
    [...SUPPORTED_PROVIDERS].sort(),
    ['jsdelivr', 'jspm', 'skypack', 'unpkg'],
  );
});

test('normalizeProvider: jspm → jspm.io, others pass through (Rails parity)', () => {
  assert.equal(normalizeProvider('jspm'), 'jspm.io');
  assert.equal(normalizeProvider('jsdelivr'), 'jsdelivr');
  assert.equal(normalizeProvider('unpkg'), 'unpkg');
  assert.equal(normalizeProvider('skypack'), 'skypack');
});

test('pinAll: rejects unknown provider with a clear error', async () => {
  const dir = join(tmpdir(), `webjs-pin-bad-prov-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"tmp"}');
  try {
    await assert.rejects(
      // Offline: the provider is rejected before any call is dialled.
      () => pinAll(dir, { from: 'not-a-real-cdn' }),
      /unknown provider 'not-a-real-cdn'/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writePinFile + readPinFile: provider persists for non-jspm choice', async () => {
  // Verify the provider round-trips through the pin file when the
  // user picked something other than the default. For default jspm
  // the field is omitted to keep the pin file shape stable for the
  // 99% case (covered by other tests).
  const dir = join(tmpdir(), `webjs-pin-prov-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(
    join(dir, '.webjs', 'vendor', 'importmap.json'),
    JSON.stringify({
      imports: { 'dayjs': 'https://cdn.jsdelivr.net/npm/dayjs@1.11.13/+esm' },
      provider: 'jsdelivr',
    }),
  );
  try {
    const file = await readPinFile(dir);
    assert.ok(file);
    assert.equal(file.provider, 'jsdelivr');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPinFile: rejects unknown provider value (tamper guard)', async () => {
  const dir = join(tmpdir(), `webjs-pin-prov-bad-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(
    join(dir, '.webjs', 'vendor', 'importmap.json'),
    JSON.stringify({
      imports: { 'a': 'https://cdn.example/a.js' },
      provider: 'malicious-resolver',
    }),
  );
  try {
    const file = await readPinFile(dir);
    assert.ok(file);
    assert.equal(file.provider, undefined,
      'provider must be dropped when not in SUPPORTED_PROVIDERS');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- audit / outdated / update parity tests ---

test('auditPinned: no pin file returns zero-checked', async () => {
  const dir = join(tmpdir(), `webjs-audit-empty-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    // Offline: no pin file, so it short-circuits before the registry call.
    const { vulnerable, totalChecked } = await auditPinned(dir);
    assert.equal(totalChecked, 0);
    assert.deepEqual(vulnerable, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOutdated: no pin file returns []', async () => {
  const dir = join(tmpdir(), `webjs-outdated-empty-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    // Offline: no pin file, so it short-circuits before the registry call.
    assert.deepEqual(await findOutdated(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updatePinned: rejects unknown provider', async () => {
  const dir = join(tmpdir(), `webjs-update-bad-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    await assert.rejects(
      // Offline: the provider is rejected before any call is dialled.
      () => updatePinned(dir, { from: 'not-real' }),
      /unknown provider/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updatePinned: no outdated returns noOutdated:true without writing', async () => {
  // Mock listPinned + findOutdated trivially: empty pin file means
  // both return empty, and updatePinned short-circuits before
  // any network call.
  const dir = join(tmpdir(), `webjs-update-clean-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    // Offline: an empty pin file short-circuits before the registry call.
    const result = await updatePinned(dir);
    assert.ok(result.noOutdated);
    assert.deepEqual(result.updated, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updatePinned: respects pin file provider when --from is not passed', async () => {
  // Regression: a user who pinned `--from jsdelivr` and later runs
  // `webjs vendor update` (no flag) should stay on jsdelivr, not
  // silently fall back to jspm.
  const dir = join(tmpdir(), `webjs-update-provider-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(
    join(dir, '.webjs', 'vendor', 'importmap.json'),
    JSON.stringify({
      // No actual outdated packages here; we're checking the
      // provider read path. updatePinned reaches the
      // findOutdated network call and returns noOutdated:true OR
      // updated:[]. Either way, the `provider` field on the
      // result should reflect what was on the pin file.
      imports: { 'a': 'https://cdn.jsdelivr.net/npm/a@1.0.0/+esm' },
      provider: 'jsdelivr',
    }),
  );
  try {
    // registry.npmjs.org is not part of what this asserts, and reaching it made
    // an unrelated outage able to stall the required job for ten seconds here
    // (#1150). A 404 exercises the same read path.
    const result = await withMockedFetch(
      async () => /** @type any */ ({ ok: false, status: 404, json: async () => ({}) }),
      () => updatePinned(dir),
    );
    assert.equal(result.provider, 'jsdelivr',
      'updatePinned must use the pin file provider when no --from passed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updatePinned: explicit --from overrides pin file provider', async () => {
  const dir = join(tmpdir(), `webjs-update-override-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(
    join(dir, '.webjs', 'vendor', 'importmap.json'),
    JSON.stringify({
      imports: { 'a': 'https://cdn.jsdelivr.net/npm/a@1.0.0/+esm' },
      provider: 'jsdelivr',
    }),
  );
  try {
    const result = await withMockedFetch(
      async () => /** @type any */ ({ ok: false, status: 404, json: async () => ({}) }),
      () => updatePinned(dir, { from: 'unpkg' }),
    );
    assert.equal(result.provider, 'unpkg',
      'explicit opts.from must override pin file provider');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('auditPinned: surfaces network failure as errored:true', async () => {
  // The audit command must NOT silently report "no vulnerabilities"
  // when the registry call failed. Never network-bound despite the gate it
  // used to carry: it stubs the global fetch for its own duration. Fail-closed contract: errored:true means the user must
  // retry.
  const dir = join(tmpdir(), `webjs-audit-err-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(
    join(dir, '.webjs', 'vendor', 'importmap.json'),
    JSON.stringify({
      imports: { 'dayjs': 'https://ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js' },
    }),
  );
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('simulated network failure'); };
  try {
    // Offline: the test installs its own throwing fetch for its whole duration.
    const result = await auditPinned(dir);
    assert.equal(result.errored, true);
    assert.deepEqual(result.vulnerable, []);
    assert.equal(result.totalChecked, 1);
  } finally {
    globalThis.fetch = origFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: respects existing pin file provider when --from is not passed', async () => {
  // Regression for the consistency gap: pinAll used to default to
  // 'jspm' on every run, silently reverting a user's jsdelivr choice
  // on subsequent re-pins. Now reads the existing pin file's
  // provider as the default. Explicit opts.from still wins.
  const dir = join(tmpdir(), `webjs-pin-sticky-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await mkdir(join(dir, 'app'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"tmp"}');
  await writeFile(join(dir, 'app', 'page.ts'), `export default () => 'no bare imports';`);
  await writeFile(
    join(dir, '.webjs', 'vendor', 'importmap.json'),
    JSON.stringify({
      imports: { 'a': 'https://cdn.jsdelivr.net/npm/a@1.0.0/+esm' },
      provider: 'jsdelivr',
    }),
  );
  try {
    // App has zero bare imports, so pinAll returns noBareImports
    // without writing. The interesting assertion: it didn't throw
    // and pinAll read the provider for whatever it would have done.
    // Verify by checking pin file's provider field unchanged.
    // Offline: the app has no bare imports, so pinAll returns before the resolve.
    const result = await pinAll(dir);
    assert.ok(result.noBareImports);
    const file = await readPinFile(dir);
    assert.equal(file.provider, 'jsdelivr',
      'pinAll must not overwrite a non-default provider field even on noBareImports');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: extracts version from jsdelivr CDN URL pattern', async () => {
  // Bug fix: listPinned only recognized jspm.io URLs (`npm:pkg@ver/`).
  // jsdelivr/unpkg/skypack pins fell through to '(unknown)', which
  // broke audit/outdated/update for any non-default provider. New
  // logic derives version by searching for `<pkg-name>@<version>`
  // in the URL.
  const dir = join(tmpdir(), `webjs-list-jsdelivr-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
    imports: {
      'dayjs': 'https://cdn.jsdelivr.net/npm/dayjs@1.11.13/+esm',
      '@hotwired/turbo': 'https://cdn.jsdelivr.net/npm/@hotwired/turbo@8.0.0/+esm',
    },
    provider: 'jsdelivr',
  }));
  try {
    const entries = await listPinned(dir);
    const dayjs = entries.find(e => e.pkg === 'dayjs');
    const turbo = entries.find(e => e.pkg === '@hotwired/turbo');
    assert.equal(dayjs.version, '1.11.13');
    assert.equal(turbo.version, '8.0.0', 'scoped package version is correctly extracted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('listPinned: extracts version from unpkg + skypack URL patterns', async () => {
  const dir = join(tmpdir(), `webjs-list-multi-cdn-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
    imports: {
      'lodash': 'https://www.unpkg.com/lodash@4.17.21/lodash.js',
      'preact': 'https://cdn.skypack.dev/preact@10.19.3',
    },
    provider: 'unpkg',
  }));
  try {
    const entries = await listPinned(dir);
    assert.equal(entries.find(e => e.pkg === 'lodash').version, '4.17.21');
    assert.equal(entries.find(e => e.pkg === 'preact').version, '10.19.3');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('updatePinned: only counts a package as updated when at least one spec resolved', async () => {
  // Regression: previously updatePinned pushed every outdated pkg
  // to result.updated regardless of whether any subpath actually
  // got a new URL from jspm.io. A user could see "Updated dayjs
  // 1.11.13 → 1.11.20" while the pin file was unchanged because
  // every jspm.io call failed. Now `anySpecUpdated` gates the push.
  //
  // We mock the package's latest by stubbing fetch: only the
  // npm-registry call for dayjs returns a "latest" newer than the
  // pinned version, but the jspm.io call for the new install
  // fails. Result: findOutdated reports dayjs as outdated, but
  // updatePinned tries jspm.io and the resolve returns nothing,
  // so updated[] stays empty.
  const dir = join(tmpdir(), `webjs-update-no-resolve-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
    imports: { 'dayjs': 'https://ga.jspm.io/npm:dayjs@1.11.13/dayjs.min.js' },
  }));
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('registry.npmjs.org/dayjs')) {
      // Pretend the latest is newer than the pinned 1.11.13.
      return /** @type any */ ({
        ok: true, status: 200,
        json: async () => ({ 'dist-tags': { latest: '99.99.99' } }),
      });
    }
    if (u.includes('api.jspm.io')) {
      // Pretend jspm.io fails for the new version. updatePinned's
      // resolved[spec] will be undefined, so the inner loop hits
      // `continue` for every spec.
      return /** @type any */ ({
        ok: false, status: 401,
        json: async () => ({ error: 'simulated' }),
      });
    }
    // No other fetches should fire in this test.
    return /** @type any */ ({ ok: false, status: 404, json: async () => ({}) });
  };
  try {
    // Offline: the test installs its own fetch for its whole duration.
    const result = await updatePinned(dir);
    assert.deepEqual(result.updated, [],
      'no spec resolved, so updated[] must be empty even though findOutdated saw dayjs as outdated');
  } finally {
    globalThis.fetch = origFetch;
    await rm(dir, { recursive: true, force: true });
  }
});

test('unpinPackage: preserves the pin file provider field after removing an entry', async () => {
  // Regression: unpinPackage rewrote the pin file via
  // writePinFile(appDir, imports, integrity) without the provider
  // argument, so a user who pinned with --from jsdelivr would lose
  // that choice after running `webjs vendor unpin <pkg>` for any
  // single package. Other pinned packages must keep their CDN.
  const dir = join(tmpdir(), `webjs-unpin-provider-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
    imports: {
      'dayjs': 'https://cdn.jsdelivr.net/npm/dayjs@1.11.13/+esm',
      'lodash': 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/+esm',
    },
    provider: 'jsdelivr',
  }));
  try {
    const result = await unpinPackage(dir, 'dayjs');
    assert.ok(result.removed);
    const after = await readPinFile(dir);
    assert.ok(after, 'pin file still exists (lodash remains)');
    assert.equal(after.provider, 'jsdelivr',
      'provider field must survive a single-package unpin');
    assert.equal(Object.keys(after.imports).length, 1);
    assert.equal(after.imports.lodash, 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/+esm');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findOutdated: returns an Array, not undefined (ASI regression guard)', async () => {
  // Regression: a `return` followed by a newline + JSDoc-cast parens
  // triggers automatic semicolon insertion (`return; (expr);`), so
  // the value gets dropped and findOutdated returns undefined.
  // Callers like updatePinned then crash with
  // `Cannot read properties of undefined (reading 'length')`.
  const dir = join(tmpdir(), `webjs-outdated-arr-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  // No pin file → grouped is empty → no fetches → return empty array.
  // The interesting assertion is that the return value is an
  // ARRAY (.length accessible), not undefined.
  // Offline: the test installs its own fetch for its whole duration.
  const result = await findOutdated(dir);
  assert.ok(Array.isArray(result), 'findOutdated must always return an Array');
  assert.equal(result.length, 0);
  await rm(dir, { recursive: true, force: true });
});

test('listPinned: short package names do not false-match inside other package URLs', async () => {
  // Regression: a bare-name regex without a boundary check would
  // find `ms@1.0.0` inside `terms@1.0.0/ms@2.0.0.js`, returning
  // version 1.0.0 for the `ms` package when the actual version
  // is 2.0.0. The boundary check ensures the match starts at
  // a non-pkg-name char (URL separator).
  const dir = join(tmpdir(), `webjs-list-boundary-${Date.now()}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
    imports: {
      'ms': 'https://cdn.example/npm/terms@1.0.0/ms@2.0.0/index.js',
    },
  }));
  try {
    const entries = await listPinned(dir);
    const ms = entries.find(e => e.pkg === 'ms');
    assert.equal(ms.version, '2.0.0',
      'must extract ms\'s own version, not the embedded "ms" inside "terms"');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports: ok=true for a pin file (deterministic disk read)', async () => {
  const dir = join(tmpdir(), `webjs-vok-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  try {
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'),
      JSON.stringify({ imports: { dayjs: 'https://ga.jspm.io/npm:dayjs@1/index.js' }, integrity: {} }));
    const r = await resolveVendorImports(dir, async () => new Set(['ignored']));
    assert.equal(r.ok, true, 'a pin-file read never partially fails');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/* ---------- live-resolve SRI integrity (#235), mocked fetch ---------- */

// Build an app dir with one resolvable bare-import package so the live path
// runs (getPackageVersion needs a real node_modules entry).
async function makeLiveApp(slug, pkg = 'dayjs', version = '1.11.20') {
  const dir = join(tmpdir(), `webjs-${slug}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, 'node_modules', pkg), { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'host' }));
  await writeFile(join(dir, 'node_modules', pkg, 'package.json'),
    JSON.stringify({ name: pkg, version, main: 'index.js' }));
  await writeFile(join(dir, 'node_modules', pkg, 'index.js'), 'export default 1;\n');
  return dir;
}

// A jspm-generate mock response carrying a `map.imports` fragment.
function jspmResponse(imports) {
  return /** @type any */ ({ ok: true, status: 200, json: async () => ({ map: { imports } }) });
}

// A bundle-fetch mock response carrying raw bytes.
function bundleResponse(bytes) {
  return /** @type any */ ({
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
}

test('resolveVendorImports live: emits sha384 integrity keyed by the FINAL cross-origin URL', async () => {
  const { sha384Integrity } = await import('../../src/vendor.js');
  const dir = await makeLiveApp('sri-live');
  const finalUrl = 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js';
  const bundleBytes = new TextEncoder().encode('export default function dayjs(){};');
  try {
    clearVendorCache();
    await withMockedFetch(async (url) => {
      const u = String(url);
      if (u.includes('api.jspm.io')) return jspmResponse({ dayjs: finalUrl });
      if (u === finalUrl) return bundleResponse(bundleBytes);
      throw new Error(`unexpected fetch: ${u}`);
    }, async () => {
      const r = await resolveVendorImports(dir, async () => new Set(['dayjs']));
      assert.equal(r.imports.dayjs, finalUrl, 'import map carries the cross-origin URL');
      const expected = await sha384Integrity(bundleBytes);
      assert.equal(r.integrity[finalUrl], expected,
        'integrity keyed by the FINAL URL, value matches sha384 of the bundle bytes');
      assert.match(r.integrity[finalUrl], /^sha384-[A-Za-z0-9+/=]+$/);
      assert.equal(r.ok, true);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports live: same-origin targets are not fetched or hashed', async () => {
  // A jspm fragment could theoretically include a same-origin entry; SRI is a
  // cross-origin defense, so a `/`-rooted target must be skipped (never fetched,
  // absent from the integrity map).
  const dir = await makeLiveApp('sri-sameorigin');
  const crossUrl = 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js';
  const localUrl = '/__webjs/core/index-browser.js';
  const bundleBytes = new TextEncoder().encode('// cross-origin bundle');
  /** @type {string[]} */
  const fetched = [];
  try {
    clearVendorCache();
    await withMockedFetch(async (url) => {
      const u = String(url);
      fetched.push(u);
      if (u.includes('api.jspm.io')) return jspmResponse({ dayjs: crossUrl, '@webjsdev/core': localUrl });
      if (u === crossUrl) return bundleResponse(bundleBytes);
      throw new Error(`unexpected fetch: ${u}`);
    }, async () => {
      const r = await resolveVendorImports(dir, async () => new Set(['dayjs']));
      assert.ok(r.integrity[crossUrl], 'cross-origin URL is hashed');
      assert.equal(r.integrity[localUrl], undefined, 'same-origin URL absent from integrity map');
      assert.ok(!fetched.includes(localUrl), 'same-origin URL is never fetched');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports live: graceful degradation on a bundle fetch failure (counterfactual)', async () => {
  // The key safety test. One cross-origin bundle fetch fails; the resolve must
  // NOT throw, the imports must stay intact, the failing URL gets NO integrity,
  // a warning is emitted, and OTHER URLs still get their hash.
  const dir = await makeLiveApp('sri-degrade');
  const okUrl = 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js';
  const badUrl = 'https://ga.jspm.io/npm:clsx@2.1.1/index.js';
  const okBytes = new TextEncoder().encode('export default function dayjs(){};');
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    clearVendorCache();
    await withMockedFetch(async (url) => {
      const u = String(url);
      if (u.includes('api.jspm.io')) return jspmResponse({ dayjs: okUrl, clsx: badUrl });
      if (u === okUrl) return bundleResponse(okBytes);
      if (u === badUrl) return /** @type any */ ({ ok: false, status: 502 });
      throw new Error(`unexpected fetch: ${u}`);
    }, async () => {
      const r = await resolveVendorImports(dir, async () => new Set(['dayjs', 'clsx']));
      // imports intact for BOTH
      assert.equal(r.imports.dayjs, okUrl);
      assert.equal(r.imports.clsx, badUrl, 'failing-integrity import is still present');
      // integrity present for the good URL, absent for the failed one
      assert.ok(r.integrity[okUrl], 'good URL keeps its integrity');
      assert.equal(r.integrity[badUrl], undefined, 'failed URL has no integrity');
      assert.ok(warnings.some(w => w.includes('could not compute SRI')),
        'a warning is emitted for the failed integrity fetch');
    });
  } finally {
    console.warn = origWarn;
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports live: a fetch rejection (not just non-ok) also degrades, no throw', async () => {
  const dir = await makeLiveApp('sri-reject');
  const url = 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js';
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => { warnings.push(args.join(' ')); };
  try {
    clearVendorCache();
    await withMockedFetch(async (u) => {
      const s = String(u);
      if (s.includes('api.jspm.io')) return jspmResponse({ dayjs: url });
      throw new Error('socket hang up'); // the bundle fetch rejects
    }, async () => {
      const r = await resolveVendorImports(dir, async () => new Set(['dayjs']));
      assert.equal(r.imports.dayjs, url, 'import survives a bundle fetch rejection');
      assert.equal(r.integrity[url], undefined, 'no integrity on a rejected fetch');
      assert.ok(warnings.some(w => w.includes('could not compute SRI')));
    });
  } finally {
    console.warn = origWarn;
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports live: in-process cache avoids re-fetching an already-hashed URL', async () => {
  const dir = await makeLiveApp('sri-cache');
  const url = 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js';
  const bundleBytes = new TextEncoder().encode('export default 1;');
  let bundleFetches = 0;
  try {
    clearVendorCache();
    await withMockedFetch(async (u) => {
      const s = String(u);
      if (s.includes('api.jspm.io')) return jspmResponse({ dayjs: url });
      if (s === url) { bundleFetches++; return bundleResponse(bundleBytes); }
      throw new Error(`unexpected fetch: ${s}`);
    }, async () => {
      const thunk = async () => new Set(['dayjs']);
      await resolveVendorImports(dir, thunk);
      await resolveVendorImports(dir, thunk); // second resolve, same URL
      assert.equal(bundleFetches, 1, 'the immutable bundle URL is hashed once, then cached');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('pinAll: a bundle fetch that hangs is abandoned, not waited on forever', async () => {
  // fetchIntegrity (default mode) and downloadBundle (--download) were the two
  // outbound calls in vendor.js with no AbortSignal, while jspmCall,
  // fetchNpmJson, and fetchLiveIntegrity all carried one. pinAll runs one of
  // them once per resolved URL and there is no ambient deadline on a CLI run,
  // so a CDN that accepted the connection and then stalled held the pin open
  // indefinitely (#1150).
  //
  // BOTH modes are covered, because they take different calls. The first
  // version of this test only exercised the default path, which left
  // `webjs vendor pin --download` with exactly the behaviour the fix claimed
  // to have removed.
  //
  // Assert the SIGNAL rather than the wall clock: a real 10s wait would make
  // this test the slow thing it is complaining about, and a shortened timeout
  // would need production code to grow a test-only knob.
  for (const opts of [{}, { download: true }]) {
    const mode = opts.download ? '--download' : 'default';
    const dir = await makeTempAppWithSource({ 'app/page.ts': `import pico from 'picocolors';` });
    const realSetTimeout = globalThis.setTimeout;
    try {
      /** @type {Array<AbortSignal | undefined>} */
      const signals = [];
      /** Milliseconds each bundle fetch was given, read off the real timer. */
      /** @type {number[]} */
      const timeouts = [];
      globalThis.setTimeout = /** @type {any} */ ((fn, ms, ...rest) => {
        if (typeof ms === 'number' && ms >= 1000) timeouts.push(ms);
        return realSetTimeout(fn, ms, ...rest);
      });
      await withMockedFetch(async (url, init) => {
        const s = String(url);
        if (s.includes('api.jspm.io')) {
          // Forget the generate call's own 10s timer, so the only budget left
          // in `timeouts` is the one the BUNDLE fetch sets a moment from now.
          timeouts.length = 0;
          return jspmResponse({ picocolors: 'https://ga.jspm.io/npm:picocolors@1.1.1/index.js' });
        }
        signals.push(init && init.signal);
        // Abort exactly the way a timeout would, so the catch path is exercised.
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }, async () => {
        const result = await pinAll(dir, opts);
        // Fail-open is unchanged: an unreachable bundle must not fail the pin
        // outright in default mode, where the entry still pins without a hash.
        if (!opts.download) assert.ok(!result.failed, 'a failed hash must not fail the whole pin');
      });
      assert.equal(signals.length, 1, `${mode}: the bundle GET fired exactly once`);
      assert.ok(signals[0] instanceof AbortSignal,
        `${mode}: the bundle fetch must carry an AbortSignal so a stalled CDN cannot hang the pin`);
      // The BUDGET, not just its existence. A pin transfers a whole package on
      // a link the user may not control, so it gets 60s rather than the 10s
      // the server's readiness-gating warmup pass uses; asserting only that a
      // signal exists could not tell the two apart. 60s is what
      // importmap-rails effectively allows, since Ruby's Net::HTTP defaults
      // read_timeout to 60 even though the gem sets none.
      assert.equal(timeouts[0], 60_000,
        `${mode}: a pin bundle fetch must get the 60s budget, not the warmup pass's 10s`);
    } finally {
      globalThis.setTimeout = realSetTimeout;
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test('the generate call gets the CLI budget from a pin and the server budget from a resolve', async () => {
  // importmap-rails sets no timeout and inherits Ruby's 60s Net::HTTP default
  // on every jspm call. Matching that flatly would be wrong here, because
  // importmap-rails only ever resolves from the CLI (its importmap is a static
  // config file), while WebJs also resolves on a cold first request. A 60s
  // budget on the request path would let one stalled CDN hold a request for a
  // minute, so the budget is per-caller: 60s from `pinAll`, 10s from a live
  // resolve.
  //
  // Counterfactual: drop the `timeoutMs` argument at either call site and the
  // matching half of this fails, since both numbers are asserted.
  const budgets = [];
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = /** @type any */ ((fn, ms, ...rest) => {
    if (typeof ms === 'number' && ms >= 1000) budgets.push(ms);
    return realSetTimeout(fn, ms, ...rest);
  });
  const dir = await makeTempAppWithSource({ 'app/page.ts': `import pico from 'picocolors';` });
  try {
    const mock = async (url) => (String(url).includes('api.jspm.io')
      ? jspmResponse({ picocolors: 'https://ga.jspm.io/npm:picocolors@1.1.1/index.js' })
      : bundleResponse(new TextEncoder().encode('export default 1;')));

    budgets.length = 0;
    await withMockedFetch(mock, async () => { clearVendorCache(); await pinAll(dir); });
    assert.ok(budgets.includes(60_000), `a pin's generate call must get 60s, saw ${budgets}`);
    assert.ok(!budgets.includes(10_000), `a pin must not fall back to the server budget, saw ${budgets}`);

    budgets.length = 0;
    await withMockedFetch(mock, async () => {
      clearVendorCache();
      await vendorImportMapEntries(new Set(['picocolors']), process.cwd());
    });
    assert.ok(budgets.includes(10_000), `a live resolve must keep the 10s server budget, saw ${budgets}`);
    assert.ok(!budgets.includes(60_000), `a live resolve must not take the CLI budget, saw ${budgets}`);
  } finally {
    globalThis.setTimeout = realSetTimeout;
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports: PINNED path is unchanged (live-hash path not taken)', async () => {
  // Counterfactual that the pin path did not regress: a pin file with its own
  // integrity returns verbatim, and NO bundle fetch fires for it.
  const dir = join(tmpdir(), `webjs-sri-pin-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, '.webjs', 'vendor'), { recursive: true });
  let fetched = false;
  try {
    await writeFile(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({
      imports: { dayjs: 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js' },
      integrity: { 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js': 'sha384-pinned' },
    }));
    clearVendorCache();
    await withMockedFetch(async () => { fetched = true; throw new Error('should not fetch'); }, async () => {
      const r = await resolveVendorImports(dir, async () => new Set(['dayjs']));
      assert.equal(r.integrity['https://ga.jspm.io/npm:dayjs@1.11.20/index.js'], 'sha384-pinned',
        'pin integrity returned verbatim');
      assert.equal(fetched, false, 'no live bundle fetch on the pinned path');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('live-resolve integrity reaches the importmap + modulepreload emission (end to end)', async () => {
  // Prove the ALREADY-WIRED emission now fires on the live path: feed the live
  // resolveVendorImports output into setVendorEntries (as ensureReady does in
  // dev.js), then assert the served importmap JSON carries the integrity
  // sibling AND ssr.js's integrityAttr(url) emits `integrity="sha384-..."` for
  // the cross-origin target.
  const { setVendorEntries, importMapTag } = await import('../../src/importmap.js');
  const { integrityAttr, preloadCrossOriginAttr } = await import('../../src/ssr.js');
  const dir = await makeLiveApp('sri-e2e');
  const finalUrl = 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js';
  const bundleBytes = new TextEncoder().encode('export default function dayjs(){};');
  try {
    clearVendorCache();
    await withMockedFetch(async (url) => {
      const u = String(url);
      if (u.includes('api.jspm.io')) return jspmResponse({ dayjs: finalUrl });
      if (u === finalUrl) return bundleResponse(bundleBytes);
      throw new Error(`unexpected fetch: ${u}`);
    }, async () => {
      const v = await resolveVendorImports(dir, async () => new Set(['dayjs']));
      await setVendorEntries(v.imports, v.integrity);
      // The importmap script tag carries the integrity sibling for the URL.
      const tag = importMapTag();
      assert.ok(tag.includes('"integrity"'), 'importmap tag carries an integrity block');
      assert.ok(tag.includes(v.integrity[finalUrl]), 'importmap integrity value present');
      // The modulepreload tag for this cross-origin URL gets integrity + crossorigin.
      assert.match(integrityAttr(finalUrl), /^ integrity="sha384-[A-Za-z0-9+/=]+"$/,
        'modulepreload integrity attribute emitted for the live-resolved URL');
      assert.ok(preloadCrossOriginAttr(finalUrl).includes('crossorigin'),
        'cross-origin URL also gets crossorigin');
    });
  } finally {
    await setVendorEntries({}, {});
    await rm(dir, { recursive: true, force: true });
  }
});

test('resolveVendorImports: ok=false on a transient failure, ok=true on a permanent 401', async () => {
  // The unpinned path distinguishes a transient CDN problem (network/timeout/5xx
  // -> ok false, retried on the next request) from a permanent unresolvable
  // install (jspm 401 for a private/workspace/server-only dep -> ok true,
  // tolerated so the app still boots). ensureReady keys its retry off this flag.
  const dir = join(tmpdir(), `webjs-vok2-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, 'node_modules', 'testpkg'), { recursive: true });
  try {
    // resolvePackageDir uses createRequire(appDir).resolve, so the host needs a
    // package.json and the dep needs a real resolvable entry point.
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'host' }));
    await writeFile(join(dir, 'node_modules', 'testpkg', 'package.json'),
      JSON.stringify({ name: 'testpkg', version: '1.0.0', main: 'index.js' }));
    await writeFile(join(dir, 'node_modules', 'testpkg', 'index.js'), 'export const x = 1;\n');
    const thunk = async () => new Set(['testpkg']);

    clearVendorCache();
    await withMockedFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
      const r = await resolveVendorImports(dir, thunk);
      assert.equal(r.ok, false, 'a network failure is transient -> ok false');
    });

    clearVendorCache();
    await withMockedFetch(async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unable to resolve' }) }), async () => {
      const r = await resolveVendorImports(dir, thunk);
      assert.equal(r.ok, true, 'a 401 unresolvable is permanent -> tolerated, ok true');
    });

    clearVendorCache();
    await withMockedFetch(async () => ({ ok: false, status: 503, json: async () => ({}) }), async () => {
      const r = await resolveVendorImports(dir, thunk);
      assert.equal(r.ok, false, 'a 5xx is transient -> ok false');
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
