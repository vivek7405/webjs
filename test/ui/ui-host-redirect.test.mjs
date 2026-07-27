/**
 * ui.webjs.dev stays alive as a redirect-only host (#1099).
 *
 * The gallery moved to webjs.dev/ui, but this host can never be retired, and
 * the reason is stronger here than it was for the docs host. `/registry/*` is
 * a LIVE API: every already-published @webjsdev/ui and @webjsdev/cli fetches
 * component sources from `https://ui.webjs.dev/registry/<name>.json` when a
 * user runs `webjs ui add`, and a published version cannot be corrected after
 * the fact. If these URLs stop resolving, a documented command breaks for
 * everyone on an older install, permanently.
 *
 * A 301 is safe because shipped clients follow it (fetch does by default,
 * verified against the real 0.3.1 and 0.3.8 tarballs before the move), so
 * these tests pin the MAPPING rather than the mere presence of a redirect. A
 * redirect that resolves to the wrong path is the failure mode that looks
 * healthy from the outside.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

let handle;

before(async () => {
  const app = await createRequestHandler({
    appDir: resolve(ROOT, 'packages/ui/packages/website'),
    dev: false,
  });
  await app.warmup?.();
  handle = (path) => app.handle(new Request('http://localhost' + path));
});

test('the registry API keeps its exact URL shape, just moved under /ui', async () => {
  // THE critical assertion of this file. These are the paths burned into
  // published npm packages. Each must land on the endpoint that answers it,
  // including the two reserved slugs (`index`, `registry`) the CLI relies on.
  const cases = [
    ['/registry', 'https://webjs.dev/ui/registry'],
    ['/registry/index.json', 'https://webjs.dev/ui/registry/index.json'],
    ['/registry/button.json', 'https://webjs.dev/ui/registry/button.json'],
    ['/registry/alert-dialog.json', 'https://webjs.dev/ui/registry/alert-dialog.json'],
    ['/registry/theme-zinc.json', 'https://webjs.dev/ui/registry/theme-zinc.json'],
    ['/registry/registry.json', 'https://webjs.dev/ui/registry/registry.json'],
  ];
  for (const [from, to] of cases) {
    const res = await handle(from);
    assert.equal(res.status, 301, `${from} is a permanent redirect`);
    assert.equal(res.headers.get('location'), to, `${from} maps to ${to}`);
  }
});

test('the registry redirect carries CORS, so a browser consumer can follow it', async () => {
  // The registry is fetched cross-origin by tooling. A redirect a browser
  // context cannot follow is as good as a dead endpoint, and the 200 it
  // replaces did send this header.
  const res = await handle('/registry/button.json');
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});

test('an asset URL keeps its path instead of moving under /ui', async () => {
  // The deleted root layout published /public/og.png as its og:image and the
  // favicons alongside it, so every social card already scraped from this host
  // points at those URLs. The marketing site serves the same filenames at the
  // same paths, so they must NOT pick up the /ui prefix the pages do: that
  // would resolve a live image to a 404 and blank every cached card.
  for (const path of [
    '/public/og.png',
    '/public/favicon-192.png',
    '/public/favicon.svg',
    '/public/apple-touch-icon.png',
    '/favicon.ico',
  ]) {
    const res = await handle(path);
    assert.equal(res.status, 301, `${path} redirects`);
    assert.equal(res.headers.get('location'), `https://webjs.dev${path}`, `${path} keeps its path`);
  }
});

test('a component page maps to its new flat path', async () => {
  // The old site nested components under /docs/components/<name>; the new one
  // serves them at /ui/<name>. A path-preserving redirect would have sent
  // every existing link to /ui/docs/components/<name>, which 404s.
  for (const name of ['button', 'alert-dialog', 'native-select']) {
    const res = await handle(`/docs/components/${name}`);
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), `https://webjs.dev/ui/${name}`);
  }
});

test('a trailing slash on a component page maps the same way', async () => {
  const res = await handle('/docs/components/button/');
  assert.equal(res.headers.get('location'), 'https://webjs.dev/ui/button');
});

test('both old human entry points collapse onto the gallery', async () => {
  // The old host had a marketing landing page at / and docs at /docs. The new
  // one has neither: /ui IS the gallery, opening on the introduction.
  for (const path of ['/', '/docs', '/docs/']) {
    const res = await handle(path);
    assert.equal(res.status, 301, `${path} redirects`);
    assert.equal(res.headers.get('location'), 'https://webjs.dev/ui', `${path} lands on the gallery`);
  }
});

test('the redirect is permanent, so ranking signal transfers', async () => {
  const res = await handle('/docs/components/button');
  assert.equal(res.status, 301, 'a 302 would keep the signal on the dead host');
});

test('a query string survives the redirect', async () => {
  const res = await handle('/docs/components/button?utm_source=x');
  assert.equal(res.headers.get('location'), 'https://webjs.dev/ui/button?utm_source=x');
});

test('an unknown path still redirects rather than 404ing', async () => {
  const res = await handle('/whatever/old/path');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), 'https://webjs.dev/ui/whatever/old/path');
});

test('the readiness probe is answered locally, so deploys can still gate on it', async () => {
  // Redirecting /__webjs/ready would fail every healthcheck and the service
  // would never come up, which is the one way to actually break this host.
  const res = await handle('/__webjs/ready');
  assert.ok(res.status < 300, `expected a local 2xx, got ${res.status}`);
});

test('the rest of the /__webjs namespace is left to the framework, not answered here', async () => {
  const res = await handle('/__webjs/core/index-browser.js');
  assert.notEqual(res.status, 301, 'framework paths are not redirected');
});
