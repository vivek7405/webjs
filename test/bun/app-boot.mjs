/**
 * Cross-runtime app boot-check for the in-repo apps whose routes CI would
 * not otherwise exercise: `website` (which serves the documentation at
 * /docs) and `packages/ui/packages/website` (ui-website). The
 * docs.webjs.dev redirect host is deliberately absent: every route on it
 * is an empty 301, which would pass this check vacuously.
 * All the in-repo apps DEPLOY on Bun in production (#541), but only
 * `examples/blog` had Bun coverage in CI (the blog-on-bun e2e), so a per-route
 * break that occurs only on Bun could reach production undetected. The #526
 * incident was exactly this: ui.webjs.dev served 500s on its component detail
 * pages because the prod start bypassed the registry copy, and Railway's
 * liveness-only healthcheck never probed an individual route.
 *
 * This runs under WHICHEVER runtime executes it (Bun in the CI `bun` job, and
 * Node via `scripts/run-bun-tests.js`): it runs each app's `webjs.start.before`
 * presteps (the ui-website registry copy + each app's Tailwind build, exactly
 * what `webjs start` runs), boots the app via `createRequestHandler({ dev:
 * false })`, GETs real routes (including a ui-website component detail page, the
 * #526 route class), and asserts status < 400 plus no broken same-origin
 * `modulepreload` hint (the #158 / #159 probe). Fails LOUD with a non-zero exit.
 *
 * It ALSO asserts each app serves the same stylesheet set on every probed route
 * (#1109). A page or non-root layout that renders its own `<style>` sits inside
 * the client router's swap boundary, so crossing between two such routes removes
 * one stylesheet and inserts another, and the CSSOM mutation invalidates style
 * for the whole document, repainting the layout the router preserved. The
 * website has its own dedicated suites for this (website/test/ssr/style-churn
 * and test/e2e/website-style-churn), but the ui-website ships no `webjs test`
 * suite (#627), so this is its only guard, and it is the app whose docs layout
 * #1109 just had to fix.
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

/** The apps + the real routes to probe. ui-website includes a component
 *  detail page (`/docs/components/[name]`), the exact route class that 500'd in
 *  #526 when the registry copy was skipped.
 *
 *  The website's list carries doc routes because the docs are served by it
 *  since #1098. The old `docs` app is gone from this list on purpose: it is a
 *  redirect-only host now, and every route on it answers 301 with an empty
 *  body, which passes the status check while probing zero preloads. Leaving it
 *  here would have looked like docs coverage while providing none. */
const APPS = [
  { name: 'website', dir: 'website', routes: ['/', '/docs/no-build', '/docs/components'] },
  { name: 'ui-website', dir: 'packages/ui/packages/website', routes: ['/', '/docs/components/button'] },
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

/**
 * Drop the contents of every declarative-shadow-root template.
 *
 * A `<style>` inside `<template shadowrootmode="...">` belongs to a shadow
 * tree, not the document. Inserting or removing it does NOT invalidate document
 * style (and on the client the component adopts it via adoptedStyleSheets), so
 * it is not churn and a shadow component legitimately carries one via
 * `static styles`. Counting them made a page with three shadow previews look
 * like it churned three stylesheets against a page with none.
 *
 * Balanced scan rather than a non-greedy regex, because a template can nest.
 */
function stripShadowTemplates(html) {
  const OPEN = /<template\b[^>]*\bshadowrootmode\b[^>]*>/gi;
  const TAG = /<template\b[^>]*>|<\/template\s*>/gi;
  let out = '';
  let last = 0;
  let m;
  while ((m = OPEN.exec(html))) {
    if (m.index < last) continue;
    out += html.slice(last, m.index);
    let depth = 1;
    let end = html.length;
    TAG.lastIndex = OPEN.lastIndex;
    let t;
    while (depth > 0 && (t = TAG.exec(html))) {
      depth += t[0][1] === '/' ? -1 : 1;
      end = TAG.lastIndex;
    }
    last = depth === 0 ? end : html.length;
    OPEN.lastIndex = last;
  }
  return out + html.slice(last);
}

let failed = false;
for (const app of APPS) {
  const appDir = resolve(REPO_ROOT, app.dir);
  /** The first probed route's stylesheet set, the churn baseline (#1109). */
  let sheetKey = null;
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
      // #1109: the stylesheet set must be identical on every route, so a
      // navigation between any two adds and removes nothing. Scripts and HTML
      // comments are scrubbed first, since a bracketed tag name inside either
      // pairs with the next real closing tag and reports a phantom element.
      const scrubbed = stripShadowTemplates(html)
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      const sheets = [];
      for (const m of scrubbed.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|<link\b([^>]*)>/gi)) {
        if (m[1] !== undefined) { sheets.push('STYLE:' + m[1]); continue; }
        const rel = /\brel\s*=\s*["']?([^"'>]*)/i.exec(m[2] || '')?.[1] || '';
        if (rel.toLowerCase().split(/\s+/).includes('stylesheet')) sheets.push('LINK:' + (m[2] || '').trim());
      }
      const key = sheets.join('\u0000');
      if (sheetKey === null) sheetKey = key;
      const churns = resp.status < 400 && key !== sheetKey;

      const ok = resp.status < 400 && broken.length === 0 && !churns;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${app.name} ${route} -> ${resp.status}, preloads=${preloads.length}, broken=[${broken.join(', ')}], sheets=${sheets.length}${churns ? ' CHURN: differs from ' + app.routes[0] : ''}`);
      if (churns) {
        console.error(`      a <style> or stylesheet <link> differs between ${app.routes[0]} and ${route}, so navigating`);
        console.error('      between them mutates the document CSSOM and repaints the preserved layout (#1109).');
        console.error('      Move static rules into the app stylesheet the ROOT layout links.');
      }
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
console.log(`OK  app boot-check passed on ${runtime} (website incl. /docs + ui-website serve real routes, no broken preloads, no stylesheet churn)`);
