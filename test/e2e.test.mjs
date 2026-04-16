/**
 * End-to-end tests for webjs.
 *
 * Starts the example blog app on a random port, runs Puppeteer against it,
 * and tears down. These tests verify the full stack: SSR, client hydration,
 * routing, theme toggle, component rendering, preloads, and import maps.
 *
 * Requires: chromium + puppeteer-core (devDependencies of the monorepo).
 *
 * Run:   node --test test/e2e.test.js
 * Or:    npm test  (runs alongside all other tests)
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BLOG_DIR = resolve(ROOT, 'examples', 'blog');

let browser, page, serverProcess, baseUrl;

/**
 * Find a free port by binding to 0 and releasing.
 * @returns {Promise<number>}
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Start the blog example dev server and wait until it's ready.
 * @param {number} port
 * @returns {Promise<import('node:child_process').ChildProcess>}
 */
function startBlog(port) {
  const cliPath = resolve(ROOT, 'packages', 'cli', 'bin', 'webjs.js');
  return new Promise((res, reject) => {
    const child = spawn(
      process.execPath,
      [cliPath, 'dev', '--port', String(port)],
      {
        cwd: BLOG_DIR,
        env: { ...process.env, __WEBJS_DEV_CHILD: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let started = false;
    const onData = (chunk) => {
      const text = chunk.toString();
      if (!started && text.includes('ready on')) {
        started = true;
        res(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', reject);
    child.on('exit', (code) => {
      if (!started) reject(new Error(`Server exited with code ${code} before ready`));
    });
    setTimeout(() => { if (!started) reject(new Error('Server start timeout')); }, 15000);
  });
}

// --- Tests ---

describe('E2E: Blog example', { skip: !process.env.WEBJS_E2E && 'set WEBJS_E2E=1 to run E2E tests' }, () => {

  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const chromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

    const port = await freePort();
    baseUrl = `http://localhost:${port}`;
    serverProcess = await startBlog(port);

    browser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
  });

  after(async () => {
    if (browser) await browser.close();
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise((r) => { serverProcess.on('exit', r); setTimeout(r, 3000); });
    }
  });

  test('homepage renders with correct title', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);
    const title = await page.title();
    assert.ok(title.toLowerCase().includes('blog'), `Expected blog title, got: ${title}`);
  });

  test('components have shadow roots from SSR (DSD)', async () => {
    const hasShadowRoots = await page.evaluate(() => {
      const shell = document.querySelector('blog-shell');
      const toggle = shell?.shadowRoot?.querySelector('theme-toggle');
      return !!shell?.shadowRoot && !!toggle?.shadowRoot;
    });
    assert.ok(hasShadowRoots, 'blog-shell and theme-toggle should have shadow roots from DSD');
  });

  test('import map includes all framework entries', async () => {
    const map = await page.evaluate(() => {
      const s = document.querySelector('script[type="importmap"]');
      return s ? JSON.parse(s.textContent) : null;
    });
    assert.ok(map, 'Import map should exist');
    assert.ok(map.imports['webjs'], 'Should have webjs entry');
    assert.ok(map.imports['webjs/directives'], 'Should have webjs/directives entry');
    assert.ok(map.imports['webjs/context'], 'Should have webjs/context entry');
    assert.ok(map.imports['webjs/task'], 'Should have webjs/task entry');
    assert.ok(map.imports['superjson'], 'Should have superjson entry');
  });

  test('modulepreload links are deduplicated', async () => {
    const preloads = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="modulepreload"]')].map(l => l.href)
    );
    const unique = new Set(preloads);
    assert.equal(preloads.length, unique.size, 'Modulepreloads should be deduplicated');
    assert.ok(preloads.length > 0, 'Should have at least one modulepreload');
  });

  test('blog-shell component renders with shadow DOM', async () => {
    const hasShadow = await page.evaluate(() => {
      const shell = document.querySelector('blog-shell');
      return !!shell?.shadowRoot;
    });
    assert.ok(hasShadow, 'blog-shell should have a shadow root');
  });

  test('theme toggle cycles light → dark', async () => {
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(before, 'light', 'Default theme should be light');

    await page.evaluate(() => {
      const shell = document.querySelector('blog-shell');
      const toggle = shell?.shadowRoot?.querySelector('theme-toggle');
      toggle?.shadowRoot?.querySelector('button')?.click();
    });
    await sleep(300);

    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(after, 'dark', 'After click, theme should be dark');
  });

  test('client-side navigation works (Turbo Drive style)', async () => {
    // Reset to homepage
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    // Click "About" link in the nav
    await page.evaluate(() => {
      const shell = document.querySelector('blog-shell');
      for (const a of shell?.shadowRoot?.querySelectorAll('a') || []) {
        if (a.textContent.trim() === 'About') { a.click(); break; }
      }
    });
    await sleep(2000);

    assert.ok(page.url().includes('/about'), `URL should contain /about, got: ${page.url()}`);
  });

  test('no JavaScript errors on homepage', async () => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    // Filter out known non-critical errors
    const critical = errors.filter(e => !e.includes('favicon'));
    assert.equal(critical.length, 0, `Unexpected JS errors: ${critical.join('; ')}`);

    page.removeAllListeners('pageerror');
  });

  test('health endpoint responds', async () => {
    const response = await page.goto(`${baseUrl}/__webjs/health`, { timeout: 5000 });
    const body = await response.json();
    assert.equal(body.status, 'ok');
  });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
