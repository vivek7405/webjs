/**
 * Integration tests for #1397: in DEV, `/public/*` is served BEFORE
 * `ensureReady()`.
 *
 * A static asset needs neither the module graph nor the vendor importmap, but
 * it used to be handled inside `handleCore`, which runs after the whole-app
 * analysis. On the website app a cold `/public/tailwind.css` measured 1907ms,
 * of which 1900ms was `ensureReady()`, which is why the stylesheet is the
 * request most exposed to the next `node --watch` restart and why a burst of
 * agent edits leaves the page unstyled.
 *
 * The hoist is DEV ONLY. In prod `/__webjs/ready` already holds traffic off a
 * cold instance, and hoisting there would silently un-gate a `/public/*` file
 * an app middleware protects.
 *
 * Assertions are on ORDER, not wall clock: the fixture's root middleware module
 * has a top-level await sleep, and `loadMiddleware` runs inside `ensureReady()`,
 * so the analysis is deterministically slow with no network involved.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequestHandler } from '../../src/dev.js';

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-publicearly-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

/**
 * @param {{ slowMiddleware?: boolean, regenerate?: boolean }} [opts]
 */
function makeApp(opts = {}) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  mkdirSync(join(appDir, 'app'), { recursive: true });
  mkdirSync(join(appDir, 'public'), { recursive: true });
  writeFileSync(join(appDir, 'public', 'a.css'), 'body{color:red}\n');
  writeFileSync(join(appDir, 'public', 'sw.js'), "self.addEventListener('install', () => {});\n");
  writeFileSync(join(appDir, 'public', 'offline.html'), '<!doctype html><title>offline</title>\n');
  writeFileSync(
    join(appDir, 'app', 'page.ts'),
    "import { html } from '@webjsdev/core';\nexport default function Page() { return html`<h1>hi</h1>`; }\n",
  );
  const pkg = { name: 'public-early-fixture', type: 'module' };
  if (opts.regenerate) {
    // #967: an on-request rebuild rule whose command rewrites the served output.
    pkg.webjs = {
      dev: {
        regenerate: [
          {
            output: 'public/gen.css',
            inputs: ['src/in.css'],
            command: `node -e "require('fs').writeFileSync('public/gen.css','body{color:lime}')"`,
          },
        ],
      },
    };
    mkdirSync(join(appDir, 'src'), { recursive: true });
    writeFileSync(join(appDir, 'src', 'in.css'), 'body{color:lime}\n');
    writeFileSync(join(appDir, 'public', 'gen.css'), '/* stale */\n');
    // Backdate the output so the input is newer, which is what makes it stale.
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(appDir, 'public', 'gen.css'), past, past);
  }
  writeFileSync(join(appDir, 'package.json'), JSON.stringify(pkg, null, 2));
  if (opts.slowMiddleware) {
    // Top-level await, so the module does not finish evaluating (and therefore
    // `loadMiddleware`, and therefore `ensureReady()`, does not resolve) until
    // the sleep elapses. It also tags every response it DOES run for, which is
    // how the dev/prod gating is asserted below.
    writeFileSync(
      join(appDir, 'middleware.ts'),
      'await new Promise((r) => setTimeout(r, 500));\n'
      + 'export default async function middleware(req: Request, next: () => Promise<Response>) {\n'
      + '  const res = await next();\n'
      + "  res.headers.set('x-mw', '1');\n"
      + '  return res;\n'
      + '}\n',
    );
  }
  return appDir;
}

// COUNTERFACTUAL: revert the dev-only `tryServePublicAsset` call ahead of
// `await ensureReady()` in dev.js and the order becomes ['warm', 'public'].
test('dev serves /public/* before the analysis completes', async () => {
  const app = await createRequestHandler({ appDir: makeApp({ slowMiddleware: true }), dev: true });
  /** @type {string[]} */
  const order = [];
  const publicP = app.handle(new Request('http://x/public/a.css')).then((r) => { order.push('public'); return r; });
  const warmP = app.warmup().then(() => { order.push('warm'); });
  const [res] = await Promise.all([publicP, warmP]);
  assert.deepEqual(order, ['public', 'warm'], 'the CSS lands before the analysis finishes');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'body{color:red}\n', 'and it is the real file');
});

