/**
 * End-to-end test for the dev error overlay's URL scope (#1047).
 *
 * The bug: after a page that throws during SSR is reached, the "Server render
 * error" overlay appeared on pages that render fine. Two causes, both only
 * observable in a real browser, which is why this is an e2e and not a unit test:
 *
 *   1. The overlay is appended to `document.body`, while the client router's
 *      swap operates strictly inside the keyed boundary comment ranges, so it
 *      outlived every soft navigation.
 *   2. Link prefetch (on by default) fires a REAL GET of the throwing page on
 *      hover, which reports a frame to every open tab, so the overlay appeared
 *      with no navigation at all. Nothing short of driving a browser reproduces
 *      that: it needs a real pointer hover on a real anchor.
 *
 * The fixture (`fixtures/dev-overlay-app`) is copied to a temp dir and given
 * symlinked `@webjsdev/*` so a fresh worktree (which has no node_modules) can
 * run it. It carries one interactive component in the root layout purely so
 * `@webjsdev/core` loads and the client router auto-enables (#620).
 *
 * Run: WEBJS_E2E=1 node --test test/e2e/dev-overlay-nav.test.mjs
 * (gated behind WEBJS_E2E like its neighbours, so the default `npm test` skips
 * it; CI runs it in the E2E job.)
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FIXTURE = resolve(__dirname, 'fixtures', 'dev-overlay-app');
const OVERLAY = '[data-webjs-error-overlay]';

/** Find a free port by binding to 0 and releasing. */
function freePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => res(port));
    });
    srv.on('error', rej);
  });
}

/**
 * Copy the fixture somewhere writable and link the framework packages in, the
 * same way the cross-runtime dev scripts do. A git worktree has no
 * node_modules, so a bare `webjs dev` in the fixture would not resolve
 * `@webjsdev/core` (#954).
 */
function stageApp() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-overlay-e2e-'));
  cpSync(FIXTURE, dir, { recursive: true });
  mkdirSync(join(dir, 'node_modules/@webjsdev'), { recursive: true });
  for (const pkg of ['core', 'server']) {
    symlinkSync(join(ROOT, 'packages', pkg), join(dir, 'node_modules/@webjsdev', pkg));
  }
  return dir;
}

