/**
 * HTTP-layer integration tests for content-hash asset URLs (issue #243,
 * feature 1), exercised through `createRequestHandler` against minimal app
 * fixtures. Web-standard Request/Response, no real HTTP server.
 *
 * The headline behaviours, proven at the strongest layer (served bytes):
 *   - PROD: every SAME-ORIGIN importmap target / modulepreload href / boot
 *     specifier carries `?v=<hash>`; a cross-origin vendor target does NOT.
 *     GET each fingerprinted url -> 200 + immutable; GET it WITHOUT `?v` ->
 *     the 1h fallback.
 *   - DEPLOY-BUSTS: changing a module's bytes changes its emitted `?v`.
 *   - DEV: emits NO `?v` and serves `no-cache`; the dev SSR HTML is
 *     byte-identical to before this feature.
 *   - basePath composes: `<basePath>/app/foo.js?v=hash` serves immutable.
 *
 * Module-state note: the importmap base path AND the asset-hash roots are
 * process-global (set at each handler's boot, like setCoreInstall). node:test
 * runs a file's tests serially, so a handler's requests always see its own
 * boot state.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_SRC = resolve(__dirname, '../../../core/src');
const HTML_URL = pathToFileURL(join(CORE_SRC, 'html.js')).toString();
const COMPONENT_URL = pathToFileURL(join(CORE_SRC, 'component.js')).toString();

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-conthash-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

function makeApp({ basePath, elide } = {}) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  const webjs = (basePath != null || elide != null)
    ? { ...(basePath != null ? { basePath } : {}), ...(elide != null ? { elide } : {}) }
    : undefined;
  const files = {
    'package.json': JSON.stringify({ name: 'fixture', type: 'module', webjs }),
    'app/layout.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default ({ children }) => html\`<main>\${children}</main>\`;\n`,
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `import './widget.js';\n` +
      `export default () => html\`<x-widget></x-widget>\`;\n`,
    // An interactive component (a @click handler) so it is NOT elided and ships
    // a module the boot path imports + a modulepreload hint.
    'app/widget.js':
      `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export class XWidget extends WebComponent {\n` +
      `  render() { return html\`<button @click=\${() => 1}>hi</button>\`; }\n` +
      `}\n` +
      `XWidget.register('x-widget');\n`,
  };
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

function importmapTargets(html) {
  const m = html.match(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  return Object.values(JSON.parse(m[1]).imports || {});
}
function modulepreloadHrefs(html) {
  return [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((m) => m[1]);
}
function bootImportSpecifiers(html) {
  const m = html.match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  return [...m[1].matchAll(/import\s+"([^"]+)";/g)].map((x) => x[1]);
}

/* ---------------- PROD fingerprinting: emit + resolve + immutable ---------------- */

test('PROD: same-origin emitted urls carry ?v and serve immutable; ?v-less is the 1h fallback', async () => {
  const appDir = makeApp({});
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const res = await app.handle(new Request('http://x/'));
  assert.equal(res.status, 200);
  const html = await res.text();

  const targets = importmapTargets(html);
  const preloads = modulepreloadHrefs(html);
  const boot = bootImportSpecifiers(html);
  assert.ok(targets.length && preloads.length && boot.length, 'urls emitted');

  // Every SAME-ORIGIN module url carries ?v (a bare /__webjs/core/... target).
  // Prefix-only importmap entries (target ends in `/`, a directory mapping) are
  // not a fetchable file and carry no ?v.
  const sameOriginFiles = [...targets, ...preloads, ...boot].filter(
    (u) => u.startsWith('/') && !u.endsWith('/'),
  );
  assert.ok(sameOriginFiles.length, 'there are same-origin file urls');
  for (const u of sameOriginFiles) {
    assert.match(u, /\?v=[0-9a-f]{6,}$/, `same-origin url is fingerprinted: ${u}`);
  }

  // GET each fingerprinted url -> 200 + immutable 1-year cache.
  for (const u of new Set(sameOriginFiles)) {
    const r = await app.handle(new Request('http://x' + u));
    assert.equal(r.status, 200, `fingerprinted url resolves: ${u}`);
    assert.equal(
      r.headers.get('cache-control'),
      'public, max-age=31536000, immutable',
      `fingerprinted url is immutable: ${u}`,
    );
  }

  // The SAME url WITHOUT ?v -> the 1h fallback (still 200, but not immutable).
  for (const u of new Set(sameOriginFiles)) {
    const bare = u.replace(/\?v=[0-9a-f]+$/, '');
    const r = await app.handle(new Request('http://x' + bare));
    assert.equal(r.status, 200, `un-fingerprinted url still resolves: ${bare}`);
    assert.equal(
      r.headers.get('cache-control'),
      'public, max-age=3600',
      `un-fingerprinted url keeps the 1h fallback: ${bare}`,
    );
  }
});

