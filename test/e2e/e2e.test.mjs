/**
 * End-to-end tests for webjs.
 *
 * Starts the example blog app on a random port, runs Puppeteer against it,
 * and tears down. These tests verify the full stack: SSR, client hydration,
 * routing, theme toggle, component rendering, preloads, and import maps.
 *
 * Requires: chromium + puppeteer-core (devDependencies of the monorepo).
 *
 * Run:   WEBJS_E2E=1 node --test test/e2e/e2e.test.mjs
 * (gated behind WEBJS_E2E so the default `npm test` run skips it; CI runs
 * it as its own job, see .github/workflows/ci.yml)
 *
 * Cross-runtime (#523): the harness always runs under `node --test` (its
 * node:test hook lifecycle does not survive `bun test`), but the BLOG SERVER it
 * spawns can be served on Bun by setting WEBJS_E2E_RUNTIME=bun (point
 * WEBJS_BUN_PATH at the bun binary if it is not `bun` on PATH). This exercises
 * the full browser stack against a Bun-served blog, proving the Bun.serve shell
 * and Drizzle-on-Bun in a real browser:
 *   WEBJS_E2E=1 WEBJS_E2E_RUNTIME=bun node --test test/e2e/e2e.test.mjs
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { assertBlogSeeded } from '../fixtures/blog-seeded.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const BLOG_DIR = resolve(ROOT, 'examples', 'blog');

let browser, page, serverProcess, baseUrl;
// A second blog instance with elision forced OFF (WEBJS_ELIDE=0), for the
// differential elision test that asserts on-vs-off observable parity.
let offPage, offServerProcess, offBaseUrl;

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
 * The runtime executable that SERVES the blog under test. Defaults to the
 * runtime running this harness (`process.execPath`, i.e. node under
 * `node --test`). Set WEBJS_E2E_RUNTIME=bun to serve the blog on Bun instead
 * (the cross-runtime e2e for #523); WEBJS_BUN_PATH overrides the bun binary
 * location when it is not `bun` on PATH. Only the spawned blog process changes
 * runtime; the harness itself stays on node.
 * @returns {string}
 */
function blogRuntimeExec() {
  if ((process.env.WEBJS_E2E_RUNTIME || '').toLowerCase() === 'bun') {
    return process.env.WEBJS_BUN_PATH || 'bun';
  }
  return process.execPath;
}

// SSR action-result seeding (#472 / the #488 GET seed) and the async-render abort
// test (#492) used to skip on Bun, because seeding rode Node's
// `module.registerHooks`. As of #529 seeding installs on Bun too (a `Bun.plugin`
// onLoad), so a shipping async component seeds and does NOT re-fetch on hydration
// on either runtime, and these tests now run on both.

/**
 * Runtime flags that load `file` into the SERVER process before it boots, in
 * whichever runtime `blogRuntimeExec` picked. Passed as argv rather than
 * NODE_OPTIONS because Bun ignores that variable outright, so a fixture wired
 * through it would silently do nothing on the Bun e2e job.
 *
 * The two flags are not symmetric, so do not reason from the Node side:
 * `node --preload` is a hard `bad option` error, while `bun --import`
 * currently works as an alias. Selecting per runtime anyway is what keeps this
 * from depending on Bun continuing to accept a Node spelling.
 * @param {string} file  absolute path to an ES module
 * @returns {string[]}
 */
function preloadArgs(file) {
  return (process.env.WEBJS_E2E_RUNTIME || '').toLowerCase() === 'bun'
    ? ['--preload', file]
    : ['--import', file];
}

/**
 * Start the blog example dev server and wait until it's ready.
 * @param {number} port
 * @param {Record<string, string>} [extraEnv]
 * @param {string[]} [runtimeArgs]  flags for the RUNTIME, before the CLI path
 * @returns {Promise<import('node:child_process').ChildProcess>}
 */
