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

  test('theme toggle cycles through themes', async () => {
    // Set localStorage to 'light' and reload so the component picks it up
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);
    await page.evaluate(() => localStorage.setItem('webjs_theme', 'light'));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(before, 'light', 'Theme should be light after reload');

    // Click toggle: light → dark
    await page.evaluate(() => {
      const shell = document.querySelector('blog-shell');
      const toggle = shell?.shadowRoot?.querySelector('theme-toggle');
      toggle?.shadowRoot?.querySelector('button')?.click();
    });
    await sleep(300);

    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.equal(after, 'dark', 'After click, theme should be dark');

    // Clean up: reset to system
    await page.evaluate(() => localStorage.removeItem('webjs_theme'));
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

  // ---------------------------------------------------------------------------
  // Counter component survives client-side navigation
  //
  // Regression tests for: after multiple client-side navigations, the counter
  // component stopped working because Document.parseHTMLUnsafe() created
  // elements in a detached document, and custom element upgrades didn't fire
  // when those elements were moved to the live document via replaceChildren.
  // The fix (upgradeCustomElements) ensures connectedCallback always fires.
  // ---------------------------------------------------------------------------

  test('counter works on initial page load', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    const initial = await getCounterValue(page);
    assert.equal(initial, 3, `Counter should start at 3, got: ${initial}`);

    await clickCounterButton(page, 'Increment');
    await sleep(300);
    const after = await getCounterValue(page);
    assert.equal(after, 4, `Counter should be 4 after increment, got: ${after}`);
  });

  test('counter works after navigating away and back (same-layout swap)', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    // Navigate to About page via client-side router
    await clickNavLink(page, 'About');
    await sleep(2000);
    assert.ok(page.url().includes('/about'), `Should be on /about, got: ${page.url()}`);

    // Navigate back to homepage via the brand link
    await clickBrandLink(page);
    await sleep(2000);
    assert.ok(!page.url().includes('/about'), `Should be back on homepage, got: ${page.url()}`);

    // Counter should be present and functional
    const val = await getCounterValue(page);
    assert.equal(val, 3, `Counter should reset to 3 after navigation, got: ${val}`);

    await clickCounterButton(page, 'Increment');
    await sleep(300);
    const after = await getCounterValue(page);
    assert.equal(after, 4, `Counter should be 4 after increment, got: ${after}`);
  });

  test('counter works after multiple navigations with delays', async () => {
    // This replicates the exact user-reported bug: navigate around the blog
    // for a while (with pauses between navigations), then come back to the
    // landing page — the counter should still work.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(3000);

    // Navigation 1: Home → About (wait)
    await clickNavLink(page, 'About');
    await sleep(3000);
    assert.ok(page.url().includes('/about'), 'Should be on /about');

    // Navigation 2: About → Home via brand link (wait)
    await clickBrandLink(page);
    await sleep(3000);

    // Navigation 3: Home → About again (wait)
    await clickNavLink(page, 'About');
    await sleep(3000);
    assert.ok(page.url().includes('/about'), 'Should be on /about again');

    // Navigation 4: About → Home via Posts nav link (wait)
    await clickNavLink(page, 'Posts');
    await sleep(3000);

    // Navigation 5: Home → About once more (wait)
    await clickNavLink(page, 'About');
    await sleep(3000);

    // Navigation 6: Back to Home (the scenario that triggered the bug)
    await clickBrandLink(page);
    await sleep(3000);

    // The counter MUST be upgraded and functional
    const val = await getCounterValue(page);
    assert.equal(typeof val, 'number', `Counter value should be a number, got: ${typeof val}`);
    assert.equal(val, 3, `Counter should be 3, got: ${val}`);

    await clickCounterButton(page, 'Increment');
    await sleep(300);
    assert.equal(await getCounterValue(page), 4, 'Counter should increment to 4');

    await clickCounterButton(page, 'Decrement');
    await sleep(300);
    assert.equal(await getCounterValue(page), 3, 'Counter should decrement back to 3');
  });

  test('counter element is fully upgraded after client navigation', async () => {
    // Directly verify the internal state that was broken before the fix:
    // _renderRoot should not be null, and the element should have state.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    // Navigate away and back
    await clickNavLink(page, 'About');
    await sleep(2000);
    await clickBrandLink(page);
    await sleep(2000);

    const status = await page.evaluate(() => {
      const counter = document.querySelector('my-counter');
      if (!counter) return { exists: false };
      return {
        exists: true,
        hasShadowRoot: !!counter.shadowRoot,
        hasRenderRoot: counter._renderRoot !== null && counter._renderRoot !== undefined,
        isConnected: counter._connected === true,
        tagName: counter.tagName,
      };
    });

    assert.ok(status.exists, 'Counter element should exist in the DOM');
    assert.ok(status.hasShadowRoot, 'Counter should have a shadow root');
    assert.ok(status.hasRenderRoot, 'Counter._renderRoot should not be null (element must be upgraded)');
    assert.ok(status.isConnected, 'Counter._connected should be true');
  });

  test('counter works after rapid back-and-forth navigation', async () => {
    // Faster navigations — still should work with upgradeCustomElements
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    for (let i = 0; i < 4; i++) {
      await clickNavLink(page, 'About');
      await sleep(1000);
      await clickBrandLink(page);
      await sleep(1000);
    }

    const val = await getCounterValue(page);
    assert.equal(val, 3, `Counter should be 3 after rapid nav, got: ${val}`);

    await clickCounterButton(page, 'Increment');
    await sleep(300);
    assert.equal(await getCounterValue(page), 4, 'Counter should increment after rapid nav');
  });

  test('theme toggle still works after navigations that test counter', async () => {
    // Verify that upgradeCustomElements doesn't break other components
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    // Navigate away and back
    await clickNavLink(page, 'About');
    await sleep(2000);
    await clickBrandLink(page);
    await sleep(2000);

    // Theme toggle should still cycle
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.evaluate(() => {
      const shell = document.querySelector('blog-shell');
      const toggle = shell?.shadowRoot?.querySelector('theme-toggle');
      toggle?.shadowRoot?.querySelector('button')?.click();
    });
    await sleep(300);
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    assert.notEqual(before, after, 'Theme should change after toggle click post-navigation');
  });
});

