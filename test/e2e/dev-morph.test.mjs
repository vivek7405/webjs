/**
 * End-to-end test for the in-place dev refresh (#1398).
 *
 * The acceptance criteria are browser facts and nothing below the browser can
 * stand in for them. Whether a page RELOADED is not observable from the DOM, so
 * the fixture's root layout stamps a `window.__docToken` that only ever assigns
 * when absent: a `shell` swap re-runs the script and leaves it alone, while a
 * real reload replaces the whole global scope and therefore mints a new one.
 * Whether a hydrated component's state SURVIVED needs a real custom-element
 * upgrade and a real instance; and whether the reader kept their place needs
 * real scroll on a real tall document. The
 * unit and browser layers prove the verdict and the swap separately, and this
 * is the only layer that proves the whole loop: edit a file, the watcher
 * classifies it, the frame carries the verdict, the relay coalesces it, and the
 * tab applies it.
 *
 * `__WEBJS_DEV_CHILD: '1'` is load-bearing, and a future reader should not
 * assume this covers `webjs dev` as users run it on Node. It keeps the server
 * in the spawned process instead of re-execing it under the `node --watch`
 * supervisor. That in-process path is the only one that can morph at all: a
 * `node --watch` restart replaces the process, so nothing survives to classify
 * the change and the browser learns of the edit only through a changed boot id,
 * which is unconditionally a full reload. On Bun the same in-process shape is
 * what `bun --hot` gives users by default.
 *
 * This is the first e2e that WRITES to a staged app file. It writes into the
 * temp copy `stageApp()` made, never into the repo.
 *
 * Run: WEBJS_E2E=1 node --test test/e2e/dev-morph.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const FIXTURE = resolve(__dirname, 'fixtures', 'dev-morph-app');

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

/** Copy the fixture somewhere writable and link the framework packages in. */
function stageApp() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-morph-e2e-'));
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

/**
 * The relay coalesces a burst and emits after a 2000ms quiet window (#1397), so
 * every wait below has to clear that plus the swap. Generous rather than tight:
 * a slow CI box that misses the window fails the assertion for the wrong
 * reason, and the cost of waiting is only wall clock.
 */
const RELOAD_SETTLE_MS = 4500;

describe('E2E: a dev page or layout edit refreshes in place (#1398)', {
  skip: !process.env.WEBJS_E2E && 'set WEBJS_E2E=1 to run E2E tests',
}, () => {
  let browser, child, dir, base;

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
  });

  after(async () => {
    if (browser) await browser.close();
    if (child) { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  /** Open the app, wait for the counter to upgrade, and hand back the page. */
  async function open() {
    const page = await browser.newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => !!customElements.get('morph-counter'), { timeout: 10000 });
    await page.waitForSelector('#bump');
    return page;
  }

  test('a PAGE edit updates in place: no reload, scroll kept, component state kept', async () => {
    const page = await open();
    try {
      await page.click('#bump');
      await page.click('#bump');
      await page.evaluate(() => window.scrollTo(0, 400));
      await sleep(100);

      const before = await page.evaluate(() => ({
        token: window.__docToken,
        scrollY: window.scrollY,
        count: document.querySelector('#bump').textContent.trim(),
      }));
      assert.ok(before.token, 'the document stamped a load token');
      assert.equal(before.count, 'count 2', 'the counter hydrated and counted');
      assert.ok(before.scrollY > 0, 'the fixture is tall enough to scroll');

      writeFileSync(join(dir, 'app/page.ts'), `
import { html } from '@webjsdev/core';
export default function Home() {
  return html\`
    <h1 id="page-marker">PAGE_B</h1>
    <div style="height:3000px"></div>
  \`;
}
`);
      await page.waitForFunction(
        () => document.querySelector('#page-marker')?.textContent === 'PAGE_B',
        { timeout: RELOAD_SETTLE_MS + 3000 },
      );

      const after = await page.evaluate(() => ({
        token: window.__docToken,
        scrollY: window.scrollY,
        count: document.querySelector('#bump').textContent.trim(),
      }));
      assert.equal(after.token, before.token, 'the document never loaded again, so this was a real in-place refresh');
      assert.equal(after.scrollY, before.scrollY, 'the reader kept their place');
      assert.equal(after.count, 'count 2', 'and the hydrated counter outside the changed region kept its state');
    } finally {
      await page.close();
    }
  });

  test('a LAYOUT edit updates the layout own markup in place, with no reload', async () => {
    const page = await open();
    try {
      await page.click('#bump');
      await page.evaluate(() => window.scrollTo(0, 400));
      await sleep(100);
      const before = await page.evaluate(() => ({
        token: window.__docToken,
        scrollY: window.scrollY,
        count: document.querySelector('#bump').textContent.trim(),
      }));
      assert.equal(before.count, 'count 1');

      writeFileSync(join(dir, 'app/layout.ts'), `
import { html, type LayoutProps } from '@webjsdev/core';
import '#components/counter.ts';
export default function RootLayout({ children }: LayoutProps) {
  return html\`
    <script>window.__docToken = window.__docToken || String(Math.random());</script>
    <header id="layout-marker">LAYOUT_B</header>
    <morph-counter></morph-counter>
    <main>\${children}</main>
  \`;
}
`);
      await page.waitForFunction(
        () => document.querySelector('#layout-marker')?.textContent === 'LAYOUT_B',
        { timeout: RELOAD_SETTLE_MS + 3000 },
      );

      const after = await page.evaluate(() => ({
        token: window.__docToken,
        scrollY: window.scrollY,
        count: document.querySelector('#bump').textContent.trim(),
      }));
      assert.equal(after.token, before.token, 'the layout markup changed WITHOUT a document load');
      assert.equal(after.scrollY, before.scrollY, 'the reader kept their place');
      // The honest cost of the shell tier, asserted rather than glossed: it
      // replaces the whole body, so every component is re-created. That is what
      // makes it a different verdict from `page` rather than a slower spelling
      // of the same one.
      assert.equal(after.count, 'count 0', 'component instances do not survive a shell swap');
    } finally {
      await page.close();
    }
  });

  // THE counterfactual, in the direction that matters most. If component edits
  // ever started morphing, the page would keep the OLD class wired to fresh
  // markup, and `customElements.define` being once-per-tag means there is no
  // recovery from that short of a reload.
  test('a COMPONENT edit still triggers a real full reload', async () => {
    const page = await open();
    try {
      const before = await page.evaluate(() => window.__docToken);
      assert.ok(before, 'the document stamped a load token');

      writeFileSync(join(dir, 'components/counter.ts'), `
import { WebComponent, html, prop } from '@webjsdev/core';
class MorphCounter extends WebComponent({ count: prop(Number) }) {
  constructor() { super(); this.count = 0; }
  render() {
    return html\`<button id="bump" @click=\${() => { this.count += 2; }}>count \${this.count}</button>\`;
  }
}
MorphCounter.register('morph-counter');
`);
      // A real reload replaces the global scope, so the token is re-minted.
      // Nothing an in-place refresh does can produce that.
      await page.waitForFunction(
        (t) => window.__docToken && window.__docToken !== t,
        { timeout: RELOAD_SETTLE_MS + 3000 },
        before,
      );
      await page.waitForSelector('#bump');
      await page.click('#bump');
      assert.equal(
        await page.evaluate(() => document.querySelector('#bump').textContent.trim()),
        'count 2',
        'and the reloaded page is running the NEW component class, which counts by two',
      );
    } finally {
      await page.close();
    }
  });
});
