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

  test('layout renders a data-layout wrapper around page content', async () => {
    // Light-DOM shell: the router uses the data-layout wrapper to detect
    // same-layout navigations (instead of a custom-element shell).
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    const markers = await page.evaluate(() => {
      const wrapper = document.querySelector('[data-layout]');
      const hasNav = !!document.querySelector('header nav');
      const hasMain = !!document.querySelector('main');
      return { hasWrapper: !!wrapper, layoutId: wrapper?.getAttribute('data-layout'), hasNav, hasMain };
    });
    assert.ok(markers.hasWrapper, 'data-layout wrapper should be present');
    assert.ok(markers.hasNav, '<header> <nav> should render in the layout');
    assert.ok(markers.hasMain, '<main> should render in the layout');
  });

  test('import map includes all framework entries', async () => {
    const map = await page.evaluate(() => {
      const s = document.querySelector('script[type="importmap"]');
      return s ? JSON.parse(s.textContent) : null;
    });
    assert.ok(map, 'Import map should exist');
    assert.ok(map.imports['@webjskit/core'], 'Should have @webjskit/core entry');
    assert.ok(map.imports['@webjskit/core/directives'], 'Should have @webjskit/core/directives entry');
    assert.ok(map.imports['@webjskit/core/context'], 'Should have @webjskit/core/context entry');
    assert.ok(map.imports['@webjskit/core/task'], 'Should have @webjskit/core/task entry');
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

  test('theme-toggle custom element is upgraded (light DOM)', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);
    const status = await page.evaluate(() => {
      const tt = document.querySelector('theme-toggle');
      return {
        exists: !!tt,
        upgraded: !!tt && tt._connected === true,
        hasButton: !!tt?.querySelector('button'),
      };
    });
    assert.ok(status.exists, 'theme-toggle should exist');
    assert.ok(status.upgraded, 'theme-toggle should be upgraded (connectedCallback ran)');
    assert.ok(status.hasButton, 'theme-toggle should render its button');
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

    // Click toggle: light → dark (light DOM — toggle + button live in document)
    await page.evaluate(() => {
      const toggle = document.querySelector('theme-toggle');
      toggle?.querySelector('button')?.click();
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

    // Click "About" link in the layout nav (light DOM now).
    await page.evaluate(() => {
      for (const a of document.querySelectorAll('nav a')) {
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

  test('counter works after multiple navigations with random delays', { timeout: 120000 }, async () => {
    // This replicates the exact user-reported bug: navigate around the blog
    // for about a minute (with varied, realistic pauses between navigations),
    // then come back to the landing page — the counter should still work.
    //
    // Delays are randomized between 3–10s to mimic real browsing behavior
    // where the user reads content, scrolls, and clicks at irregular intervals.
    const delay = () => sleep(3000 + Math.floor(Math.random() * 7000));

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await delay();

    // Navigation 1: Home → About (read the about page for a while)
    await clickNavLink(page, 'About');
    await delay();
    assert.ok(page.url().includes('/about'), 'Should be on /about');

    // Navigation 2: About → Home via brand link (browse the post list)
    await clickBrandLink(page);
    await delay();

    // Navigation 3: Home → About again (re-read something)
    await clickNavLink(page, 'About');
    await delay();
    assert.ok(page.url().includes('/about'), 'Should be on /about again');

    // Navigation 4: About → Home via Posts nav link (different link, same dest)
    await clickNavLink(page, 'Posts');
    await delay();

    // Navigation 5: Home → About once more (third visit to about)
    await clickNavLink(page, 'About');
    await delay();

    // Navigation 6: About → Home via brand
    await clickBrandLink(page);
    await delay();

    // Navigation 7: Home → About (keep going)
    await clickNavLink(page, 'About');
    await delay();

    // Navigation 8: About → Home via Posts
    await clickNavLink(page, 'Posts');
    await delay();

    // Navigation 9: Home → About (one more round trip)
    await clickNavLink(page, 'About');
    await delay();

    // Navigation 10: Back to Home (the scenario that triggered the bug)
    await clickBrandLink(page);
    await delay();

    // The counter MUST be upgraded and functional after all that browsing
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
        // Counter is light DOM — no shadowRoot; render root is the element itself.
        hasRenderRoot: counter._renderRoot !== null && counter._renderRoot !== undefined,
        renderRootIsSelf: counter._renderRoot === counter,
        isConnected: counter._connected === true,
        tagName: counter.tagName,
      };
    });

    assert.ok(status.exists, 'Counter element should exist in the DOM');
    assert.ok(status.hasRenderRoot, 'Counter._renderRoot should not be null (element must be upgraded)');
    assert.ok(status.renderRootIsSelf, 'Counter light-DOM render root is the element itself');
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

  // ---------------------------------------------------------------------------
  // Nested DSD: all four shadow/light DOM nesting combinations
  //
  // The /test-nesting page renders four sections, each with a parent component
  // nesting a child component in a different shadow/light DOM combination.
  // These tests verify:
  //   1. SSR emits correct DSD templates / hydration markers
  //   2. Components upgrade and render content after JS loads
  //   3. Inline styles from DSD are applied (no layout shift)
  // ---------------------------------------------------------------------------

  test('nested DSD: shadow parent → shadow child renders with DSD and styles', async () => {
    await page.goto(`${baseUrl}/test-nesting`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    const result = await page.evaluate(() => {
      const section = document.querySelector('#shadow-shadow');
      const parent = section?.querySelector('shadow-parent');
      if (!parent) return { error: 'shadow-parent not found' };

      const parentHasShadow = !!parent.shadowRoot;
      const parentDiv = parent.shadowRoot?.querySelector('[data-testid="shadow-parent"]');

      const child = parent.shadowRoot?.querySelector('shadow-inner');
      const childHasShadow = !!child?.shadowRoot;
      const childText = child?.shadowRoot?.querySelector('[data-testid="shadow-inner"]')?.textContent;

      // Check that the child's shadow root has adopted styles (inline <style>
      // from SSR was replaced by adoptedStyleSheets on upgrade)
      const childHasAdoptedStyles = (child?.shadowRoot?.adoptedStyleSheets?.length || 0) > 0;

      return { parentHasShadow, parentDiv: !!parentDiv, childHasShadow, childText, childHasAdoptedStyles };
    });

    assert.ok(!result.error, result.error);
    assert.ok(result.parentHasShadow, 'Shadow parent should have a shadow root');
    assert.ok(result.parentDiv, 'Shadow parent should render its content');
    assert.ok(result.childHasShadow, 'Shadow child nested in shadow parent should have a shadow root');
    assert.equal(result.childText, 'shadow-inner OK', 'Shadow child should render its text');
    assert.ok(result.childHasAdoptedStyles, 'Shadow child should have adopted styles');
  });

  test('nested DSD: shadow parent → light child renders with hydration marker', async () => {
    const result = await page.evaluate(() => {
      const section = document.querySelector('#shadow-light');
      const parent = section?.querySelector('shadow-parent');
      if (!parent) return { error: 'shadow-parent not found' };

      const parentHasShadow = !!parent.shadowRoot;
      const child = parent.shadowRoot?.querySelector('light-inner');
      const childHasShadow = !!child?.shadowRoot;
      // Light DOM child renders directly into its own element (no shadow root)
      const childText = child?.querySelector('[data-testid="light-inner"]')?.textContent;

      return { parentHasShadow, childExists: !!child, childHasShadow, childText };
    });

    assert.ok(!result.error, result.error);
    assert.ok(result.parentHasShadow, 'Shadow parent should have a shadow root');
    assert.ok(result.childExists, 'Light child should exist inside shadow parent');
    assert.ok(!result.childHasShadow, 'Light child should NOT have a shadow root');
    assert.equal(result.childText, 'light-inner OK', 'Light child should render its text');
  });

  test('nested DSD: light parent → shadow child renders with DSD and styles', async () => {
    const result = await page.evaluate(() => {
      const section = document.querySelector('#light-shadow');
      const parent = section?.querySelector('light-parent');
      if (!parent) return { error: 'light-parent not found' };

      const parentHasShadow = !!parent.shadowRoot;
      // Light DOM parent renders into itself
      const parentDiv = parent.querySelector('[data-testid="light-parent"]');
      const child = parent.querySelector('shadow-inner');
      const childHasShadow = !!child?.shadowRoot;
      const childText = child?.shadowRoot?.querySelector('[data-testid="shadow-inner"]')?.textContent;
      const childHasAdoptedStyles = (child?.shadowRoot?.adoptedStyleSheets?.length || 0) > 0;

      return { parentHasShadow, parentDiv: !!parentDiv, childHasShadow, childText, childHasAdoptedStyles };
    });

    assert.ok(!result.error, result.error);
    assert.ok(!result.parentHasShadow, 'Light parent should NOT have a shadow root');
    assert.ok(result.parentDiv, 'Light parent should render its content');
    assert.ok(result.childHasShadow, 'Shadow child nested in light parent should have a shadow root');
    assert.equal(result.childText, 'shadow-inner OK', 'Shadow child should render its text');
    assert.ok(result.childHasAdoptedStyles, 'Shadow child should have adopted styles');
  });

  test('nested DSD: light parent → light child renders with hydration marker', async () => {
    const result = await page.evaluate(() => {
      const section = document.querySelector('#light-light');
      const parent = section?.querySelector('light-parent');
      if (!parent) return { error: 'light-parent not found' };

      const parentHasShadow = !!parent.shadowRoot;
      const child = parent.querySelector('light-inner');
      const childHasShadow = !!child?.shadowRoot;
      const childText = child?.querySelector('[data-testid="light-inner"]')?.textContent;

      return { parentHasShadow, childExists: !!child, childHasShadow, childText };
    });

    assert.ok(!result.error, result.error);
    assert.ok(!result.parentHasShadow, 'Light parent should NOT have a shadow root');
    assert.ok(result.childExists, 'Light child should exist inside light parent');
    assert.ok(!result.childHasShadow, 'Light child should NOT have a shadow root');
    assert.equal(result.childText, 'light-inner OK', 'Light child should render its text');
  });

  test('nested DSD: SSR output has inline styles for shadow components before JS', async () => {
    // Fetch raw HTML without executing JS to verify SSR output directly
    const html = await page.evaluate(async (url) => {
      const resp = await fetch(url);
      return resp.text();
    }, `${baseUrl}/test-nesting`);

    // shadow-parent should have DSD with <style>
    assert.match(html, /<shadow-parent[^>]*><template shadowrootmode="open"><style>/,
      'shadow-parent should have DSD with inline <style>');

    // shadow-inner nested inside should also have DSD with <style>
    assert.match(html, /<shadow-inner><template shadowrootmode="open"><style>/,
      'shadow-inner nested inside parent should have DSD with inline <style>');

    // light-parent should have hydration marker, NOT DSD
    assert.match(html, /<light-parent[^>]*><!--webjs-hydrate-->/,
      'light-parent should have hydration marker');
    assert.ok(!html.includes('<light-parent><template shadowrootmode'),
      'light-parent should NOT have DSD template');

    // light-inner should have hydration marker, NOT DSD
    assert.match(html, /<light-inner><!--webjs-hydrate-->/,
      'light-inner should have hydration marker');
    assert.ok(!html.includes('<light-inner><template shadowrootmode'),
      'light-inner should NOT have DSD template');

    // Verify the inline styles contain actual CSS (not empty)
    assert.match(html, /shadow-inner><template shadowrootmode="open"><style>[^<]+<\/style>/,
      'shadow-inner DSD should contain non-empty inline styles');
  });

  test('nested DSD: no duplicate <style> tags after hydration (SSR style removed)', async () => {
    await page.goto(`${baseUrl}/test-nesting`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000);

    const result = await page.evaluate(() => {
      const checks = [];

      // Check all shadow-inner instances
      for (const el of document.querySelectorAll('shadow-inner')) {
        if (!el.shadowRoot) continue;
        const styleTags = el.shadowRoot.querySelectorAll('style').length;
        const adoptedSheets = el.shadowRoot.adoptedStyleSheets?.length || 0;
        checks.push({ tag: 'shadow-inner', styleTags, adoptedSheets });
      }

      // Check all shadow-parent instances
      for (const el of document.querySelectorAll('shadow-parent')) {
        if (!el.shadowRoot) continue;
        const styleTags = el.shadowRoot.querySelectorAll('style').length;
        const adoptedSheets = el.shadowRoot.adoptedStyleSheets?.length || 0;
        checks.push({ tag: 'shadow-parent', styleTags, adoptedSheets });
      }

      return checks;
    });

    for (const check of result) {
      assert.equal(check.styleTags, 0,
        `${check.tag} should have 0 inline <style> tags after hydration (SSR style removed)`);
      assert.ok(check.adoptedSheets > 0,
        `${check.tag} should have adoptedStyleSheets after hydration`);
    }
  });

  // ---------------------------------------------------------------------------
  // Additional coverage: dynamic routes, 404, auth redirect, metadata,
  // browser history, Suspense streaming, server-side /api round-trip.
  // ---------------------------------------------------------------------------

  test('dynamic route: /blog/[slug] renders the post title in <head>', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);
    // Use any post href rendered on the home page.
    const href = await page.evaluate(() => {
      const a = document.querySelector('main ul a[href^="/blog/"]');
      return a?.getAttribute('href');
    });
    assert.ok(href, 'homepage should list at least one /blog/... link');
    await page.goto(baseUrl + href, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    const title = await page.title();
    assert.ok(title.toLowerCase().includes('blog'),
      `slug page title should mention "blog", got: ${title}`);
    const hasArticle = await page.evaluate(() => !!document.querySelector('article'));
    assert.ok(hasArticle, 'slug page should render an <article>');
  });

  test('dynamic route: unknown slug hits notFound() → 404 page', async () => {
    const resp = await page.goto(
      baseUrl + '/blog/this-post-definitely-does-not-exist-xyz-98765',
      { waitUntil: 'domcontentloaded', timeout: 10000 },
    );
    assert.equal(resp.status(), 404);
    const body = await page.evaluate(() =>
      document.body.textContent.toLowerCase());
    assert.ok(/not found|404/.test(body),
      `custom 404 page should render a "not found" message; got: ${body.slice(0, 200)}`);
  });

  test('dashboard middleware redirects unauthenticated requests to /login', async () => {
    const resp = await page.goto(baseUrl + '/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    assert.equal(resp.status(), 200);
    assert.ok(page.url().includes('/login'),
      `unauthenticated /dashboard should redirect to /login; final url: ${page.url()}`);
    // `then` query parameter should be set so post-login returns to /dashboard.
    assert.ok(page.url().includes('then='),
      'redirect should carry a ?then= parameter');
  });

  test('login page renders the <auth-forms> custom element', async () => {
    await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);
    const ok = await page.evaluate(() => {
      const af = document.querySelector('auth-forms');
      return { exists: !!af, hasInputs: !!af?.querySelector('input') };
    });
    assert.ok(ok.exists, '<auth-forms> should be present on /login');
    assert.ok(ok.hasInputs, '<auth-forms> should render form inputs');
  });

  test('metadata: <title> and <meta description> update per route', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);
    const home = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
    }));
    assert.ok(home.title.toLowerCase().includes('blog'));
    assert.ok(home.description && home.description.length > 0, 'homepage has a description meta');

    await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);
    const login = await page.evaluate(() => ({ title: document.title }));
    assert.ok(login.title.toLowerCase().includes('sign in'),
      `/login <title> should mention "sign in"; got: ${login.title}`);
  });

  test('browser history: back button after client nav returns to previous page', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);
    await clickNavLink(page, 'About');
    await sleep(2000);
    assert.ok(page.url().endsWith('/about'), 'navigated to /about');

    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    assert.ok(page.url() === baseUrl + '/' || page.url() === baseUrl,
      `back should return to homepage, got: ${page.url()}`);

    await page.goForward({ waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    assert.ok(page.url().endsWith('/about'), 'forward returns to /about');
  });

  test('Suspense streaming: fallback appears first, resolved content follows', async () => {
    // The home page has <Suspense> around `slowStat()` which sleeps 400ms
    // before resolving with a timestamp wrapped in <muted-text>.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(2000); // Enough for the deferred chunk to stream in.
    const hasStat = await page.evaluate(() => {
      // "posts loaded" is part of the resolved Suspense content.
      return document.body.textContent.includes('posts loaded');
    });
    assert.ok(hasStat, 'resolved Suspense content should eventually render');
  });

  test('/api/posts GET returns an array of posts', async () => {
    const resp = await page.goto(baseUrl + '/api/posts', { timeout: 5000 });
    assert.equal(resp.status(), 200);
    const data = await resp.json();
    assert.ok(Array.isArray(data), '/api/posts should return an array');
  });

  test('POST /api/posts without auth is rejected', async () => {
    const result = await page.evaluate(async (url) => {
      const r = await fetch(url + '/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'x', body: 'y' }),
      });
      return { status: r.status };
    }, baseUrl);
    assert.ok(result.status >= 400 && result.status < 500,
      `unauthenticated POST should be 4xx, got ${result.status}`);
  });

  test('404 for unknown pathname serves text/html', async () => {
    const resp = await page.goto(baseUrl + '/nothing-here-abcxyz', {
      waitUntil: 'domcontentloaded',
      timeout: 5000,
    });
    assert.equal(resp.status(), 404);
    const ct = resp.headers()['content-type'];
    assert.ok(ct && ct.includes('text/html'), `expected html 404, got ${ct}`);
  });

  test('same-origin link with download attribute is NOT intercepted by router', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);
    const intercepted = await page.evaluate(async () => {
      const a = document.createElement('a');
      a.href = '/favicon.ico';
      a.setAttribute('download', '');
      document.body.appendChild(a);
      let fetched = false;
      const orig = window.fetch;
      window.fetch = async (...args) => { fetched = true; return orig(...args); };
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
      a.dispatchEvent(ev);
      window.fetch = orig;
      a.remove();
      return fetched;
    });
    assert.equal(intercepted, false,
      'downloads should bypass the router (let the browser handle)');
  });

  test('CSRF cookie is set on first GET response', async () => {
    // Fresh context → clear cookies.
    await page.deleteCookie(...(await page.cookies()));
    const resp = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    assert.equal(resp.status(), 200);
    const cookies = await page.cookies();
    const csrf = cookies.find((c) => /csrf/i.test(c.name));
    assert.ok(csrf, `expected a csrf cookie; got: ${cookies.map(c => c.name).join(', ')}`);
    assert.ok(csrf.value && csrf.value.length > 10, 'csrf cookie should have a non-trivial value');
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
    const before = await page.evaluate(() =>
      document.documentElement.dataset.theme || 'system',
    );
    await page.evaluate(() => {
      const toggle = document.querySelector('theme-toggle');
      toggle?.querySelector('button')?.click();
    });
    await sleep(300);
    const after = await page.evaluate(() =>
      document.documentElement.dataset.theme || 'system',
    );
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
    // <my-counter> is a light-DOM component; children live on the element itself.
    const counter = document.querySelector('my-counter');
    if (!counter) return null;
    const output = counter.querySelector('output');
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
    const btn = counter?.querySelector(`button[aria-label="${lbl}"]`);
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
    for (const a of document.querySelectorAll('header nav a')) {
      if (a.textContent.trim() === t) { a.click(); return; }
    }
  }, text);
}

/**
 * Click the brand link ("webjs / blog") — the first <a> in the header that
 * points at '/', sitting before the nav.
 * @param {import('puppeteer-core').Page} p
 */
async function clickBrandLink(p) {
  await p.evaluate(() => {
    const brand = document.querySelector('header > a[href="/"]');
    brand?.click();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