// ---------------------------------------------------------------------------
// Helpers for counter & navigation tests
// ---------------------------------------------------------------------------

/**
 * Get the current counter display value.
 * The counter is a shadow DOM component: <my-counter> → shadowRoot → <output>.
 * @param {import('puppeteer-core').Page} p
 * @returns {Promise<number|null>}
 */
async function getCounterValue(p) {
  return p.evaluate(() => {
    const counter = document.querySelector('my-counter');
    if (!counter?.shadowRoot) return null;
    const output = counter.shadowRoot.querySelector('output');
    if (!output) return null;
    return parseInt(output.textContent.trim(), 10);
  });
}

/**
 * Click a counter button by its aria-label (Increment or Decrement).
 * @param {import('puppeteer-core').Page} p
 * @param {'Increment'|'Decrement'} label
 */
async function clickCounterButton(p, label) {
  await p.evaluate((lbl) => {
    const counter = document.querySelector('my-counter');
    const btn = counter?.shadowRoot?.querySelector(`button[aria-label="${lbl}"]`);
    btn?.click();
  }, label);
}

/**
 * Click a nav link inside blog-shell's shadow root.
 * @param {import('puppeteer-core').Page} p
 * @param {string} text  The visible link text (e.g. 'About', 'Posts', 'Dashboard')
 */
async function clickNavLink(p, text) {
  await p.evaluate((t) => {
    const shell = document.querySelector('blog-shell');
    for (const a of shell?.shadowRoot?.querySelectorAll('a') || []) {
      if (a.textContent.trim() === t) { a.click(); return; }
    }
  }, text);
}

/**
 * Click the brand link ("webjs / blog") to navigate back to the homepage.
 * @param {import('puppeteer-core').Page} p
 */
async function clickBrandLink(p) {
  await p.evaluate(() => {
    const shell = document.querySelector('blog-shell');
    const brand = shell?.shadowRoot?.querySelector('a.brand');
    brand?.click();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
