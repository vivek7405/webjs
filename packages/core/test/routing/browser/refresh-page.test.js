/**
 * `refreshPage(mode)` (#1398): re-render the CURRENT url on the server and
 * apply it in place, with no page load.
 *
 * Every assertion here is about what SURVIVES a swap and what does not, which
 * is only observable against real DOM identity, a real custom-element upgrade,
 * and real scroll, so it runs in a browser rather than against a parsed string.
 *
 * The nav guard is installed per suite, as the core package's browser-test rule
 * requires: a degradation inside `refreshPage` hard-navigates, and an
 * unguarded hard navigation aborts the whole web-test-runner session rather
 * than failing this one file.
 */
import {
  enableClientRouter, disableClientRouter, refreshPage,
  _setCurrentPageUrl,
} from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 6; i++) await tick(); }

/**
 * A counter element, so "the hydrated state of a component outside the changed
 * region survives" is a real assertion about a real upgraded instance rather
 * than about markup. Its state lives on the INSTANCE, so it can only survive if
 * the node itself was never replaced.
 */
class RefreshCounter extends HTMLElement {
  constructor() { super(); this.count = 0; }
  connectedCallback() {
    if (this._wired) return;
    this._wired = true;
    this.textContent = 'C0';
    this.addEventListener('click', () => { this.count++; this.textContent = 'C' + this.count; });
  }
}
if (!customElements.get('wj-refresh-counter-1398')) {
  customElements.define('wj-refresh-counter-1398', RefreshCounter);
}

/** The route key of the live page. A same-url refresh always matches it. */
const KEY = '/refresh-1398';

/**
 * The body of a rendered page: layout chrome and a hydrated component OUTSIDE
 * the children range, page content INSIDE it. The split is the whole point,
 * since it is what makes `page` and `shell` observably different.
 */
function bodyHtml({ shell, inner }) {
  return `<div id="wj-refresh-shell">${shell}</div>`
    + '<wj-refresh-counter-1398 id="wj-refresh-ctr"></wj-refresh-counter-1398>'
    + `<!--wj:children:/:${KEY}-->`
    + `<span id="wj-refresh-inner">${inner}</span>`
    + '<div id="wj-refresh-tall" style="height:3000px"></div>'
    + `<!--/wj:children:/-->`;
}

function docHtml(parts) {
  return `<!doctype html><html><head></head><body>${bodyHtml(parts)}</body></html>`;
}

