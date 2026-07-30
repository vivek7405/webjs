/**
 * End-to-end serving test for the `asset()` helper (#1194).
 *
 * The unit tests for `resolveAssetUrl` prove the resolver. This proves the
 * WIRING: that a real prod handler installs the provider at boot, that a
 * layout calling `asset()` therefore renders a fingerprinted url, and that
 * requesting that url gets `immutable` caching back. Without this, the two
 * halves could each be correct while nothing connected them, which is exactly
 * the failure mode a manual browser check kept hiding (a worktree resolves
 * `@webjsdev/*` through node_modules, so a hand-booted server can silently be
 * running a DIFFERENT checkout's code).
 *
 * `dev: false` matters: fingerprinting is prod-only, so a dev handler must
 * leave the url untouched, which the second test pins.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';

// The fixture app's own source does `import { asset } from '@webjsdev/core'`,
// and a temp dir outside the monorepo cannot resolve that. Link the repo's
// node_modules into each fixture so the app resolves the SAME core this test
// is exercising, rather than whatever a parent directory happens to expose.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const REPO_MODULES = join(REPO_ROOT, 'node_modules');

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-asset-serve-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  if (existsSync(REPO_MODULES)) symlinkSync(REPO_MODULES, join(appDir, 'node_modules'), 'dir');
  return appDir;
}

const FILES = {
  // A layout that marks one asset and leaves a second one bare, so the same
  // render proves both that marking works and that nothing else is touched.
  'app/layout.ts': `
import { html, asset } from '@webjsdev/core';
export default ({ children }) => html\`<!doctype html><html><head>
<link rel="stylesheet" href=\${asset('/public/app.css')}>
<link rel="preload" href="/public/app.css" as="style">
</head><body>\${children}</body></html>\`;
`,
  'app/page.ts': `import { html } from '@webjsdev/core';\nexport default () => html\`<main>hi</main>\`;`,
  'public/app.css': 'body{color:red}',
  'package.json': JSON.stringify({ name: 'asset-serve' }),
};

test('a prod handler renders asset() fingerprinted and serves it immutable', async () => {
  const appDir = makeApp(FILES);
  const app = await createRequestHandler({ appDir, dev: false });

  const page = await app.handle(new Request('http://x/'));
  assert.equal(page.status, 200);
  const html = await page.text();

  const m = html.match(/<link rel="stylesheet" href="(\/public\/app\.css\?v=[0-9a-f]+)"/);
  assert.ok(m, `the marked url should carry ?v=, got:\n${html.slice(0, 400)}`);

  // The UNMARKED preload is untouched. This is the property the previous
  // design (#1196) could not hold: it rewrote every asset-looking url in the
  // document, which desynced font preloads from the `@font-face url()` that
  // actually fetches them. Opt-in means the author decides per url.
  assert.match(html, /<link rel="preload" href="\/public\/app\.css" as="style">/);

  // And the emitted url is really servable, with the caching that is the
  // whole point: a hashed url is immutable for a year, a bare one is not.
  const hashed = await app.handle(new Request(`http://x${m[1]}`));
  assert.equal(hashed.status, 200);
  assert.match(hashed.headers.get('cache-control') || '', /immutable/);

  const bare = await app.handle(new Request('http://x/public/app.css'));
  assert.equal(bare.status, 200);
  assert.doesNotMatch(bare.headers.get('cache-control') || '', /immutable/);
});

test('a dev handler leaves asset() urls untouched', async () => {
  // Fingerprinting is prod-only so dev output stays byte-identical, and a
  // dev server never installs the resolver.
  const appDir = makeApp(FILES);
  const app = await createRequestHandler({ appDir, dev: true });
  const html = await (await app.handle(new Request('http://x/'))).text();
  assert.match(html, /<link rel="stylesheet" href="\/public\/app\.css">/);
  assert.doesNotMatch(html, /\?v=/);
});
