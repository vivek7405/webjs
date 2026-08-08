/**
 * Guards for the site-wide SEO plumbing (#1088).
 *
 * These are the defects an audit of the live site turned up, each of which was
 * invisible from the app itself and only observable in a SERP:
 *
 *  - the favicon was declared `sizes="32x32"` while the real asset is 512x512.
 *    Google requires a square favicon that is a MULTIPLE OF 48px, so the
 *    declared size put it under the floor and webjs.dev showed no icon in
 *    search results at all.
 *  - `/favicon.ico` 404'd at the origin root, so the universal fallback that
 *    crawlers try before reading any markup was missing.
 *  - NO page on the site emitted `<link rel="canonical">`, so query-string and
 *    trailing-slash variants of every URL split their ranking signals.
 *  - robots.txt left the AI answer engines to the wildcard, which is the
 *    surface where developers increasingly ask what a framework is.
 *
 * Each assertion is written against the observable output rather than the
 * implementation, so a future refactor that keeps the behaviour keeps passing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';
import RootLayout, { generateMetadata } from '#app/layout.ts';
import Robots from '#app/robots.ts';
import { layoutProps } from '#test/helpers/layout-props.ts';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Read a PNG's intrinsic dimensions straight out of the IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('the declared favicon size matches the real asset and clears Google 48px floor', async () => {
  const out = await renderToString(RootLayout(layoutProps(html`<main>x</main>`)));
  const match = out.match(/<link rel="icon" href="\/public\/([\w.-]+\.png)"[^>]*sizes="(\d+)x(\d+)"/);
  assert.ok(match, 'declares a PNG icon with an explicit sizes attribute');

  const [, file, declaredW, declaredH] = match!;
  const declared = Number(declaredW);
  const { width, height } = pngSize(resolve(WEBSITE_ROOT, 'public', file));

  assert.equal(declaredW, declaredH, 'declared as square');
  assert.equal(width, height, 'the favicon asset really is square');
  // The original bug: the markup claimed 32x32 for a 512x512 file.
  assert.equal(declared, width, 'the DECLARED size matches the real asset');
  // And the second half of the bug: 32 was under Google's floor. 512 would not
  // have satisfied the rule either, since 512 % 48 is 32.
  assert.equal(declared % 48, 0, 'the size is a multiple of 48px, which is what Google requires');
  assert.ok(declared >= 48, 'and clears the 48px minimum');
});

test('the apple-touch icon points at a correctly sized asset', async () => {
  const out = await renderToString(RootLayout(layoutProps(html`<main>x</main>`)));
  const match = out.match(/<link rel="apple-touch-icon" sizes="(\d+)x\d+" href="\/public\/([\w.-]+\.png)"/);
  assert.ok(match, 'declares an apple-touch-icon with a size');
  const { width } = pngSize(resolve(WEBSITE_ROOT, 'public', match![2]));
  assert.equal(Number(match![1]), width, 'the declared apple-touch size matches the real asset');
});

test('the raster icon is declared before the SVG', async () => {
  // Google's favicon crawler takes the first usable icon. The SVG led before,
  // and raster is the format search results reliably render.
  const out = await renderToString(RootLayout(layoutProps(html`<main>x</main>`)));
  const png = out.indexOf('type="image/png"');
  const svg = out.indexOf('href="/public/favicon.svg"');
  assert.ok(png > -1 && svg > -1, 'both icons are declared');
  assert.ok(png < svg, 'the PNG is declared ahead of the SVG');
});

test('favicon.ico exists so the origin-root fallback resolves', () => {
  // The framework maps a request for /favicon.ico onto public/favicon.ico
  // (packages/server/src/dev.js, the ROOT_ASSETS special case), so shipping the
  // file is what turns the live 404 into a 200.
  const ico = resolve(WEBSITE_ROOT, 'public', 'favicon.ico');
  const size = statSync(ico).size;
  assert.ok(size > 0, 'favicon.ico is a non-empty file');
  // An ICO directory entry stores 48 as the byte 48, and a 0 byte means 256.
  const buf = readFileSync(ico);
  assert.equal(buf.readUInt16LE(0), 0, 'valid ICO reserved field');
  assert.equal(buf.readUInt16LE(2), 1, 'valid ICO type field');
  const count = buf.readUInt16LE(4);
  const sizes = Array.from({ length: count }, (_, i) => buf[6 + i * 16] || 256);
  assert.ok(sizes.includes(48), 'bundles a 48x48 entry, the size Google wants');
});

test('the root layout gives every page a canonical URL', () => {
  const m = generateMetadata({ url: 'https://webjs.dev/why-webjs' });
  assert.equal(m.alternates.canonical, 'https://webjs.dev/why-webjs', 'canonical tracks the current path');
});

test('the canonical collapses query strings and trailing slashes', () => {
  // The counterfactual for the whole point of a canonical: three addresses for
  // one page must resolve to ONE canonical, or they split ranking signals.
  const variants = [
    'https://webjs.dev/why-webjs?utm_source=twitter&utm_campaign=launch',
    'https://webjs.dev/why-webjs/',
    'https://webjs.dev/why-webjs',
  ];
  const canonicals = variants.map((url) => generateMetadata({ url }).alternates.canonical);
  assert.deepEqual(new Set(canonicals), new Set(['https://webjs.dev/why-webjs']), 'all variants collapse to one canonical');
});

test('the home page canonical has no trailing slash', () => {
  const m = generateMetadata({ url: 'https://webjs.dev/' });
  assert.equal(m.alternates.canonical, 'https://webjs.dev', 'root canonical is the bare origin');
});

test('robots.txt explicitly welcomes the AI answer engines', () => {
  const txt = Robots();
  for (const agent of ['ClaudeBot', 'GPTBot', 'OAI-SearchBot', 'PerplexityBot', 'CCBot', 'Google-Extended']) {
    assert.match(txt, new RegExp(`User-agent: ${agent}\\nAllow: /`), `explicitly allows ${agent}`);
  }
});

test('robots.txt still allows everything else and points at the sitemap', () => {
  const txt = Robots();
  assert.match(txt, /^User-agent: \*\nAllow: \//m, 'the wildcard group still allows all');
  assert.match(txt, /Sitemap: https:\/\/[^\s]+\/sitemap\.xml/, 'references the absolute sitemap URL');
  assert.ok(!txt.includes('Disallow:'), 'nothing on the marketing site is disallowed');
});

test('robots.txt emits exactly one wildcard group', () => {
  // Cloudflare's managed block injects a SECOND `User-agent: *` group ahead of
  // ours at the edge, and a crawler that takes the first matching group then
  // never reads ours. Our own output must at least not compound the problem.
  const txt = Robots();
  const wildcards = txt.split('\n').filter((l) => l.trim() === 'User-agent: *');
  assert.equal(wildcards.length, 1, 'exactly one wildcard group');
});
