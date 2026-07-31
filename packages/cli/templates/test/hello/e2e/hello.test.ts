// Example E2E test: replace with tests for your user flows.
//
// Run:  WEBJS_E2E=1 webjs test
//       (or point node --test at your e2e test files directly)
//
// Requires: puppeteer-core + chromium installed.
//   npm i -D puppeteer-core
//
// Note: this header uses line comments on purpose. A JSDoc block comment
// here cannot contain a glob like test/**/e2e/ because the ** followed by /
// closes the block comment early and breaks TypeScript stripping.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

// puppeteer-core is an optional dev dependency, so `import type { Browser,
// Page } from 'puppeteer-core'` does not resolve until you install it. These
// minimal structural types keep the file typed in the meantime; swap them for
// the real imports once puppeteer-core is in package.json. Reaching for `any`
// here would silently un-type every call below.
type Page = {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  title(): Promise<string>;
  on(event: string, handler: (e: Error) => void): void;
  removeAllListeners(event: string): void;
};
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

let browser: Browser, page: Page, serverProcess: ChildProcess, baseUrl: string;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

before(async () => {
  let puppeteer;
  try { puppeteer = (await import('puppeteer-core')).default; }
  catch { console.log('# Skipping: puppeteer-core not installed'); return; }

  const port = await freePort();
  baseUrl = `http://localhost:${port}`;

  serverProcess = spawn('npx', ['webjs', 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, __WEBJS_DEV_CHILD: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (chunk.toString().includes('ready on')) resolve();
    };
    serverProcess.stdout?.on('data', onData);
    serverProcess.stderr?.on('data', onData);
    setTimeout(() => reject(new Error('Server start timeout')), 15000);
  });

  browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox'],
  });
  page = await browser.newPage();
});

after(async () => {
  if (browser) await browser.close();
  if (serverProcess) serverProcess.kill('SIGTERM');
});

describe('E2E: App', {
  skip: !process.env.WEBJS_E2E && 'set WEBJS_E2E=1 to run',
}, () => {

  test('homepage loads and renders', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    const title = await page.title();
    assert.ok(title, 'Page should have a title');
  });

  test('no JavaScript errors', async () => {
    const errors: string[] = [];
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000));
    assert.equal(errors.length, 0, `JS errors: ${errors.join('; ')}`);
    page.removeAllListeners('pageerror');
  });

  // Add your E2E tests here:
  // test('user can sign up', async () => { ... });
  // test('user can create a post', async () => { ... });
});
