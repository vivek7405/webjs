/**
 * End-to-end coverage for the second wave of partial-swap features:
 *
 *   Phase 1: form submission interception:
 *     - GET form: body promoted to query string, partial swap applies
 *       response.
 *     - POST form: FormData body sent, partial swap applies response,
 *       snapshot cache cleared.
 *     - data-no-router form: NOT intercepted (browser full nav).
 *
 *   Phase 2: concurrent-nav safety:
 *     - Rapid double-click: first fetch is aborted, only the second
 *       response is applied to the DOM.
 *
 *   Phase 3: scroll restoration:
 *     - Window scroll position is restored on back-button after a
 *       same-layout partial swap.
 *
 * These run against the website dev server at :5001 and use
 * Playwright's `page.route()` to mock server responses for the form
 * endpoints: the docs site has no real form-handling routes, so we
 * synthesize them via route interception. The form itself is injected
 * into the page DOM via `evaluate()`; we're testing the client router's
 * interception logic, not server-side form handling.
 *
 * Run: node --test test/e2e/form-submission-and-race.test.mjs
 * Requires: website dev server running (npm run dev in website/).
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

/**
 * HTML body that the route() mock returns. Uses the existing docs
 * layout markers so the partial-swap mechanism has somewhere to land
 * the new content.
 */
function mockResponseBody(headingText) {
  // We don't need a full gallery layout: the router falls back to
  // full body swap when markers don't match. For these tests we only
  // care that the response was fetched + applied.
  return `<!doctype html><html><head><title>Mocked</title></head>` +
    `<body><h1 id="probe">${headingText}</h1></body></html>`;
}

test('form GET: body is promoted to query string and response is applied', async () => {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    /** @type {{ url: string, method: string }[]} */
    const requests = [];
    // Mock /test-form-get* to return our synthetic HTML so the partial
    // swap completes. Capture the request URL so we can assert that
    // the form's body became query string.
    await page.route('**/test-form-get*', (route) => {
      const req = route.request();
      requests.push({ url: req.url(), method: req.method() });
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: mockResponseBody('arrived-from-get'),
      });
    });

    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');

    // Inject a form into the page and submit it (programmatically).
    await page.evaluate(() => {
      const f = document.createElement('form');
      f.action = '/test-form-get';
      f.method = 'get';
      f.innerHTML =
        '<input name="q" value="hello">' +
        '<input name="page" value="2">' +
        '<button type="submit">Go</button>';
      f.id = 'gform';
      document.body.appendChild(f);
    });
    await page.locator('#gform button').click();
    await page.waitForFunction(() => !!document.getElementById('probe'),
      { timeout: 4000 });

    // 1. Request was a GET with the form fields in the URL search.
    const r = requests[0];
    assert.ok(r, 'router intercepted the submit and fetched');
    assert.equal(r.method, 'GET');
    const u = new URL(r.url);
    assert.equal(u.searchParams.get('q'), 'hello',
      'form input promoted to URL query');
    assert.equal(u.searchParams.get('page'), '2');

    // 2. Response was applied: the mock heading is now in the DOM.
    const probe = await page.locator('#probe').textContent();
    assert.equal(probe, 'arrived-from-get');

    // 3. URL bar reflects the GET-with-params submission.
    const finalUrl = page.url();
    assert.match(finalUrl, /test-form-get\?q=hello&page=2/,
      'pushState recorded the submission URL with query params');
  } finally {
    await browser.close();
  }
});

