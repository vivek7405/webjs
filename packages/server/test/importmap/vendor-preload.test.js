/**
 * Vendor modulepreload (#754): flatten the npm CDN waterfall by hinting the
 * vendor URLs a page's SHIPPED modules actually import, so the browser fetches
 * the vendor graph in parallel instead of discovering it level by level.
 *
 *  - `vendorPreloadTargets` (unit): maps reached bare specifiers to
 *    `{ href, integrity }` taken DIRECTLY from the importmap (byte-identical, so
 *    no double-fetch), excludes `@webjsdev/core`, dedups, and drops a specifier
 *    not in the importmap (an unpinned / unreached / elided vendor -> no
 *    over-fetch).
 *  - the HTTP layer: a page rendering an interactive component that imports a
 *    cross-origin vendor emits `<link rel="modulepreload" href integrity
 *    crossorigin>` for the reached vendor URL; an elided/unused vendor is NOT
 *    preloaded; the modulepreload href is byte-identical to the importmap target.
 *
 * Also covers the CORE runtime hint (#1118), which lives in the same head
 * builder but deliberately NOT in `vendorPreloadTargets` (core is same-origin,
 * not a CDN-waterfall vendor). Same byte-identity rule, same over-fetch rule.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import {
  setVendorEntries,
  setCoreInstall,
  vendorPreloadTargets,
  buildImportMap,
} from '../../src/importmap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, '../../../core/src');
const CORE_DIR = resolve(__dirname, '../../../core');
const HTML_URL = pathToFileURL(join(CORE_SRC, 'html.js')).toString();
const COMPONENT_URL = pathToFileURL(join(CORE_SRC, 'component.js')).toString();

/* ---------------- vendorPreloadTargets (unit) ---------------- */

test('vendorPreloadTargets maps reached specifiers to importmap href + integrity', async () => {
  const DAYJS = 'https://ga.jspm.io/npm:dayjs@1.11.21/dayjs.min.js';
  const UTC = 'https://ga.jspm.io/npm:dayjs@1.11.21/plugin/utc.js';
  await setVendorEntries(
    { dayjs: DAYJS, 'dayjs/plugin/utc': UTC },
    { [DAYJS]: 'sha384-dayjsHASH', [UTC]: 'sha384-utcHASH' },
  );
  const targets = vendorPreloadTargets(['dayjs', 'dayjs/plugin/utc']);
  assert.deepEqual(
    targets.sort((a, b) => a.href.localeCompare(b.href)),
    [
      { href: DAYJS, integrity: 'sha384-dayjsHASH' },
      { href: UTC, integrity: 'sha384-utcHASH' },
    ],
    'each reached specifier yields its importmap href + matching integrity',
  );
  // Byte-identity: the href is EXACTLY the importmap target (no rewrite).
  assert.equal(targets.find((t) => t.href === DAYJS).href, buildImportMap().imports.dayjs);
  await setVendorEntries({});
});

test('vendorPreloadTargets excludes @webjsdev/core and dedups', async () => {
  const LIT = 'https://ga.jspm.io/npm:lit@3.1.0/index.js';
  await setVendorEntries({
    'lit': LIT,
    'lit-also': LIT, // two specifiers, same URL -> one preload
    '@webjsdev/core': 'https://cdn.example/core.js',
    '@webjsdev/core/directives': 'https://cdn.example/directives.js',
  });
  const targets = vendorPreloadTargets(['lit', 'lit-also', '@webjsdev/core', '@webjsdev/core/directives']);
  assert.deepEqual(targets, [{ href: LIT, integrity: undefined }],
    'core specifiers excluded; the shared URL is emitted once');
  await setVendorEntries({});
});

test('vendorPreloadTargets drops a specifier not in the importmap (no over-fetch)', async () => {
  await setVendorEntries({ dayjs: 'https://ga.jspm.io/npm:dayjs@1.11.21/dayjs.min.js' });
  const targets = vendorPreloadTargets(['dayjs', 'left-pad', 'not-pinned']);
  assert.equal(targets.length, 1, 'only the pinned/reached specifier is a target');
  assert.ok(targets[0].href.includes('dayjs'));
  await setVendorEntries({});
});

