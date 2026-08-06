#!/usr/bin/env node
/**
 * Propagates the brand favicon to every app that serves HTML.
 *
 * The SOURCE OF TRUTH is the authored monogram at
 * website/public/brand/webjs-monogram.svg (the Velocity W on its dark tile).
 * This script no longer draws a mark of its own: an earlier version inlined
 * the retired square-gradient logo here, so re-running it silently reverted
 * the favicon to the old brand. It now reads the brand asset, copies it out
 * as each app's favicon.svg, and bakes the PNG fallbacks from the same bytes,
 * so the only way to change the favicon is to change the brand asset.
 *
 * Writes favicon.svg + favicon.png (512) into website/public and
 * examples/blog/public, plus favicon.ico (16+32+48) for the website, which
 * serves it at the origin root for crawlers that read no markup.
 * Requires ImageMagick for the .ico.
 *
 *   node scripts/generate-favicon.mjs
 */
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// The docs (#1098) and the component gallery (#1099) are served by the website,
// so they share its favicon. docs.webjs.dev and ui.webjs.dev are Cloudflare
// redirect rules with no app in this repo, so there is no public/ to write
// into for either.
const APPS = [
  resolve(root, 'website/public'),
  resolve(root, 'examples/blog/public'),
];

// The authored mark. Opaque dark tile, so it reads on light and dark browser
// chrome alike with no media-query variant.
const svg = await readFile(resolve(root, 'website/public/brand/webjs-monogram.svg'), 'utf8');

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('viewBox="0 0 120 120"', 'viewBox="0 0 120 120" width="512" height="512"')}</body></html>`, { waitUntil: 'load' });
const png = await page.screenshot({ type: 'png', omitBackground: true });
await browser.close();

for (const pub of APPS) {
  await writeFile(resolve(pub, 'favicon.svg'), svg);
  await writeFile(resolve(pub, 'favicon.png'), png);
  console.log('wrote', pub + '/favicon.{svg,png}', `(png: ${Math.round(png.length / 1024)} kB)`);
}

// The .ico multi-resolution fallback, website only (it serves /favicon.ico at
// the origin root). ImageMagick downscales the 512 PNG; -background none
// keeps the tile's rounded corners transparent.
const site = resolve(root, 'website/public');
await writeFile(resolve(site, '.favicon-512.tmp.png'), png);
execFileSync('magick', [resolve(site, '.favicon-512.tmp.png'), '-background', 'none', '-define', 'icon:auto-resize=48,32,16', resolve(site, 'favicon.ico')]);
execFileSync('rm', [resolve(site, '.favicon-512.tmp.png')]);
console.log('wrote', site + '/favicon.ico (48+32+16)');