function startBlog(port, extraEnv = {}, runtimeArgs = []) {
  const cliPath = resolve(ROOT, 'packages', 'cli', 'bin', 'webjs.js');
  return new Promise((res, reject) => {
    const child = spawn(
      blogRuntimeExec(),
      [...runtimeArgs, cliPath, 'dev', '--port', String(port)],
      {
        cwd: BLOG_DIR,
        env: { ...process.env, __WEBJS_DEV_CHILD: '1', ...extraEnv },
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
    // Before launching Chromium, so an unseeded worktree fails in a second
    // with the remedy rather than after a browser launch on three assertions
    // that never mention the database (#1323).
    assertBlogSeeded(await (await fetch(`${baseUrl}/`)).text());

    browser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    // Model a desktop pointer deterministically. Headless Chromium reports
    // hover:none, which would flip the adaptive prefetch default to viewport
    // and passively warm links (breaking tests that assume nothing prefetches
    // without a hover). Override ONLY the hover/pointer media query (other
    // queries delegate to the real matchMedia); a test opts into touch by
    // setting window.__webjsForceTouch before the router scans. This uses a
    // matchMedia shim rather than emulateMediaFeatures, which CI's Chromium
    // does not support for the hover feature.
    await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (typeof q === 'string' && q.includes('hover')) {
          const touch = !!window.__webjsForceTouch;
          return {
            matches: !touch, media: q, onchange: null,
            addEventListener() {}, removeEventListener() {},
            addListener() {}, removeListener() {}, dispatchEvent() { return false; },
          };
        }
        return real(q);
      };
    });
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

  test('layout emits wj:children markers for the client router', async () => {
    // Per-layout `<!--wj:children:<segment>-->` comment markers wrap
    // each ${children} interpolation. The client router walks these
    // markers across old + new DOMs to detect the deepest shared
    // layout for partial-swap navigation. Replaced the older single
    // `data-layout` attribute approach on 2026-05-16 (f216f0e).
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1000);
    const markers = await page.evaluate(() => {
      const it = document.createNodeIterator(document, NodeFilter.SHOW_COMMENT);
      const layoutMarkers = [];
      let n;
      while ((n = it.nextNode())) {
        if (n.data && n.data.startsWith('wj:children:')) {
          layoutMarkers.push(n.data);
        }
      }
      const hasNav = !!document.querySelector('header nav');
      const hasMain = !!document.querySelector('main');
      return { layoutMarkers, hasNav, hasMain };
    });
    assert.ok(markers.layoutMarkers.length > 0,
      `wj:children comment markers should be present; got ${JSON.stringify(markers.layoutMarkers)}`);
    assert.ok(markers.hasNav, '<header> <nav> should render in the layout');
    assert.ok(markers.hasMain, '<main> should render in the layout');
  });




  test('nested component modules are fetched once: import URL matches the preload (#369)', async () => {
    // Regression for #369: layout.ts / page.ts import their components with a
    // bare relative specifier (`import '../components/x.ts'`). The browser
    // resolves that against the importer's `?v=`-versioned URL, and a `?v` is
    // NOT inherited across relative resolution, so before the fix it fetched the
    // UN-versioned URL: a different cache key from the `?v=`-versioned
    // modulepreload hint. Result: the preload was wasted AND the module was
    // downloaded a second time. Capture every same-origin module request on a
    // cold load and assert (a) no module path is fetched both bare and
    // versioned, and (b) every modulepreload href is actually one of the
    // fetched URLs (the preload is used, not warming a dead cache key).
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => { if (req.resourceType() === 'script' || /\.(ts|js|mts|mjs)(\?|$)/.test(req.url())) requested.push(req.url()); };
    page.on('request', onRequest);
    try {
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(3000);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }

    const origin = new URL(baseUrl).origin;
    const sameOriginModules = requested.filter((u) => u.startsWith(origin) && /\.(ts|js|mts|mjs)(\?|$)/.test(u));

    // (a) No module path requested both with and without ?v (the bug's signature).
    /** @type {Map<string, Set<string>>} */
    const byPath = new Map();
    for (const u of sameOriginModules) {
      const url = new URL(u);
      if (!byPath.has(url.pathname)) byPath.set(url.pathname, new Set());
      byPath.get(url.pathname).add(url.search.includes('v=') ? 'versioned' : 'bare');
    }
    const split = [...byPath.entries()].filter(([, variants]) => variants.size > 1).map(([p]) => p);
    assert.equal(split.length, 0, `no module may be fetched both bare and versioned (double-fetch):\n${split.join('\n')}`);

    // (b) Every modulepreload href was actually requested (preload used, not wasted).
    const preloads = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.href).filter((h) => h.startsWith(location.origin)),
    );
    assert.ok(preloads.length > 0, 'expected same-origin modulepreloads on the home route');
    const requestedSet = new Set(sameOriginModules);
    const unused = preloads.filter((href) => !requestedSet.has(href));
    assert.equal(unused.length, 0, `every modulepreload must be requested by the module graph (else it warms a dead cache key):\n${unused.join('\n')}`);
  });

  test('the core runtime is preloaded and fetched exactly ONCE (#1118)', async () => {
    // The boot script names only page and component URLs, so without the head
    // hint the browser discovers core a full round trip late: fetch a component,
    // parse it, then fetch core. That round trip is the pre-boot click window on
    // a cold connection.
    //
    // Exactly-once is what proves the hint's href matched the importmap target
    // byte for byte. A differing href still WORKS, it just makes the browser
    // treat the preload and the import as two resources and fetch core twice,
    // which is why eyeballing the tag is not enough.
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => { requested.push(req.url()); };
    const p = await browser.newPage();
    p.on('request', onRequest);
    try {
      await p.setCacheEnabled(false);
      await p.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(3000);

      const target = await p.evaluate(() => {
        const tag = document.querySelector('script[type="importmap"]');
        return tag ? (JSON.parse(tag.textContent).imports['@webjsdev/core'] || null) : null;
      });
      assert.ok(target, '@webjsdev/core is in the served importmap');

      const hinted = await p.evaluate((t) => {
        const links = [...document.querySelectorAll('link[rel="modulepreload"]')];
        // Compare on the RESOLVED url, since the served href may be relative.
        const abs = new URL(t, location.href).href;
        return links.filter((l) => l.href === abs).length;
      }, target);
      assert.equal(hinted, 1, 'the served head carries exactly one core modulepreload');

      const absTarget = new URL(target, baseUrl).href;
      const coreRequests = requested.filter((u) => u === absTarget);
      assert.equal(
        coreRequests.length, 1,
        `the core bundle must be requested exactly once (a preload href that differs from the importmap target double-fetches); saw ${coreRequests.length}`,
      );
    } finally {
      p.off('request', onRequest);
      await p.close();
    }
  });

  test('a same-origin load the router never saw reports pre-boot-navigation (#1118)', async () => {
    // The window between first paint and the deferred boot module cannot be
    // closed from inside the router, so it is measured instead. The listener has
    // to be installed before the boot module runs, which no in-page script can
    // do, hence `evaluateOnNewDocument`.
    const p = await browser.newPage();
    try {
      await p.evaluateOnNewDocument(() => {
        window.__wjFallbacks = [];
        document.addEventListener('webjs:navigation-fallback', (e) => {
          window.__wjFallbacks.push(e.detail);
        });
      });

      // Entry load: no referrer, so nothing to report. This is the control that
      // stops the assertion below from passing on a router that reports every
      // load unconditionally.
      await p.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(1500);
      const onEntry = await p.evaluate(() => window.__wjFallbacks.filter((d) => d.cause === 'pre-boot-navigation'));
      assert.equal(onEntry.length, 0, 'an external / typed entry has no router that could have missed a click');

      // A same-origin FULL document load, which is exactly what an unintercepted
      // click produces. The destination must be a route that SHIPS the runtime:
      // the report comes from the router's own boot, so a fully elided page has
      // nothing running to report with (and no router that could have been
      // missed either).
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        p.evaluate(() => { location.href = '/about'; }),
      ]);
      await sleep(1500);

      const details = await p.evaluate(() => window.__wjFallbacks);
      const preBoot = details.filter((d) => d.cause === 'pre-boot-navigation');
      assert.equal(preBoot.length, 1, `the arriving document reports one pre-boot navigation; saw ${JSON.stringify(details)}`);
      assert.equal(preBoot[0].willReload, false, 'the document load already happened, so nothing further will reload');
      assert.match(preBoot[0].href, /\/about/, 'the report names the document that loaded');
    } finally {
      await p.close();
    }
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

    // Click toggle: light → dark (light DOM: toggle + button live in document)
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

  test('progressive soft-nav streaming: the Suspense fallback shows while the slow boundary streams in (#473)', async () => {
    // The homepage renders a Suspense boundary whose data resolves after 400ms,
    // with the fallback "computing timestamp...". On a soft navigation TO the
    // homepage the router now applies the shell (with the fallback) immediately
    // and streams the resolved boundary in afterward. So at the moment the URL
    // advances to "/", the fallback is STILL showing (the boundary has not
    // resolved yet). A buffered swap would instead wait for the whole stream
    // (past 400ms) and advance the URL only once the content was already
    // resolved, so the fallback would never be observed live.
    await page.goto(baseUrl + '/about', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);

    // Click the layout's home link (href="/") to soft-navigate to the homepage.
    await page.evaluate(() => {
      const home = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/');
      home.click();
    });

    // Assert the fallback is live the moment the URL is the homepage, checked
    // ATOMICALLY in the browser so there is no test-to-browser round-trip gap in
    // which the fast (400ms) boundary could resolve before we read (the gap made
    // this flake under heavy load). A progressive swap satisfies both conditions
    // together; a buffered swap never shows the fallback at "/" and times out.
    // Match case-INSENSITIVELY: the fallback is a <muted-text> whose Tailwind
    // `uppercase` class renders "COMPUTING TIMESTAMP" once the stylesheet is
    // applied, and `innerText` reflects `text-transform`, so a case-sensitive
    // match would miss the (fully styled) fallback (#967).
    const fallbackLiveAtAdvance = await page
      .waitForFunction(
        () => location.pathname === '/' && document.body.innerText.toLowerCase().includes('computing timestamp'),
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    assert.ok(
      fallbackLiveAtAdvance,
      'the Suspense fallback was live when the URL advanced (progressive streaming); a buffered swap would already show resolved content',
    );

    // And the boundary eventually streams in, replacing the fallback.
    await page.waitForFunction(
      () => !document.body.innerText.toLowerCase().includes('computing timestamp'),
      { timeout: 8000 },
    );
    const resolvedNoFallback = await page.evaluate(() =>
      !document.body.innerText.toLowerCase().includes('computing timestamp'),
    );
    assert.ok(resolvedNoFallback, 'the streamed boundary replaced the fallback');
  });

  test('async render bakes data into the SSR HTML and the component hydrates (#469)', async () => {
    // Network-probe the raw SSR HTML (no JS) to prove async render bakes the
    // data into the first paint, then load with JS and prove the component
    // hydrates and stays interactive (the @click counter works).
    const rawHtml = await fetch(baseUrl + '/stream-demo').then((r) => r.text());
    assert.ok(/Hello, world!/.test(rawHtml), 'async render data is in the raw SSR HTML (PE-safe)');

    await page.goto(baseUrl + '/stream-demo', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForFunction(() => {
      const b = document.querySelector('.greeting-bump');
      return b && b.textContent.includes('n=0');
    }, { timeout: 8000 });
    // Click the async component's button: it must have hydrated (the @click
    // bound after the async commit) and re-render with the new state.
    await page.evaluate(() => document.querySelector('.greeting-bump').click());
    await page.waitForFunction(
      () => document.querySelector('.greeting-bump')?.textContent.includes('n=1'),
      { timeout: 8000 },
    );
    const bumped = await page.evaluate(() => document.querySelector('.greeting-bump').textContent.includes('n=1'));
    assert.ok(bumped, 'the async-render component hydrated and stayed interactive');
    // The greeting text is still present (stale-while-revalidate held it across the re-render).
    const greeting = await page.evaluate(() => document.querySelector('.greeting-text')?.textContent || '');
    assert.ok(greeting.includes('Hello, world!'), 'the greeting survived the re-render');
  });

  test('SSR action seeding: no action RPC on hydration, RPC on a prop bump (#472)', async () => {
    // The /seeded page renders a shipping <seeded-user> whose async render()
    // awaits the getSeedUser 'use server' action. SSR bakes the result into the
    // first paint AND seeds it into the page, so the client's first render must
    // resolve from the seed (NO /__webjs/action/ RPC). A prop bump asks for an
    // unseeded id, which DOES go to the network.

    // (1) Raw SSR HTML (no JS): the data is in the first paint and the seed
    // payload is present.
    const rawHtml = await fetch(baseUrl + '/seeded').then((r) => r.text());
    assert.match(rawHtml, /User 1/, 'async render data is in the raw SSR HTML (PE-safe)');
    assert.match(rawHtml, /__webjs-seeds/, 'the SSR seed payload is emitted');

    // (2) Load with JS, probing every action RPC.
    /** @type {string[]} */
    const actionRpcs = [];
    const onRequest = (req) => { if (req.url().includes('/__webjs/action/')) actionRpcs.push(req.url()); };
    page.on('request', onRequest);
    try {
      await page.setCacheEnabled(false);
      await page.goto(baseUrl + '/seeded', { waitUntil: 'domcontentloaded', timeout: 12000 });
      // Wait for the component to hydrate (the @click button is bound).
      await page.waitForFunction(
        () => document.querySelector('seeded-user .seeded-bump') && document.querySelector('seeded-user .seeded-name')?.textContent.includes('User 1'),
        { timeout: 8000 },
      );
      // Give any stray hydration re-fetch a moment to fire (it must not).
      await sleep(800);
      assert.equal(
        actionRpcs.length,
        0,
        `no action RPC may fire on hydration (the SSR result was seeded); saw:\n${actionRpcs.join('\n')}`,
      );

      // (3) Bump uid -> the new id is unseeded, so the action DOES fetch.
      await page.evaluate(() => document.querySelector('seeded-user .seeded-bump').click());
      await page.waitForFunction(
        () => document.querySelector('seeded-user .seeded-name')?.textContent.includes('User 2'),
        { timeout: 8000 },
      );
      assert.ok(actionRpcs.length >= 1, 'a prop bump to an unseeded id fetches over RPC');
      assert.ok(
        actionRpcs.some((u) => /\/__webjs\/action\//.test(u)),
        'the refetch went through the action RPC endpoint',
      );
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }
  });

  test('HTTP-verb actions: GET read is seeded, POST mutation invalidates + refetches (#488)', async () => {
    // /verbs reads via a GET action (cacheable, seeded on first paint) and a
    // POST mutation that invalidates the read's tag. Probe action RPCs: none on
    // hydration (the GET was seeded), then the bump fires the mutation and a
    // fresh re-read.
    const rawHtml = await fetch(baseUrl + '/verbs').then((r) => r.text());
    assert.ok(/Hello #0/.test(rawHtml), 'the GET-action read is in the first paint (PE-safe)');

    /** @type {{method: string, url: string}[]} */
    const actionReqs = [];
    const onRequest = (req) => { if (req.url().includes('/__webjs/action/')) actionReqs.push({ method: req.method(), url: req.url() }); };
    page.on('request', onRequest);
    try {
      // The browser cache is ENABLED (default) so the second bump genuinely
      // tests the tag-bypass: a broken coordinator would serve the cached value.
      await page.goto(baseUrl + '/verbs', { waitUntil: 'domcontentloaded', timeout: 12000 });
      await page.waitForFunction(
        () => document.querySelector('verb-greeting .vg-bump') && document.querySelector('verb-greeting .vg-text')?.textContent.includes('Hello #0'),
        { timeout: 8000 },
      );
      await sleep(700);
      // No action RPC on hydration: the GET resolves from the SSR seed before any
      // fetch, so this holds regardless of the browser-cache state.
      assert.equal(actionReqs.length, 0, `no action RPC on hydration (the GET was seeded); saw:\n${actionReqs.map((r) => r.method + ' ' + r.url).join('\n')}`);

      // Bump: a POST mutation that invalidates, then a fresh GET re-read. This GET
      // response is now stored in the browser cache (max-age=30).
      await page.evaluate(() => document.querySelector('verb-greeting .vg-bump').click());
      await page.waitForFunction(
        () => document.querySelector('verb-greeting .vg-text')?.textContent.includes('Hello #1'),
        { timeout: 8000 },
      );
      const methods = actionReqs.map((r) => r.method);
      assert.ok(methods.includes('POST'), 'the bump fired the POST mutation');
      assert.ok(methods.includes('GET'), 'the re-read fired a GET action after invalidation');

      // Bump AGAIN within the 30s window: #1 is now browser-cached, so reaching #2
      // proves the tag-invalidation forced a cache BYPASS (a plain cached read,
      // or a broken coordinator, would still say #1). The real coordinator test.
      await page.evaluate(() => document.querySelector('verb-greeting .vg-bump').click());
      await page.waitForFunction(
        () => document.querySelector('verb-greeting .vg-text')?.textContent.includes('Hello #2'),
        { timeout: 8000 },
      );
      const fresh = await page.evaluate(() => document.querySelector('verb-greeting .vg-text')?.textContent || '');
      assert.ok(fresh.includes('Hello #2'), 'invalidation bypassed the browser cache to show the fresh value');
    } finally {
      page.off('request', onRequest);
    }
  });

  test('a superseded async render aborts its in-flight action fetch (#492)', async () => {
    // <abort-demo> awaits a slow (800ms) GET action. Bumping n while the fetch
    // is in flight supersedes the render, and the framework aborts the previous
    // render's fetch (net::ERR_ABORTED on the action URL).
    /** @type {string[]} */
    const aborted = [];
    const onFailed = (req) => {
      if (req.url().includes('/__webjs/action/') && /ERR_ABORTED/.test(req.failure()?.errorText || '')) aborted.push(req.url());
    };
    page.on('requestfailed', onFailed);
    try {
      await page.goto(baseUrl + '/abort', { waitUntil: 'domcontentloaded', timeout: 12000 });
      await page.waitForFunction(() => document.querySelector('abort-demo .ad-bump') && document.querySelector('abort-demo .ad-n')?.textContent.includes('n=0'), { timeout: 8000 });
      // Bump (n=1): the slow getSlow(1) fetch starts and stays in flight.
      await page.evaluate(() => document.querySelector('abort-demo .ad-bump').click());
      await sleep(200);
      // Bump again (n=2): supersedes the in-flight n=1 render, aborting its fetch.
      await page.evaluate(() => document.querySelector('abort-demo .ad-bump').click());
      await page.waitForFunction(() => document.querySelector('abort-demo .ad-n')?.textContent.includes('n=2'), { timeout: 8000 });
      assert.ok(aborted.length >= 1, 'the superseded render\'s in-flight action fetch was aborted');
    } finally {
      page.off('requestfailed', onFailed);
    }
  });

  test('a streaming-RPC action renders tokens incrementally (#489)', async () => {
    // <token-stream> calls an async-generator action; each yielded token streams
    // over the single RPC response and is appended as it arrives. We assert (1)
    // the action response is the framed stream content type, and (2) the FIRST
    // DOM paint shows fewer tokens than the final count (captured race-free via a
    // MutationObserver), proving incremental arrival rather than one buffered result.
    /** @type {string|null} */
    let streamCt = null;
    const onResponse = (res) => {
      if (res.url().includes('/__webjs/action/') && res.url().includes('/streamTokens')) {
        streamCt = res.headers()['content-type'] || null;
      }
    };
    page.on('response', onResponse);
    try {
      await page.goto(baseUrl + '/rpc-stream', { waitUntil: 'domcontentloaded', timeout: 12000 });
      await page.waitForFunction(() => document.querySelector('token-stream .ts-start'), { timeout: 8000 });
      // Install a MutationObserver BEFORE clicking that records the token count at
      // the FIRST DOM update. This is race-free (it fires whenever the first token
      // appends, so it cannot be missed by snapshotting too late) and still proves
      // incremental delivery: a real stream first-paints ONE token (the server
      // spaces tokens 60ms apart), while a single buffered flush would first-paint
      // all 8 at once. A prior version snapshotted the count "mid-stream" and
      // asserted it was below the final, which raced completion on a fast runner
      // (mid==final) and flaked on the Bun E2E lane (#1004).
      await page.evaluate(() => {
        const el = document.querySelector('token-stream');
        /** @type {any} */ (window).__tsFirst = 0;
        const obs = new MutationObserver(() => {
          const n = document.querySelectorAll('token-stream .ts-item').length;
          if (n > 0 && !(/** @type {any} */ (window).__tsFirst)) /** @type {any} */ (window).__tsFirst = n;
        });
        obs.observe(el, { childList: true, subtree: true });
        /** @type {any} */ (window).__tsObs = obs;
      });
      await page.evaluate(() => document.querySelector('token-stream .ts-start').click());
      // Wait for the stream to finish (the button re-enables with all 8 rendered).
      await page.waitForFunction(() => {
        const b = document.querySelector('token-stream .ts-start');
        return b && !b.disabled && document.querySelectorAll('token-stream .ts-item').length === 8;
      }, { timeout: 8000 });
      const first = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        if (w.__tsObs) w.__tsObs.disconnect();
        return w.__tsFirst;
      });
      const final = await page.evaluate(() => document.querySelectorAll('token-stream .ts-item').length);
      assert.equal(final, 8, 'all 8 streamed tokens rendered');
      assert.ok(first > 0 && first < final,
        `tokens rendered incrementally (first paint showed ${first} of ${final}, not one buffered flush)`);
      assert.ok(streamCt && streamCt.includes('application/vnd.webjs+stream'), `the action streamed a framed body; got content-type ${streamCt}`);
    } finally {
      page.off('response', onResponse);
    }
  });

  test('SSR action seeding rides a soft navigation: no RPC on the navigated render (#472)', async () => {
    // Start on another page, then soft-navigate to /seeded through the client
    // router. The navigation response carries the seed payload, the router
    // ingests it (applySwap -> scanSeeds) before <seeded-user> hydrates, so the
    // navigated render resolves from the seed with NO action RPC.
    await page.goto(baseUrl + '/static-info', { waitUntil: 'domcontentloaded', timeout: 12000 });
    await sleep(500); // let the client router enable
    /** @type {string[]} */
    const actionRpcs = [];
    const onRequest = (req) => { if (req.url().includes('/__webjs/action/')) actionRpcs.push(req.url()); };
    page.on('request', onRequest);
    try {
      await page.evaluate(() => {
        const a = document.createElement('a');
        a.href = '/seeded';
        document.body.appendChild(a);
        a.click();
      });
      await page.waitForFunction(
        () => location.pathname === '/seeded' && document.querySelector('seeded-user .seeded-name')?.textContent.includes('User 1'),
        { timeout: 8000 },
      );
      await sleep(700);
      assert.equal(
        actionRpcs.length,
        0,
        `a soft-nav to /seeded must not fire the action RPC (the result was seeded); saw:\n${actionRpcs.join('\n')}`,
      );
    } finally {
      page.off('request', onRequest);
    }
  });

  test('a wrapped slow component streams in behind its fallback on initial load (#471)', async () => {
    await page.goto(baseUrl + '/stream-demo', { waitUntil: 'domcontentloaded', timeout: 10000 });
    // The slow fact (400ms) streams in behind its fallback; wait for it.
    await page.waitForFunction(
      () => document.body.innerText.includes('The answer is 42'),
      { timeout: 8000 },
    );
    const state = await page.evaluate(() => ({
      hasFact: document.body.innerText.includes('The answer is 42'),
      fallbackGone: !document.body.innerText.includes('loading the fact'),
    }));
    assert.ok(state.hasFact, 'the wrapped slow component streamed in');
    assert.ok(state.fallbackGone, 'the boundary fallback was replaced by the streamed content');
  });

  test('progressive soft-nav to a streamed page keeps the fallback live at URL advance (#471/#473)', async () => {
    await page.goto(baseUrl + '/static-info', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1200);
    // Click the "Stream" nav link (soft navigation to /stream-demo).
    await page.evaluate(() => {
      for (const a of document.querySelectorAll('nav a')) {
        if (a.textContent.trim() === 'Stream') { a.click(); break; }
      }
    });
    await page.waitForFunction(() => location.pathname === '/stream-demo', { timeout: 8000 });
    // The slow boundary (400ms) has not resolved when the URL advances, so its
    // fallback is live (progressive); a buffered swap would already show "42".
    const fallbackLive = await page.evaluate(() => document.body.innerText.includes('loading the fact'));
    assert.ok(fallbackLive, 'the streamed boundary fallback was live when the URL advanced (progressive)');
    // And the async-greeting (blocking) was applied in the shell immediately.
    const greetingNow = await page.evaluate(() => document.body.innerText.includes('Hello, world!'));
    assert.ok(greetingNow, 'the blocking async-render content was in the shell at URL advance');
    // The boundary then streams in.
    await page.waitForFunction(
      () => document.body.innerText.includes('The answer is 42'),
      { timeout: 8000 },
    );
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
    // then come back to the landing page: the counter should still work.
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
        // Counter is light DOM: no shadowRoot; render root is the element itself.
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
    // Faster navigations: still should work with upgradeCustomElements
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
    assert.match(html, /<shadow-inner[^>]*><template shadowrootmode="open"><style>/,
      'shadow-inner nested inside parent should have DSD with inline <style>');

    // light-parent should have hydration marker, NOT DSD
    assert.match(html, /<light-parent[^>]*><!--webjs-hydrate-->/,
      'light-parent should have hydration marker');
    assert.ok(!html.includes('<light-parent><template shadowrootmode'),
      'light-parent should NOT have DSD template');

    // light-inner should have hydration marker, NOT DSD
    assert.match(html, /<light-inner[^>]*><!--webjs-hydrate-->/,
      'light-inner should have hydration marker');
    assert.ok(!html.includes('<light-inner><template shadowrootmode'),
      'light-inner should NOT have DSD template');

    // Verify the inline styles contain actual CSS (not empty)
    assert.match(html, /shadow-inner[^>]*><template shadowrootmode="open"><style>[^<]+<\/style>/,
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

  // ---------------------------------------------------------------------------
  // UI demo route (Webjs UI showcase)
  //
  // Verifies /ui-demo renders both tiers correctly:
  //   - Tier 1 (button, card, input, label, alert, badge): class-helper
  //     functions on native elements. Asserts the helper output (e.g.
  //     "rounded-xl border bg-card", "bg-primary text-primary-foreground")
  //     is present in the rendered HTML.
  //   - Tier 2 (dialog): real <ui-dialog> custom element.
  // Also enforces the regression denylist: no <ui-button>/<ui-card>/
  // <ui-input>/<ui-alert>/<ui-badge> tags (Tier-1 is class-helper-only
  // after the migration).
  // ---------------------------------------------------------------------------

  test('/ui-demo route renders both tiers: class-helper output + ui-dialog', async () => {
    // After the Tier-1/Tier-2 migration: Tier-1 components (button, card,
    // input, label, alert, badge) are class-helper functions: no
    // <ui-button>/<ui-card> custom elements. They render as native
    // <button>/<div>/<input> with the helper's class string. Tier-2
    // components (dialog and friends) stay as <ui-X> custom elements.
    const resp = await page.goto(baseUrl + '/ui-demo', { waitUntil: 'domcontentloaded', timeout: 10000 });
    assert.equal(resp.status(), 200, '/ui-demo should respond 200');
    await sleep(1500);

    const result = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h1')].map((h) => h.textContent || '');
      const html = document.documentElement.outerHTML;
      return {
        hasHeading: headings.some((t) => t.toLowerCase().includes('webjs ui demo')),
        // Stale Tier-1 tags MUST NOT appear (regression denylist).
        staleTier1: {
          'ui-button': document.querySelectorAll('ui-button').length,
          'ui-card':   document.querySelectorAll('ui-card').length,
          'ui-input':  document.querySelectorAll('ui-input').length,
          'ui-alert':  document.querySelectorAll('ui-alert').length,
          'ui-badge':  document.querySelectorAll('ui-badge').length,
        },
        // Tier-2 dialog WAS migrated to stay as a custom element.
        uiDialogCount: document.querySelectorAll('ui-dialog').length,
        // Tier-1 helper output present (cardClass + buttonClass characteristic strings).
        hasCardClassOutput: html.includes('rounded-xl border bg-card'),
        hasButtonClassOutput: html.includes('bg-primary text-primary-foreground hover:bg-primary'),
      };
    });

    assert.ok(result.hasHeading, '"Webjs UI demo" heading should be visible');
    for (const [tag, count] of Object.entries(result.staleTier1)) {
      assert.equal(count, 0, `Tier-1 ${tag} is a class helper after migration; <${tag}> tag must not appear`);
    }
    assert.ok(result.uiDialogCount >= 1, `expected at least one <ui-dialog>, got ${result.uiDialogCount}`);
    assert.ok(result.hasCardClassOutput, 'cardClass() Tailwind output should be present');
    assert.ok(result.hasButtonClassOutput, 'buttonClass() Tailwind output should be present');
  });

  test('/ui-demo: an opened dialog exposes ONE dialog node, and it is named', async () => {
    // The role sits on the native <dialog>, which already has an implicit
    // dialog role, so a second one on the content panel would expose two nested
    // dialog-family nodes. Declaring the role also obliges the element to carry
    // a NAME: a modal that announces itself as a dialog with nothing to read is
    // worse than one a reader treats as ordinary content. Naming is wired at
    // showModal() time, so it can only be observed with the dialog open.
    await page.goto(baseUrl + '/ui-demo', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);

    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => /open dialog/i.test(b.textContent || ''));
      if (!btn) return false;
      btn.click();
      return true;
    });
    assert.ok(opened, 'the "Open dialog" trigger should be present');
    await sleep(600);

    const seen = await page.evaluate(() => {
      const host = document.querySelector('ui-dialog');
      const native = host?.querySelector('dialog[data-slot="dialog-native"]');
      const panel = host?.querySelector('[data-slot="dialog-content"]');
      if (!native || !panel) return null;
      const labelledBy = native.getAttribute('aria-labelledby');
      const describedBy = native.getAttribute('aria-describedby');
      const nameTarget = labelledBy ? document.getElementById(labelledBy) : null;
      const descTarget = describedBy ? document.getElementById(describedBy) : null;
      return {
        open: native.open,
        nativeRole: native.getAttribute('role'),
        panelHasRole: panel.hasAttribute('role'),
        // Whether the IDREF actually resolves, which a dead one would not.
        nameResolves: !!nameTarget,
        descResolves: !!descTarget,
        name: (nameTarget?.textContent || native.getAttribute('aria-label') || '').trim(),
        desc: (descTarget?.textContent || '').trim(),
      };
    });

    assert.ok(seen, 'the native <dialog> and its content panel should both be found');
    assert.ok(seen.open, 'the dialog should be open');
    assert.equal(seen.nativeRole, 'dialog', 'the native <dialog> carries role="dialog"');
    assert.equal(seen.panelHasRole, false, 'the content panel carries no second dialog role');
    // Assert the RESOLVED title, not merely that some name exists. A
    // non-empty check passes on the generic "Dialog" floor alone, so it would
    // stay green with the entire title lookup deleted and could never observe
    // that the wiring found this demo's <ui-dialog-title>.
    assert.ok(seen.nameResolves, 'aria-labelledby must point at a live element, not a dead IDREF');
    assert.equal(seen.name, 'Edit profile', 'the name comes from the demo title node');
    assert.ok(seen.descResolves, 'aria-describedby must point at a live element');
    assert.match(seen.desc, /Make changes to your profile/, 'the description comes from the demo description node');
  });

  test('/ui-demo: clicking a button does not crash the page', async () => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(baseUrl + '/ui-demo', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);

    const clicked = await page.evaluate(() => {
      // Tier-1 buttons render as native <button> with buttonClass() output.
      // Find one in the demo (any of the two on /ui-demo work).
      const buttons = [...document.querySelectorAll('button')];
      for (const b of buttons) {
        const t = (b.textContent || '').toLowerCase();
        if (t.includes('send link') || t.includes('cancel') || t.includes('open dialog')) {
          b.click();
          return true;
        }
      }
      return false;
    });

    assert.ok(clicked, 'a button with the expected text should be present');
    await sleep(500);

    const critical = errors.filter((e) => !e.includes('favicon'));
    assert.equal(critical.length, 0, `clicking a button should not throw JS errors: ${critical.join('; ')}`);
    page.removeAllListeners('pageerror');
  });

  // ---------------------------------------------------------------------------
  // Migrated auth flow: <auth-forms> uses Tier-1 class helpers
  // (inputClass, labelClass, buttonClass) on raw native <input>/<label>/
  // <button> elements. No <ui-input>/<ui-button> custom elements after
  // the Tier-1/Tier-2 split.
  // ---------------------------------------------------------------------------

  test('migrated auth flow: login form uses native inputs styled by class helpers', async () => {
    await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);

    const shape = await page.evaluate(() => {
      const af = document.querySelector('auth-forms');
      const html = af?.innerHTML || '';
      return {
        nativeInputCount: af?.querySelectorAll('input').length || 0,
        nativeButtonCount: af?.querySelectorAll('button[type="submit"]').length || 0,
        // Stale Tier-1 custom-element tags must not appear.
        staleUiInput: af?.querySelectorAll('ui-input').length || 0,
        staleUiButton: af?.querySelectorAll('ui-button').length || 0,
        // Tier-1 helper characteristic Tailwind strings should be present.
        hasInputClass: html.includes('border-input'),
        hasButtonClass: html.includes('bg-primary text-primary-foreground'),
      };
    });

    assert.equal(shape.staleUiInput, 0, '<auth-forms> should not contain <ui-input> (Tier-1 is a class helper)');
    assert.equal(shape.staleUiButton, 0, '<auth-forms> should not contain <ui-button> (Tier-1 is a class helper)');
    assert.ok(shape.nativeInputCount >= 2, `expected native email + password <input>, found ${shape.nativeInputCount}`);
    assert.ok(shape.nativeButtonCount >= 1, `expected a native <button type="submit">, found ${shape.nativeButtonCount}`);
    assert.ok(shape.hasInputClass, 'inputClass() Tailwind output should be present on inputs');
    assert.ok(shape.hasButtonClass, 'buttonClass() Tailwind output should be present on submit button');
  });

  test('migrated auth flow: fill email + password and submit navigates or shows error', async () => {
    await page.goto(baseUrl + '/login', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);

    const startUrl = page.url();
    const submitOutcome = await page.evaluate(async () => {
      const af = document.querySelector('auth-forms');
      // Tier-1: inputs are real native <input> elements inside the form.
      const inputs = [...(af?.querySelectorAll('input') || [])];
      const emailInput = inputs.find((i) => i.type === 'email' || i.name === 'email');
      const passwordInput = inputs.find((i) => i.type === 'password' || i.name === 'password');
      if (!emailInput || !passwordInput) {
        return { ok: false, reason: 'native email/password input not found' };
      }
      emailInput.value = `e2e-ui-${Date.now()}@test.local`;
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      passwordInput.value = 'correct-horse-battery-staple';
      passwordInput.dispatchEvent(new Event('input', { bubbles: true }));

      const form = af.querySelector('form');
      if (!form) return { ok: false, reason: 'no <form> inside auth-forms' };
      form.requestSubmit
        ? form.requestSubmit()
        : form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      return { ok: true };
    });

    assert.ok(submitOutcome.ok, `submit setup failed: ${submitOutcome.reason || ''}`);
    await sleep(1500);

    const after = await page.evaluate(() => {
      const af = document.querySelector('auth-forms');
      const errText = af?.textContent?.toLowerCase() || '';
      return {
        url: location.href,
        hasError: /error|invalid|fail|password|email/.test(errText),
      };
    });

    const navigated = after.url !== startUrl;
    assert.ok(navigated || after.hasError,
      `expected navigation or error message after submit; url=${after.url}, hasError=${after.hasError}`);
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


  test('a top-level script in a swapped range re-executes on a soft nav (#1102)', async () => {
    // The headline behaviour, in a real browser. /script-swap's layout emits
    // two inline scripts as SIBLINGS of its children, so both are top-level
    // nodes of the range the router replaces when you navigate in from
    // outside. Start somewhere that does not render that layout, so the two
    // window counters are untouched and the ONLY thing that can set them is
    // this navigation.
    await page.goto(`${baseUrl}/static-info`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);

    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/script-swap';
      a.id = 'e2e-1102-link';
      a.textContent = 'script swap (e2e)';
      (document.querySelector('main') || document.body).appendChild(a);
      // A full page load discards this; a router swap keeps it. Without the
      // sentinel a hard navigation would run the scripts through the PARSER
      // and satisfy the counters for entirely the wrong reason.
      window.__e2e1102Sentinel = 'alive';
    });

    await page.click('#e2e-1102-link');
    await waitForCond(
      async () => (await page.evaluate(() => location.pathname)) === '/script-swap',
      10000,
      () => 'expected the injected link to navigate to /script-swap',
    );
    await sleep(500);

    const state = await page.evaluate(() => ({
      sentinel: window.__e2e1102Sentinel,
      before: window.__wjScriptBefore,
      after: window.__wjScriptAfter,
      beforeText: (document.getElementById('script-swap-before') || {}).textContent,
      afterText: (document.getElementById('script-swap-after') || {}).textContent,
      body: !!document.getElementById('script-swap-body'),
    }));

    assert.equal(state.sentinel, 'alive',
      'this must be a soft navigation; a full page load proves nothing about reactivation');
    assert.equal(state.body, true, 'the fixture route actually rendered');
    assert.equal(state.before, 1,
      'the top-level script BEFORE the children ran, which is the bug: it never used to');
    assert.equal(state.after, 1,
      'and the one AFTER the children ran too, so replacing the first did not truncate the range walk');
    assert.equal(state.beforeText, '1', 'the before-script DOM write landed');
    assert.equal(state.afterText, '1', 'the after-script DOM write landed');
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

  // ---------------------------------------------------------------------------
  // Full auth round-trip: signup → protected dashboard → logout
  // ---------------------------------------------------------------------------

  test('auth flow: signup → access dashboard → logout clears session', async () => {
    // Run late: previous tests assume unauthenticated state, so clean
    // cookies before starting the flow.
    const client = await page.target().createCDPSession();
    await client.send('Network.clearBrowserCookies');
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);

    const email = `e2e-${Date.now()}@test.local`;
    const password = 'correct-horse-battery-staple';

    // 1) POST /api/auth/signup with a fresh email. Rate-limited to 5/10s
    // - we do one request total per test run, so we're well under.
    const signupResp = await page.evaluate(async ({ email, password }) => {
      const r = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, name: 'E2E User' }),
      });
      return { status: r.status, ok: r.ok };
    }, { email, password });
    assert.ok(signupResp.ok, `signup should succeed; got status ${signupResp.status}`);

    // 2) With the session cookie now set, /dashboard should render (not redirect).
    const dashResp = await page.goto(baseUrl + '/dashboard', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    assert.equal(dashResp.status(), 200);
    assert.ok(
      !page.url().includes('/login'),
      `authenticated /dashboard should not redirect to /login; got: ${page.url()}`,
    );

    // 3) POST /api/auth/logout → clears cookie.
    const logoutResp = await page.evaluate(async () => {
      const r = await fetch('/api/auth/logout', { method: 'POST' });
      return { status: r.status };
    });
    assert.ok(
      logoutResp.status >= 200 && logoutResp.status < 400,
      `logout should return 2xx/3xx; got ${logoutResp.status}`,
    );

    // 4) /dashboard now redirects back to /login again.
    await page.goto(baseUrl + '/dashboard', { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);
    assert.ok(
      page.url().includes('/login'),
      `/dashboard after logout should redirect to /login; got: ${page.url()}`,
    );
  });

  // ---------------------------------------------------------------------------
  // Client-side nav: same-layout swap preserves the layout header element
  // ---------------------------------------------------------------------------

  test('client nav: layout header survives same-layout swap (no remount)', async () => {
    // Same-layout nav should preserve the layout chrome: the header
    // DOM element is the same instance before and after. If the router
    // did a full page reload, a property stamped on the element would
    // be lost.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);
    await page.evaluate(() => {
      const h = document.querySelector('header');
      if (h) /** @type any */ (h).__layoutMarker = 'before';
    });
    await clickNavLink(page, 'About');
    await sleep(2000);
    const survived = await page.evaluate(() =>
      /** @type any */ (document.querySelector('header'))?.__layoutMarker === 'before',
    );
    assert.ok(survived, 'same-layout nav should keep the <header> DOM element mounted');
  });

  test('client nav: data-webjs-permanent element survives a partial swap by node identity (#250)', async () => {
    // Both `/` and `/about` render a `<span id="perm-probe" data-webjs-permanent>`
    // INSIDE the swapped `<main>` region. A normal partial swap would
    // recreate it from the incoming HTML; the permanent regraft must move
    // the LIVE node into the incoming tree so it keeps its identity (a
    // playing media element / live widget would keep running). Proven by
    // stamping a unique JS property before the nav and asserting it
    // survives, which only holds if the SAME DOM node was kept.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);
    const stamped = await page.evaluate(() => {
      const el = document.getElementById('perm-probe');
      if (!el) return false;
      /** @type any */ (el).__permProbe = 'kept-alive';
      return true;
    });
    assert.ok(stamped, 'the permanent probe element is present on the home page');

    await clickNavLink(page, 'About');
    await sleep(2000);

    const result = await page.evaluate(() => {
      const el = document.getElementById('perm-probe');
      return {
        present: !!el,
        identityKept: !!el && /** @type any */ (el).__permProbe === 'kept-alive',
        onAbout: location.pathname === '/about',
      };
    });
    assert.ok(result.onAbout, 'navigated to /about via the client router');
    assert.ok(result.present, 'the permanent element is present after the swap');
    assert.ok(result.identityKept,
      'the permanent element kept its NODE IDENTITY across the partial swap (regrafted, not recreated)');
  });

  test('client nav: the outer-layout navbar keeps node identity across a soft nav (#994)', async () => {
    // The persistent top navbar (`<header class="site-header">`) is OUTER-layout
    // chrome, emitted BEFORE the `wj:children` marker, so the deepest-shared-
    // layout swap must never touch it. #994: a dropped close marker forced the
    // destructive full-body swap that wiped this header; the orphaned-open
    // recovery keeps the scoped swap so the header node survives. A missing close is
    // not reproducible on demand from a well-formed response (#1007 found the
    // original cause was our own parse stripping comments, now fixed), so this
    // happy-path end-to-end guard (markers intact) cannot trigger it; the dropped-
    // close divergence is covered deterministically by the core browser test
    // (packages/core/test/routing/browser/orphaned-marker-navbar.test.js). Proven by stamping a JS
    // property on the live header and asserting the SAME node persists.
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(1500);
    const stamped = await page.evaluate(() => {
      const el = document.querySelector('header.site-header');
      if (!el) return false;
      /** @type any */ (el).__navProbe = 'outer-layout-kept';
      return true;
    });
    assert.ok(stamped, 'the outer-layout navbar header is present on the home page');

    await clickNavLink(page, 'About');
    await sleep(2000);

    const result = await page.evaluate(() => {
      const el = document.querySelector('header.site-header');
      return {
        present: !!el,
        identityKept: !!el && /** @type any */ (el).__navProbe === 'outer-layout-kept',
        onAbout: location.pathname === '/about',
      };
    });
    assert.ok(result.onAbout, 'navigated to /about via the client router');
    assert.ok(result.present, 'the navbar is still present after the soft nav');
    assert.ok(result.identityKept,
      'the outer-layout navbar kept its NODE IDENTITY across the soft nav (not wiped by a full-body swap)');
  });

  // ---------------------------------------------------------------------------
  // Rate limiting: 6th rapid auth request → 429
  // ---------------------------------------------------------------------------

  test('rate limit: 6 rapid auth requests → 429 with retry-after', { timeout: 30000 }, async () => {
    // /api/auth/* has `rateLimit({ window: '10s', max: 5 })`. Fire 6
    // login attempts with a bogus credential in quick succession.
    // Use Node's fetch (not page.evaluate) so we bypass puppeteer
    // navigation timeouts: this is a pure HTTP-level test.
    // The X-Forwarded-For header gives us a fresh IP bucket so earlier
    // tests in the suite don't consume our quota.
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const r = await fetch(baseUrl + '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ email: 'ratelimit@test', password: 'x' }),
      });
      statuses.push({ status: r.status, retryAfter: r.headers.get('retry-after') });
    }
    const last = statuses[statuses.length - 1];
    assert.equal(last.status, 429, `6th rapid auth request should be 429, got ${last.status}`);
    assert.ok(last.retryAfter, 'rate-limit 429 should include a Retry-After header');
  });

  // ---------------------------------------------------------------------------
  // Light-DOM <slot> projection through the full stack
  //
  //   These tests exercise the slot pipeline end-to-end: file-router SSR,
  //   client hydration, client-router navigation away and back, form
  //   state survival, and shadow-DOM parity (the same render template
  //   running under both static shadow = false and static shadow = true).
  //   Backed by /slot-demo (page.ts) + components/slot-card.ts +
  //   components/slot-card-shadow.ts.
  // ---------------------------------------------------------------------------

  test('SSR places projected children inside light slot elements', async () => {
    // Fetch raw SSR'd HTML (no client JS), so we observe exactly what
    // the server emits without hydration reordering attributes.
    const res = await fetch(`${baseUrl}/slot-demo`);
    const html = await res.text();
    // The framework-marked slot elements carry data-webjs-light and a
    // data-projection attribute set to "actual" or "fallback".
    assert.ok(html.includes('data-webjs-light'), 'light slots present in SSR output');
    assert.ok(html.includes('data-projection="actual"'), 'at least one projection is actual');
    assert.ok(html.includes('data-projection="fallback"'), 'partial card has a fallback slot');
    // Header slot in the full card projects the H2 child. Verify
    // structurally without depending on attribute order, since the SSR
    // emitter writes one order and the browser's serialiser may produce
    // another.
    assert.ok(html.includes('<h2 slot="header">Full card</h2>'),
      'header H2 with slot="header" present in output');
    // Footer slot in the partial card shows the fallback text.
    assert.ok(html.includes('no actions'),
      'fallback footer text "no actions" present in output');
  });

  test('hydration preserves authored DOM identity through SSR roundtrip', async () => {
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    // Tag the SSR-rendered button before hydration completes. If
    // hydration ran cleanly via DOM identity preservation, the same
    // node reference is in the slot AFTER full settle.
    const identityHeld = await page.evaluate(() => {
      const btnBefore = document.querySelector('#footer-btn');
      if (!btnBefore) return { ok: false, why: 'no SSR button' };
      btnBefore.dataset.hydrationProbe = 'present';
      return new Promise((res) => {
        // Microtask + a queued macrotask covers projection settle.
        setTimeout(() => {
          const btnAfter = document.querySelector('#footer-btn');
          res({
            ok: !!btnAfter && btnAfter.dataset.hydrationProbe === 'present',
            inSlot: btnAfter?.parentElement?.tagName === 'SLOT',
          });
        }, 50);
      });
    });
    assert.ok(identityHeld.ok, 'pre-hydration node identity preserved');
    assert.ok(identityHeld.inSlot, 'projected button is inside its <slot> element');
  });

  test('client-router navigation away and back preserves slot projection', async () => {
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);
    // Navigate away to home via the client router (link click).
    await page.evaluate(() => {
      document.querySelector('a[data-testid="back-home"]').click();
    });
    await page.waitForFunction(() => location.pathname === '/', { timeout: 5000 });
    await sleep(300);
    // Navigate back. Use a fresh navigation since we have not exercised
    // the client router's URL-state preservation for slot-using pages
    // yet; a hard goto verifies the SSR round-trip cleanly.
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);
    // After return, the projected paragraph should be visible in the
    // light-DOM slot and the slot should carry data-projection="actual".
    const observed = await page.evaluate(() => {
      const slot = document.querySelector('#card-full slot[data-webjs-light]:not([name])');
      if (!slot) return { ok: false, why: 'no slot' };
      return {
        ok: true,
        projection: slot.getAttribute('data-projection'),
        bodyText: slot.textContent.trim(),
      };
    });
    assert.ok(observed.ok, observed.why || 'slot present after navigation');
    assert.equal(observed.projection, 'actual', 'slot projecting after re-navigation');
    assert.ok(observed.bodyText.includes('authored children'),
      `body slot still has projected content, got: ${observed.bodyText}`);
  });

  test('input value inside slotted content survives projection round-trip', async () => {
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.evaluate(() => {
      const input = document.querySelector('#survive-input');
      input && (input.value = 'typed-into-slot');
      input && input.focus();
    });
    // Force a re-render through the framework by triggering a microtask
    // batch on an unrelated mutation. The slot's projected input should
    // keep its value because DOM identity is preserved.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    const value = await page.evaluate(() => document.querySelector('#survive-input')?.value);
    assert.equal(value, 'typed-into-slot', 'input value preserved');
  });

  test('shadow-DOM parity: same render template projects via native slot', async () => {
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const sshadow = await page.evaluate(() => {
      const host = document.querySelector('#card-shadow-full');
      if (!host) return { ok: false, why: 'no shadow host' };
      // Wait for upgrade.
      const sr = host.shadowRoot;
      if (!sr) return { ok: false, why: 'no shadow root' };
      const headerSlot = sr.querySelector('slot[name="header"]');
      const defaultSlot = Array.from(sr.querySelectorAll('slot')).find((s) => !s.hasAttribute('name'));
      const footerSlot = sr.querySelector('slot[name="footer"]');
      // Native browser projection: assignedNodes returns the host's
      // light-DOM children that match each slot's name.
      return {
        ok: true,
        headerAssigned: headerSlot.assignedNodes().map((n) => n.tagName || n.nodeType),
        defaultAssigned: defaultSlot.assignedNodes().map((n) => n.tagName || n.nodeType),
        footerAssigned: footerSlot.assignedNodes().map((n) => n.tagName || n.nodeType),
      };
    });
    assert.ok(sshadow.ok, sshadow.why || 'shadow host should be upgraded');
    assert.ok(sshadow.headerAssigned.includes('H2'),
      `header slot should project H2, got ${JSON.stringify(sshadow.headerAssigned)}`);
    assert.ok(sshadow.footerAssigned.includes('BUTTON'),
      `footer slot should project BUTTON, got ${JSON.stringify(sshadow.footerAssigned)}`);
  });

  test('shadow-DOM partial card shows fallback when footer slot empty', async () => {
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);
    const fb = await page.evaluate(() => {
      const host = document.querySelector('#card-shadow-partial');
      const sr = host?.shadowRoot;
      if (!sr) return null;
      const footerSlot = sr.querySelector('slot[name="footer"]');
      if (!footerSlot) return null;
      // assignedNodes returns empty when fallback content is being shown.
      const assigned = footerSlot.assignedNodes();
      // Slot's fallback text is its own children (in the shadow tree).
      const fallback = footerSlot.textContent.trim();
      return { assignedCount: assigned.length, fallback };
    });
    assert.ok(fb, 'shadow root + footer slot present');
    assert.equal(fb.assignedCount, 0, 'no children projected to footer');
    assert.equal(fb.fallback, 'no actions', 'footer shows fallback text');
  });

  test('light-DOM partial card shows fallback when footer slot empty', async () => {
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const fb = await page.evaluate(() => {
      const host = document.querySelector('#card-partial');
      const footerSlot = host.querySelector('slot[data-webjs-light][name="footer"]');
      if (!footerSlot) return null;
      return {
        projection: footerSlot.getAttribute('data-projection'),
        text: footerSlot.textContent?.trim(),
        assignedCount: footerSlot.assignedNodes().length,
      };
    });
    assert.ok(fb, 'light footer slot present');
    assert.equal(fb.projection, 'fallback', 'projection is fallback');
    assert.equal(fb.text, 'no actions', 'fallback text rendered');
    assert.equal(fb.assignedCount, 0, 'assignedNodes is empty per spec');
  });

  test('light and shadow cards produce equivalent observable output', async () => {
    await page.goto(`${baseUrl}/slot-demo`, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await sleep(500);
    // textContent inside a shadow root does not flatten through native
    // slots, so for shadow cards we read each slot's assignedNodes and
    // concat their text. For light cards we can read the host directly
    // because projection physically moves the children into the slot.
    const observed = await page.evaluate(() => {
      const lightFull = document.querySelector('#card-full');
      const shadowFull = document.querySelector('#card-shadow-full');
      function lightSlotText(host, name) {
        const sel = name ? `slot[data-webjs-light][name="${name}"]` : 'slot[data-webjs-light]:not([name])';
        const slot = host.querySelector(sel);
        return slot ? slot.textContent.trim() : '';
      }
      function shadowSlotText(host, name) {
        const sr = host.shadowRoot;
        if (!sr) return '';
        const sel = name ? `slot[name="${name}"]` : 'slot:not([name])';
        const slot = sr.querySelector(sel);
        if (!slot) return '';
        const nodes = slot.assignedNodes();
        return nodes.map((n) => n.textContent || '').join('').trim();
      }
      return {
        light: {
          header: lightSlotText(lightFull, 'header'),
          footer: lightSlotText(lightFull, 'footer'),
        },
        shadow: {
          header: shadowSlotText(shadowFull, 'header'),
          footer: shadowSlotText(shadowFull, 'footer'),
        },
      };
    });
    assert.equal(observed.light.header, 'Full card');
    assert.equal(observed.shadow.header, 'Shadow full card');
    assert.ok(observed.light.footer.includes('Footer action'));
    assert.ok(observed.shadow.footer.includes('Shadow footer'));
  });

  // ---------------------------------------------------------------------------
  // Display-only component elision (the network probe)
  //
  //   <build-stamp> is purely presentational (static markup, no events,
  //   props, hooks, or slot), so its import is stripped from the served
  //   page source and the browser must never download its module. The
  //   interactive <my-counter> on the same page must still be fetched.
  // ---------------------------------------------------------------------------

  test('display-only component module is never downloaded; interactive one is', async () => {
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => requested.push(req.url());
    page.on('request', onRequest);
    try {
      // Cache disabled so module fetches actually hit the network and
      // show up in the log. networkidle is unusable here: the chat-box
      // WebSocket keeps the connection open, so settle on a fixed delay
      // after domcontentloaded, long enough for the boot script to walk
      // the page's import graph.
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(3000);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }

    const built = requested.some((u) => /\/components\/build-stamp\.(ts|js)/.test(u));
    const counter = requested.some((u) => /\/components\/counter\.(ts|js)/.test(u));

    // The home page renders <build-stamp> correctly without its JS.
    const stampText = await page.evaluate(
      () => document.querySelector('build-stamp')?.textContent?.trim() || '',
    );
    assert.ok(stampText.includes('no-build'), 'build-stamp SSR content is present');

    assert.equal(built, false, 'display-only build-stamp module must NOT be downloaded');
    assert.equal(counter, true, 'interactive counter module must be downloaded');
  });

  test('a display-only component observed via whenDefined IS downloaded (#169)', async () => {
    // Counterpart to the build-stamp probe above. <observed-badge> is just as
    // display-only, but the /observed route imports a module that calls
    // customElements.whenDefined('observed-badge'). That observation forces
    // the badge to ship (eliding it would leave whenDefined unresolved), so
    // the browser MUST download its module. The unobserved build-stamp is the
    // negative control (proven not downloaded by the test above).
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => requested.push(req.url());
    page.on('request', onRequest);
    try {
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/observed`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(3000);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }

    const badgeFetched = requested.some((u) => /\/components\/observed-badge\.(ts|js)/.test(u));
    const badgeText = await page.evaluate(
      () => document.querySelector('observed-badge')?.textContent?.trim() || '',
    );

    assert.match(badgeText, /observed badge/i, 'observed-badge SSR content is present');
    assert.equal(badgeFetched, true,
      'an observed display-only component module MUST be downloaded (forced to ship)');
  });

  test('static interactive = true forces a display-only module onto the wire (#1308)', async () => {
    // The OTHER route to a ship, on the same page as the observation probe.
    // <forced-badge> is display-only in every respect (static markup, no
    // events, no reactive props, no lifecycle hook, light DOM); the one thing
    // keeping it on the wire is the author's `static interactive = true`.
    // Until now that override's only coverage stopped at the analyser
    // returning a boolean, and nothing proved the boot script honours it.
    //
    // build-stamp on the SAME run is the negative control: without it this
    // assertion would also pass if elision had stopped working entirely.
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => requested.push(req.url());
    page.on('request', onRequest);
    try {
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/observed`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(3000);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }

    const forcedFetched = requested.some((u) => /\/components\/forced-badge\.(ts|js)/.test(u));
    const stampFetched = requested.some((u) => /\/components\/build-stamp\.(ts|js)/.test(u));
    const forcedText = await page.evaluate(
      () => document.querySelector('forced-badge')?.textContent?.trim() || '',
    );

    // The progressive-enhancement half: the markup is in the first paint.
    assert.match(forcedText, /forced badge/i, 'forced-badge SSR content is present');
    assert.equal(forcedFetched, true,
      'static interactive = true MUST keep the module on the wire');
    assert.equal(stampFetched, false,
      'negative control: an unoverridden display-only module is still elided on this run');
  });

  test('willUpdate-derived state and reflected props are in the SSR HTML before JS (#217)', async () => {
    // <ssr-derived-badge seed="42"> derives its text in willUpdate and flips a
    // reflect:true `ready` boolean there. The SSR walker now runs willUpdate
    // and reflects properties before render(), so both must be present in the
    // raw served HTML (a JS-off view), then unchanged after hydration (no flash).
    const res = await fetch(`${baseUrl}/observed`);
    const rawHtml = await res.text();
    // JS-off proof: the derived text and the reflected attribute are in the
    // server response, not produced by client hydration.
    assert.match(rawHtml, /derived-from-42/, 'willUpdate-derived text is in the SSR HTML');
    assert.match(rawHtml, /<ssr-derived-badge[^>]*\bready\b/,
      'reflect:true property set in willUpdate appears as an attribute in the SSR HTML');

    // Post-hydration: a real browser keeps the same derived text and attribute
    // (SSR and the client first render agree, so there is no flash/divergence).
    await page.goto(`${baseUrl}/observed`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const state = await waitForCond(
      async () => await page.evaluate(() => {
        const el = document.querySelector('ssr-derived-badge');
        if (!el) return null;
        return { text: el.textContent.trim(), ready: el.hasAttribute('ready') };
      }),
      5000,
      () => 'ssr-derived-badge did not settle',
    ).then(() => page.evaluate(() => {
      const el = document.querySelector('ssr-derived-badge');
      return { text: el.textContent.trim(), ready: el.hasAttribute('ready') };
    }));
    assert.equal(state.text, 'derived-from-42', 'derived text unchanged after hydration');
    assert.equal(state.ready, true, 'reflected ready attribute unchanged after hydration');
  });

  test('a fully-static route (/about) drops its page module from the boot', async () => {
    // /about renders only static markup (no events, signals, or custom
    // elements), so its page module is inert and dropped from the boot
    // script. The root layout is import-only too (it no longer imports the
    // client router, #620), so layout.ts is ALSO dropped; the layout's
    // theme-toggle component is re-emitted directly and loads @webjsdev/core,
    // which auto-enables the client router, so SPA nav keeps working.
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => requested.push(req.url());
    page.on('request', onRequest);
    try {
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/about`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(2500);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }
    const aboutPageFetched = requested.some((u) => /about\/page\.(ts|js)/.test(u));
    const aLayoutFetched = requested.some((u) => /\/layout\.(ts|js)/.test(u));
    const themeToggleFetched = requested.some((u) => /theme-toggle\.(ts|js)/.test(u));
    const rendered = await page.evaluate(() => document.body.textContent || '');

    assert.match(rendered, /full-stack demo/i, '/about content is server-rendered');
    assert.equal(aboutPageFetched, false, 'inert /about page module must NOT be downloaded');
    assert.equal(aLayoutFetched, false, 'the import-only layout module is dropped too (#620)');
    assert.equal(themeToggleFetched, true, 're-emitted component loads core, which auto-enables the router (SPA nav intact)');
  });

  // ---------------------------------------------------------------------------
  // Vendor-package elision (the network probe for #170)
  //
  //   <vendor-badge> is display-only and its ONLY non-core dependency is
  //   the `dayjs` npm package (a binding import, not an interactivity
  //   signal). Because the component is elided, the bare-import scan skips
  //   its file, so dayjs never enters the importmap and the browser never
  //   fetches it from the CDN. The badge's dayjs-formatted text is still
  //   SSR'd. Mirrors the <build-stamp> probe one section up.
  // ---------------------------------------------------------------------------

  test('vendor package used only by a display-only component is never fetched (#170)', async () => {
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => requested.push(req.url());
    page.on('request', onRequest);
    try {
      // Cache disabled so a real dayjs fetch would hit the network and show
      // up in the log. Settle on a fixed delay after domcontentloaded (the
      // chat WebSocket keeps the connection open, so networkidle is unusable)
      // long enough for the boot script to walk the import graph.
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(3000);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }

    // dayjs resolves to a jspm.io CDN URL when it is in the importmap. If the
    // package were shipped, the browser would fetch a URL containing 'dayjs'.
    const dayjsFetched = requested.some((u) => /dayjs/i.test(u));
    // The badge's import is stripped from the served page source, so its
    // module is never downloaded either.
    const badgeFetched = requested.some((u) => /\/components\/vendor-badge\.(ts|js)/.test(u));

    // The home page renders <vendor-badge> correctly without its JS: the
    // dayjs-formatted date is computed server-side and inlined.
    const badgeText = await page.evaluate(
      () => document.querySelector('vendor-badge')?.textContent?.trim() || '',
    );
    assert.match(badgeText, /released\b/i, 'vendor-badge SSR content is present');
    assert.match(badgeText, /\b2026\b/, 'vendor-badge dayjs-formatted year is SSR-rendered');

    // The served importmap has no entry for dayjs (pruned because the only
    // importer is elided and the map is resolved live, not from a pin file).
    const hasDayjsEntry = await page.evaluate(() => {
      const s = document.querySelector('script[type="importmap"]');
      if (!s) return false;
      const map = JSON.parse(s.textContent);
      return Object.keys(map.imports || {}).some((k) => /dayjs/i.test(k));
    });

    assert.equal(dayjsFetched, false, 'dayjs (used only by an elided component) must NOT be fetched');
    assert.equal(badgeFetched, false, 'display-only vendor-badge module must NOT be downloaded');
    assert.equal(hasDayjsEntry, false, 'dayjs must NOT have an importmap entry');
  });

  // ---------------------------------------------------------------------------
  // Inert-route zero-JS probe (#170)
  //
  //   /static-info is a fully-static page (no custom elements, events,
  //   signals, or npm imports). Its inert page module is dropped from the
  //   boot, and the import-only root layout is dropped too (#620); the only
  //   remaining import is the layout's re-emitted theme-toggle component,
  //   which loads core and auto-enables the router. Asserts on the served
  //   boot script directly, complementing the request-log <about> probe above.
  // ---------------------------------------------------------------------------

  test('inert route /static-info ships zero application page JS (#170)', async () => {
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => requested.push(req.url());
    page.on('request', onRequest);
    try {
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/static-info`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(2500);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }

    // The inline boot script's import specifiers: the page module must be
    // absent; the root layout is import-only and ALSO dropped (#620, it no
    // longer imports the client router), so the only application module the
    // boot emits is the layout's theme-toggle component, which loads
    // @webjsdev/core and auto-enables the router (SPA nav intact).
    const bootImports = await page.evaluate(() => {
      const scripts = [...document.querySelectorAll('script[type="module"]:not([src])')];
      const specs = [];
      for (const s of scripts) {
        for (const m of s.textContent.matchAll(/import\s+["']([^"']+)["']/g)) specs.push(m[1]);
      }
      return specs;
    });
    const pageInBoot = bootImports.some((s) => /static-info\/page\.(ts|js)/.test(s));
    const layoutInBoot = bootImports.some((s) => /\/layout\.(ts|js)/.test(s));
    const themeToggleInBoot = bootImports.some((s) => /theme-toggle\.(ts|js)/.test(s));
    const pageFetched = requested.some((u) => /static-info\/page\.(ts|js)/.test(u));
    const rendered = await page.evaluate(() => document.body.textContent || '');

    assert.match(rendered, /zero application JS/i, '/static-info content is server-rendered');
    assert.equal(pageInBoot, false, 'inert page module must NOT appear in the boot script');
    assert.equal(pageFetched, false, 'inert page module must NOT be downloaded');
    assert.equal(layoutInBoot, false, 'the import-only layout module is dropped too (#620)');
    assert.equal(themeToggleInBoot, true, 're-emitted component loads core, which auto-enables the router (SPA nav intact)');
  });

  test('a bare async-render leaf is elided: its module is never fetched, JS-off + JS-on render it (#474)', async () => {
    // JS-OFF: the raw SSR HTML must already contain the async-baked quote
    // (progressive-enhancement-safe; the elided module is never needed to read).
    const rawHtml = await fetch(baseUrl + '/async-leaf').then((r) => r.text());
    assert.ok(
      /What you read is what runs\./.test(rawHtml),
      'the bare-async leaf data is in the raw SSR HTML (JS-off readable)',
    );
    assert.ok(
      !/components\/inline-quote\.(ts|js)/.test(rawHtml),
      'the elided leaf module is not even referenced (no import, no modulepreload) in the served HTML',
    );

    // JS-ON: load with a real browser, probe the network, and prove the
    // inline-quote module is NEVER downloaded while the quote is on screen and
    // no script errors fire.
    /** @type {string[]} */
    const requested = [];
    /** @type {string[]} */
    const errors = [];
    const onRequest = (req) => requested.push(req.url());
    const onError = (e) => errors.push(e.message);
    page.on('request', onRequest);
    page.on('pageerror', onError);
    try {
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/async-leaf`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(2000);
    } finally {
      page.off('request', onRequest);
      page.off('pageerror', onError);
      await page.setCacheEnabled(true);
    }
    const moduleFetched = requested.some((u) => /components\/inline-quote\.(ts|js)/.test(u));
    const onScreen = await page.evaluate(() => document.body.innerText.includes('What you read is what runs.'));
    assert.equal(moduleFetched, false, 'the elided bare-async leaf module must NOT be downloaded by the browser');
    assert.ok(onScreen, 'the elided leaf renders its async-baked content with JS on');
    assert.deepEqual(errors, [], `no page errors on the elided leaf route; got ${JSON.stringify(errors)}`);
  });

  test('a streamed bare-async component (slow-fact) is elided while its interactive sibling (async-greeting) ships (#474)', async () => {
    // /stream-demo wraps <slow-fact> (bare async, light DOM) in <webjs-suspense>
    // and renders <async-greeting> (async + @click). Under #474 the slow-fact
    // module is elided (its streamed light-DOM content needs no JS to display),
    // while async-greeting ships (the @click is a client signal). Probe both.
    /** @type {string[]} */
    const requested = [];
    const onRequest = (req) => requested.push(req.url());
    page.on('request', onRequest);
    try {
      await page.setCacheEnabled(false);
      await page.goto(`${baseUrl}/stream-demo`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Wait for the slow boundary (400ms) to stream in.
      await page.waitForFunction(
        () => document.body.innerText.includes('The answer is 42'),
        { timeout: 8000 },
      );
      await sleep(500);
    } finally {
      page.off('request', onRequest);
      await page.setCacheEnabled(true);
    }
    const slowFactFetched = requested.some((u) => /components\/slow-fact\.(ts|js)/.test(u));
    const greetingFetched = requested.some((u) => /components\/async-greeting\.(ts|js)/.test(u));
    assert.equal(slowFactFetched, false, 'the elided bare-async slow-fact module must NOT be downloaded');
    assert.equal(greetingFetched, true, 'the interactive async-greeting module (it has @click) MUST ship');
    // The streamed content is present despite the module being elided.
    const factOnScreen = await page.evaluate(() => document.body.innerText.includes('The answer is 42'));
    assert.ok(factOnScreen, 'the streamed slow-fact content displays without its module (light-DOM HTML)');
  });

  // --- Differential elision: ON vs OFF must be observably identical (#181) ---
  //
  // `page` runs the default (elision ON) blog; `offPage` runs a SECOND blog
  // instance with WEBJS_ELIDE=0 (everything ships). The invariant is that
  // removing the elided JS never changes what the user sees or can do, so a
  // real browser must render the same DOM and behave the same on both. The
  // SAFE direction (over-ship) is invisible here; only the DANGEROUS
  // direction (a needed module wrongly dropped, blanking content or breaking
  // an interaction) makes these fail. This is the layer that would have
  // caught the build-stamp regression instantly.
  //
  // The off-server lives in this nested describe (started lazily, torn down
  // right after) rather than the suite-wide setup, so the rest of the e2e
  // suite never pays for a second always-on dev server. Running two servers
  // for the whole run added enough load to tip timing-sensitive tests into
  // 5s waitFor timeouts.
  describe('differential elision (#181)', () => {
    before(async () => {
      const offPort = await freePort();
      offBaseUrl = `http://localhost:${offPort}`;
      // The OFF server resolves its vendors from this repo, not the public
      // internet (#1228). Elision ON drops `components/vendor-badge.ts`, the
      // blog's only vendor consumer, so the ON server never calls jspm and the
      // ON page never fetches from a CDN. OFF ships that component, which puts
      // a blocking `api.jspm.io/generate` POST on the server's cold first
      // request AND a `https://ga.jspm.io/...` module fetch inside
      // `app/page.ts`'s graph. A module graph instantiates as a unit, so either
      // one failing means `app/page.ts` never evaluates and NOTHING it imports
      // registers, including the counter these tests drive. That is what redded
      // this block on and off from 2026-08-02, reported as an elision defect
      // when it was CDN reachability. Stubbing the API call closes both holes,
      // since the URL the browser fetches is whatever that map says.
      offServerProcess = await startBlog(
        offPort,
        { WEBJS_ELIDE: '0' },
        preloadArgs(resolve(ROOT, 'test', 'e2e', 'fixtures', 'stub-jspm.mjs')),
      );
      offPage = await browser.newPage();

      // No browser-side warmup here on purpose. An earlier revision navigated
      // offPage twice before the tests, to pay the cold dev server's on-demand
      // transform cost off the clock. Two things killed that idea. Its premise
      // was wrong: module scripts are deferred and DOMContentLoaded waits for
      // deferred scripts, so goto(domcontentloaded) already absorbs the whole
      // module graph and there is no residual for a warmup to remove (measured
      // with a 4s delay injected on the counter module, goto took 4076ms and
      // the element was upgraded by the time it returned). And it correlated
      // with CI failures on the pushes that carried it. That attribution did
      // NOT hold up: the same failure recurred without the warmup, and the
      // cause turned out to be the vendor fetch above (#1228), not the warmup.
      // What stands is the narrower point, that driving extra navigations
      // through the page under test buys nothing measurable and changes
      // browser-side state the assertions then depend on.
    });

    after(async () => {
      if (offPage) await offPage.close();
      if (offServerProcess) {
        offServerProcess.kill('SIGTERM');
        await new Promise((r) => { offServerProcess.on('exit', r); setTimeout(r, 3000); });
      }
    });

    // Snapshot the observable content of <main>: visible text and the ordered
    // tag structure, with the two things that are not a function of elision
    // held out.
    //
    // 1. The wall-clock, which ticks between the two snapshots. Both the
    //    12-hour and 24-hour renderings are matched, since which one appears
    //    depends on the runner's default locale.
    //
    // 2. Everything INSIDE <chat-box>. The element itself stays in the tag
    //    list, so a chat-box that failed to render at all is still caught, but
    //    its contents are dropped wholesale.
    //
    //    That is a blunt cut and it is deliberate. chat-box's pane is a live
    //    websocket feed, and the two pages hold sockets to two DIFFERENT
    //    servers: the OFF server is created privately in this block, the ON
    //    server is shared with the whole suite. Every join and leave on either
    //    appends a line with no counterpart on the other, and a reconnect
    //    appends another. Those are independent populations, so no amount of
    //    waiting converges them. Earlier revisions tried to keep the status
    //    header while excluding just the pane, which needs the pane identified
    //    by content or position inside markup that carries neither an id nor a
    //    data hook; that machinery went wrong repeatedly under review and is
    //    not worth its weight for a widget this block is not testing.
    //
    //    The cost is explicit: chat-box's own hydration and its header/form
    //    structure are no longer covered here. The counter still covers
    //    hydration on both sides, which is what this block is for.
    const observableMain = (pg) => pg.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      // Clone so the live DOM is untouched and a later snapshot of the same
      // page still sees the real thing.
      const copy = /** @type {HTMLElement} */ (main.cloneNode(true));
      for (const box of copy.querySelectorAll('chat-box')) box.replaceChildren();
      const text = (copy.textContent || '')
        .replace(/\d{1,2}:\d{2}:\d{2}\s?[AP]M/gi, 'TIME')
        .replace(/\d{1,2}:\d{2}:\d{2}/g, 'TIME')
        .replace(/\s+/g, ' ')
        .trim();
      const tags = [...copy.querySelectorAll('*')].map((el) => el.tagName.toLowerCase());
      return { text, tags };
    });


    /**
     * Wait until the page has actually hydrated, instead of sleeping and hoping.
     *
     * The counter is ONE of the page's interactive components, not all of
     * them: <chat-box> is inside <main> too, and <theme-toggle> is in the root
     * layout. So this is a wait for the component the assertions drive, not a
     * whole-page hydration barrier. chat-box is not waited on because its
     * contents are excluded from the snapshot entirely (see observableMain).
     *
     * The signal is that the ELEMENT INSTANCE has been upgraded, tested with
     * `instanceof` against the registered constructor. Nothing weaker works
     * here, because SSR already emits the counter's full inner markup:
     *
     *     <my-counter count="3" data-wj-host><!--webjs-hydrate-->
     *       <button aria-label="Decrement">...<output>3</output>
     *       <button aria-label="Increment">...
     *
     * So the host, the output and both buttons exist before a single line of
     * JavaScript has run. Waiting on any of them is waiting on the server's
     * HTML, which is always already true, and a click at that point lands on a
     * real button with no listener attached and is silently swallowed. Before
     * upgrade the element is a plain HTMLElement; only after it is an instance
     * of the registered class, which is the first moment the `@click` binding
     * exists. `my-counter` is a LIGHT-DOM component, so there is no shadow root
     * to look inside for a different answer.
     * @param {import('puppeteer-core').Page} p
     * @param {string} which  'ON' or 'OFF', named in the failure message
     */
    const waitForHydration = async (p, which) => {
      try {
        await p.waitForFunction(() => {
          const C = customElements.get('my-counter');
          return !!(C && document.querySelector('my-counter') instanceof C);
        }, { timeout: 15000, polling: 50 });
      } catch (waitErr) {
        // Say what failed and what it most likely means. A bare puppeteer
        // "Waiting failed: 15000ms exceeded" names neither the page nor the
        // condition, which is the same diagnostic dead end the old off-by-one
        // counter assertion was. Report what is actually on the page.
        //
        // Only a genuine timeout is evidence about hydration. waitForFunction
        // also rejects for reasons that say nothing about it (a detached frame,
        // a target crash, a navigation mid-wait), so those are rethrown as
        // themselves rather than relabelled as a suspected elision defect.
        if (!/timeout|Waiting failed/i.test(String(waitErr && waitErr.message))) throw waitErr;
        const state = await p.evaluate(() => {
          const C = customElements.get('my-counter');
          // A module graph instantiates as a unit, so when define never runs
          // the usual reason is that ONE member of the graph did not load and
          // took every other member down with it, including modules that
          // fetched fine. Name the candidates instead of leaving the next
          // reader to guess: anything the page fetched from another origin
          // (#1228 was exactly this, a vendor module from a CDN), and anything
          // that came back an error. `responseStatus` is 0 for an opaque or
          // failed cross-origin fetch, so it is reported only when readable.
          const suspects = performance.getEntriesByType('resource')
            .filter((e) => {
              const crossOrigin = !e.name.startsWith(location.origin) && /^https?:/.test(e.name);
              return crossOrigin || (typeof e.responseStatus === 'number' && e.responseStatus >= 400);
            })
            .map((e) => `${typeof e.responseStatus === 'number' && e.responseStatus ? e.responseStatus : 'status unknown'} ${e.name}`);
          return {
            defined: !!C,
            host: !!document.querySelector('my-counter'),
            upgraded: !!(C && document.querySelector('my-counter') instanceof C),
            suspects,
          };
        }).catch(() => null);
        // Never print an unobserved state as a fact. When the probe itself
        // fails there is nothing to report, and asserting "define DID NOT run"
        // from a null reading would send the next reader after the wrong bug.
        const detail = state
          ? `customElements.define ${state.defined ? 'ran' : 'DID NOT run'}, `
            + `host ${state.host ? 'present' : 'absent'}, `
            + `instance ${state.upgraded ? 'upgraded' : 'NOT upgraded'}`
            // What can produce a missing define depends on WHICH page this is,
            // so do not offer the OFF page a cause that cannot happen there.
            // The OFF server runs with WEBJS_ELIDE=0, which empties the
            // elidable sets wholesale, so elision drops nothing and the only
            // remaining cause is the page's module graph never evaluating.
            // Offering elision there as a coequal possibility would re-suggest
            // the exact misreading #1228 was.
            + (state.defined
              ? ''
              : `. The graph did not evaluate: a member of it failed to load, or one threw at module scope. Either aborts `
                + 'the WHOLE graph, so the component\'s own module never runs even though it fetched fine.'
                + (which === 'OFF'
                  ? ' Elision is not a candidate here, since this server runs with WEBJS_ELIDE=0 and drops nothing.'
                  : ' The other possibility on this page is elision wrongly dropping the component, in which case its module'
                    + ' was never in the graph at all.')
                + ' Off-origin or failed resources on the page: '
                + (state.suspects.length ? state.suspects.join(', ') : 'none'))
          : 'the page could not be probed for its state, so nothing is known beyond the timeout';
        throw new Error(`${which} page never upgraded <my-counter> within 15s (${detail}).`);
      }
    };

    // The guard on the wiring in this block's before(). Everything below
    // assumes the OFF server resolved its vendors from this repo rather than
    // over the internet, and nothing else checks that: the fixture's own unit
    // tests exercise it in isolation and never touch `preloadArgs`,
    // `startBlog`, or a running server. So without this, deleting the
    // `preloadArgs(...)` argument, renaming Bun's `--preload`, or moving the
    // fixture leaves every test green while quietly restoring the live-CDN
    // dependency, and this block goes back to being intermittently red months
    // later, which is the failure #1228 was.
    //
    // The importmap is the right thing to read because it is where the two
    // paths diverge: the stub answers the server's resolve, so a `data:` target
    // can only have come from it, and an `https://` one can only mean the real
    // API answered. The ON-side test for #170 reads the map the same way.
    test('the OFF server resolved its vendor from the repo, not from a CDN', async () => {
      await offPage.goto(`${offBaseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const dayjsTarget = await offPage.evaluate(() => {
        const s = document.querySelector('script[type="importmap"]');
        if (!s) return null;
        const map = JSON.parse(s.textContent);
        const key = Object.keys(map.imports || {}).find((k) => /^dayjs$/i.test(k));
        return key ? map.imports[key] : null;
      });
      // Absent is a failure too, not a pass: the OFF build ships vendor-badge,
      // so an importmap with no dayjs entry is the unresolved-bare-specifier
      // case that kills the whole page graph.
      assert.ok(dayjsTarget, 'the OFF page must carry an importmap entry for dayjs');
      assert.match(
        dayjsTarget,
        /^data:/,
        `the OFF server must resolve dayjs locally via the stub, got ${dayjsTarget}. `
        + 'The stub is loaded by the preloadArgs() argument in this block\'s before().',
      );
    });

    test('the mixed page renders identically on vs off', async () => {
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await offPage.goto(`${offBaseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForHydration(page, 'ON');
      await waitForHydration(offPage, 'OFF');
      const onSnap = await observableMain(page);
      const offSnap = await observableMain(offPage);
      // The display-only badges (build-stamp, vendor-badge, muted-text) are
      // elided ON and shipped OFF, yet their rendered output must match: that
      // identity is exactly why they are safe to elide.
      assert.deepEqual(onSnap.tags, offSnap.tags,
        'post-hydration tag structure of <main> must match on vs off');
      assert.equal(onSnap.text, offSnap.text,
        'post-hydration visible text of <main> must match on vs off');
    });

    test('the interactive counter behaves identically on vs off', async () => {
      // The counter is interactive, so it ships in BOTH builds and MUST work
      // in both. If elision ever wrongly dropped its module on the ON side,
      // the ON counter would not increment and this assertion fails: the live
      // guard for the dangerous direction.
      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await offPage.goto(`${offBaseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForHydration(page, 'ON');
      await waitForHydration(offPage, 'OFF');

      const onSeed = await getCounterValue(page);
      assert.equal(onSeed, await getCounterValue(offPage),
        'counter seeds to the same value on vs off');
      await clickCounterButton(page, 'Increment');
      await clickCounterButton(offPage, 'Increment');
      // The click sets a reactive property, and that re-render is batched to a
      // microtask, so the new value is NOT readable synchronously. Wait for it
      // to land on both sides rather than sleeping a guessed interval.
      //
      // A failure here is REPORTED, not swallowed. Discarding it would leave
      // the run to fall through to the on-vs-off assertion below and fail as
      // `on=4, off=3`, which is precisely the misleading message this block is
      // supposed to stop producing: it names a counter mismatch when what
      // actually happened is that one side never applied its click. This wait
      // knows which side it was and what the value got stuck on, so it says so.
      const settled = async (p, which) => {
        try {
          await p.waitForFunction(
            // Every hop optional-chained: a missing <output> must make the
            // predicate FALSE (so the wait times out and reports which side
            // stalled), not throw a TypeError that the handler below cannot
            // recognise as a timeout and rethrows raw, unlabelled.
            (want) => parseInt(document.querySelector('my-counter')?.querySelector('output')?.textContent?.trim() ?? '', 10) === want,
            { timeout: 10000, polling: 25 },
            onSeed + 1,
          );
        } catch (err) {
          if (!/timeout|Waiting failed/i.test(String(err && err.message))) throw err;
          const got = await getCounterValue(p).catch(() => null);
          throw new Error(
            `${which} counter never reached ${onSeed + 1} within 10s of the click (still ${got}). `
            + 'The click did not take effect on that side.',
          );
        }
      };
      await settled(page, 'ON');
      await settled(offPage, 'OFF');
      const onAfter = await getCounterValue(page);
      const offAfter = await getCounterValue(offPage);
      assert.equal(onAfter, offAfter, `counter increments identically on vs off (on=${onAfter}, off=${offAfter})`);
      assert.equal(onAfter, 4, `counter incremented from its seed (got ${onAfter})`);
    });

    test('the fully-static route renders identically on vs off', async () => {
      // This route ships no component of its OWN (its page module is dropped),
      // but it is not JS-free: the boot re-emits the root layout's
      // theme-toggle, which loads @webjsdev/core and enables the client router
      // (see the docstring on examples/blog/app/static-info/page.ts). Nothing
      // inside <main> depends on that, which is the scope this asserts on, so
      // there is no component here to poll for and `load` (every subresource
      // settled) is the real condition the old sleep stood in for.
      await page.goto(`${baseUrl}/static-info`, { waitUntil: 'load', timeout: 30000 });
      await offPage.goto(`${offBaseUrl}/static-info`, { waitUntil: 'load', timeout: 30000 });
      const onSnap = await observableMain(page);
      const offSnap = await observableMain(offPage);
      assert.deepEqual(onSnap.tags, offSnap.tags, 'static route tag structure must match on vs off');
      assert.equal(onSnap.text, offSnap.text, 'static route visible text must match on vs off');
    });
  });

  test('prefetch: hovering an internal link warms the cache; the click consumes it via SPA swap (no second fetch)', async () => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    // Inject our own internal link to a real route (/about) so the test
    // is independent of DB state and the layout's nav markup. The router
    // intercepts document-level clicks on any same-origin <a>, so an
    // injected light-DOM link exercises the exact prefetch + click path.
    // Stamp a sentinel on window: a full-page reload discards it, a
    // client-router SPA swap keeps it. The sentinel is what proves the
    // click was a cache-consuming swap and not a full navigation, which
    // would ALSO issue zero x-webjs-router requests and pass the
    // "no second fetch" assertion for the wrong reason.
    const href = '/about';
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/about';
      a.id = 'e2e-prefetch-link';
      a.textContent = 'about (e2e)';
      (document.querySelector('main') || document.body).appendChild(a);
      window.__e2ePrefetchSentinel = 'alive';
      // Latch the webjs:prefetch event (fires the instant the fragment is
      // cached and consumable) BEFORE hovering, so the click below waits
      // for the cache to be warm rather than racing the response.
      window.__e2ePrefetchCached = false;
      document.addEventListener('webjs:prefetch', (e) => {
        const u = e.detail && e.detail.url;
        if (typeof u === 'string' && (u === '/about' || u.endsWith('/about'))) {
          window.__e2ePrefetchCached = true;
        }
      });
    });

    // Count document requests to that pathname, split by the prefetch
    // header the prefetch path sets versus a real router navigation.
    const hits = { prefetch: 0, nav: 0 };
    const onRequest = (req) => {
      let p;
      try { p = new URL(req.url()).pathname; } catch { return; }
      if (p !== href) return;
      const h = req.headers();
      if (h['x-webjs-prefetch']) hits.prefetch++;
      else if (h['x-webjs-router']) hits.nav++;
    };
    page.on('request', onRequest);
    try {
      // Hover, then poll for the prefetch (past the ~100ms intent dwell +
      // the fetch round-trip) instead of a single fixed sleep, so a slow
      // CI box does not flake.
      await page.evaluate(() => {
        document.getElementById('e2e-prefetch-link')
          ?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      });
      await waitFor(() => hits.prefetch >= 1, 4000,
        () => `hover should issue a speculative prefetch GET for ${href} (got ${hits.prefetch})`);
      const afterHover = hits.prefetch;

      // The prefetch REQUEST going out is not the same as the fragment
      // being CACHED: the router stores the entry only after it reads the
      // response body (prefetchStore runs inside the fetch `.then`).
      // Clicking in that window misses the cache and issues a real
      // navigation fetch, which is the race this test used to flake on.
      // Wait for the webjs:prefetch latch set above, so the click is
      // guaranteed to consume the cached fragment.
      await waitForCond(() => page.evaluate(() => window.__e2ePrefetchCached === true), 4000,
        () => `prefetch fragment for ${href} should become cached (webjs:prefetch) before the click`);

      // Click; poll until the URL reflects the navigation.
      await page.evaluate(() => {
        document.getElementById('e2e-prefetch-link')?.click();
      });
      await waitFor(() => page.url().includes(href), 4000,
        () => `should have navigated to ${href}, got ${page.url()}`);
      await sleep(300); // let any (erroneous) second fetch land before asserting absence

      // The sentinel survives ONLY if the click was a client-router swap.
      // If the router were disabled, the click would full-page navigate,
      // discard the sentinel, AND issue no x-webjs-router request, so this
      // assertion is what stops the "no second fetch" check from passing
      // vacuously.
      const sentinel = await page.evaluate(() => window.__e2ePrefetchSentinel);
      assert.equal(sentinel, 'alive',
        'click must be a client-router SPA swap (sentinel survived), not a full-page reload');
      assert.equal(hits.nav, 0, 'click consumed the prefetch cache, no second document fetch');
      assert.equal(hits.prefetch, afterHover, 'no extra prefetch fired during the click');
    } finally {
      page.off('request', onRequest);
    }
  });

  test('navigation-error: a JSON 500 nav fires webjs:navigation-error and recovers in place (no full reload) (#249)', async () => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    // Inject an internal link to /boom (a route.ts that always 500s with a
    // JSON body). The router intercepts the document-level click, fetches,
    // sees a non-HTML error response, and (the #249 fix) dispatches
    // webjs:navigation-error + recovers in place instead of a full reload.
    // A window sentinel proves no full-page navigation happened: a reload
    // discards it, an in-place recovery keeps it.
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/boom';
      a.id = 'e2e-naverror-link';
      a.textContent = 'boom (e2e)';
      (document.querySelector('main') || document.body).appendChild(a);
      window.__e2eNavErrorSentinel = 'alive';
      window.__e2eNavErrorEvent = null;
      document.addEventListener('webjs:navigation-error', (e) => {
        window.__e2eNavErrorEvent = {
          url: e.detail && e.detail.url,
          status: e.detail && e.detail.status,
          hasError: !!(e.detail && e.detail.error),
        };
      });
    });

    await page.evaluate(() => {
      document.getElementById('e2e-naverror-link')?.click();
    });

    // Poll for the navigation-error event the router dispatched.
    await waitForCond(
      () => page.evaluate(() => window.__e2eNavErrorEvent !== null),
      5000,
      () => 'a /boom (JSON 500) client nav should fire webjs:navigation-error',
    );

    const evt = await page.evaluate(() => window.__e2eNavErrorEvent);
    assert.ok(String(evt.url).endsWith('/boom'), 'detail.url is the failed URL');
    assert.equal(evt.status, 500, 'detail.status is the HTTP status (500)');
    assert.equal(evt.hasError, false, 'detail.error is null when a response arrived');

    // No full reload: the window sentinel survived, proving the router
    // recovered in place rather than abandoning the SPA with location.href.
    const sentinel = await page.evaluate(() => window.__e2eNavErrorSentinel);
    assert.equal(sentinel, 'alive',
      'navigation-error must recover in place (sentinel survived), not full-reload');

    // The default in-place error surface (role="alert") was rendered.
    const hasAlert = await page.evaluate(() =>
      !!document.querySelector('[data-webjs-nav-error][role="alert"]'));
    assert.ok(hasAlert, 'a role="alert" in-place error surface was rendered');
  });

  test('prefetch: a normal link prefetches on hover, but cross-origin and data-prefetch="none" do not', async () => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      // Positive control: a plain same-origin link MUST prefetch on hover.
      // Without it, the negative assertions below could pass simply because
      // the hover listener never attached.
      const ok = document.createElement('a');
      ok.href = '/about';
      ok.id = 'e2e-ctrl-link';
      ok.textContent = 'control';
      const ext = document.createElement('a');
      ext.href = 'https://example.com/somewhere';
      ext.id = 'e2e-ext-link';
      ext.textContent = 'external';
      const opt = document.createElement('a');
      opt.href = '/dashboard';
      opt.setAttribute('data-prefetch', 'none');
      opt.id = 'e2e-optout-link';
      opt.textContent = 'opted-out';
      main.append(ok, ext, opt);
    });

    // Track prefetch requests by destination origin / pathname.
    const pf = { control: 0, ext: 0, optout: 0 };
    const origin = new URL(baseUrl).origin;
    const onRequest = (req) => {
      if (!req.headers()['x-webjs-prefetch']) return;
      let u;
      try { u = new URL(req.url()); } catch { return; }
      if (u.origin !== origin) { pf.ext++; return; }
      if (u.pathname === '/about') pf.control++;
      else if (u.pathname === '/dashboard') pf.optout++;
    };
    page.on('request', onRequest);
    try {
      await page.evaluate(() => {
        for (const id of ['e2e-ctrl-link', 'e2e-ext-link', 'e2e-optout-link']) {
          document.getElementById(id)
            ?.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        }
      });
      // The positive control proves the listener is live; only then do the
      // negative assertions carry meaning.
      await waitFor(() => pf.control >= 1, 4000,
        () => `the control link should prefetch on hover (got ${pf.control})`);
      await sleep(300);
      assert.equal(pf.ext, 0, 'cross-origin link must not trigger a webjs prefetch');
      assert.equal(pf.optout, 0, 'data-prefetch="none" link must not trigger a webjs prefetch');
    } finally {
      page.off('request', onRequest);
    }
  });

  test('prefetch: a data-prefetch="viewport" link warms only after it scrolls into view, not on load (#530)', async () => {
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(2000);

    // A unique query gives a distinct prefetch-cache key, so a prior test that
    // warmed /about cannot mask this one. /about is a real page (200 text/html).
    const vpHref = '/about?probe=e2e-viewport';
    await page.evaluate((href) => {
      const main = document.querySelector('main') || document.body;
      // Push the link far below the fold so it starts OUTSIDE the viewport.
      const spacer = document.createElement('div');
      spacer.id = 'e2e-vp-spacer';
      spacer.style.height = '4000px';
      const a = document.createElement('a');
      a.href = href;
      a.id = 'e2e-vp-link';
      a.setAttribute('data-prefetch', 'viewport');
      a.textContent = 'viewport link';
      main.append(spacer, a);
      // A re-scan (what a soft nav fires) makes the router observe the new link.
      document.dispatchEvent(new Event('webjs:navigate'));
      window.scrollTo(0, 0);
    }, vpHref);

    let warmed = 0;
    const origin = new URL(baseUrl).origin;
    const onRequest = (req) => {
      if (!req.headers()['x-webjs-prefetch']) return;
      let u; try { u = new URL(req.url()); } catch { return; }
      if (u.origin === origin && u.pathname === '/about' && u.search.includes('probe=e2e-viewport')) warmed++;
    };
    page.on('request', onRequest);
    try {
      // Off-screen: the viewport link must NOT prefetch on load (not eager).
      await sleep(700);
      assert.equal(warmed, 0, 'a viewport link below the fold must not prefetch before it is seen');

      // Scroll it into view and let it settle past the ~250ms dwell.
      await page.evaluate(() => document.getElementById('e2e-vp-link')?.scrollIntoView());
      await waitFor(() => warmed >= 1, 4000,
        () => `a viewport link scrolled into view should warm once it dwells (got ${warmed})`);
      await sleep(300);
      assert.equal(warmed, 1, 'a settled viewport link warms exactly once');
    } finally {
      page.off('request', onRequest);
    }
  });

  test('prefetch: on a TOUCH viewport, a bare link (no data-prefetch) defaults to viewport prefetch (#530)', async () => {
    // Force the touch modality (no hover) through the matchMedia shim the before
    // hook installs, so the adaptive default resolves a bare link to `viewport`
    // and it warms on scroll-into-view rather than needing a hover that touch
    // cannot produce. Reset the flag in finally so later tests keep the desktop
    // model. CI Chromium does not support emulateMediaFeatures for hover, so the
    // shim is how the modality is controlled.
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    try {
      await page.evaluate(() => { window.__webjsForceTouch = true; });
      await sleep(1500);

      const touchHref = '/about?probe=e2e-touch-default';
      await page.evaluate((href) => {
        const main = document.querySelector('main') || document.body;
        const spacer = document.createElement('div');
        spacer.style.height = '4000px';
        const a = document.createElement('a');
        a.href = href;          // NO data-prefetch: relies on the adaptive default
        a.id = 'e2e-touch-link';
        a.textContent = 'touch default link';
        main.append(spacer, a);
        document.dispatchEvent(new Event('webjs:navigate'));
        window.scrollTo(0, 0);
      }, touchHref);

      let warmed = 0;
      const origin = new URL(baseUrl).origin;
      const onRequest = (req) => {
        if (!req.headers()['x-webjs-prefetch']) return;
        let u; try { u = new URL(req.url()); } catch { return; }
        if (u.origin === origin && u.pathname === '/about' && u.search.includes('probe=e2e-touch-default')) warmed++;
      };
      page.on('request', onRequest);
      try {
        // Off-screen: no hover exists on touch, so nothing warms yet.
        await sleep(700);
        assert.equal(warmed, 0, 'a bare link off-screen on touch does not warm (no hover to trigger it)');
        // Scroll it in and let it dwell: the adaptive default warms it as viewport.
        await page.evaluate(() => document.getElementById('e2e-touch-link')?.scrollIntoView());
        await waitFor(() => warmed >= 1, 4000,
          () => `a bare link on touch should warm as viewport once it dwells (got ${warmed})`);
      } finally {
        page.off('request', onRequest);
      }
    } finally {
      await page.evaluate(() => { window.__webjsForceTouch = false; }).catch(() => {});
    }
  });

  test('chat: sending a message keeps you on the page and the message survives (#150)', async () => {
    // The chat form calls e.preventDefault() and sends over WebSocket, so the
    // client router must NOT intercept it (its submit listener is bubble, so the
    // component's preventDefault is honored). Before the fix, the router's
    // capture-phase submit listener navigated the page on send: it scrolled to
    // the top and the just-sent message vanished (the chat-box re-rendered from
    // its empty SSR state and the WebSocket reconnected fresh).
    await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Wait for the chat WebSocket to connect (the input enables once 'live').
    await page.waitForFunction(
      () => { const i = document.querySelector('chat-box input'); return !!i && !i.disabled; },
      { timeout: 12000 },
    );
    const msg = 'e2e-chat-stays-onpage';
    await page.type('chat-box input', msg);
    await page.keyboard.press('Enter');
    // Poll (not a fixed sleep) for the message to land in the chat-box via the
    // WS round-trip: send -> server broadcast -> onMessage -> re-render. On the
    // buggy (capture) code the page swaps and the message never appears, so this
    // times out and `present` stays false, failing the assertion below.
    let present = false;
    try {
      await page.waitForFunction(
        (m) => { const box = document.querySelector('chat-box'); return !!box && (box.textContent || '').includes(m); },
        { timeout: 6000 }, msg,
      );
      present = true;
    } catch { present = false; }
    assert.ok(present, 'the sent chat message must remain visible (the page must not have navigated/swapped)');
    const path = await page.evaluate(() => location.pathname);
    assert.equal(path, '/', 'must stay on the home page after sending a chat message');
  });

  // --- <webjs-frame> external targeting + aria-busy lifecycle (#252) ---
  //
  // /frame-demo renders a <webjs-frame id="panel"> driven by EXTERNAL tab
  // links (data-webjs-frame="panel", not nested in the frame) plus a _top
  // breakout link nested inside it. These exercise the real wire: a frame
  // nav issues an x-webjs-frame request, the response carries the frame, and
  // the router swaps only the frame's children.

  test('frame: an external data-webjs-frame link swaps only the frame, leaving the rest of the page', async () => {
    await page.goto(`${baseUrl}/frame-demo`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);

    // Stamp a sentinel on a node OUTSIDE the frame so a full-body swap is
    // detectable: a frame swap keeps the node (and the property), a full swap
    // destroys it.
    await page.evaluate(() => {
      const o = document.getElementById('outside-sentinel');
      if (o) o.dataset.e2eMarker = 'kept';
      window.__e2eFrameNav = 'alive';
    });

    // Capture whether a frame-scoped request (x-webjs-frame header) was issued.
    /** @type {string[]} */
    const frameRequests = [];
    const onReq = (req) => {
      const h = req.headers();
      if (h['x-webjs-frame']) frameRequests.push(h['x-webjs-frame']);
    };
    page.on('request', onReq);
    try {
      const before = await page.evaluate(() => document.getElementById('panel-body')?.getAttribute('data-tab'));
      assert.equal(before, 'one', 'panel starts on tab one');

      // Click the EXTERNAL "Two" tab link (data-webjs-frame="panel").
      await page.evaluate(() => document.getElementById('tab-two')?.click());
      await waitForCond(
        () => page.evaluate(() => document.getElementById('panel-body')?.getAttribute('data-tab') === 'two'),
        6000,
        () => 'the external link should swap the frame content to tab two',
      );

      // The frame content changed.
      const bodyText = await page.evaluate(() => document.getElementById('panel-body')?.textContent || '');
      assert.ok(bodyText.includes('TWO'), `frame body should show panel TWO, got "${bodyText}"`);

      // A frame-scoped request was issued (x-webjs-frame=panel).
      assert.ok(frameRequests.includes('panel'),
        'a frame-scoped request (x-webjs-frame: panel) must have been issued');

      // The REST of the page is untouched: the outside sentinel + its marker
      // survive (no full-body swap), and the window property persists.
      const survived = await page.evaluate(() => {
        const o = document.getElementById('outside-sentinel');
        return { marker: o && o.dataset.e2eMarker, win: window.__e2eFrameNav };
      });
      assert.equal(survived.marker, 'kept', 'outside-frame node survived (no full-body swap)');
      assert.equal(survived.win, 'alive', 'window state survived (a client swap, not a full reload)');

      // The URL reflects the frame nav.
      assert.ok(page.url().includes('tab=two'), `URL should reflect the frame nav, got ${page.url()}`);
    } finally { page.off('request', onReq); }
  });

  test('frame: a _top link inside the frame breaks OUT to a full-page navigation', async () => {
    await page.goto(`${baseUrl}/frame-demo?tab=three`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);

    // The _top link points at "/" and carries data-webjs-frame="_top": it
    // must perform a normal navigation away (not a frame swap of "panel").
    /** @type {string[]} */
    const frameRequests = [];
    const onReq = (req) => {
      const h = req.headers();
      if (h['x-webjs-frame']) frameRequests.push(h['x-webjs-frame']);
    };
    page.on('request', onReq);
    try {
      await page.evaluate(() => document.getElementById('top-link')?.click());
      await waitForCond(
        () => page.evaluate(() => location.pathname === '/'),
        6000,
        () => `_top should navigate to "/", got ${page.url()}`,
      );
      // The home page rendered (the frame-demo heading is gone).
      const heading = await page.evaluate(() => document.getElementById('frame-demo-heading'));
      assert.equal(heading, null, 'left /frame-demo: the frame-demo heading is gone (a real page change)');
      // No frame-scoped request was issued for the _top breakout.
      assert.ok(!frameRequests.includes('panel'),
        '_top must NOT issue an x-webjs-frame: panel request (it is a full nav, not a frame swap)');
    } finally { page.off('request', onReq); }
  });

  test('frame: aria-busy toggles true during the frame fetch and clears after, with start+finish events', async () => {
    await page.goto(`${baseUrl}/frame-demo`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await sleep(1500);

    // Record every webjs:frame-busy event's busy flag, and snapshot
    // aria-busy synchronously inside the start event (when the fetch is
    // genuinely in flight) so the assertion does not race the response.
    await page.evaluate(() => {
      window.__frameBusyEvents = [];
      window.__ariaBusyAtStart = null;
      document.addEventListener('webjs:frame-busy', (e) => {
        window.__frameBusyEvents.push(e.detail.busy);
        if (e.detail.busy === true) {
          const f = document.getElementById('panel');
          window.__ariaBusyAtStart = f && f.getAttribute('aria-busy');
        }
      });
    });

    await page.evaluate(() => document.getElementById('tab-three')?.click());
    // Wait for the swap to complete (the finish event lands).
    await waitForCond(
      () => page.evaluate(() => (window.__frameBusyEvents || []).includes(false)),
      6000,
      () => 'a webjs:frame-busy finish (busy:false) event must fire',
    );

    const state = await page.evaluate(() => ({
      events: window.__frameBusyEvents,
      ariaAtStart: window.__ariaBusyAtStart,
      ariaNow: document.getElementById('panel')?.getAttribute('aria-busy'),
    }));

    assert.equal(state.ariaAtStart, 'true', 'aria-busy was "true" while the frame fetch was in flight');
    assert.equal(state.ariaNow, 'false', 'aria-busy is cleared to "false" after the swap completes');
    assert.equal(state.events[0], true, 'the first webjs:frame-busy event is the start (busy:true)');
    assert.equal(state.events[state.events.length - 1], false, 'the last webjs:frame-busy event is the finish (busy:false)');
  });

  // --- <webjs-frame src loading="lazy"> self-load (#253) ---
  //
  // The deferred frame on /frame-demo carries `src` + `loading="lazy"`, so it
  // self-fetches its content (with the x-webjs-frame header) ONLY when it
  // scrolls into view. The e2e proves the real wire: no fetch before the
  // frame is on-screen, then a single x-webjs-frame request once scrolled,
  // and the deferred content appears (the lazy-content use case). It also
  // proves the SERVER subtree render (#253): the self-load response is JUST
  // the frame subtree, not the full /frame-demo/deferred page.
  test('frame: a lazy <webjs-frame src> self-loads on viewport entry, sending x-webjs-frame', async () => {
    // Track frame-scoped requests + the response bodies they get back.
    /** @type {string[]} */
    const frameRequests = [];
    /** @type {{ url: string, body: string }[]} */
    const frameResponses = [];
    const onReq = (req) => {
      const h = req.headers();
      if (h['x-webjs-frame']) frameRequests.push(h['x-webjs-frame']);
    };
    page.on('request', onReq);

    // Capture the deferred self-load's RESPONSE BODY deterministically over CDP.
    // A page.on('response') + `await resp.text()` races the browser: loadFrame()
    // (packages/core/src/router-client.js) reads the fetch body to apply the
    // subtree, and once the renderer has consumed it the browser is free to evict
    // it, so Puppeteer's getResponseBody can throw "Could not load body" (#811).
    // Instead, pause each request at the RESPONSE stage and read the body from
    // the browser's buffer BEFORE it is delivered to the page, so there is no
    // consumer to race. A capture failure is recorded (never silently swallowed)
    // so the assertion below fails loudly and diagnosably rather than flaking.
    const findHeader = (headers, name) => {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
      return key ? headers[key] : undefined;
    };
    const client = await page.target().createCDPSession();
    await client.send('Fetch.enable', { patterns: [{ requestStage: 'Response' }] });
    client.on('Fetch.requestPaused', async (evt) => {
      const { requestId, request } = evt;
      try {
        if (findHeader(request.headers, 'x-webjs-frame') === 'deferred') {
          const { body, base64Encoded } = await client.send('Fetch.getResponseBody', { requestId });
          const decoded = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body;
          frameResponses.push({ url: request.url, body: decoded });
        }
      } catch (err) {
        // Do NOT swallow: record it so the assertion below is diagnosable.
        frameResponses.push({ url: request.url, body: `__CAPTURE_ERROR__: ${err && err.message}` });
      } finally {
        await client.send('Fetch.continueRequest', { requestId }).catch(() => {});
      }
    });

    try {
      await page.goto(`${baseUrl}/frame-demo`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(1500);

      // Before scrolling: the deferred frame is far below the fold, so its
      // lazy self-load must NOT have fired yet.
      assert.ok(!frameRequests.includes('deferred'),
        'a lazy frame must NOT self-fetch before it enters the viewport');
      const placeholder = await page.evaluate(() => !!document.getElementById('deferred-placeholder'));
      assert.ok(placeholder, 'the deferred frame still shows its JS-off placeholder before loading');

      // Scroll the deferred frame into view to trigger the lazy load.
      await page.evaluate(() => document.getElementById('deferred')?.scrollIntoView());

      // The self-load fires (x-webjs-frame: deferred) and the content appears.
      await waitForCond(
        () => page.evaluate(() => !!document.getElementById('deferred-loaded')),
        6000,
        () => 'the deferred frame must self-load its content once scrolled into view',
      );

      // Network probe: a frame-scoped request for "deferred" was issued.
      assert.ok(frameRequests.includes('deferred'),
        'a lazy frame self-load must issue an x-webjs-frame: deferred request');
      // The placeholder was replaced by the server-rendered deferred content.
      const loaded = await page.evaluate(() => ({
        hasLoaded: !!document.getElementById('deferred-loaded'),
        hasPlaceholder: !!document.getElementById('deferred-placeholder'),
        text: document.getElementById('deferred-loaded')?.textContent || '',
      }));
      assert.ok(loaded.hasLoaded, 'the deferred content swapped in');
      assert.ok(!loaded.hasPlaceholder, 'the placeholder was replaced by the self-load');
      assert.match(loaded.text, /Deferred content loaded/, 'the swapped-in content is the server-rendered deferred body');

      // Server subtree render (#253): the self-load response body is JUST the
      // frame subtree, NOT the full /frame-demo/deferred document.
      assert.ok(frameResponses.length >= 1, 'captured the deferred self-load response');
      const respBody = frameResponses[frameResponses.length - 1].body;
      assert.ok(!respBody.startsWith('__CAPTURE_ERROR__'),
        `the deferred self-load response body must be captured cleanly, got: ${respBody}`);
      assert.match(respBody, /<webjs-frame id="deferred"/, 'the response carries the requested frame subtree');
      assert.ok(!/<html|<head\b|importmap/i.test(respBody),
        'the self-load response is the frame subtree only (no full document shell), the server subtree-render optimization');
    } finally {
      page.off('request', onReq);
      await client.send('Fetch.disable').catch(() => {});
      await client.detach().catch(() => {});
    }
  });

  // --- Progressive enhancement: the no-JS baseline must hold (#183) ---
  //
  // "Progressive enhancement by default" is the foundational claim: with
  // JavaScript disabled the page must still read, <a> links must navigate,
  // a <form> server action must submit, and display-only components must
  // render. This layer loads the blog with JS OFF and asserts each.
  //
  // setJavaScriptEnabled(false) disables ALL page script execution,
  // including page.evaluate, so this block reads the DOM via page.content()
  // (HTML serialization, no page JS) and interacts via CDP-level type/click
  // (real input/mouse events the browser handles natively), never evaluate.
  describe('progressive enhancement (JS disabled) (#183)', () => {
    let noJs;

    before(async () => {
      noJs = await browser.newPage();
      await noJs.setJavaScriptEnabled(false);
      await noJs.setViewport({ width: 1024, height: 768 }); // show the desktop nav
    });

    after(async () => {
      if (noJs) await noJs.close();
    });

    test('content reads and a display-only component renders with JS off', async () => {
      await noJs.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const html = await noJs.content();
      // Real post content from the SSR'd HTML (seeded posts).
      assert.match(html, /Hello, webjs|Zero build steps|Web components first/,
        'post content must be server-rendered and readable with JS off');
      // The display-only build-stamp renders its SSR markup even though its
      // module never ships (criterion: a display-only component renders).
      assert.match(html, /zero JS shipped for this badge/,
        'a display-only component must render its SSR markup with JS off');
    });

    test('an <a> link performs a full navigation with JS off', async () => {
      await noJs.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // With JS off the client router never attaches, so clicking a same-origin
      // <a> is a native full-page navigation. Click the desktop nav About link.
      await Promise.all([
        noJs.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        noJs.click('nav a[href="/about"]'),
      ]);
      assert.ok(noJs.url().endsWith('/about'), `link should navigate to /about, got ${noJs.url()}`);
      const html = await noJs.content();
      // Match a phrase unique to the about page body, not the nav word
      // "About" that appears on every page.
      assert.match(html, /What's on display/, '/about page body must render after a no-JS navigation');
    });

    test('a server-rendered form submits and the response renders with JS off', async () => {
      await noJs.goto(`${baseUrl}/search`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      // Type a query and submit the native GET form. Both are CDP-level
      // browser events, so they work with page JS disabled. The submission is
      // a real navigation to /search?q=web that the SERVER renders.
      await noJs.type('input[name="q"]', 'web');
      await Promise.all([
        noJs.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
        noJs.click('form button[type="submit"]'),
      ]);
      assert.match(noJs.url(), /\/search\?q=web/, `form should GET-navigate to /search?q=web, got ${noJs.url()}`);
      const html = await noJs.content();
      assert.match(html, /Found 2 results for "web"/,
        'the server must render the search results for the no-JS form submission');
      assert.match(html, /class="search-result"/, 'result items must render');
    });

    test('counterfactual: a JS-dependent interaction does NOT work with JS off', async () => {
      // The interactive counter needs JS to increment. With JS off, clicking
      // the increment button must do nothing: the seeded value stays put. This
      // proves the harness genuinely disabled JS, so any feature whose first
      // paint or core behaviour depended on JS would render broken and fail
      // the assertions above rather than passing on a secretly-live page.
      await noJs.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const countOf = (html) => {
        const m = html.match(/<my-counter[^>]*>[\s\S]*?<output[^>]*>(\d+)<\/output>/);
        return m ? Number(m[1]) : NaN;
      };
      const before = countOf(await noJs.content());
      assert.equal(before, 3, `counter SSRs its seeded value (got ${before})`);
      await noJs.click('my-counter button[aria-label="Increment"]');
      await sleep(300);
      const after = countOf(await noJs.content());
      assert.equal(after, 3, `with JS off the counter must NOT increment (got ${after})`);
    });
  });
});

// ---------------------------------------------------------------------------
// Form actions: the no-JS write path (#1155)
//
// `/feedback` binds a module action with `<form action=${submitFeedback}>`. We
// exercise BOTH the JS-disabled native path and the JS-enabled client-router
// path, asserting the SAME field-error UI and the same PRG redirect, plus a
// network probe that the enhanced path issues exactly one POST and does NOT
// full-reload on the 422.
//
// JS-disabled is the load-bearing half. Progressive enhancement is the
// framework's headline invariant, and a bound form is the one place a hidden
// field the RENDERER emitted has to survive all the way into a native browser
// submission for anything to happen at all. Nothing below stubs that: a real
// browser with scripting off submits the real markup.
// ---------------------------------------------------------------------------

describe('E2E: form actions (no-JS + enhanced)', { skip: !process.env.WEBJS_E2E && 'set WEBJS_E2E=1 to run E2E tests' }, () => {
  let paBrowser, paServer, paBase;

  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const chromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
    const port = await freePort();
    paBase = `http://localhost:${port}`;
    paServer = await startBlog(port);
    paBrowser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  });

  after(async () => {
    if (paBrowser) await paBrowser.close();
    if (paServer) {
      paServer.kill('SIGTERM');
      await new Promise((r) => { paServer.on('exit', r); setTimeout(r, 3000); });
    }
  });

  test('JS DISABLED: the served markup carries the identity and no action attribute', async () => {
    // The premise every other case here rests on. With JS off, whatever the
    // server sent IS the form, so if the identity field were missing or emitted
    // outside the <form>, the submissions below would post an empty body and
    // the failure would look like an action bug rather than a markup one.
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      const form = await p.evaluate(() => {
        const f = document.querySelector('form');
        const field = f && f.querySelector('input[name="__webjs_action"]');
        return {
          hasAction: !!f && f.hasAttribute('action'),
          method: f ? f.method : null,
          identity: field ? field.value : null,
          // What the browser would actually serialize on submit.
          submitted: f ? new FormData(f).get('__webjs_action') : null,
        };
      });
      assert.equal(form.hasAction, false, 'no action attribute, so it posts to this page');
      assert.equal(form.method, 'post', 'method is post');
      assert.ok(/^[0-9a-f]{10}\/submitFeedback$/.test(form.identity || ''),
        `identity field must name the action, got ${form.identity}`);
      assert.equal(form.submitted, form.identity, 'and it is inside the form, so it is submitted');
      const src = await p.content();
      assert.ok(!src.includes('already subscribed'),
        'the action body must not ship: its validation message appears only after a submit');
    } finally { await p.close(); }
  });

  test('JS DISABLED: invalid submit re-renders the page with the error + preserved input', async () => {
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await p.type('#email', 'taken@example.com');
      // Native form submit (no JS): the browser POSTs and renders the 422 body.
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.click('button[type="submit"]'),
      ]);
      const error = await p.evaluate(() => document.getElementById('email-error')?.textContent || '');
      assert.ok(error.includes('That email is already subscribed'), `expected field error, got "${error}"`);
      const value = await p.evaluate(() => document.getElementById('email')?.value || '');
      assert.equal(value, 'taken@example.com', 'the submitted value is preserved in the re-render');
      // Still on /feedback (no PRG, the 422 re-renders in place).
      assert.ok(p.url().endsWith('/feedback'), `expected to stay on /feedback, got ${p.url()}`);
    } finally { await p.close(); }
  });

  test('JS DISABLED: valid submit redirects (PRG) to /feedback/thanks', async () => {
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await p.type('#email', 'real@example.com');
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.click('button[type="submit"]'),
      ]);
      assert.ok(p.url().endsWith('/feedback/thanks'), `expected PRG to /feedback/thanks, got ${p.url()}`);
      const ok = await p.evaluate(() => !!document.getElementById('thanks'));
      assert.ok(ok, 'the thanks page rendered');
    } finally { await p.close(); }
  });

  test('JS ENABLED: invalid submit swaps the 422 in place (one POST, no full reload)', async () => {
    const p = await paBrowser.newPage();
    // Network probe: count POSTs to /feedback and watch for a full document load.
    const posts = [];
    p.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/feedback')) posts.push(req.url());
    });
    try {
      await p.goto(`${paBase}/feedback`, { waitUntil: 'networkidle2', timeout: 15000 });
      // Tag the live document; a full reload would discard the marker, an
      // in-place client-router swap preserves it.
      await p.evaluate(() => { window.__paMarker = 'kept'; });
      await p.type('#email', 'taken@example.com');
      await p.click('button[type="submit"]');
      // Wait for the client router to apply the 422 fragment.
      await p.waitForFunction(
        () => !!document.getElementById('email-error'),
        { timeout: 10000 },
      );
      const marker = await p.evaluate(() => window.__paMarker);
      assert.equal(marker, 'kept', 'the client router swapped in place (no full reload)');
      const value = await p.evaluate(() => document.getElementById('email')?.value || '');
      assert.equal(value, 'taken@example.com', 'submitted value preserved in the enhanced re-render');
      assert.equal(posts.length, 1, `exactly one POST issued, got ${posts.length}`);
    } finally { await p.close(); }
  });

  test('JS ENABLED: valid submit follows the 303 to the thanks page in place', async () => {
    const p = await paBrowser.newPage();
    try {
      await p.goto(`${paBase}/feedback`, { waitUntil: 'networkidle2', timeout: 15000 });
      await p.evaluate(() => { window.__paMarker = 'kept'; });
      await p.type('#email', 'real@example.com');
      await p.click('button[type="submit"]');
      await p.waitForFunction(
        () => !!document.getElementById('thanks'),
        { timeout: 10000 },
      );
      assert.ok(p.url().endsWith('/feedback/thanks'), `expected /feedback/thanks, got ${p.url()}`);
      const marker = await p.evaluate(() => window.__paMarker);
      assert.equal(marker, 'kept', 'the 303 was followed in place by the client router');
    } finally { await p.close(); }
  });

  // -------------------------------------------------------------------------
  // The HYDRATED half. Everything above runs against `/feedback`, a plain page
  // that never hydrates, so the client renderer never touches its form and
  // `reconcileFormAction` never executes. `/feedback/live` puts the same bound
  // action inside a component that also carries `@submit`, so it ships,
  // hydrates, and re-renders its whole template in the browser.
  //
  // This is the only place the client half runs against a REAL generated RPC
  // stub. Every other test of it stubs one end: the linkedom tests and the
  // browser parity table hand-stamp a stand-in function, and the browser router
  // test hand-writes the hidden input into its template. If anything stopped
  // the browser-served stub from carrying its identity stamp, the component's
  // render would throw in the browser while all of those stayed green.
  //
  // The row ADDED in the browser is what makes it discriminating. Hydrating the
  // SSR'd row only patches markup the server already sent, identity field
  // included, so asserting on that row passes whether or not the client
  // reconcile ran (measured: disabling reconcileFormActions entirely left such
  // an assertion green). A client-created row has nothing to inherit.
  // -------------------------------------------------------------------------

  test('JS ENABLED: a client-CREATED bound form builds its identity from the real stub', async () => {
    const p = await paBrowser.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    try {
      await p.goto(`${paBase}/feedback/live`, { waitUntil: 'networkidle2', timeout: 15000 });
      // Proof the component actually hydrated before anything else is read.
      await p.waitForFunction(
        () => customElements.get('feedback-form') && document.querySelector('feedback-form')?.updateComplete !== undefined,
        { timeout: 10000 },
      );
      // Add a row: this form has no server-rendered markup at all, so every
      // attribute below was written by the client renderer.
      await p.click('#live-add');
      await p.waitForFunction(
        () => document.querySelectorAll('feedback-form form').length === 2,
        { timeout: 10000 },
      );

      const state = await p.evaluate(() => {
        const form = document.querySelectorAll('feedback-form form')[1];
        const field = form.querySelector('input[name="__webjs_action"]');
        return {
          hasAction: form.hasAttribute('action'),
          method: form.getAttribute('method'),
          enctype: form.getAttribute('enctype'),
          identity: field ? field.getAttribute('value') : null,
          fieldIsFirst: form.firstElementChild === field,
          ssrIdentity: document.querySelectorAll('feedback-form form')[0]
            .querySelector('input[name="__webjs_action"]')?.getAttribute('value') || null,
        };
      });
      assert.equal(errors.length, 0, `no page errors, got: ${errors.join(' | ')}`);
      assert.equal(state.hasAction, false, 'the client-built form has no action attribute either');
      assert.equal(state.method, 'post');
      assert.equal(state.enctype, 'multipart/form-data');
      assert.ok(/^[0-9a-f]{10}\/submitFeedback$/.test(state.identity || ''),
        `the identity came off the real generated stub, got ${state.identity}`);
      assert.equal(state.fieldIsFirst, true, 'and it is inserted first, outside every child part range');
      assert.equal(state.identity, state.ssrIdentity,
        'the client resolved the SAME identity the server did, which is the whole parity claim');
    } finally { await p.close(); }
  });

  test('JS ENABLED: the hydrated component submits through the same pipeline', async () => {
    const p = await paBrowser.newPage();
    try {
      await p.goto(`${paBase}/feedback/live`, { waitUntil: 'networkidle2', timeout: 15000 });
      await p.waitForFunction(() => !!customElements.get('feedback-form'), { timeout: 10000 });
      await p.type('#live-email', 'real@example.com');
      await p.click('button[type="submit"]');
      await p.waitForFunction(() => !!document.getElementById('thanks'), { timeout: 10000 });
      assert.ok(p.url().endsWith('/feedback/thanks'), `expected /feedback/thanks, got ${p.url()}`);
    } finally { await p.close(); }
  });

  test('JS DISABLED: the hydrated component page still submits natively', async () => {
    // The component ships, but its SSR'd markup is a complete form on its own,
    // which is the whole progressive-enhancement claim.
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback/live`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.evaluate(() => {
          document.querySelector('#live-email').value = 'real@example.com';
          document.querySelector('feedback-form form').submit();
        }),
      ]);
      assert.ok(p.url().endsWith('/feedback/thanks'), `expected PRG to /feedback/thanks, got ${p.url()}`);
    } finally { await p.close(); }
  });

  // -------------------------------------------------------------------------
  // #1207: PER-BUTTON actions, the headline proof.
  //
  // `/feedback/triage` binds `saveDraft` on the form and overrides it with
  // `formaction=${publishDraft}` on the Publish button. With JavaScript off
  // nothing intercepts anything: the browser serializes the form's hidden
  // identity field AND the pressed button's own name/value pair, in that DOM
  // order, and the dispatcher takes the last. If the submitter's pair were not
  // emitted, or landed before the hidden field, or the dispatcher still read
  // only the first entry, the wrong action would run and the redirect would
  // name it.
  //
  // The redirect target carries WHICH action ran precisely so these cannot
  // pass on "the form submitted successfully": with the submitter binding
  // removed, pressing Publish still submits fine and still redirects, just to
  // the other name.
  // -------------------------------------------------------------------------

  test('JS DISABLED: the submitter carries its own identity, after the form field', async () => {
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback/triage`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      const shape = await p.evaluate(() => {
        const form = document.querySelector('form');
        const publish = document.getElementById('publish');
        const save = document.getElementById('save');
        return {
          hidden: form.querySelector('input[name="__webjs_action"]')?.value || null,
          hiddenIsFirst: form.firstElementChild?.getAttribute('name') === '__webjs_action',
          publishName: publish.getAttribute('name'),
          publishValue: publish.getAttribute('value'),
          publishHasFormAction: publish.hasAttribute('formaction'),
          // The plain button binds nothing, so it must stay untouched.
          saveName: save.getAttribute('name'),
          // What the browser would really serialize for each submitter.
          onPublish: [...new FormData(form, publish).getAll('__webjs_action')],
          onSave: [...new FormData(form, save).getAll('__webjs_action')],
        };
      });
      assert.ok(/^[0-9a-f]{10}\/saveDraft$/.test(shape.hidden || ''),
        `form identity must name saveDraft, got ${shape.hidden}`);
      assert.ok(shape.hiddenIsFirst, 'the form identity is the first child, so a submitter entry follows it');
      assert.equal(shape.publishName, '__webjs_action', 'the submitter carries the identity name');
      assert.ok(/^[0-9a-f]{10}\/publishDraft$/.test(shape.publishValue || ''),
        `the submitter value must name publishDraft, got ${shape.publishValue}`);
      assert.equal(shape.publishHasFormAction, false, 'no formaction url is emitted, so it posts to this page');
      assert.equal(shape.saveName, null, 'a button that binds nothing is left alone');
      assert.deepEqual(shape.onPublish, [shape.hidden, shape.publishValue],
        'pressing Publish submits both identities, the submitter LAST');
      assert.deepEqual(shape.onSave, [shape.hidden],
        'pressing Save submits only the form identity');
      const src = await p.content();
      assert.ok(!src.includes('Write something first'),
        'the action bodies must not ship: their validation message appears only after a submit');
    } finally { await p.close(); }
  });

  test('JS DISABLED: pressing the bound submitter runs ITS action, not the form\'s', async () => {
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback/triage`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await p.type('#note', 'ship it');
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.click('#publish'),
      ]);
      const ran = await p.evaluate(() => document.getElementById('ran')?.textContent || '');
      assert.equal(ran, 'publishDraft', `the submitter's action must run, got "${ran}"`);
    } finally { await p.close(); }
  });

  test('JS DISABLED: pressing a plain submitter runs the FORM action', async () => {
    // The other half of the same claim. A browser submits a submitter's pair
    // only for the button pressed, so with Save pressed there is no second
    // entry and the form's own identity is what the dispatcher sees.
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback/triage`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await p.type('#note', 'later');
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.click('#save'),
      ]);
      const ran = await p.evaluate(() => document.getElementById('ran')?.textContent || '');
      assert.equal(ran, 'saveDraft', `the form's action must run, got "${ran}"`);
    } finally { await p.close(); }
  });

  test('JS DISABLED: a bound submitter runs its action inside a COMPLETELY UNBOUND form (#1307)', async () => {
    // THE headline assertion of #1307, and the one-line proof the whole change
    // works. `/feedback/triage-split` renders a `<form>` with NO action and NO
    // method, so a browser defaults it to GET. Both of its buttons bind their
    // own action, and "Publish" is rendered by a COMPONENT, which SSR renders
    // in a separate pass that cannot see this page at all.
    //
    // Before the change this submitted as a GET: the identity rode the query
    // string, the page re-rendered, and nothing ran. A 200 with no log, which
    // is exactly why detection was the original plan and making it WORK is the
    // better one.
    //
    // COUNTERFACTUAL: delete the `formmethod` / `formenctype` injection from
    // `bindSubmitterStartTag` and this test goes red, because the button falls
    // back to the form's GET default and the action never runs.
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback/triage-split`, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // The served markup carries the whole submission on the button itself.
      const shape = await p.evaluate(() => {
        const btn = document.getElementById('publish');
        const form = btn.closest('form');
        return {
          formMethodAttr: form.getAttribute('method'),
          formActionAttr: form.getAttribute('action'),
          name: btn.getAttribute('name'),
          value: btn.getAttribute('value'),
          formmethod: btn.getAttribute('formmethod'),
          formenctype: btn.getAttribute('formenctype'),
          formaction: btn.getAttribute('formaction'),
        };
      });
      assert.equal(shape.formMethodAttr, null, 'the host form declares no method');
      assert.equal(shape.formActionAttr, null, 'and binds no action');
      assert.equal(shape.name, '__webjs_action', 'the component-rendered button carries the identity');
      assert.ok(/\/publishDraft$/.test(shape.value || ''), `identity value, got "${shape.value}"`);
      assert.equal(shape.formmethod, 'post', 'and supplies its own method');
      assert.equal(shape.formenctype, 'multipart/form-data', 'and its own enctype');
      assert.equal(shape.formaction, null, 'no formaction url is emitted');

      // And it actually RUNS, which is the part markup alone cannot prove.
      await p.type('#note', 'ship it');
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.click('#publish'),
      ]);
      const ran = await p.evaluate(() => document.getElementById('ran')?.textContent || '');
      assert.equal(ran, 'publishDraft',
        `the action must RUN from an unbound form, got "${ran}"`);
    } finally { await p.close(); }
  });

  test('JS DISABLED: the INLINE bound submitter in the same unbound form runs too', async () => {
    // The sibling path. "Save draft" is written inline in the page template, so
    // SSR sees it in the same scan as the form and knew that form was unbound.
    // That is the case the renderer used to REFUSE outright, as distinct from
    // the component case it bound anyway. Both now bind and both work.
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback/triage-split`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await p.type('#note', 'later');
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.click('#save'),
      ]);
      const ran = await p.evaluate(() => document.getElementById('ran')?.textContent || '');
      assert.equal(ran, 'saveDraft', `the inline submitter's action must run, got "${ran}"`);
    } finally { await p.close(); }
  });

  test('JS DISABLED: a failing submitter action re-renders THIS page at 422', async () => {
    // The per-button path has to reach the same 422 re-render as the form-level
    // one, or a validation failure on a submitter action would lose the page.
    const p = await paBrowser.newPage();
    await p.setJavaScriptEnabled(false);
    try {
      await p.goto(`${paBase}/feedback/triage`, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }),
        p.click('#publish'),
      ]);
      const error = await p.evaluate(() => document.getElementById('note-error')?.textContent || '');
      assert.ok(error.includes('Write something first'), `expected the field error, got "${error}"`);
      assert.ok(p.url().endsWith('/feedback/triage'), `expected to stay put, got ${p.url()}`);
    } finally { await p.close(); }
  });

  test('JS ENABLED: the same button runs the same action through the client router', async () => {
    // Identical by construction is the claim, so the enhanced path must reach
    // the same action. The client router posts the same body to the same url
    // and follows the 303 via fetch.
    const p = await paBrowser.newPage();
    try {
      await p.goto(`${paBase}/feedback/triage`, { waitUntil: 'networkidle0', timeout: 15000 });
      await p.type('#note', 'ship it');
      await p.click('#publish');
      await p.waitForFunction(() => !!document.getElementById('ran'), { timeout: 10000 });
      const ran = await p.evaluate(() => document.getElementById('ran')?.textContent || '');
      assert.equal(ran, 'publishDraft', `the submitter's action must run with JS too, got "${ran}"`);
    } finally { await p.close(); }
  });

});

