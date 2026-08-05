/**
 * Real-browser tests for the client router's enhanced handling of bound form
 * submissions (#1155): a `<form action=${importedAction}>` renders as a plain
 * form posting to the page's own url, carrying the action's identity in a
 * hidden field. The no-JS path is a native form round-trip; the JS path rides
 * the partial-swap pipeline, posting the SAME body to the SAME url, which is
 * what makes the two paths identical by construction rather than by two
 * implementations agreeing. This pins the two responses the dispatcher
 * produces:
 *
 *   - 422 re-render (validation failure): HTML of a 4xx status is applied in
 *     place (NO full-page reload), so the field errors + preserved input show
 *     without losing the rest of the page. This is the same UI the no-JS reload
 *     produces.
 *   - 303 See Other (success / PRG): `fetch` follows it automatically; the
 *     router records the FINAL (redirected) URL in history, not the POST target.
 *
 * MUST run in a real browser: we detect router interception by stubbing fetch
 * (the router's submission path calls it) and inspecting the RequestInit.
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { enableClientRouter } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';
const tick = () => new Promise((r) => setTimeout(r, 20));

suite('Client router: bound form submissions (#1155)', () => {
  // The navigation backstop this suite used to declare inline now lives in the
  // shared guard (#1135), which is the same window-bubble listener with the
  // same reasoning, so every browser suite gets it rather than the few that
  // hand-rolled a copy. See `test/browser-nav-guard.js` for why the phase is
  // window bubble and never capture.
  let navGuard;

  let container, origFetch, calls;
  // When a test redefines window.location.href (to detect a full-page reload),
  // it records the restore fn here so teardown reverts it even if the body
  // throws. Null when no redefine is active.
  let restoreHref;

  let bOpen, bClose;
  function setup(responder) {
    navGuard = installNavGuard();
    enableClientRouter(); // idempotent
    container = document.createElement('div');
    // Bracket the container with a live keyed boundary pair (#1015): the swap
    // needs a shared boundary on both sides, else the router (correctly)
    // degrades to a full page load, which would navigate the test page away.
    bOpen = document.createComment('wj:children:/:/');
    bClose = document.createComment('/wj:children:/');
    document.body.appendChild(bOpen);
    document.body.appendChild(container);
    document.body.appendChild(bClose);
    calls = [];
    restoreHref = null;
    origFetch = window.fetch;
    window.fetch = (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return Promise.resolve(responder(String(url), init || {}));
    };
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    if (restoreHref) { try { restoreHref(); } catch { /* ignore */ } restoreHref = null; }
    container.remove();
    if (bOpen) bOpen.remove();
    if (bClose) bClose.remove();
  }

  /**
   * Replace window.location.href's setter with a spy so a full-page reload is
   * observable (the router falls back to `location.href = url` only for a
   * non-HTML / error response). Returns a getter for the reload count. The
   * descriptor restore is registered on `restoreHref` so teardown always
   * reverts it. Some browsers forbid redefining the accessor; in that case the
   * spy is a no-op and the test leans on the DOM-applied assertion instead.
   */
  function spyOnReload() {
    let reloads = 0;
    const realDescriptor = Object.getOwnPropertyDescriptor(Location.prototype, 'href')
      || Object.getOwnPropertyDescriptor(window.location, 'href');
    let installed = false;
    try {
      Object.defineProperty(window.location, 'href', {
        configurable: true,
        get: () => location.toString(),
        set: () => { reloads += 1; },
      });
      installed = true;
    } catch { /* redefining forbidden here; rely on the DOM assertion */ }
    if (installed && realDescriptor) {
      restoreHref = () => Object.defineProperty(window.location, 'href', realDescriptor);
    }
    return { count: () => reloads, installed: () => installed };
  }

  test('a bound form posts to the page own url and carries the identity field', async () => {
    // The rendered form has NO `action` attribute (the renderer omits it so the
    // browser posts to the current document), so this also pins that the router
    // resolves an attribute-less form to the page url rather than skipping it.
    setup(() => new Response('<!--wj:children:/:/--><p>ok</p><!--/wj:children:/-->', {
      headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
    }));
    const here = location.pathname;
    try {
      render(html`
        <form method="post" enctype="multipart/form-data">
          <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/signup">
          <input name="email" value="a@b.com">
          <button type="submit">go</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      const post = calls[0];
      assert.ok(post, 'router issued the submission fetch');
      assert.equal(new URL(post.url).pathname, here, 'posts to the page own url');
      assert.equal((post.init.method || 'GET').toUpperCase(), 'POST', 'method is POST');
      assert.ok(post.init.body instanceof FormData, 'body is FormData');
      assert.equal(post.init.body.get('email'), 'a@b.com', 'FormData carries the field');
      assert.equal(post.init.body.get('__webjs_action'), 'a1b2c3d4e5/signup',
        'and the identity, without which the server has nothing to dispatch on');
    } finally { teardown(); }
  });

  test("a submit button's own name/value rides along with the identity", async () => {
    // A multi-button form tells its buttons apart by the submitter's name.
    // Both have to survive, which is also why `formaction=${fn}` is refused
    // rather than supported: a per-submitter identity would want that same pair.
    setup(() => new Response('<!--wj:children:/:/--><p>ok</p><!--/wj:children:/-->', {
      headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
    }));
    try {
      render(html`
        <form method="post">
          <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/act">
          <button type="submit" name="intent" value="publish">publish</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      const body = calls[0].init.body;
      assert.equal(body.get('intent'), 'publish', "the submitter's name/value is submitted");
      assert.equal(body.get('__webjs_action'), 'a1b2c3d4e5/act', 'alongside the identity');
    } finally { teardown(); }
  });

  test('a 422 HTML response is applied in place, not via a full reload', async () => {
    // A unique marker in the 422 body. The router swaps the body in place, so
    // after the submission the marker must be in the live document. A full
    // reload would instead leave the spy's reload count non-zero AND never
    // place the marker. Asserting both makes "applied in place" robust rather
    // than leaning on a single inline flag.
    const marker = `pa-422-${Math.random().toString(36).slice(2)}`;
    setup(() => new Response(
      `<!--wj:children:/:/--><main><form method="post"><p class="error" id="${marker}">Enter a valid email</p>` +
      '<input name="email" value="bad"></form></main><!--/wj:children:/-->',
      { status: 422, headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
    ));
    const reload = spyOnReload();
    try {
      render(html`
        <main>
          <form method="post">
            <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/signup">
            <input name="email" value="bad">
            <button type="submit">go</button>
          </form>
        </main>
      `, container);
      container.querySelector('button').click();
      await tick();

      assert.ok(calls.length, 'fetch was issued');
      assert.equal(reload.count(), 0, '422 HTML must be applied in place, never a full reload');
      // The 422 body was actually applied to the live DOM (the field error is
      // now present), which a full reload would never achieve from a fetch stub.
      assert.ok(document.getElementById(marker), 'the 422 re-render body was applied in place');
    } finally { teardown(); }
  });

  test('a 303-redirected success records the FINAL url in history (PRG)', async () => {
    // fetch follows a 303 automatically; the resolved Response reports
    // redirected=true and url=<final>. The router records that, not the POST
    // target. We simulate by returning a redirected-shaped Response.
    setup(() => {
      const r = new Response('<!--wj:children:/:/--><p>welcome</p><!--/wj:children:/-->', {
        status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
      });
      Object.defineProperty(r, 'redirected', { value: true });
      Object.defineProperty(r, 'url', { value: location.origin + '/welcome' });
      return r;
    });
    const before = location.pathname;
    try {
      render(html`
        <form method="post">
          <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/signup">
          <button type="submit">go</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      assert.ok(calls.length, 'fetch was issued');
      assert.equal(location.pathname, '/welcome', 'history advanced to the redirected URL');
    } finally {
      // Restore history so later tests start clean.
      history.replaceState(null, '', before);
      teardown();
    }
  });
});
