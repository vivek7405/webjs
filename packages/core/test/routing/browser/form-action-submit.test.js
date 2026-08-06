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
  // same reasoning. It is installed per suite, not globally, so any NEW suite
  // that clicks a real link or submits a real form has to opt in. See
  // `test/browser-nav-guard.js` for why the phase is window bubble and never
  // capture.
  let navGuard;

  let container, origFetch, calls;

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
    origFetch = window.fetch;
    window.fetch = (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return Promise.resolve(responder(String(url), init || {}));
    };
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    container.remove();
    if (bOpen) bOpen.remove();
    if (bClose) bClose.remove();
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
      // The seam (#1286) records a hard navigation instead of performing it, so
      // this is a real observation. The old `spyOnReload` helper could not make
      // it: `location.href` is non-configurable on all three engines, so its
      // redefine always threw and the count was structurally always zero.
      assert.equal(navGuard.hardNavigations.length, 0,
        '422 HTML must be applied in place, never a full reload');
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
  /**
   * #1307. A submitter bound inside a component whose host form is unbound
   * reaches the browser through the renderer's cannot-tell fallback, and the
   * submission it produces cannot deliver the identity. The client cannot
   * answer that at reconcile time, but by submit time both the form and the
   * body are in hand, so the guard fires here.
   */
  test('a submission that cannot deliver its action logs once, and still submits', async () => {
    // A response carrying the SAME keyed boundary the container is bracketed
    // with, so the router morphs in place. Without it the nav degrades to a
    // full page load, which is the real production behaviour here but would
    // reload the test page out from under the runner.
    setup(() => new Response(
      '<!--wj:children:/:/--><p>ok</p><!--/wj:children:/-->',
      { status: 200, headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
    ));
    const errors = [];
    const origError = console.error;
    console.error = (...a) => { errors.push(a.join(' ')); };
    const before = location.pathname + location.search;
    try {
      // An UNBOUND form (no method) holding a bound submitter: exactly what the
      // cannot-tell fallback emits when the button lives in a component.
      render(html`
        <form>
          <button type="submit" name="__webjs_action" value="a1b2c3d4e5/publish">go</button>
        </form>
      `, container);
      // A DISPATCHED submit event, not a click. The router handles it exactly
      // the same way, but a synthetic event never triggers the browser's own
      // submission, so a GET promotion cannot navigate the runner page away.
      const fire = () => {
        const btn = container.querySelector('button');
        container.querySelector('form').dispatchEvent(
          new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: btn }),
        );
      };
      fire();
      await tick();

      assert.equal(errors.length, 1, 'exactly one console error');
      assert.ok(errors[0].includes('[webjs]'), 'the message is framework-prefixed');
      assert.ok(errors[0].includes('<form action='), 'and it names the fix');
      // The guard observes; it must not change what the submission does.
      assert.ok(calls.length, 'the submission still went through');

      // Fire-once per shape, so a repeated misconfiguration does not spam.
      fire();
      await tick();
      assert.equal(errors.length, 1, 'still one after a second submit');
    } finally {
      console.error = origError;
      history.replaceState(null, '', before);
      teardown();
    }
  });
});