// ---------------------------------------------------------------------------
// Helpers for counter & navigation tests
// ---------------------------------------------------------------------------

/**
 * Get the current counter display value.
 * The counter is a LIGHT DOM component, so its <output> is a child of the host
 * itself and there is no shadow root in the path.
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
  // Refuse to click an element that cannot respond, and say so.
  //
  // Checking the BUTTON exists is not that check, which is the trap worth
  // spelling out: SSR emits the counter's buttons and output, so on a page that
  // has not hydrated the button is present, `click()` runs, and nothing at all
  // happens. A helper that only guards `!btn` therefore reports success for the
  // one failure it was written to catch, and the miss resurfaces an assertion
  // later as a baffling off-by-one (`on=4, off=3`).
  //
  // The element being UPGRADED is the real precondition: before upgrade it is a
  // plain HTMLElement, after it is an instance of the registered class, and
  // that is the first moment the `@click` binding exists.
  const problem = await p.evaluate((lbl) => {
    const counter = document.querySelector('my-counter');
    if (!counter) return 'no <my-counter> on the page';
    const C = customElements.get('my-counter');
    if (!C) return 'my-counter is not registered (its module never ran), so the SSR buttons have no listener';
    if (!(counter instanceof C)) return 'my-counter is registered but this instance is not upgraded yet, so its buttons have no listener';
    const btn = counter.querySelector(`button[aria-label="${lbl}"]`);
    if (!btn) return `<my-counter> has no button[aria-label="${lbl}"] (SSR markup changed?)`;
    btn.click();
    return null;
  }, label);
  if (problem) throw new Error(`clickCounterButton(${label}): ${problem}`);
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
 * Click the brand link ("webjs / blog"): the first <a> in the header that
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

/**
 * Poll `cond` until it returns truthy or `timeoutMs` elapses. Replaces a
 * fixed sleep where the wait is for an async signal (a prefetch landing,
 * a URL changing), so a slow CI box does not flake. Throws with `msg()`
 * on timeout so the assertion reads like a normal failure.
 *
 * @param {() => boolean} cond
 * @param {number} timeoutMs
 * @param {() => string} msg
 */
async function waitFor(cond, timeoutMs, msg) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await sleep(50);
  }
  throw new Error(msg());
}

// Like waitFor, but awaits an async predicate (e.g. a page.evaluate that
// reads in-page state) on each poll.
async function waitForCond(cond, timeoutMs, msg) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await sleep(50);
  }
  throw new Error(msg());
}