test('vendorPreloadTargets returns [] for an empty specifier set', async () => {
  await setVendorEntries({ dayjs: 'https://ga.jspm.io/npm:dayjs@1/dayjs.js' });
  assert.deepEqual(vendorPreloadTargets([]), []);
  assert.deepEqual(vendorPreloadTargets(undefined), []);
  await setVendorEntries({});
  await setCoreInstall(CORE_DIR, true); // restore shared core install for later files
});

/* ---------------- HTTP layer ---------------- */

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-vendorpreload-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

/** Write a trivial local node_modules stub for a bare specifier so the SSR
 * render (which Node resolves from disk) does not crash on a missing package.
 * The importmap target stays the pinned CDN URL (that is what drives the
 * browser-side modulepreload href); the stub only lets SSR import the widget
 * module so a successful render populates the used-component set. Without it the
 * page 500s and a "no modulepreload" assertion would pass VACUOUSLY. */
function writeVendorStub(appDir, name) {
  const pkgDir = join(appDir, 'node_modules', name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, 'package.json'),
    JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.js' }));
  writeFileSync(join(pkgDir, 'index.js'), `export default function stub() { return {}; }\n`);
}

function makeApp({ pin = null, stubs = ['dayjs'] } = {}) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  const files = {
    'package.json': JSON.stringify({ name: 'fixture', type: 'module' }),
    'app/layout.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default ({ children }) => html\`<main>\${children}</main>\`;\n`,
  };
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  for (const s of stubs) writeVendorStub(appDir, s);
  if (pin) {
    const dir = join(appDir, '.webjs', 'vendor');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'importmap.json'), JSON.stringify(pin));
  }
  return appDir;
}

/** An INTERACTIVE component (a `@click`, so elision keeps it) that imports the
 * bare `dayjs` specifier, so dayjs stays reachable in the pruned vendor map. */
function writeVendorWidget(appDir) {
  writeFileSync(
    join(appDir, 'app', 'widget.js'),
    `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import dayjs from 'dayjs';\n` +
    `export class XWidget extends WebComponent {\n` +
    `  render() { return html\`<button @click=\${() => dayjs()}>hi</button>\`; }\n` +
    `}\n` +
    `XWidget.register('x-widget');\n`,
  );
}

function modulepreloadLinks(html) {
  return [...html.matchAll(/<link rel="modulepreload"[^>]*>/g)].map((m) => m[0]);
}
function importmapTarget(html, spec) {
  const m = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  return JSON.parse(m[1]).imports[spec] || null;
}

const DAYJS_URL = 'https://ga.jspm.io/npm:dayjs@1.11.21/dayjs.min.js';
const DAYJS_INTEGRITY = 'sha384-TESTdayjsINTEGRITY0000000000000000000000000000000000000000000';

