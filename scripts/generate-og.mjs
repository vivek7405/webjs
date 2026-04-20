#!/usr/bin/env node
/**
 * Generates Open Graph social-preview PNGs for the three apps.
 *
 * Uses puppeteer-core + system chromium to render a small HTML template
 * at 1200×630 (the OG / Twitter summary_large_image size) and writes the
 * PNG into each app's `public/og.png`.
 *
 * Rerun this script whenever the brand text / subtitle changes.
 *
 *   node scripts/generate-og.mjs
 */
import puppeteer from 'puppeteer-core';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const APPS = [
  {
    out: resolve(root, 'website/public/og.png'),
    section: null,
    title: 'The web framework built for AI agents.',
    subtitle: 'Your AI agent reads the framework code and ships. Web components, server actions, streaming SSR. No bundler, no config, no magic.',
  },
  {
    out: resolve(root, 'docs/public/og.png'),
    section: 'docs',
    title: 'Documentation',
    subtitle: 'Getting started, routing, components, server actions, deployment, and more.',
  },
  {
    out: resolve(root, 'examples/blog/public/og.png'),
    section: 'blog · demo',
    title: 'A live, full-stack webjs example.',
    subtitle: 'Posts, comments, auth, WebSocket chat. Open the source on GitHub.',
  },
];

const html = (a) => `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    background: oklch(0.14 0.01 55);
    font-family: -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif;
    color: oklch(0.96 0.015 60);
    position: relative;
    overflow: hidden;
    padding: 80px;
  }
  body::before {
    content: '';
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse 80% 60% at 55% -5%, oklch(0.78 0.14 55 / 0.32), transparent 65%),
      radial-gradient(ellipse 60% 50% at 105% 110%, oklch(0.78 0.14 55 / 0.18), transparent 70%);
    pointer-events: none;
  }
  body::after {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(oklch(1 0 0 / 0.02) 1px, transparent 1px),
      linear-gradient(90deg, oklch(1 0 0 / 0.02) 1px, transparent 1px);
    background-size: 60px 60px;
    pointer-events: none;
  }
  .wrap { position: relative; z-index: 2; height: 100%; display: flex; flex-direction: column; }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
    font-weight: 700;
    font-size: 28px;
    letter-spacing: -0.01em;
  }
  .logo {
    width: 34px; height: 34px;
    background: linear-gradient(135deg, oklch(0.82 0.14 55), oklch(0.58 0.13 45));
    border-radius: 8px;
    box-shadow: 0 0 0 1px oklch(1 0 0 / 0.14) inset, 0 6px 16px oklch(0.78 0.14 55 / 0.35);
  }
  .sep { color: oklch(0.5 0.02 60); font-weight: 400; margin: 0 2px; }
  .section { color: oklch(0.82 0.14 55); font-weight: 600; }
  .title {
    margin-top: auto;
    margin-bottom: 28px;
    font-family: ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif;
    font-weight: 700;
    font-size: 72px;
    line-height: 1.05;
    letter-spacing: -0.025em;
    max-width: 1000px;
    text-wrap: balance;
  }
  .subtitle {
    color: oklch(0.72 0.02 60);
    font-size: 26px;
    line-height: 1.4;
    max-width: 940px;
  }
  .footer {
    position: absolute;
    bottom: 60px;
    left: 80px;
    right: 80px;
    display: flex;
    justify-content: space-between;
    color: oklch(0.55 0.02 60);
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
    font-size: 15px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .dot { color: oklch(0.82 0.14 55); }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="logo"></div>
      <span>webjs</span>
      ${a.section ? `<span class="sep">/</span><span class="section">${a.section}</span>` : ''}
    </div>
    <h1 class="title">${a.title}</h1>
    <p class="subtitle">${a.subtitle}</p>
  </div>
  <div class="footer">
    <span><span class="dot">●</span>&nbsp;&nbsp;ai-first · web-components-first · no build</span>
    <span>github.com/vivek7405/webjs</span>
  </div>
</body>
</html>`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });

for (const a of APPS) {
  await page.setContent(html(a), { waitUntil: 'load' });
  const buf = await page.screenshot({ type: 'png', omitBackground: false, fullPage: false });
  await writeFile(a.out, buf);
  console.log('wrote', a.out, `(${Math.round(buf.length / 1024)} kB)`);
}
await browser.close();