suite('Client router: refreshPage re-renders the current url in place (#1398)', () => {
  let navGuard, container, origFetch, calls, respond;

  function setup() {
    navGuard = installNavGuard();
    enableClientRouter();
    container = document.createElement('div');
    container.innerHTML = bodyHtml({ shell: 'SHELL_A', inner: 'INNER_A' });
    document.body.appendChild(container);
    _setCurrentPageUrl(location.href);
    calls = [];
    respond = () => docHtml({ shell: 'SHELL_B', inner: 'INNER_B' });
    origFetch = window.fetch;
    window.fetch = (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return Promise.resolve(new Response(respond(), {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }));
    };
  }

  function teardown() {
    window.fetch = origFetch;
    container.remove();
    // A `shell` refresh replaces the body WHOLESALE, so its swapped-in content
    // lands as a sibling of the container rather than inside it, and removing
    // the container leaves it behind. Sweep the elements AND the boundary
    // COMMENTS: a leftover comment pair is not visible to an element selector,
    // and a body carrying two of them scans as poisoned, so the next case would
    // degrade to a hard navigation instead of testing what it means to.
    for (const id of ['wj-refresh-shell', 'wj-refresh-ctr', 'wj-refresh-inner', 'wj-refresh-tall']) {
      document.querySelectorAll('#' + id).forEach((el) => el.remove());
    }
    for (const n of [...document.body.childNodes]) {
      if (n.nodeType === 8 && /^\/?wj:children:/.test(n.data)) n.remove();
    }
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    _setCurrentPageUrl(null);
    navGuard.remove();
    disableClientRouter();
  }

  // THE headline assertion of the whole issue: a page edit updates the page
  // content and leaves the reader's hydrated state alone.
  test('page mode morphs the boundary range and a component outside it keeps its state', async () => {
    setup();
    try {
      const ctr = document.getElementById('wj-refresh-ctr');
      ctr.click();
      ctr.click();
      assert.equal(ctr.count, 2, 'the counter hydrated and counted');

      const ok = await refreshPage();
      await settle();

      assert.equal(ok, true, 'the refresh applied');
      assert.equal(document.getElementById('wj-refresh-inner').textContent, 'INNER_B',
        'the page content inside the boundary range was re-rendered');
      assert.equal(document.getElementById('wj-refresh-ctr'), ctr,
        'the component outside the range is the SAME node, never re-created');
      assert.equal(ctr.count, 2, 'so its hydrated state survived the refresh');
      assert.equal(navGuard.hardNavigations.length, 0, 'and nothing degraded to a full load');
    } finally {
      teardown();
    }
  });

  test('page mode preserves scroll and records no history entry', async () => {
    setup();
    try {
      window.scrollTo({ top: 500, left: 0, behavior: 'instant' });
      await settle();
      const y = window.scrollY;
      assert.ok(y > 0, 'the fixture is tall enough to scroll');
      const entries = history.length;

      await refreshPage();
      await settle();

      assert.equal(window.scrollY, y, 'the reader keeps their place, no scroll-to-top');
      assert.equal(history.length, entries,
        'no duplicate history entry, so Back still goes to the previous page');
    } finally {
      teardown();
    }
  });

  // The two modes contrasted in ONE test rather than asserted in isolation,
  // because the claim is comparative: a layout's own markup lives outside every
  // children range, so a boundary morph provably cannot reach it.
  test('shell mode replaces the layout markup that page mode provably leaves alone', async () => {
    setup();
    try {
      await refreshPage('page');
      await settle();
      assert.equal(document.getElementById('wj-refresh-shell').textContent, 'SHELL_A',
        'a page morph cannot touch markup outside the children range');
      assert.equal(document.getElementById('wj-refresh-inner').textContent, 'INNER_B',
        'though it did update the page content');

      await refreshPage('shell');
      await settle();
      assert.equal(document.getElementById('wj-refresh-shell').textContent, 'SHELL_B',
        'a shell refresh replaces the whole body, so the layout markup updates');
      assert.equal(navGuard.hardNavigations.length, 0, 'still no full load');
    } finally {
      teardown();
    }
  });

  // Required, not an optimisation. The server short-circuits at the first
  // layout whose segment path AND route key the client already holds, and a
  // same-url request matches every one of them, so a have-header would make a
  // layout edit invisible.
  test('a refresh sends no X-Webjs-Have, so a layout edit is never short-circuited away', async () => {
    setup();
    try {
      await refreshPage();
      await settle();
      const req = calls.find((c) => c.url.includes(location.pathname));
      assert.ok(req, 'the refresh went to the network');
      const headers = req.init.headers || {};
      assert.equal(headers['x-webjs-router'], '1', 'it is still a router request');
      assert.equal('x-webjs-have' in headers, false, 'and it carries no have-header');
    } finally {
      teardown();
    }
  });

  // The return value has to be READ from the swap outcome, not inferred from
  // the absence of a throw. `fetchAndApply` reports every real failure as
  // `{ ok: false }` and throws for none of them, so a bare try/catch would
  // resolve `true` for exactly the cases the caller's full-load fallback exists
  // to cover, and the page would silently sit on stale content.
  test('a refresh that could not apply resolves false, so the caller can fall back', async () => {
    setup();
    try {
      // A rejected fetch is the offline / server-died case, which is precisely
      // when the dev client has to reload rather than keep the stale page.
      window.fetch = () => Promise.reject(new TypeError('network down'));
      assert.equal(await refreshPage(), false, 'a transport failure declines');

      // A non-HTML body (a JSON 500) never reaches a swap either.
      window.fetch = () => Promise.resolve(new Response('{"nope":true}', {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
      assert.equal(await refreshPage(), false, 'a non-HTML response declines');
    } finally {
      teardown();
    }
  });

  // The counterfactual for the test above: an implementation that always
  // resolved `false` would pass it and fail this one.
  test('a refresh that DID apply resolves true', async () => {
    setup();
    try {
      assert.equal(await refreshPage(), true);
      await settle();
      assert.equal(document.getElementById('wj-refresh-inner').textContent, 'INNER_B');
    } finally {
      teardown();
    }
  });

  // `applied` is a different question from `ok`, and reading the wrong one here
  // is a real cost rather than a nicety. An HTML body of ANY status is swapped
  // in place, which is what makes the 422-revalidation and error-boundary
  // behaviour work, so a page rendered through `notFound()` / `forbidden()` /
  // an `error.ts` boundary applied perfectly well. Reporting those as failures
  // would make the dev client reload on top of a swap that already happened,
  // losing the state the refresh exists to keep, every time you iterate on a
  // page that currently renders a 4xx or 5xx.
  test('a swapped error page resolves true, because it applied', async () => {
    setup();
    try {
      for (const status of [404, 403, 500]) {
        respond = () => docHtml({ shell: 'SHELL_A', inner: 'ERROR_' + status });
        const origFetchStub = window.fetch;
        window.fetch = (url, init) => origFetchStub(url, init).then((r) =>
          new Response(r.body, { status, headers: { 'content-type': 'text/html' } }));
        assert.equal(await refreshPage(), true, `a ${status} HTML page applied`);
        await settle();
        assert.equal(document.getElementById('wj-refresh-inner').textContent, 'ERROR_' + status,
          `and the ${status} body is what is on screen`);
        window.fetch = origFetchStub;
      }
    } finally {
      teardown();
    }
  });

  // The other `'none'` source (#1398). When the incoming boundaries share no
  // segment with the live ones, `applySwap` degrades to a hard navigation and
  // returns without committing. That IS a correct recovery, but nothing was
  // applied in place, and a refresh that reports otherwise would leave the dev
  // client believing a swap happened.
  test('a refresh that degrades to a hard navigation reports that it did not apply', async () => {
    setup();
    try {
      // A response whose boundary keys share nothing with the live page.
      respond = () => '<!doctype html><html><head></head><body>'
        + '<!--wj:children:/other:/other-different-->'
        + '<span>UNRELATED</span>'
        + '<!--/wj:children:/other-->'
        + '</body></html>';

      assert.equal(await refreshPage(), false, 'it declines, so the caller falls back to a full load');
      await settle();
      assert.equal(navGuard.hardNavigations.length, 1, 'and it degraded to a hard navigation');
      assert.ok(navGuard.fallbacks.some((f) => f.cause === 'no-shared-boundary'),
        'reported with the cause, not silently');
      assert.equal(document.getElementById('wj-refresh-inner').textContent, 'INNER_A',
        'the live page is left exactly as it was');
    } finally {
      teardown();
    }
  });

  // The dev reload client feature-DETECTS the refresh entry on the global
  // rather than assuming it, and the absence covers both no-router cases:
  // `webjs.clientRouter: false`, and a page that ships no component at all so
  // @webjsdev/core never loads.
  test('the global refresh entry tracks the router, and a disabled router declines', async () => {
    disableClientRouter();
    assert.equal(typeof globalThis.__webjsRefreshPage, 'undefined',
      'no entry while the router is off');
    assert.equal(await refreshPage(), false, 'and a refresh declines rather than half-applying');

    enableClientRouter();
    try {
      assert.equal(typeof globalThis.__webjsRefreshPage, 'function',
        'enabling the router publishes it');
      assert.equal(globalThis.__webjsRefreshPage, refreshPage, 'and it is the real entry');
    } finally {
      disableClientRouter();
    }
    assert.equal(typeof globalThis.__webjsRefreshPage, 'undefined', 'disabling takes it back down');
  });
});
