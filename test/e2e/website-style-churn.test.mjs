/**
 * E2E: navigating the website adds and removes no stylesheet (#1109).
 *
 * The reported bug is an intermittent full-page flash, fixed navbar included,
 * when clicking in and out of /docs on webjs.dev. The layout is preserved (the
 * header element keeps its object identity across every hop, and the router
 * issues no main-frame navigation), so nothing about the DOM diff explains it.
 * The mechanism is CSSOM: the landing page rendered a `<style>` and the docs
 * sub-layout rendered a different one, both INSIDE the router's swap boundary,
 * so each crossing removed one stylesheet and inserted another. Adding or
 * removing a stylesheet invalidates style for the entire document, preserved
 * DOM included, and the site's oklch() / color-mix() tokens behind a
 * backdrop-filter header are expensive to re-resolve.
 *
 * Why this test exists on top of the SSR ones in website/test/ssr:
 * style-churn.test.ts proves the SERVED HTML carries no `<style>` inside a
 * boundary, which is the authoring rule. This proves the consequence in a real
 * browser over the real router: across the exact reported cycle, repeated well
 * past the "once in a while" threshold, the live document's `<style>` set never
 * changes. Those are different claims. The server could serve churn-free HTML
 * and the router could still inject or drop a sheet during the swap or the head
 * merge, and only a browser can see that.
 *
 * Observed rather than sampled. A MutationObserver records every style-node add
 * and remove for the whole run, so a sheet that is removed and re-added within
 * one frame is still caught. The earlier CDP screencast on the live site sampled
 * about 11fps and could not rule out a one-frame flash, which is the measurement
 * mistake this avoids.
 *
 * The observer walks each added and removed SUBTREE rather than testing the
 * node itself. `addedNodes` and `removedNodes` carry only the root of a change,
 * so a `<style>` wrapped in a `<div>` would otherwise never be seen and the
 * churn log would stay empty while the page churned. That happens not to be the
 * shape of the two blocks this PR moved (both were top-level nodes of their
 * templates), which is exactly the sort of accident that stops holding later.
 *
 * Run: WEBJS_E2E=1 node --test test/e2e/website-style-churn.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const WEBSITE_DIR = resolve(ROOT, 'website');

/** The reported reproduction, one lap. Landing, docs, a sidebar item, back. */
const CYCLE = ['/', '/docs/getting-started', '/docs/routing', '/'];
/** The issue asks for at least 20 repetitions of the reported cycle. */
const LAPS = 22;

let browser, page, serverProcess, baseUrl;

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
 * Start the website in PROD mode on `port`. Prod runs `webjs.start.before`,
 * which compiles public/tailwind.css, so the relocated rules are actually
 * present. That matters here: this test would pass vacuously against a stale or
 * missing stylesheet, since "no style churn" is trivially true when there is no
 * style at all. The assertions below check the sheet resolved before trusting
 * the churn count.
 */
