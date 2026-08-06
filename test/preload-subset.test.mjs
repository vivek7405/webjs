/**
 * Preload-subset invariant, integration layer (issue #182).
 *
 * Every `<link rel="modulepreload">` hint the SSR pipeline emits MUST be a
 * SUBSET of the servable set: the browser will fetch each preload eagerly,
 * so a hint pointing at a non-servable file (a server-only module reached
 * through a `.server.*`, a phantom path, anything the auth gate 404s) is a
 * real bug shipped to users (the #158 / #159 class). The blog gained a
 * browser-level probe in #176; this generalises it to every in-repo app
 * through the in-process handler, so a regression in any of them is caught
 * without a browser.
 *
 * Each representative route is GET, every emitted same-origin modulepreload
 * href is probed through the SAME handler with GET (the dev/prod server only
 * serves source on GET), and any href that 404s fails the test. The
 * counterfactual proves the probe actually catches a bad preload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '@webjsdev/server';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// One handler per app, representative routes that render a real page (a 307
// redirect has no body to probe and is treated as a pass). Routes here are
// known to serve 200 in prod mode.
// The blog routes are deliberately DB-independent (`/about` and the inert
// `/static-info`), since the unit/integration CI job does not migrate the
// blog's Drizzle DB, so `/` calls listPosts() and would 500 there. Both still
// emit the layout's modulepreloads, which is what this test probes.
const APPS = [
  { name: 'blog', dir: 'examples/blog', routes: ['/about', '/static-info'] },
  // The docs (#1098) and the component gallery (#1099) are both served by the
  // website app, so their routes are probed as part of it.
  //
  // /ui/button is the gallery's heaviest page: it is the one that pulls the
  // mirrored kit component sources, which is exactly the class of import a
  // broken preload would show up in.
  { name: 'website', dir: 'website', routes: ['/', '/docs/architecture', '/docs/components', '/ui', '/ui/button'] },
];

const PRELOAD_RE = /<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g;

/** Same-origin (root-relative) modulepreload hrefs emitted in `html`. */
function preloadHrefs(html) {
  return [...html.matchAll(PRELOAD_RE)].map((m) => m[1]).filter((h) => h.startsWith('/'));
}

/** Probe each preload href through `handle` (GET); return the broken ones. */
async function brokenPreloads(handle, hrefs) {
  const broken = [];
  for (const href of hrefs) {
    const r = await handle(new Request('http://localhost' + href));
    if (r.status >= 400) broken.push(`${href} -> ${r.status}`);
  }
  return broken;
}

for (const app of APPS) {
  test(`every modulepreload resolves through the handler: ${app.name}`, async () => {
    const h = await createRequestHandler({ appDir: resolve(ROOT, app.dir), dev: false });
    if (h.warmup) await h.warmup();

    let probedAnyRoute = false;
    for (const route of app.routes) {
      const resp = await h.handle(new Request('http://localhost' + route));
      if (resp.status >= 300 && resp.status < 400) continue; // redirect: no body
      assert.ok(resp.status < 400, `${app.name} ${route} should render (got ${resp.status})`);
      const html = await resp.text();
      const hrefs = preloadHrefs(html);
      assert.ok(hrefs.length > 0, `${app.name} ${route} should emit at least one modulepreload to probe`);
      const broken = await brokenPreloads(h.handle, hrefs);
      assert.equal(broken.length, 0,
        `${app.name} ${route}: no modulepreload may 404 (preload must be a subset of servable):\n${broken.join('\n')}`);
      probedAnyRoute = true;
    }
    assert.ok(probedAnyRoute, `${app.name}: at least one route should have been probed`);
  });
}

test('counterfactual: the probe catches a preload pointing outside the servable set', async () => {
  // Render a real page, then inject a bogus modulepreload at a path the auth
  // gate refuses to serve (package.json is never servable). The same probe
  // must flag it, proving the per-app tests above are not passing vacuously.
  const h = await createRequestHandler({ appDir: resolve(ROOT, 'examples/blog'), dev: false });
  if (h.warmup) await h.warmup();
  const html = await (await h.handle(new Request('http://localhost/about'))).text();
  const tampered = html.replace('</head>',
    '<link rel="modulepreload" href="/package.json"></head>');

  const hrefs = preloadHrefs(tampered);
  assert.ok(hrefs.includes('/package.json'), 'precondition: the bogus preload is present');
  const broken = await brokenPreloads(h.handle, hrefs);
  assert.ok(broken.some((b) => b.startsWith('/package.json ->')),
    `the probe must flag the non-servable preload; broken=${JSON.stringify(broken)}`);
});
