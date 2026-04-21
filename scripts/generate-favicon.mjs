#!/usr/bin/env node
/**
 * Generates a single favicon.png (and matching SVG source) that mirrors
 * the brand logo used in each app's header: a small rounded square with
 * the accent-orange gradient + subtle inner highlight.
 *
 * Writes into website/public, docs/public, examples/blog/public.
 *
 *   node scripts/generate-favicon.mjs
 */
import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const APPS = [
  resolve(root, 'website/public'),
  resolve(root, 'docs/public'),
  resolve(root, 'examples/blog/public'),
];

// SVG that matches the header logo: linear gradient, rounded corners,
// inner highlight ring. 512×512 so it down-scales cleanly to any size.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="oklch(0.82 0.14 55)"/>
      <stop offset="100%" stop-color="oklch(0.58 0.13 45)"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="96" ry="96" fill="url(#g)"/>
  <rect x="32" y="32" width="448" height="448" rx="96" ry="96" fill="none" stroke="oklch(1 0 0 / 0.15)" stroke-width="6"/>
</svg>`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`, { waitUntil: 'load' });
const png = await page.screenshot({ type: 'png', omitBackground: true });
await browser.close();

for (const pub of APPS) {
  await writeFile(resolve(pub, 'favicon.svg'), svg);
  await writeFile(resolve(pub, 'favicon.png'), png);
  console.log('wrote', pub + '/favicon.{svg,png}', `(png: ${Math.round(png.length / 1024)} kB)`);
}