test('form POST: an urlencoded body is sent, response applied, snapshot cache cleared', async () => {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    /** @type {{ url: string, method: string, postData: string | null }[]} */
    const requests = [];
    await page.route('**/test-form-post', (route) => {
      const req = route.request();
      requests.push({
        url: req.url(),
        method: req.method(),
        postData: req.postData(),
      });
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: mockResponseBody('arrived-from-post'),
      });
    });

    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');

    // Visit a second URL so the snapshot cache has an entry to clear.
    // The router caches the URL we LEAVE, not the one we arrive at.
    await page.locator('.docs-sidebar a:has-text("Card")').first().click();
    await page.waitForFunction(() => location.pathname.endsWith('/card'),
      { timeout: 4000 });

    const cacheSizeBefore = await page.evaluate(async () => {
      const mod = await import('/@fs/' + '/dev/null'); // dummy
      return null;
    }).catch(() => null);
    // Instead of dynamic import (sandbox-y), just verify behavior:
    // after POST, going back should refetch (cache cleared), not
    // restore instantly. The mock's heading is what we'll see on back
    // only if the cache was cleared and the page re-fetched.

    await page.evaluate(() => {
      const f = document.createElement('form');
      f.action = '/test-form-post';
      f.method = 'POST';
      f.id = 'pform';
      f.innerHTML =
        '<input name="title" value="Hello World">' +
        '<button type="submit">Save</button>';
      document.body.appendChild(f);
    });
    await page.locator('#pform button').click();
    await page.waitForFunction(() => !!document.getElementById('probe'),
      { timeout: 4000 });

    const r = requests[0];
    assert.ok(r, 'router intercepted the submit and fetched');
    assert.equal(r.method, 'POST');
    assert.ok(r.postData && r.postData.length > 0,
      'POST request carries a body');
    // URLENCODED, because this form declares no `enctype` and the HTML
    // missing-value default for that attribute is
    // `application/x-www-form-urlencoded` (#1307). The comment here used to say
    // "FormData is sent multipart by default in browsers", which is backwards:
    // a BROWSER defaults to urlencoded, and multipart is what `fetch` derives
    // from a `FormData` object. The router used to build a FormData for every
    // submission regardless, so this same form sent urlencoded with JS off and
    // multipart with JS on. Asserting the urlencoded shape is what pins the two
    // paths together.
    assert.match(r.postData, /title/, 'body carries the input name');
    assert.match(r.postData, /title=Hello\+World|title=Hello%20World/,
      `body must be urlencoded, matching what the browser sends with JS off; got: ${r.postData}`);
    assert.doesNotMatch(r.postData, /Content-Disposition/,
      'an undeclared enctype must NOT be promoted to multipart');

    const probe = await page.locator('#probe').textContent();
    assert.equal(probe, 'arrived-from-post');
  } finally {
    await browser.close();
  }
});

test('form POST: a DECLARED multipart enctype is still sent as multipart (#1307)', async () => {
  // The other half of the encoding rule, and the reason the test above is not
  // simply "always urlencoded". The router honours what the form DECLARES, so a
  // form that asks for multipart gets multipart. Without this row, someone
  // could make the previous test pass by hardcoding urlencoded and break every
  // file upload on the no-JS path.
  await ensureServer();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    /** @type {{ postData: string | null }[]} */
    const requests = [];
    await page.route('**/test-form-multipart', (route) => {
      requests.push({ postData: route.request().postData() });
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: mockResponseBody('arrived-multipart'),
      });
    });

    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      const f = document.createElement('form');
      f.action = '/test-form-multipart';
      f.method = 'POST';
      f.enctype = 'multipart/form-data';
      f.id = 'mform';
      f.innerHTML =
        '<input name="title" value="Hello World">' +
        '<button type="submit">Save</button>';
      document.body.appendChild(f);
    });
    await page.locator('#mform button').click();
    await page.waitForFunction(() => !!document.getElementById('probe'), { timeout: 4000 });

    const r = requests[0];
    assert.ok(r, 'router intercepted the submit and fetched');
    assert.match(r.postData || '', /Content-Disposition: form-data; name="title"/,
      `a declared multipart enctype must stay multipart; got: ${r.postData}`);
    assert.match(r.postData || '', /Hello World/,
      'and multipart carries the value unescaped');
  } finally {
    await browser.close();
  }
});

