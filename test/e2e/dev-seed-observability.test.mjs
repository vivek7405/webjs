/**
 * End-to-end test for dev observability of SSR action seeding (#1309).
 *
 * The headline acceptance criterion is a browser one, so a unit test cannot
 * stand in for it: a developer whose seeding silently broke must see it WITHOUT
 * opening the network tab. Three things are only true in a real browser against
 * a real `webjs dev`, which is why this is an e2e:
 *
 *   1. Whether the hydrating component actually re-issues the RPC. That is a
 *      network fact, asserted here as a request probe, not inferred.
 *   2. Whether the console line fires, and only on a defect. The report runs on
 *      `requestIdleCallback` after hydration, so it needs a real event loop and
 *      a real hydration pass.
 *   3. Whether the marker survives the whole dev pipeline (the TS strip, the
 *      module graph, the served bundle) rather than just `buildSeedScript`.
 *
 * The fixture (`fixtures/dev-seed-app`) is copied to a temp dir and given
 * symlinked `@webjsdev/*` so a fresh worktree (which has no node_modules) can
 * run it, the same staging `dev-overlay-nav.test.mjs` uses. The prod-mode
 * seeding e2e in `e2e.test.mjs` is unchanged and still covers the no-refetch
 * property itself.
 *
 * Run: WEBJS_E2E=1 node --test test/e2e/dev-seed-observability.test.mjs
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
const FIXTURE = resolve(__dirname, 'fixtures', 'dev-seed-app');
const WARN_PREFIX = '[webjs] SSR action seeding:';

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
  const dir = mkdtempSync(join(tmpdir(), 'webjs-seed-e2e-'));
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

describe('E2E: dev observability for SSR action seeding (#1309)', {
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

  /**
   * Load `path` in a fresh page, collecting the action RPCs it issued and the
   * seeding warnings it logged. The dwell is long enough for hydration plus the
   * idle-scheduled report (which carries a 1000ms timeout).
   */
  async function visit(path) {
    const page = await browser.newPage();
    const rpcs = [];
    const warns = [];
    page.on('request', (r) => { if (r.url().includes('/__webjs/action/')) rpcs.push(r.url()); });
    page.on('console', (m) => { if (m.text().includes(WARN_PREFIX)) warns.push(m.text()); });
    try {
      await page.goto(`${base}${path}`, { waitUntil: 'networkidle2' });
      await page.waitForFunction(() => !!customElements.get('thing-card') || !!customElements.get('unseeded-card'), { timeout: 10000 });
      await sleep(1600);
      return { rpcs, warns, html: await page.content() };
    } finally {
      await page.close();
    }
  }

  test('the dev header reports the counts for a seeded page', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-webjs-seed'), 'collected=1, emitted=1');
    assert.match(await res.text(), /id="__webjs-seeds" data-webjs-dev="ok"/);
  });

  test('a healthy page issues NO action RPC on hydration and logs NOTHING', async () => {
    const { rpcs, warns, html } = await visit('/');
    assert.match(html, /thing-1/, 'the SSR data is in the paint');
    assert.deepEqual(rpcs, [], 'the seed answered the hydration call, so no round-trip');
    assert.deepEqual(warns, [], 'and a working page says nothing at all');
  });

  test('a page whose call the seed cannot cover logs exactly one line naming the cause', async () => {
    const { rpcs, warns } = await visit('/unseeded');
    assert.equal(rpcs.length, 1, 'the unmatched key really did cost a network round-trip');
    assert.equal(warns.length, 1, 'exactly one line, not one per call');
    assert.match(warns[0], /1 of 1 hydration action call\(s\) missed the seed/);
    assert.match(warns[0], /carried seeds, but not for these calls/);
  });
});
