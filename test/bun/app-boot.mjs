/**
 * Cross-runtime app boot-check for the routes CI would not otherwise
 * exercise. That is now one app, `website`, which serves the marketing pages,
 * the documentation at /docs (#1098), and the component gallery at /ui
 * (#1099). The docs.webjs.dev and ui.webjs.dev redirect hosts are deliberately
 * absent: every route on them is an empty 301, which would pass this check
 * vacuously.
 * All the in-repo apps DEPLOY on Bun in production (#541), but only
 * `examples/blog` had Bun coverage in CI (the blog-on-bun e2e), so a per-route
 * break that occurs only on Bun could reach production undetected. The #526
 * incident was exactly this: the component detail pages served 500s because
 * the prod start bypassed the registry copy, and Railway's liveness-only
 * healthcheck never probed an individual route.
 *
 * This runs under WHICHEVER runtime executes it (Bun in the CI `bun` job, and
 * Node via `scripts/run-bun-tests.js`): it runs each app's `webjs.start.before`
 * presteps (the registry copy + the Tailwind build, exactly what `webjs start`
 * runs), boots the app via `createRequestHandler({ dev: false })`, GETs real
 * routes (including a gallery component detail page, the #526 route class),
 * and asserts status < 400 plus no broken same-origin `modulepreload` hint
 * (the #158 / #159 probe). Fails LOUD with a non-zero exit.
 *
 * Left as-is: `examples/blog` already has its own Bun e2e (#523 / #525), so it
 * is not duplicated here.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

/** The apps + the real routes to probe.
 *
 *  Everything the project serves as HTML is now one app: the docs moved onto
 *  the website in #1098 and the component gallery in #1099. So the list is a
 *  single entry, and it carries a gallery component detail page (`/ui/button`),
 *  the exact route class that 500'd in #526 when the registry copy was skipped.
 *
 *  The old `docs` and `ui-website` apps used to be redirect-only hosts here.
 *  Both are Cloudflare redirect rules now, with no origin in this repo, so
 *  there is nothing left to boot for either. */
const APPS = [
  { name: 'website', dir: 'website', routes: ['/', '/docs/no-build', '/docs/components', '/ui', '/ui/button'] },
];

/** Run an app's `webjs.start.before` steps (registry copy, Tailwind build) the
 *  same way `webjs start` does, so the boot sees the assets a prod start bakes.
 *  These are Node-tooling steps (tailwindcss, the copy-registry script); the CI
 *  `bun` job has Node + `npm ci` available before it, and they run identically
 *  under a local Node invocation. */
function runStartBefore(appDir) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')); }
  catch { return; }
  const before = pkg?.webjs?.start?.before || [];
  for (const cmd of before) execSync(cmd, { cwd: appDir, stdio: 'inherit' });
}

let failed = false;
for (const app of APPS) {
  const appDir = resolve(REPO_ROOT, app.dir);
  try {
    runStartBefore(appDir);
    const h = await createRequestHandler({ appDir, dev: false });
    if (h.warmup) await h.warmup();
    for (const route of app.routes) {
      const resp = await h.handle(new Request('http://localhost' + route));
      const html = resp.status < 400 ? await resp.text() : '';
      // Every same-origin modulepreload hint must resolve through the SAME
      // in-process handler (a preload the auth gate then 404s is the #158/#159
      // bug class). Probe method-agnostic, so no GET-vs-HEAD trap.
      const preloads = [...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g)]
        .map((m) => m[1]).filter((href) => href.startsWith('/'));
      const broken = [];
      for (const p of preloads) {
        const pr = await h.handle(new Request('http://localhost' + p));
        if (pr.status >= 400) broken.push(`${p}->${pr.status}`);
      }
      const ok = resp.status < 400 && broken.length === 0;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${app.name} ${route} -> ${resp.status}, preloads=${preloads.length}, broken=[${broken.join(', ')}]`);
      if (!ok) failed = true;
    }
  } catch (e) {
    console.log(`FAIL ${app.name} boot threw: ${String(e && e.message ? e.message : e).split('\n')[0]}`);
    failed = true;
  }
}

if (failed) {
  console.error(`FAIL  app boot-check on ${runtime}`);
  process.exit(1);
}
console.log(`OK  app boot-check passed on ${runtime} (website incl. /docs + /ui serves real routes, no broken preloads)`);