/** Spawn `webjs dev` against the staged app and resolve once it is listening. */
function startDev(dir, port) {
  const cli = resolve(ROOT, 'packages', 'cli', 'bin', 'webjs.js');
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [cli, 'dev', '--port', String(port)], {
      cwd: dir,
      // __WEBJS_DEV_CHILD keeps the dev server in THIS process rather than
      // under the restart supervisor, so killing the child really stops it.
      env: { ...process.env, __WEBJS_DEV_CHILD: '1', NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let started = false;
    let log = '';
    const onData = (chunk) => {
      log += chunk.toString();
      if (!started && log.includes('ready on')) { started = true; res(child); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', rej);
    child.on('exit', (code) => {
      if (!started) rej(new Error(`dev server exited with ${code} before ready\n${log}`));
    });
    setTimeout(() => { if (!started) rej(new Error(`dev server start timeout\n${log}`)); }, 20000);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until it is true or the deadline passes. Never waits forever. */
async function waitFor(fn, timeoutMs = 5000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > deadline) return false;
    await sleep(stepMs);
  }
}

/**
 * Land on a page with the client router live. The router auto-enables when
 * `@webjsdev/core` loads, which is what the layout's component pulls in, so
 * waiting for that component to upgrade is the signal that a click will be a
 * SOFT navigation rather than a plain document load.
 */
async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => !!customElements.get('counter-el'),
    { timeout: 10000 },
  );
}

describe('E2E: dev error overlay URL scope (#1047)', {
  skip: !process.env.WEBJS_E2E && 'set WEBJS_E2E=1 to run E2E tests',
}, () => {
  let browser, page, child, dir, base;

  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const chromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
    dir = stageApp();
    const port = await freePort();
    child = await startDev(dir, port);
    base = `http://localhost:${port}`;
    browser = await puppeteer.launch({
      executablePath: chromium,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
  });

  after(async () => {
    if (browser) await browser.close();
    if (child) { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('the page that actually threw still shows the overlay', async () => {
    await page.goto(`${base}/crash`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(OVERLAY, { timeout: 5000 });
    const text = await page.$eval(OVERLAY, (el) => el.textContent);
    assert.match(text, /this page threw during render/, 'the overlay names the real error');
  });

  test('a soft nav away takes a live overlay with it', async () => {
    // Reaching the state honestly: sit on a page that renders fine, then break
    // it and re-render it out of band, the way another tab or a background
    // revalidation would. The frame names THIS page, so the overlay is correct
    // and must go up...
    await gotoReady(page, `${base}/flaky`);
    assert.equal(await page.$(OVERLAY), null, 'a clean page starts clean');
    await page.evaluate(async () => {
      await fetch('/break');
      await fetch('/flaky', { headers: { accept: 'text/html' } });
    });
    await page.waitForSelector(OVERLAY, { timeout: 5000 });
    assert.match(
      await page.$eval(OVERLAY, (el) => el.textContent), /flaky page threw/,
      'a frame for the page you ARE on still renders (the gate does not over-block)',
    );

    // ...and must come down when the client router takes you elsewhere. Before
    // the fix the overlay was appended to document.body, which the router's
    // boundary-scoped swap never touches, so it survived every navigation.
    const ctx = await page.evaluate(() => { window.__wjCtx = 1; return 1; });
    // A programmatic click, not a pointer one: the overlay is `position:fixed;
    // inset:0` at the top of the stacking order, so it deliberately swallows
    // every real click on the page beneath it. The synthetic click still
    // bubbles to the router's document listener, which is the path under test.
    await page.evaluate(() => document.querySelector('#flaky-to-good').click());
    await page.waitForSelector('#good', { timeout: 5000 });
    await page.waitForFunction((sel) => !document.querySelector(sel), { timeout: 5000 }, OVERLAY);
    assert.match(page.url(), /\/good$/);
    assert.equal(
      await page.evaluate(() => window.__wjCtx), ctx,
      'it really was a soft navigation, not a document load that would clear it anyway',
    );
  });

  test('a back/forward restore does not resurrect the overlay', async () => {
    // Continues from /good, with /flaky one step back in history. Heal the page
    // first, so returning to it must be clean by every route: a fresh render
    // succeeds, and a restore from the router's snapshot cache shows no
    // overlay either.
    await page.evaluate(() => fetch('/heal'));
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.pathname === '/flaky', { timeout: 5000 });
    await sleep(300);
    assert.equal(await page.$(OVERLAY), null, 'the restored page carries no baked-in overlay');

    await page.goForward({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => location.pathname === '/good', { timeout: 5000 });
    await sleep(300);
    assert.equal(await page.$(OVERLAY), null, 'and the good page stays clean');
  });

  test('a render error in one tab does not raise an overlay in another', async () => {
    await gotoReady(page, `${base}/good`);
    const other = await browser.newPage();
    try {
      await other.goto(`${base}/crash`, { waitUntil: 'domcontentloaded' });
      await other.waitForSelector(OVERLAY, { timeout: 5000 });
      // Every tab shares one SSE relay through the SharedWorker, so the frame
      // reaches this tab too. It is looking at a different page, so: nothing.
      await sleep(500);
      assert.equal(await page.$(OVERLAY), null, 'the other tab keeps its own page clean');
    } finally { await other.close(); }
  });

  test('navigating into a page whose render throws is a SOFT navigation (#1298)', async () => {
    // Until #1298 this could not be written at all: a boundary was served with
    // no layout chain, so it carried none of the keyed wj:children markers, the
    // router's scan found no shared boundary, and the click was a full document
    // load. That is why every other test in this file reaches /crash with a
    // plain `page.goto` or only prefetches it, and never clicks through to it.
    const fallbacks = [];
    await gotoReady(page, `${base}/good`);
    await page.evaluate(() => {
      window.__wjCtx = 'alive';
      window.__wjFallbacks = [];
      document.addEventListener('webjs:navigation-fallback', (e) => {
        window.__wjFallbacks.push(e.detail && e.detail.cause);
      });
      // Tag the layout's own DOM so its IDENTITY can be checked after the swap,
      // not merely its presence: a re-created node would look the same.
      document.querySelector('main').__wjIdentity = 'same-main';
      document.querySelector('counter-el').__wjIdentity = 'same-counter';
    });
    // Give the counter some hydrated state to lose.
    await page.click('#bump');
    await page.waitForFunction(() => /bumped 1/.test(document.querySelector('#bump').textContent));

    await page.evaluate(() => document.querySelector('#to-crash').click());
    await page.waitForSelector('#crash-boundary', { timeout: 5000 });

    assert.match(page.url(), /\/crash$/);
    assert.equal(
      await page.evaluate(() => window.__wjCtx), 'alive',
      'the document was never reloaded, so it really was a soft navigation',
    );
    fallbacks.push(...await page.evaluate(() => window.__wjFallbacks));
    assert.deepEqual(fallbacks, [], 'the router did not degrade to a full page load');

    const identity = await page.evaluate(() => ({
      main: document.querySelector('main') && document.querySelector('main').__wjIdentity,
      counter: document.querySelector('counter-el') && document.querySelector('counter-el').__wjIdentity,
      bump: document.querySelector('#bump') && document.querySelector('#bump').textContent,
      boundary: document.querySelector('#crash-boundary').textContent,
    }));
    assert.equal(identity.main, 'same-main', 'the layout element itself survived, not a copy of it');
    assert.equal(identity.counter, 'same-counter', 'and so did the interactive component inside it');
    assert.match(identity.bump, /bumped 1/, 'its hydrated state survived too');
    assert.match(identity.boundary, /this page threw during render/, 'the boundary rendered the real error');
  });

  test('merely PREFETCHING a link to a throwing page raises no overlay', async () => {
    // The listener goes on BEFORE the navigation, for two reasons. The prefetch
    // strategy is device-adaptive, and on the `viewport` branch (no hover
    // pointer) the already-visible /crash link can be prefetched during load,
    // before a listener attached afterwards would exist. And counting into an
    // array rather than awaiting a bare promise means a miss FAILS on a
    // deadline instead of hanging: `node --test` has no default per-test
    // timeout, so an unbounded await would stall CI until its own ceiling.
    const prefetches = [];
    const onReq = (req) => {
      if (req.headers()['x-webjs-prefetch'] === '1' && req.url().endsWith('/crash')) {
        prefetches.push(req.url());
      }
    };
    page.on('request', onReq);
    try {
      await gotoReady(page, `${base}/good`);
      assert.equal(await page.$(OVERLAY), null);

      // A real pointer hover over the anchor, which is what fires the intent
      // prefetch. This is the half of #1047 that needs no navigation at all.
      await page.hover('#to-crash');
      assert.equal(
        await waitFor(() => prefetches.length > 0), true,
        'the throwing page really was prefetched (nothing to assert about otherwise)',
      );

      // Give the SSE frame ample time to arrive and (wrongly) paint.
      await sleep(1000);
      assert.equal(await page.$(OVERLAY), null, 'hovering a link to a broken page does not break this one');
      assert.match(page.url(), /\/good$/, 'and the user never left the page they were on');
    } finally { page.off('request', onReq); }
  });
});