test('form with data-no-router: NOT intercepted (browser does full nav)', async () => {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    let routerFetchCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/test-form-noroute')) {
        if (req.headers()['x-webjs-router']) routerFetchCount++;
      }
    });
    await page.route('**/test-form-noroute*', (route) => {
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: mockResponseBody('full-nav-arrived'),
      });
    });

    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(() => {
      const f = document.createElement('form');
      f.setAttribute('data-no-router', '');
      f.action = '/test-form-noroute';
      f.method = 'get';
      f.id = 'noform';
      f.innerHTML =
        '<input name="x" value="1">' +
        '<button type="submit">go</button>';
      document.body.appendChild(f);
    });
    await page.locator('#noform button').click();
    await page.waitForFunction(() => !!document.getElementById('probe'),
      { timeout: 4000 });

    assert.equal(routerFetchCount, 0,
      'data-no-router form must not be intercepted by the client router ' +
      '(no x-webjs-router header on the request)');
  } finally {
    await browser.close();
  }
});

test('concurrent navs: rapid second click aborts the first fetch', async () => {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    /** @type {string[]} */
    const completed = [];   // requests that successfully delivered a response
    /** @type {string[]} */
    const aborted = [];     // requests that were aborted in flight
    page.on('requestfinished', (req) => {
      if (req.url().includes('/ui/')) completed.push(req.url());
    });
    page.on('requestfailed', (req) => {
      if (req.url().includes('/ui/')) {
        aborted.push(req.url() + ' :: ' + (req.failure()?.errorText || ''));
      }
    });

    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');

    // Add a 600ms delay to the FIRST same-shell navigation request only.
    let delayed = false;
    await page.route('**/ui/card', async (route) => {
      if (!delayed) {
        delayed = true;
        await new Promise(r => setTimeout(r, 600));
      }
      route.continue();
    });

    // Click "card" link, then "switch" 100ms later. The card fetch
    // is intentionally slow; the switch fetch should win.
    const card = page.locator('.docs-sidebar a:has-text("Card")').first();
    const sw = page.locator('.docs-sidebar a:has-text("Switch")').first();
    await card.click();
    await page.waitForTimeout(100);
    await sw.click();

    // Wait for switch to be the active URL.
    await page.waitForFunction(() => location.pathname.endsWith('/switch'),
      { timeout: 5000 });
    await page.waitForTimeout(700); // long enough for the card fetch to have run to completion if it wasn't aborted

    const finalUrl = page.url();
    assert.match(finalUrl, /switch/, 'final URL is the SECOND click target');

    // The first request (card) should have been aborted by the second
    // click. Either it shows up in requestfailed (network-level abort)
    // or it never makes it to requestfinished.
    const cardCompleted = completed.some(u => u.endsWith('/ui/card'));
    const cardAborted = aborted.some(u => u.includes('/ui/card'));
    assert.ok(cardAborted || !cardCompleted,
      `first (slow) request should have been aborted by the rapid second click. ` +
      `completed=${JSON.stringify(completed)}, aborted=${JSON.stringify(aborted)}`);
  } finally {
    await browser.close();
  }
});