// Pins the settled dev-only gating in BOTH directions. The dev bypass is a
// deliberate, documented trade (the same one the framework statics already make
// in both modes); silently extending it to prod would un-gate a protected asset.
test('root middleware does not run for /public/* in dev, and does in prod', async () => {
  const devApp = await createRequestHandler({ appDir: makeApp({ slowMiddleware: true }), dev: true });
  const devRes = await devApp.handle(new Request('http://x/public/a.css'));
  assert.equal(devRes.status, 200);
  assert.equal(devRes.headers.get('x-mw'), null, 'dev takes the early path, ahead of middleware');

  const prodApp = await createRequestHandler({ appDir: makeApp({ slowMiddleware: true }), dev: false });
  const prodRes = await prodApp.handle(new Request('http://x/public/a.css'));
  assert.equal(prodRes.status, 200);
  assert.equal(prodRes.headers.get('x-mw'), '1', 'prod still runs root middleware for a public asset');
});

// COUNTERFACTUAL: drop the containment check from `tryServePublicAsset` and this
// serves the file, which is a directory-traversal hole.
test('the traversal guard travels with the moved code (dev early path)', async () => {
  const appDir = makeApp();
  writeFileSync(join(appDir, 'secret.txt'), 'nope\n');
  const app = await createRequestHandler({ appDir, dev: true });
  const res = await app.handle(new Request('http://x/public/%2E%2E/secret.txt'));
  assert.equal(res.status, 404, 'a path that escapes appDir/public/ is refused');
  assert.notEqual(await res.text(), 'nope\n');
});

// The `return null` contract: a missing public asset is NOT a short-circuit, so
// it 404s through normal routing exactly as it did before the extraction.
test('a missing /public/* file still falls through to normal routing', async () => {
  const app = await createRequestHandler({ appDir: makeApp(), dev: true });
  const res = await app.handle(new Request('http://x/public/nope.png'));
  assert.equal(res.status, 404);
});

// #830, re-asserted here because the code moved to a shared function.
test('/sw.js and /offline.html still serve at the root through the early path', async () => {
  const app = await createRequestHandler({ appDir: makeApp(), dev: true });
  const sw = await app.handle(new Request('http://x/sw.js'));
  assert.equal(sw.status, 200);
  assert.equal(sw.headers.get('service-worker-allowed'), '/', 'still opts into the root scope');
  const offline = await app.handle(new Request('http://x/offline.html'));
  assert.equal(offline.status, 200);
  assert.match(await offline.text(), /offline/);
});

// #967 still holds ahead of ensureReady: a stale regenerate output is rebuilt
// before it is served, on the early path too.
test('a stale webjs.dev.regenerate output is rebuilt before serving on the early path', async () => {
  const app = await createRequestHandler({ appDir: makeApp({ regenerate: true }), dev: true });
  const res = await app.handle(new Request('http://x/public/gen.css'));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'body{color:lime}', 'the stale output was regenerated, not served as-is');
});

// #243: the `?v=` fingerprint still decides the cache header on the early path.
test('?v= still yields immutable on the early path, un-versioned keeps the 1h fallback', async () => {
  const app = await createRequestHandler({ appDir: makeApp(), dev: false });
  const versioned = await app.handle(new Request('http://x/public/a.css?v=abc123'));
  assert.match(versioned.headers.get('cache-control') || '', /immutable/, 'content-addressed is immutable');
  const plain = await app.handle(new Request('http://x/public/a.css'));
  assert.doesNotMatch(plain.headers.get('cache-control') || '', /immutable/, 'un-fingerprinted is not');
});
