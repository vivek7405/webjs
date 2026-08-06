/**
 * End-to-end test for nested-layout partial-swap navigation.
 *
 * Runs against the website dev server, drives a real Chromium browser
 * via playwright, and asserts that:
 *
 *   1. The docs sidenav DOM identity is preserved across sidebar link
 *      clicks (the bug we set out to fix).
 *   2. The sidenav's scroll position is preserved across nav.
 *   3. The right-hand content actually swaps to the new component.
 *   4. The URL updates correctly via pushState.
 *   5. No console errors fire during the swap.
 *   6. X-Webjs-Have request header is sent on subsequent navigations
 *      (the wire-byte optimization is engaged).
 *
 * The component gallery at /ui/<name> is the canonical motivating
 * case: nested root → gallery layouts, sidebar inside the gallery layout,
 * content inside the gallery layout's children-slot. It moved here from the
 * old ui.webjs.dev host in #1099, and that host is gone entirely now.
 *
 * Run: node --test test/e2e/nested-layout-partial-swap.test.mjs
 *
 * The test assumes a website dev server is already running on
 * port 5001 (npm run dev in website). If not, the test fails fast
 * with a helpful message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = 'http://localhost:5001';

async function ensureServer() {
  try {
    const res = await fetch(`${BASE}/ui`);
    if (!res.ok) throw new Error(`server responded ${res.status}`);
  } catch (err) {
    throw new Error(
      `website dev server not reachable at ${BASE}. ` +
      `Start it with: cd website && npm run dev`
    );
  }
}

test('nested-layout partial-swap: gallery sidebar scroll + identity preserved', async () => {
  await ensureServer();

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  /** @type {string[]} */
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));

  /** @type {Array<{ url: string, have: string | null, frame: string | null }>} */
  const captured = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url().includes('/ui/')) {
      captured.push({
        url: req.url(),
        have: req.headers()['x-webjs-have'] || null,
        frame: req.headers()['x-webjs-frame'] || null,
      });
    }
  });

  try {
    // 1. Load the docs page for one component.
    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');

    // Sanity: sidenav exists.
    const sidenav = page.locator('.docs-sidebar').first();
    await sidenav.waitFor({ state: 'attached' });

    // Tag the sidenav with a unique attribute so we can prove it's the
    // SAME DOM node after navigation (not a re-rendered replacement).
    await sidenav.evaluate((el) => { el.setAttribute('data-identity-probe', 'before-nav'); });

    // Tag the main content with a probe too.
    await page.evaluate(() => {
      const main = document.querySelector('.docs-sidebar')?.parentElement?.children?.[1];
      if (main) main.setAttribute('data-content-probe', 'before-nav');
    });

    // Scroll the nav to a non-zero position. The scroll container is the
    // `.docs-nav` INSIDE the aside (`flex-1 min-h-0 overflow-y-auto`), not
    // the aside itself, which is a plain flex column.
    const initialScrollTop = await page.locator('.docs-nav').first().evaluate((el) => {
      el.scrollTop = 200;
      return el.scrollTop;
    });
    assert.ok(initialScrollTop > 0,
      `expected the nav scrollable; got scrollTop=${initialScrollTop}`);

    // 2. Click a sidebar link to a DIFFERENT component.
    // The sidenav lists components: pick one we know exists.
    const linkText = 'card';
    const link = sidenav.locator(`a:has-text("${linkText}")`).first();
    await link.waitFor({ state: 'attached' });
    await link.click();

    // Wait for the router-driven navigation to settle. webjs:navigate
    // fires when the swap is complete.
    await page.waitForFunction(() =>
      location.pathname.endsWith('/card'),
      { timeout: 4000 }
    );
    // Network might still be settling (revalidation, etc.): wait briefly.
    await page.waitForTimeout(100);

    // 3. The same sidenav DOM node should still carry our probe.
    const sidenavIdentityProbe = await page.locator('.docs-sidebar').first()
      .evaluate((el) => el.getAttribute('data-identity-probe'));
    assert.equal(sidenavIdentityProbe, 'before-nav',
      'sidenav DOM identity preserved: partial swap did NOT re-render the docs layout');

    // 4. The scroll position survives.
    const scrollTopAfter = await page.locator('.docs-nav').first()
      .evaluate((el) => el.scrollTop);
    assert.equal(scrollTopAfter, 200,
      `nav scroll preserved; expected 200, got ${scrollTopAfter}`);

    // 5. The right-hand content actually changed: page heading reflects new component.
    const heading = await page.locator('h1').first().textContent();
    assert.ok(/card/i.test(heading || ''),
      `expected heading to mention "Card", got: ${heading}`);

    // 6. The X-Webjs-Have header was sent on the subsequent navigation.
    const navRequests = captured.filter((c) => c.url.includes('/ui/card'));
    assert.ok(navRequests.length > 0, 'router fetched the target URL');
    const navReq = navRequests[0];
    assert.ok(navReq.have, `X-Webjs-Have should be set; captured: ${JSON.stringify(navReq)}`);
    assert.ok(navReq.have.includes('/'),
      `X-Webjs-Have should include root path; got: ${navReq.have}`);

    // 7. No console errors during the whole flow.
    assert.deepEqual(consoleErrors, [],
      `expected no console errors; got:\n  ${consoleErrors.join('\n  ')}`);
  } finally {
    await browser.close();
  }
});

test('nested-layout partial-swap: back button restores prior page from snapshot cache', async () => {
  await ensureServer();

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    // Visit two pages in sequence, then go back.
    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');

    const firstHeading = (await page.locator('h1').first().textContent()) || '';

    // Click a different sidebar link.
    const link = page.locator('.docs-sidebar a:has-text("card")').first();
    await link.click();
    await page.waitForFunction(() => location.pathname.endsWith('/card'), { timeout: 4000 });
    await page.waitForTimeout(100);

    // Go back via browser history.
    await page.goBack();
    await page.waitForFunction(() => location.pathname.endsWith('/button'), { timeout: 4000 });
    await page.waitForTimeout(100);

    // Heading should match the first page again.
    const back = (await page.locator('h1').first().textContent()) || '';
    assert.equal(back, firstHeading, 'back-button restored the prior heading');
  } finally {
    await browser.close();
  }
});