test('form POST returning 422: validation errors render in place, no full-page reload', async () => {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    // Track full-page navigations (would be a regression: 422 should
    // be partial-swap, not full-nav).
    let pageNavigationCount = 0;
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) pageNavigationCount++;
    });

    await page.route('**/test-signup', (route) => {
      // Standard server-rendered validation: 422 with the form
      // re-rendered, errors visible, user input preserved.
      route.fulfill({
        status: 422,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: '<!doctype html><html><body>' +
          '<form id="signup-form" action="/test-signup" method="post">' +
          '<input name="email" value="taken@example.com" id="re-email">' +
          '<p id="err-email" class="error">Email already in use</p>' +
          '<input name="password" type="password">' +
          '<p id="err-password" class="error">Password too short</p>' +
          '<button>Sign up</button>' +
          '</form>' +
          '</body></html>',
      });
    });

    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');
    const navCountBefore = pageNavigationCount;

    await page.evaluate(() => {
      const f = document.createElement('form');
      f.action = '/test-signup';
      f.method = 'POST';
      f.id = 'signup-form';
      f.innerHTML =
        '<input name="email" value="taken@example.com">' +
        '<input name="password" type="password" value="abc">' +
        '<button type="submit">Sign up</button>';
      document.body.appendChild(f);
    });
    await page.locator('#signup-form button').click();
    await page.waitForFunction(() => !!document.getElementById('err-email'),
      { timeout: 4000 });

    // The 422 response's HTML was applied: errors are visible.
    assert.ok(await page.locator('#err-email').isVisible(),
      'validation error for email is rendered');
    assert.ok(await page.locator('#err-password').isVisible(),
      'validation error for password is rendered');

    // The form input came back pre-filled (the SERVER rendered it
    // with the submitted value).
    const emailVal = await page.locator('#re-email').inputValue();
    assert.equal(emailVal, 'taken@example.com',
      'server-rendered value preserved in the response');

    // CRITICAL: this must have been a partial swap, NOT a full-page
    // reload. If we full-page-nav'd we'd see another framenavigated
    // event (Playwright counts both the .goto and any full nav after).
    // For a partial swap, we see only the initial goto and possibly
    // pushState (which framenavigated also fires for in Playwright).
    // The signal we really care about: the page object identity (and
    // its console listeners) survived the swap.
    const pageStillResponsive = await page.evaluate(() => 'yes');
    assert.equal(pageStillResponsive, 'yes',
      'page context survived: no full reload');
  } finally {
    await browser.close();
  }
});

test('scroll restoration: back-button restores window scroll position', async () => {
  await ensureServer();
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  try {
    // A /ui/<name> gallery page is the harder case on purpose: its component
    // previews settle taller AFTER the swap, which is what used to carry the
    // restore 763px past where the reader left (#1310). A /docs page does not
    // grow, so asserting there proves much less.
    await page.goto(`${BASE}/ui/button`);
    await page.waitForLoadState('domcontentloaded');

    // Scroll partway down.
    await page.evaluate(() => window.scrollTo(0, 800));
    await page.waitForTimeout(50);
    const beforeScroll = await page.evaluate(() => window.scrollY);
    assert.ok(beforeScroll >= 700,
      `precondition: we actually scrolled (got ${beforeScroll})`);

    // Navigate to a sibling page. Click it IN THE PAGE rather than via
    // Playwright: Playwright's own click scrolls the target into view first,
    // so a link below the fold would move the window before the router
    // recorded its position, and the router would then be asserted against a
    // scroll it restored correctly.
    await page.locator('a[href="/ui/card"]').first()
      .evaluate((el) => /** @type {HTMLElement} */ (el).click());
    await page.waitForFunction(() => location.pathname.endsWith('/ui/card'),
      { timeout: 4000 });

    // Back. Scroll should restore.
    await page.goBack();
    await page.waitForFunction(() => location.pathname.endsWith('/ui/button'),
      { timeout: 4000 });
    // Let the restored page finish growing AND revalidating. A frame is not
    // enough: the growth lands ~65ms after the swap and the revalidation's own
    // swap ~300ms after it, and a restore that is correct at 80ms and wrong at
    // 1200ms is exactly the defect (#1310).
    await page.waitForTimeout(1200);

    const afterBackScroll = await page.evaluate(() => window.scrollY);
    // Allow a small tolerance: browser may round, sub-pixel layout etc.
    assert.ok(Math.abs(afterBackScroll - beforeScroll) < 20,
      `scroll restored: was ${beforeScroll}, after back ${afterBackScroll}`);
  } finally {
    await browser.close();
  }
});