test('a page reaching a cross-origin vendor emits a modulepreload (with integrity)', async () => {
  const appDir = makeApp({
    pin: { imports: { dayjs: DAYJS_URL }, integrity: { [DAYJS_URL]: DAYJS_INTEGRITY } },
  });
  writeVendorWidget(appDir);
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import './widget.js';\n` +
    `export default () => html\`<x-widget></x-widget>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();

  const links = modulepreloadLinks(html);
  const dayjs = links.filter((l) => l.includes(DAYJS_URL));
  assert.equal(dayjs.length, 1, 'exactly one modulepreload for the reached vendor URL');
  assert.match(dayjs[0], /integrity="sha384-TESTdayjsINTEGRITY/, 'carries the importmap integrity');
  assert.match(dayjs[0], /crossorigin(=|>|\s)/, 'cross-origin vendor preload carries crossorigin');

  // Byte-identity: the preload href is EXACTLY the importmap target, else the
  // browser treats them as two resources and double-fetches.
  const target = importmapTarget(html, 'dayjs');
  assert.ok(target, 'dayjs is in the served importmap');
  assert.ok(dayjs[0].includes(`href="${target}"`), 'preload href === importmap target (no double fetch)');
});

test('an unused/elided vendor is NOT preloaded (no over-fetch)', async () => {
  // Pin TWO vendors but the page reaches only dayjs. `left-pad` is pinned yet
  // never imported by a shipped module, so it must not be preloaded.
  const LEFTPAD = 'https://ga.jspm.io/npm:left-pad@1.3.0/index.js';
  const appDir = makeApp({
    pin: {
      imports: { dayjs: DAYJS_URL, 'left-pad': LEFTPAD },
      integrity: { [DAYJS_URL]: DAYJS_INTEGRITY },
    },
  });
  writeVendorWidget(appDir);
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import './widget.js';\n` +
    `export default () => html\`<x-widget></x-widget>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();

  const links = modulepreloadLinks(html);
  assert.ok(links.some((l) => l.includes('dayjs')), 'the reached vendor IS preloaded');
  assert.ok(!links.some((l) => l.includes('left-pad')), 'the unused vendor is NOT preloaded (no over-fetch)');
});

test('an inert page does not preload an SSR-only vendor a SIBLING route ships (#754 review MUST-FIX)', async () => {
  // The real over-fetch (the single-route case is masked by app-wide importmap
  // pruning, which drops a wholly-unreached vendor anyway). A SIBLING route
  // `/live` ships dayjs via an interactive widget, so dayjs STAYS in the
  // app-wide importmap. The tested route `/` is an inert page that imports dayjs
  // as a binding used ONLY in SSR: its module is dropped from the boot, dayjs is
  // never fetched on `/`, so `/` must NOT preload it. Without the inert/import-only
  // filter, `/` would collect dayjs from the dropped page and over-fetch it.
  const appDir = makeApp({
    pin: { imports: { dayjs: DAYJS_URL }, integrity: { [DAYJS_URL]: DAYJS_INTEGRITY } },
  });
  writeVendorWidget(appDir); // app/widget.js: interactive (@click), imports dayjs
  mkdirSync(join(appDir, 'app', 'live'), { recursive: true });
  writeFileSync(
    join(appDir, 'app', 'live', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import '../widget.js';\n` +
    `export default () => html\`<x-widget></x-widget>\`;\n`,
  );
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import dayjs from 'dayjs';\n` +
    `export default () => html\`<main>built (\${typeof dayjs})</main>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const homeHtml = await (await app.handle(new Request('http://x/'))).text();
  // Precondition: dayjs IS in the app-wide importmap (the sibling /live keeps it
  // reachable, so it is not pruned). This is what makes the over-fetch possible.
  assert.ok(/"dayjs"/.test(homeHtml), 'dayjs stays in the app-wide importmap (sibling /live ships it)');
  // Precondition: the inert page module is dropped from the boot.
  assert.ok(!modulepreloadLinks(homeHtml).some((l) => l.includes('/app/page.js')),
    'the inert page module is dropped from the boot');
  // The fix: `/` must NOT preload dayjs (its only importer on `/` is the dropped page).
  assert.ok(!modulepreloadLinks(homeHtml).some((l) => l.includes('dayjs')),
    'the inert page\'s SSR-only vendor is NOT preloaded on / (no over-fetch)');

  // Sanity: the sibling route that actually SHIPS dayjs does preload it.
  const liveHtml = await (await app.handle(new Request('http://x/live'))).text();
  assert.ok(modulepreloadLinks(liveHtml).some((l) => l.includes('dayjs')),
    '/live preloads dayjs (it ships the widget that uses it)');
  await setCoreInstall(CORE_DIR, true);
});

test('a vendor imported ONLY by an elided (display-only) component is NOT preloaded', async () => {
  // A display-only component (no interactivity signal) is elided, so its bare
  // import is stripped from the served source and must not be preloaded.
  const appDir = makeApp({
    pin: { imports: { dayjs: DAYJS_URL }, integrity: { [DAYJS_URL]: DAYJS_INTEGRITY } },
  });
  writeFileSync(
    join(appDir, 'app', 'badge.js'),
    `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import dayjs from 'dayjs';\n` +
    `export class XBadge extends WebComponent {\n` +
    `  render() { return html\`<span>\${dayjs ? 'static' : 'x'}</span>\`; }\n` +
    `}\n` +
    `XBadge.register('x-badge');\n`,
  );
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import './badge.js';\n` +
    `export default () => html\`<x-badge></x-badge>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();
  assert.ok(!modulepreloadLinks(html).some((l) => l.includes('dayjs')),
    'an elided component\'s vendor is not preloaded');
  await setCoreInstall(CORE_DIR, true);
});

test('a dropped page\'s SSR-only RELATIVE HELPER vendor is NOT preloaded (#754 round-2)', async () => {
  // Round-2 finding: the walk reached a dropped page's relative helper, whose
  // vendor was collected even though the helper never ships. An inert page
  // imports `./fmt.js` (a pure SSR helper) which imports dayjs as a binding; the
  // page module is dropped, so neither fmt.js nor dayjs ships, and dayjs must
  // NOT be preloaded on that route.
  //
  // Multi-route for the same reason as the SIBLING-route test above, and since
  // #1399 for a second one. A sibling `/live` ships dayjs through an interactive
  // widget, which is what keeps dayjs in the app-wide importmap and therefore
  // makes the over-fetch possible at all. Single-route, this now asserts nothing:
  // the vendor scan is rooted in the module graph and does not traverse into a
  // skipped module, so the subtree behind the dropped page (fmt.js, and dayjs
  // with it) is pruned from the importmap outright, and a specifier absent from
  // the importmap can never be preloaded whatever the walk does.
  const appDir = makeApp({
    pin: { imports: { dayjs: DAYJS_URL }, integrity: { [DAYJS_URL]: DAYJS_INTEGRITY } },
  });
  writeVendorWidget(appDir); // app/widget.js: interactive (@click), imports dayjs
  mkdirSync(join(appDir, 'app', 'live'), { recursive: true });
  writeFileSync(
    join(appDir, 'app', 'live', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import '../widget.js';\n` +
    `export default () => html\`<x-widget></x-widget>\`;\n`,
  );
  writeFileSync(
    join(appDir, 'app', 'fmt.js'),
    `import dayjs from 'dayjs';\nexport const fmt = () => typeof dayjs;\n`,
  );
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import { fmt } from './fmt.js';\n` +
    `export default () => html\`<main>built (\${fmt()})</main>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();
  // Precondition: dayjs stays in the app-wide importmap (the sibling /live keeps
  // it reachable), so excluding it from the preload set is the fix under test.
  assert.ok(/"dayjs"/.test(html), 'dayjs is in the app-wide importmap (sibling /live ships it)');
  // Precondition: the inert page module is dropped from the boot.
  assert.ok(!modulepreloadLinks(html).some((l) => l.includes('/app/page.js')), 'the inert page is dropped');
  // The fix: the SSR-only helper's vendor is NOT preloaded.
  assert.ok(!modulepreloadLinks(html).some((l) => l.includes('dayjs')),
    'a dropped page\'s SSR-only relative-helper vendor is NOT preloaded (no over-fetch)');
  await setCoreInstall(CORE_DIR, true);
});

test('import-only page: skipping the dropped page module does NOT drop its shipping component\'s vendor (no under-fetch)', async () => {
  // The under-fetch guard for the round-1 fix: an IMPORT-ONLY page imports its
  // interactive widget (which ships and imports dayjs) AND imports dayjs itself
  // as an SSR-only binding. The page module is dropped, so the fix skips the
  // PAGE's own bare imports, but it must KEEP the page in the reachability WALK
  // so the widget (which ships) is still reached and its dayjs collected. dayjs
  // must therefore still be preloaded. (The pure over-fetch of an SSR-only vendor
  // is proven load-bearingly by the multi-route inert test above.)
  const appDir = makeApp({
    pin: { imports: { dayjs: DAYJS_URL }, integrity: { [DAYJS_URL]: DAYJS_INTEGRITY } },
  });
  writeVendorWidget(appDir); // app/widget.js: interactive, imports dayjs (ships)
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import './widget.js';\n` +
    `import dayjs from 'dayjs';\n` +
    `export default () => html\`<main>\${typeof dayjs}<x-widget></x-widget></main>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();
  const links = modulepreloadLinks(html);
  // Precondition: the page is import-only (its module dropped; the widget ships).
  assert.ok(!links.some((l) => l.includes('/app/page.js')), 'the import-only page module is dropped');
  assert.ok(links.some((l) => l.includes('/app/widget.js')), 'the widget ships (component preload)');
  // No under-fetch: the shipping widget's dayjs IS still preloaded.
  assert.ok(links.some((l) => l.includes('dayjs')),
    'the shipping component\'s vendor IS preloaded (skipping the dropped page did not drop it)');
  await setCoreInstall(CORE_DIR, true);
});

/* ---------------- core runtime modulepreload (#1118) ---------------- */

test('a page shipping a boot module preloads @webjsdev/core, byte-identical to the importmap target', async () => {
  // The boot script names only page and component URLs, so without this hint the
  // browser discovers core one round trip later (fetch a component -> parse ->
  // fetch core). That round trip is the pre-boot click window on a cold link.
  const appDir = makeApp();
  writeVendorWidget(appDir);
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `import './widget.js';\n` +
    `export default () => html\`<x-widget></x-widget>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();

  const target = importmapTarget(html, '@webjsdev/core');
  assert.ok(target, '@webjsdev/core is in the served importmap');
  const core = modulepreloadLinks(html).filter((l) => l.includes(`href="${target}"`));
  assert.equal(core.length, 1, 'exactly one modulepreload for the core runtime');
  // Byte-identity is the whole correctness condition: a differing href makes the
  // browser treat the preload and the import as two resources and fetch core
  // twice, silently (the page still works, it just pays double).
  assert.ok(core[0].includes(`href="${target}"`), 'preload href === importmap target (no double fetch)');

  // The hint is emitted FIRST, ahead of the page/component preloads, since every
  // one of them imports it.
  const links = modulepreloadLinks(html);
  assert.ok(links[0].includes(`href="${target}"`), 'the core hint is the first modulepreload');
  assert.ok(links.some((l) => l.includes('/app/widget.js')), 'the component preloads are still emitted');
});

test('a fully elided page (no boot module) does NOT preload core (#780 no over-fetch)', async () => {
  // A display-only page ships nothing, so a preload for the runtime it never
  // loads is pure over-fetch. Same rule that keeps a core hint off
  // `global-error.{js,ts}`, whose document is returned verbatim with no boot.
  const appDir = makeApp();
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default () => html\`<main>static</main>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();

  // Precondition: nothing ships, so the assertion below cannot pass vacuously
  // for the wrong reason (a rendered page that simply had no modules at all).
  assert.ok(!/<script type="module"/.test(html), 'the elided page ships no boot script');
  const target = importmapTarget(html, '@webjsdev/core');
  assert.ok(
    !modulepreloadLinks(html).some((l) => target && l.includes(`href="${target}"`)),
    'no core preload for a page that never loads core',
  );
});

test('vendorPreloadTargets still excludes core: the hint comes from the head builder', () => {
  // Guards the seam. If someone "fixes" the exclusion in `vendorPreloadTargets`
  // instead, the href stops being the raw importmap target on a base-path or
  // fingerprinted deploy and core double-fetches.
  assert.deepEqual(vendorPreloadTargets(['@webjsdev/core', '@webjsdev/core/lazy-loader']), []);
});

/* ---------------- the served importmap, through the real server ---------------- */

test('a vendor imported only by instrumentation-client survives the pin prune (real runtime path)', async () => {
  // `instrumentation-client.*` is an app-ROOT convention file, not a router
  // stem, so it reaches the browser-bound entry set only because
  // `buildRouteTable` resolves it onto the table. When the dev server alone
  // attached it, the vendor scan (which builds its own table) lost the entry.
  //
  // A pinned app is where that becomes user-visible: `prunePinToReachable`
  // intersects the committed pin with the runtime's reachable set, and it can
  // only SHRINK, so an entry the scan cannot see is dropped from the served
  // map. The boot imports instrumentation-client FIRST, so the browser then
  // hits an unresolved bare specifier before anything else runs.
  //
  // This boots a real handler and reads the importmap off the served HTML, so
  // it exercises dev.js's own scan closure rather than a hand-rebuilt
  // stand-in: it fails if any link in the real runtime path stops carrying the
  // entry, not only if the one line a mirror copies goes missing.
  const appDir = makeApp({
    pin: { imports: { dayjs: DAYJS_URL }, integrity: { [DAYJS_URL]: DAYJS_INTEGRITY } },
  });
  writeFileSync(
    join(appDir, 'instrumentation-client.js'),
    `import dayjs from 'dayjs';\nglobalThis.__booted = typeof dayjs;\n`,
  );
  writeFileSync(
    join(appDir, 'app', 'page.js'),
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export default () => html\`<main>hi</main>\`;\n`,
  );
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();
  const html = await (await app.handle(new Request('http://x/'))).text();
  assert.equal(importmapTarget(html, 'dayjs'), DAYJS_URL,
    'the pin prune must keep a vendor reachable only from instrumentation-client');
  await setCoreInstall(CORE_DIR, true);
});