async function startWebsite(port) {
  const cliPath = resolve(ROOT, 'packages', 'cli', 'bin', 'webjs.js');
  const child = spawn(process.execPath, [cliPath, 'start', '--port', String(port)], {
    cwd: WEBSITE_DIR,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });

  // Poll the server rather than pattern-matching its stdout. Readiness here is
  // not "the process printed something": the boot runs the start.before Tailwind
  // compile AND the importmap vendor pass, and the vendor pass can spend tens of
  // seconds on network timeouts before the listener answers. Matching a log line
  // raced ahead of that and the first page.goto then timed out.
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`website exited (${child.exitCode}):\n${log}`);
    try {
      const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) { await res.arrayBuffer(); return child; }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`website did not answer on ${port} within 120s:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('E2E: website style churn (#1109)', {
  skip: !process.env.WEBJS_E2E && 'set WEBJS_E2E=1 to run E2E tests',
}, () => {
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const chromium = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
    const port = await freePort();
    baseUrl = `http://localhost:${port}`;
    serverProcess = await startWebsite(port);
    browser = await puppeteer.launch({
      executablePath: chromium,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(60_000);
  });

  after(async () => {
    await browser?.close();
    serverProcess?.kill('SIGTERM');
  });

  /** Total bytes of inline style plus the count of stylesheet links. */
  const styleFingerprint = () => page.evaluate(() => ({
    inlineBytes: [...document.querySelectorAll('style')].reduce((n, s) => n + s.textContent.length, 0),
    inlineCount: document.querySelectorAll('style').length,
    linkCount: document.querySelectorAll('link[rel~="stylesheet"]').length,
  }));

  test('the relocated docs rules resolve from the compiled stylesheet', async () => {
    // Run FIRST, on its own hard load. "No style churn" is trivially true when
    // there is no style at all, so establish that the rules actually reach the
    // page before the churn test is allowed to mean anything. A stale or 404
    // public/tailwind.css is the failure mode this catches.
    const probe = () => page.evaluate(() => {
      const ul = document.querySelector('.prose-docs ul');
      const h1 = document.querySelector('.prose-docs h1');
      const side = document.querySelector('#docs-sidebar');
      return {
        listStyle: ul ? getComputedStyle(ul).listStyleType : null,
        padLeft: ul ? getComputedStyle(ul).paddingLeft : null,
        h1Family: h1 ? getComputedStyle(h1).fontFamily : null,
        sidebarPos: getComputedStyle(side).position,
        sidebarVis: getComputedStyle(side).visibility,
      };
    });

    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(baseUrl + '/docs/routing', { waitUntil: 'domcontentloaded' });
    const desktop = await probe();
    assert.equal(desktop.listStyle, 'disc', 'the prose list markers survive Tailwind preflight from the compiled sheet');
    assert.equal(desktop.padLeft, '24px', 'and the marker inset came through too');
    assert.match(desktop.h1Family || '', /serif/i, 'the docs h1 resolves the shared serif stack');
    assert.equal(desktop.sidebarPos, 'sticky', 'the desktop sidebar rules came through');
    assert.equal(desktop.sidebarVis, 'visible', 'and the desktop sidebar is not the hidden drawer');

    // The drawer rules ride a hand-written max-width: 859.98px query, which is
    // the fiddliest part of the move (see the note on that breakpoint in
    // input.css). Prove the query survived compilation rather than assuming it.
    await page.setViewport({ width: 420, height: 900 });
    await page.goto(baseUrl + '/docs/routing', { waitUntil: 'domcontentloaded' });
    const mobile = await probe();
    assert.equal(mobile.sidebarPos, 'fixed', 'under 860px the sidebar becomes the fixed drawer');
    assert.equal(mobile.sidebarVis, 'hidden', 'and starts closed, out of the tab order');
    assert.equal(mobile.listStyle, 'disc', 'the prose scale still applies at mobile width');

    await page.setViewport({ width: 1280, height: 900 });
  });

  test(`no <style> is added or removed across ${LAPS} laps of the reported cycle`, async () => {
    await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });

    // The router only intercepts once @webjsdev/core has loaded. Without this
    // the first hops would be full page loads, which reload the document and
    // would make the churn count trivially zero for the wrong reason.
    await page.waitForFunction(() => !!customElements.get('theme-toggle'), { timeout: 20_000 });

    // Install the observer LAST, after every hard load this test needs. A
    // page.goto tears the document down and takes the observer with it, so
    // anything below here must be a soft navigation.
    await page.evaluate(() => {
      const w = /** @type {any} */ (window);
      w.__styleChurn = [];
      w.__header = document.querySelector('header');
      const isStyle = (n) => n.nodeType === 1 && (n.tagName === 'STYLE'
        || (n.tagName === 'LINK' && (n.getAttribute('rel') || '').toLowerCase().includes('stylesheet')));
      // Walk the whole subtree: addedNodes/removedNodes carry only the root of
      // a change, so a nested <style> is invisible to a test on the node alone.
      const stylesIn = (n) => {
        if (n.nodeType !== 1) return [];
        const found = isStyle(n) ? [n] : [];
        if (n.querySelectorAll) found.push(...n.querySelectorAll('style, link[rel~="stylesheet"]'));
        return found;
      };
      const record = (op) => (n) => {
        for (const el of stylesIn(n)) {
          w.__styleChurn.push({ op, tag: el.tagName, len: (el.textContent || '').length });
        }
      };
      new MutationObserver((records) => {
        for (const r of records) {
          r.addedNodes.forEach(record('add'));
          r.removedNodes.forEach(record('remove'));
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    });

    const baseline = await styleFingerprint();
    assert.ok(baseline.inlineBytes > 0, 'the landing page carries inline style, so this is not vacuous');
    assert.equal(baseline.linkCount, 1, 'and exactly one compiled stylesheet is linked');

    const fingerprints = [];
    let hops = 0;
    for (let lap = 0; lap < LAPS; lap++) {
      for (const path of CYCLE) {
        const before = await page.evaluate(() => location.pathname);
        if (before === path) continue;   // the lap seam, / to / is not a hop

        // Click the REAL link, so what is under test is the router's click
        // interception on the actual markup. No programmatic fallback: a
        // history.pushState stand-in would swap nothing, and a test that
        // silently degrades to it would report zero churn for the wrong reason.
        const clicked = await page.evaluate((p) => {
          const a = [...document.querySelectorAll('a[href]')].find((el) => el.getAttribute('href') === p);
          if (!a) return false;
          /** @type {HTMLElement} */ (a).click();
          return true;
        }, path);
        assert.ok(clicked, `no <a href="${path}"> on ${before} to drive the cycle with`);

        await page.waitForFunction((p) => location.pathname === p, { timeout: 15_000 }, path);
        // And wait for the swap to actually land, not just the URL to change.
        await page.waitForFunction(
          (p) => (p.startsWith('/docs') ? !!document.querySelector('.prose-docs') : !!document.querySelector('like-button')),
          { timeout: 15_000 },
          path,
        );
        hops++;
        fingerprints.push({ lap, path, ...(await styleFingerprint()) });
      }
    }

    const churn = await page.evaluate(() => /** @type {any} */ (window).__styleChurn);
    const headerSurvived = await page.evaluate(() =>
      /** @type {any} */ (window).__header === document.querySelector('header'));

    // A full page load would rebuild the document, resetting both the observer
    // and __header, and would make an empty churn log meaningless. The surviving
    // header identity is the proof every hop was a soft swap.
    assert.ok(headerSurvived, 'the header kept its identity, so these were soft navigations');
    assert.equal(hops, LAPS * 3, `expected ${LAPS * 3} soft navigations, got ${hops}`);
    assert.deepEqual(
      churn,
      [],
      `a stylesheet was added or removed during navigation, which invalidates style ` +
        `for the whole document and repaints the preserved layout. Churn log: ${JSON.stringify(churn)}`,
    );

    // Belt and braces: the observer proves nothing was inserted or removed, and
    // this proves the resulting document is byte-stable at every stop.
    for (const f of fingerprints) {
      assert.equal(f.inlineBytes, baseline.inlineBytes, `${f.path} (lap ${f.lap}) changed inline style bytes`);
      assert.equal(f.inlineCount, baseline.inlineCount, `${f.path} (lap ${f.lap}) changed the inline style count`);
      assert.equal(f.linkCount, baseline.linkCount, `${f.path} (lap ${f.lap}) changed the stylesheet link count`);
    }
  });
});