test('PROD: a /public/* asset is fingerprinted + served immutable when ?v is present', async () => {
  const appDir = makeApp({});
  mkdirSync(join(appDir, 'public'), { recursive: true });
  writeFileSync(join(appDir, 'public', 'logo.svg'), '<svg></svg>');
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const withV = await app.handle(new Request('http://x/public/logo.svg?v=abc123'));
  assert.equal(withV.status, 200);
  assert.equal(withV.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const noV = await app.handle(new Request('http://x/public/logo.svg'));
  assert.equal(noV.status, 200);
  assert.equal(noV.headers.get('cache-control'), 'public, max-age=3600');
});

/* ---------------- deploy-busts regression ---------------- */

test('DEPLOY-BUSTS: changing a module byte changes its emitted ?v', async () => {
  const appDir = makeApp({});
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const before = modulepreloadHrefs(await (await app.handle(new Request('http://x/'))).text())
    .find((u) => u.includes('/app/widget.js'));
  assert.ok(before, 'widget.js is a modulepreload href');
  const vBefore = (before.match(/\?v=([0-9a-f]+)/) || [])[1];
  assert.ok(vBefore, 'widget.js carries a ?v');

  // A deploy ships different bytes at the same url; rebuild() re-hashes.
  writeFileSync(
    join(appDir, 'app', 'widget.js'),
    `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export class XWidget extends WebComponent {\n` +
    `  render() { return html\`<button @click=\${() => 999}>changed</button>\`; }\n` +
    `}\n` +
    `XWidget.register('x-widget');\n`,
  );
  await app.rebuild();

  const after = modulepreloadHrefs(await (await app.handle(new Request('http://x/'))).text())
    .find((u) => u.includes('/app/widget.js'));
  const vAfter = (after.match(/\?v=([0-9a-f]+)/) || [])[1];
  assert.ok(vAfter, 'widget.js still carries a ?v after the change');
  assert.notEqual(vAfter, vBefore, 'the ?v changed with the bytes (no stale-immutable)');
});

/* ---------------- DEV is unchanged ---------------- */

test('DEV: no ?v is emitted and modules serve no-cache (byte-identical to before)', async () => {
  const appDir = makeApp({});
  const app = await createRequestHandler({ appDir, dev: true });
  await app.warmup();

  const html = await (await app.handle(new Request('http://x/'))).text();
  const all = [...importmapTargets(html), ...modulepreloadHrefs(html), ...bootImportSpecifiers(html)];
  for (const u of all) {
    assert.ok(!u.includes('?v='), `dev emits no ?v: ${u}`);
  }

  // A dev module serve is no-cache (page.js is a boot specifier; widget.js
  // rides a modulepreload). Pick any same-origin app module url emitted.
  const appModule = [...bootImportSpecifiers(html), ...modulepreloadHrefs(html)]
    .find((u) => u.startsWith('/app/'));
  assert.ok(appModule, 'an app module url is emitted');
  const r = await app.handle(new Request('http://x' + appModule));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
});

test('DEV vs PROD HTML differs ONLY by the ?v query (dev is the un-fingerprinted form)', async () => {
  // Two apps, identical source. The dev body, with any ?v stripped, must equal
  // the prod body with any ?v stripped (modulo the per-deploy build-id /
  // tmpdir-name noise the base-path test also normalizes). This proves
  // fingerprinting is purely additive and the inert (dev) path is unchanged.
  const devApp = makeApp({});
  const devH = await createRequestHandler({ appDir: devApp, dev: true });
  await devH.warmup();
  const devHtml = await (await devH.handle(new Request('http://x/'))).text();

  const prodApp = makeApp({});
  const prodH = await createRequestHandler({ appDir: prodApp, dev: false });
  await prodH.warmup();
  const prodHtml = await (await prodH.handle(new Request('http://x/'))).text();

  const norm = (s) => s
    .replace(/\?v=[0-9a-f]+/g, '')                 // strip fingerprints
    .replace(/app-[^/"]+/g, 'APP')                 // tmpdir app-dir name
    .replace(/data-webjs-build="[^"]*"/g, 'BUILD') // per-deploy build id
    .replace(/ ?data-webjs-src="[^"]*"/g, 'SRC') // app-source deploy signal (#899)
    .replace(/"NODE_ENV":"(development|production)"/g, '"NODE_ENV":"ENV"') // dev vs prod env shim
    .replace(/<script type="module"[^>]*src="[^"]*reload[^"]*"[^>]*><\/script>/g, '') // dev-only reload script
    // #1309: in DEV the seed block is emitted even when the collector is empty,
    // carrying only the `data-webjs-dev` marker, which is the sole dev signal
    // the browser gets (a NODE_ENV gate is a compile-time constant in the built
    // core bundle). Prod emits nothing for an empty collector, so this is a
    // dev-only artifact in the same class as the reload script above.
    .replace(/<script type="application\/json" id="__webjs-seeds" data-webjs-dev="[^"]*">\{\}<\/script>/g, '');

  assert.equal(norm(devHtml), norm(prodHtml), 'dev and prod bodies match once the ?v is stripped');
});

/* ---------------- elision-verdict flip busts the importer's ?v ---------------- */

test('ELISION-FLIP: a display-only -> interactive flip is reflected in the boot set (#605)', async () => {
  // page.js imports an always-interactive component AND a `flip` component that
  // starts DISPLAY-ONLY (elided). Since the page's only client work is importing
  // components, it is import-only (#605): the page module is dropped and its
  // SHIPPING components are emitted directly in the boot. When `flip` becomes
  // interactive the boot set GAINS flip.js. Because that boot script rides the
  // fresh (never-immutable) HTML, a returning client always picks up the new set,
  // so the older importer-?v staleness concern is structurally moot once the page
  // module is no longer a boot specifier.
  const appDir = mkdtempSync(join(tmpRoot, 'elide-'));
  const files = {
    'package.json': JSON.stringify({ name: 'fx', type: 'module' }),
    'app/layout.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export default ({ children }) => html\`<main>\${children}</main>\`;\n`,
    'app/page.js':
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `import './always.js';\n` +
      `import './flip.js';\n` +
      `export default () => html\`<x-always></x-always><x-flip></x-flip>\`;\n`,
    'app/always.js':
      `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export class XAlways extends WebComponent {\n` +
      `  render() { return html\`<button @click=\${() => 1}>a</button>\`; }\n` +
      `}\nXAlways.register('x-always');\n`,
    // DISPLAY-ONLY: no @click / signal / lifecycle, so it is elided.
    'app/flip.js':
      `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
      `import { html } from ${JSON.stringify(HTML_URL)};\n` +
      `export class XFlip extends WebComponent {\n` +
      `  render() { return html\`<span>display</span>\`; }\n` +
      `}\nXFlip.register('x-flip');\n`,
  };
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }

  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const bootPaths = async () => {
    const html = await (await app.handle(new Request('http://x/'))).text();
    return new Set(
      [...bootImportSpecifiers(html), ...modulepreloadHrefs(html)].map((u) => u.split('?')[0]),
    );
  };
  const before = await bootPaths();
  assert.ok(before.has('/app/always.js'), 'the always-interactive component is in the boot');
  assert.ok(!before.has('/app/flip.js'), 'the display-only component is elided from the boot');
  assert.ok(!before.has('/app/page.js'), 'the import-only page module is not a boot specifier');

  // Flip x-flip to interactive WITHOUT touching page.js's bytes.
  writeFileSync(
    join(appDir, 'app', 'flip.js'),
    `import { WebComponent } from ${JSON.stringify(COMPONENT_URL)};\n` +
    `import { html } from ${JSON.stringify(HTML_URL)};\n` +
    `export class XFlip extends WebComponent {\n` +
    `  render() { return html\`<button @click=\${() => 2}>now interactive</button>\`; }\n` +
    `}\nXFlip.register('x-flip');\n`,
  );
  await app.rebuild();

  const after = await bootPaths();
  assert.ok(
    after.has('/app/flip.js'),
    'the now-interactive component appears in the boot after the flip (the verdict change is reflected)',
  );
  assert.ok(after.has('/app/always.js'), 'the always-interactive component is still in the boot');
});

/* ---------------- 103 Early Hints preload the SAME fingerprinted url ---------------- */

test('EARLY-HINTS: routeFor() module urls match the body fingerprinted urls (no double-fetch)', async () => {
  const appDir = makeApp({});
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const html = await (await app.handle(new Request('http://x/'))).text();
  const bodyUrls = new Set([
    ...bootImportSpecifiers(html),
    ...modulepreloadHrefs(html),
    ...importmapTargets(html),
  ]);

  const pathOf = (u) => u.split('?')[0];
  const bodyByPath = new Map([...bodyUrls].map((u) => [pathOf(u), u]));

  const route = app.routeFor('/');
  assert.ok(route && route.moduleUrls.length, 'routeFor yields module urls');
  let shared = 0;
  for (const u of route.moduleUrls) {
    // Every Early-Hint url is fingerprinted (the prod default; never a bare url
    // that would warm a different cache entry than the body fetches).
    assert.match(u, /\?v=[0-9a-f]{6,}$/, `Early-Hint url is fingerprinted: ${u}`);
    // For a module the body ALSO emits (page.js here; an inert layout is elided
    // from the boot and legitimately absent, a pre-existing routeFor difference
    // out of #243 scope), the FULL url including ?v must match, so the 103 hint
    // warms exactly the url the body requests (no double-fetch).
    const bodyUrl = bodyByPath.get(pathOf(u));
    if (bodyUrl) {
      shared++;
      assert.equal(u, bodyUrl, `Early-Hint ?v matches the body ?v for ${pathOf(u)}`);
    }
  }
  assert.ok(shared > 0, 'at least one Early-Hint url (page.js) is shared with the body and parity-checked');
});

/* ---------------- nested relative imports carry the matching ?v (#369) ---------------- */

test('NESTED-IMPORTS: a served module versions its relative imports to the preload ?v (one cache key, no double fetch)', async () => {
  // page.js does `import './widget.js'`. The browser resolves that relative
  // specifier against page.js's own (?v-versioned) URL, and a ?v is NOT
  // inherited across that resolution. Before the #369 fix the served body kept
  // the bare specifier, so the browser fetched `/app/widget.js` (a different
  // cache key from the `/app/widget.js?v=hash` modulepreload) -> wasted preload,
  // double download, 1h cache instead of immutable. The fix rewrites the served
  // specifier to carry widget.js's own ?v, collapsing both onto one URL.
  //
  // This exercises relative-import versioning (#369) on a page that is a BOOT
  // specifier. With elision on, a page whose only client work is importing a
  // component is import-only (#605) and the component, not the page, is the boot
  // module; elision is disabled here to keep the page in the boot and isolate the
  // #369 mechanism, which runs on any served module regardless of elision.
  const appDir = makeApp({ elide: false });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const html = await (await app.handle(new Request('http://x/'))).text();

  // The ?v the modulepreload + boot path advertise for widget.js.
  const widgetPreload = modulepreloadHrefs(html).find((u) => u.includes('/app/widget.js'));
  assert.ok(widgetPreload, 'widget.js has a modulepreload href');
  assert.match(widgetPreload, /^\/app\/widget\.js\?v=[0-9a-f]{6,}$/);

  // Fetch the SERVED page.js body (via its versioned boot specifier).
  const pageUrl = bootImportSpecifiers(html).find((u) => u.startsWith('/app/page.js'));
  assert.ok(pageUrl, 'page.js is a boot specifier');
  const pageRes = await app.handle(new Request('http://x' + pageUrl));
  assert.equal(pageRes.status, 200);
  const pageBody = await pageRes.text();

  // The served body's relative import now carries widget.js's ?v.
  const m = pageBody.match(/import\s+'\.\/widget\.js\?v=([0-9a-f]{6,})'/);
  assert.ok(m, `served page.js versions its './widget.js' import; body was:\n${pageBody}`);

  // Resolve the served specifier against page.js's URL the way the browser does:
  // it must land on EXACTLY the modulepreload href -> a single cache key.
  const resolved = new URL('./widget.js?v=' + m[1], 'http://x/app/page.js').pathname + '?v=' + m[1];
  assert.equal(resolved, widgetPreload, 'served import URL === preload href (deduped, one fetch)');

  // And that URL serves immutable (the headline cache win).
  const widgetRes = await app.handle(new Request('http://x' + widgetPreload));
  assert.equal(widgetRes.status, 200);
  assert.equal(widgetRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('NESTED-IMPORTS: DEV serves the bare relative specifier (no ?v), byte-identical to before', async () => {
  const appDir = makeApp({});
  const app = await createRequestHandler({ appDir, dev: true });
  await app.warmup();

  const pageRes = await app.handle(new Request('http://x/app/page.js'));
  assert.equal(pageRes.status, 200);
  const body = await pageRes.text();
  assert.match(body, /import\s+'\.\/widget\.js'/, 'dev keeps the bare specifier');
  assert.ok(!body.includes('widget.js?v='), 'dev appends no ?v to a nested import');
});

/* ---------------- basePath composes ---------------- */

test('basePath composes: <basePath>/app/widget.js?v=hash serves immutable', async () => {
  const appDir = makeApp({ basePath: '/app' });
  const app = await createRequestHandler({ appDir, dev: false });
  await app.warmup();

  const html = await (await app.handle(new Request('http://x/app/'))).text();
  const sameOrigin = [...importmapTargets(html), ...modulepreloadHrefs(html), ...bootImportSpecifiers(html)]
    .filter((u) => u.startsWith('/') && !u.endsWith('/'));
  assert.ok(sameOrigin.length);
  for (const u of sameOrigin) {
    assert.ok(u.startsWith('/app/'), `prefixed with basePath: ${u}`);
    assert.match(u, /\?v=[0-9a-f]{6,}$/, `AND fingerprinted: ${u}`);
    const r = await app.handle(new Request('http://x' + u));
    assert.equal(r.status, 200, `prefixed+fingerprinted url resolves: ${u}`);
    assert.equal(r.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  }
});
