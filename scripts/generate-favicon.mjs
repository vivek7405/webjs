#!/usr/bin/env node
/**
 * Generates a single favicon.png (and matching SVG source) that mirrors
 * the brand logo used in each app's header: a small rounded square with
 * the accent-orange gradient + subtle inner highlight.
 *
 * Writes into website/public, examples/blog/public, and the UI site.
 *
 *   node scripts/generate-favicon.mjs
 */
import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// The docs (#1098) and the component gallery (#1099) are served by the website,
// so they share its favicon. The docs.webjs.dev and ui.webjs.dev hosts that
// remain render no HTML at all, only redirects, so neither has a public/ to
// write into (and writing to a directory that no longer exists throws).
const APPS = [
  resolve(root, 'website/public'),
  resolve(root, 'examples/blog/public'),
];

// SVG that matches the header logo mark in website/app/layout.ts: a rounded
// square with the accent-orange gradient (--logo-from to --logo-to) plus a
// subtle inner highlight ring. 512x512 so it down-scales cleanly to any size.
//
// The mark is theme-adaptive, exactly like the navbar: the default stops are
// the LIGHT-theme --logo-from/--logo-to, and an embedded
// @media (prefers-color-scheme: dark) swaps in the DARK-theme stops. This is
// the standards-based way to ship one favicon that reads on both light and
// dark browser chrome (a single SVG whose own style adapts, no second file).
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop class="from" offset="0%" stop-color="oklch(0.63 0.17 50)"/>
      <stop class="to" offset="100%" stop-color="oklch(0.44 0.11 52)"/>
    </linearGradient>
    <style>
      @media (prefers-color-scheme: dark) {
        .from { stop-color: oklch(0.8 0.16 58); }
        .to { stop-color: oklch(0.62 0.18 44); }
      }
    </style>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="142" ry="142" fill="url(#g)"/>
  <rect x="32" y="32" width="448" height="448" rx="142" ry="142" fill="none" stroke="oklch(1 0 0 / 0.15)" stroke-width="6"/>
</svg>`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
// Bake the single PNG fallback from the DARK-theme stops: a raster cannot
// carry the @media swap, and the bright dark-navbar orange reads on both
// light and dark tab bars. Emulate dark so the SVG's own media query resolves
// to the dark stops before we screenshot it.
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`, { waitUntil: 'load' });
const png = await page.screenshot({ type: 'png', omitBackground: true });
await browser.close();

for (const pub of APPS) {
  await writeFile(resolve(pub, 'favicon.svg'), svg);
  await writeFile(resolve(pub, 'favicon.png'), png);
  console.log('wrote', pub + '/favicon.{svg,png}', `(png: ${Math.round(png.length / 1024)} kB)`);
}
