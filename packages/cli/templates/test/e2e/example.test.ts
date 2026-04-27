/**
 * Example E2E test — replace with tests for your user flows.
 *
 * Run:  WEBJS_E2E=1 webjs test
 * Or:   WEBJS_E2E=1 node --test test/e2e/*.test.ts
 *
 * Requires: puppeteer-core + chromium installed.
 *   npm i -D puppeteer-core
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

let browser: any, page: any, serverProcess: any, baseUrl: string;

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
