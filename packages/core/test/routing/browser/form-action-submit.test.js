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

  // -------------------------------------------------------------------------
  // #1307: the router honours the DECLARED enctype.
  //
  // It used to build a `FormData` for every submission and send it with no
  // explicit content type, so `fetch` always derived `multipart/form-data` and
  // the authored `enctype` was never read at all. A plain `<form method="post">`
  // MEANS `application/x-www-form-urlencoded` in HTML, so the same form sent a
  // urlencoded body with JS off and a multipart body with JS on. Two different
  // requests from one template is exactly what progressive enhancement rules
  // out, and it is why these assertions read the real RequestInit rather than
  // trusting the resolver in isolation.
  // -------------------------------------------------------------------------

  const okHtml = () => new Response(
    '<!--wj:children:/:/--><p>ok</p><!--/wj:children:/-->',
    { headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
  );

  test('a form declaring no enctype sends URLENCODED, the HTML default (#1307)', async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post">
          <input name="email" value="a@b.com">
          <button type="submit">go</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      const post = calls[0];
      assert.ok(post, 'router issued the submission fetch');
      assert.ok(post.init.body instanceof URLSearchParams,
        'a form with no enctype must NOT be sent as multipart');
      assert.equal(post.init.body.get('email'), 'a@b.com', 'and the field survives the encoding');
      // COUNTERFACTUAL: revert `encodeSubmitBody` to return the FormData
      // unconditionally and this goes red, which is what pins the fix.
    } finally { teardown(); }
  });

  test('a form declaring multipart still sends FormData', async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post" enctype="multipart/form-data">
          <input name="email" value="a@b.com">
          <button type="submit">go</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      assert.ok(calls[0].init.body instanceof FormData, 'multipart is still FormData');
    } finally { teardown(); }
  });

  test("a submitter's formenctype overrides the form's, as native precedence says", async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post" enctype="multipart/form-data">
          <input name="email" value="a@b.com">
          <button type="submit" formenctype="application/x-www-form-urlencoded">go</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      assert.ok(calls[0].init.body instanceof URLSearchParams,
        "the button's own formenctype decides the encoding");
    } finally { teardown(); }
  });

  test('an invalid enctype is urlencoded, not passed through or treated as text/plain', async () => {
    // `enctype` is an enumerated attribute whose invalid-value default is
    // urlencoded, so a browser sends urlencoded for this and so must the router.
    setup(okHtml);
    try {
      render(html`
        <form method="post" enctype="nonsense">
          <input name="email" value="a@b.com">
          <button type="submit">go</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      assert.ok(calls[0], 'the submission was still routed, not bailed');
      assert.ok(calls[0].init.body instanceof URLSearchParams);
    } finally { teardown(); }
  });

  test('a text/plain POST is NOT routed, so both paths do the same native thing', async () => {
    // The server parses multipart and urlencoded only, so there is no honest
    // way to send this over fetch. Bailing means the browser performs exactly
    // the submission it would have without JS. The nav guard would catch the
    // real navigation, so what is asserted is simply that no fetch was issued.
    setup(okHtml);
    try {
      render(html`
        <form method="post" enctype="text/plain" action="/never">
          <button type="submit">go</button>
        </form>
      `, container);
      // The native submission this bail deliberately allows is cancelled by
      // the suite's nav guard, which listens on WINDOW bubble, i.e. after the
      // router's own document-bubble listener. A listener on `container` would
      // run BEFORE the router and set `defaultPrevented`, so `onSubmit` would
      // return at its first line and this test would pass without the router
      // ever making the decision it claims to measure.
      container.querySelector('button').click();
      await tick();
      assert.equal(calls.length, 0, 'the router did not take it');
    } finally { teardown(); }
  });

  // -------------------------------------------------------------------------
  // #1307: the dev-time submit guard.
  //
  // The renderer deliberately stopped refusing a PLAIN submitter's own
  // `formmethod` / `formenctype`, because native HTML defines what those mean
  // and the author wrote them on purpose. That leaves one honest gap: the
  // shape is also what a mistake looks like. Submit time is the only moment
  // the resolved method, the resolved enctype, and whether a bound identity is
  // actually in the body all exist together, so the report happens there.
  //
  // Observational by construction: it runs before `preventDefault` and changes
  // nothing about the submission.
  // -------------------------------------------------------------------------

  function captureWarnings(fn) {
    const orig = console.warn;
    const seen = [];
    console.warn = (...a) => { seen.push(a.join(' ')); };
    try { return fn(seen); } finally { console.warn = orig; }
  }

  function captureErrors(fn) {
    const orig = console.error;
    const seen = [];
    console.error = (...a) => { seen.push(a.join(' ')); };
    try { return fn(seen); } finally { console.error = orig; }
  }

  test('a bound identity submitted as GET logs once, and still submits', async () => {
    setup(okHtml);
    try {
      await captureErrors(async (seen) => {
        render(html`
          <form method="post">
            <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/act">
            <button type="submit" formmethod="get">go</button>
          </form>
        `, container);
        container.querySelector('button').click();
        await tick();
        assert.ok(
          seen.some((m) => /never runs/.test(m)),
          `expected a submit-time console.error, saw: ${JSON.stringify(seen)}`,
        );
      });
    } finally { teardown(); }
  });

  test('a bound identity posting to ANOTHER url is reported (#1307)', async () => {
    // The one shape the redesign left unrefused. A bound submitter emits no
    // `formaction`, so a form declaring its own action sends the identity
    // there by native precedence. The renderer used to throw, but only where
    // it could SEE the form, which is the cross-element judgement it cannot
    // make from inside a component. Reported here, where the resolved target
    // is a fact rather than an inference.
    setup(okHtml);
    try {
      await captureWarnings(async (seen) => {
        render(html`
          <form method="post" action="/somewhere-else">
            <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/act">
            <button type="submit">go</button>
          </form>
        `, container);
        container.querySelector('button').click();
        await tick();
        assert.ok(
          seen.some((m) => /posts to "\/somewhere-else"/.test(m)),
          `expected the submit-elsewhere report, saw: ${JSON.stringify(seen)}`,
        );
      });
    } finally { teardown(); }
  });

  test('the submit-elsewhere guard stays silent for a form posting to its own page', async () => {
    // The counterfactual. A bound FORM has its action stripped by the renderer,
    // so it always posts to the page and must never trip this. Without this
    // row the guard could be written to fire on every submission and the test
    // above would still pass.
    setup(okHtml);
    try {
      await captureWarnings(async (seen) => {
        render(html`
          <form method="post">
            <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/act">
            <button type="submit">go</button>
          </form>
        `, container);
        container.querySelector('button').click();
        await tick();
        assert.equal(seen.length, 0, `expected silence, saw: ${JSON.stringify(seen)}`);
      });
    } finally { teardown(); }
  });

  test('the guard stays silent for a form carrying no bound identity', async () => {
    // An ordinary hand-written form is not this feature's business, and a
    // console error on every plain GET form would be pure noise.
    setup(okHtml);
    try {
      await captureErrors(async (seen) => {
        render(html`
          <form method="get" action="/search">
            <input name="q" value="x">
            <button type="submit">go</button>
          </form>
        `, container);
        container.querySelector('button').click();
        await tick();
        assert.equal(seen.length, 0, `expected silence, saw: ${JSON.stringify(seen)}`);
      });
    } finally { teardown(); }
  });

  test('the guard fires for text/plain but NOT for an invalid enctype', async () => {
    // `enctype` is an enumerated attribute whose invalid-value default is
    // urlencoded, so `nonsense` submits a perfectly parseable body and the
    // action runs. Testing against the renderer's parseable-enctype allowlist
    // instead of `text/plain` alone would report that working form as broken.
    setup(okHtml);
    try {
      await captureErrors(async (seen) => {
        render(html`
          <form method="post" enctype="nonsense">
            <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/act">
            <button type="submit">go</button>
          </form>
        `, container);
        container.querySelector('button').click();
        await tick();
        assert.equal(seen.length, 0, `an invalid enctype is urlencoded and works, saw: ${JSON.stringify(seen)}`);
      });
    } finally { teardown(); }

    setup(okHtml);
    try {
      await captureErrors(async (seen) => {
        render(html`
          <form method="post" enctype="text/plain" action="/never">
            <input type="hidden" name="__webjs_action" value="a1b2c3d4e5/act">
            <button type="submit">go</button>
          </form>
        `, container);
        container.querySelector('button').click();
        await tick();
        assert.ok(
          seen.some((m) => /cannot parse/.test(m)),
          `expected the text/plain report, saw: ${JSON.stringify(seen)}`,
        );
      });
    } finally { teardown(); }
  });
});
