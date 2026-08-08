/**
 * The `onSubmit` BAIL LADDER, pinned one rung at a time in a real browser
 * (#1322).
 *
 * `onSubmit` (`packages/core/src/router-client.js`) is a ladder of guards, each
 * of which declines a submission and hands it back to the browser. The ladder
 * used to be "tested" in the node suite, where every test proved only that a
 * submission was NOT routed. That is not a test: in that harness there is no
 * `location` global and `new FormData(formElement)` throws under linkedom, so
 * `preventDefault()` was unreachable for EVERY input and an ordinary POST the
 * router does intercept looked exactly like a bail. Deleting the
 * `data-no-router` rung outright left all 222 of those tests green.
 *
 * ## What replaces it
 *
 * Every rung is one test containing a PAIR: a bail fixture, and a near-miss
 * control that differs from it by exactly the one attribute that trips the
 * rung. Three positive assertions replace the old absence assertion:
 *
 *   1. A submit probe on WINDOW BUBBLE reads `e.defaultPrevented`, which is a
 *      direct read of the router's decision about this event. `false` means the
 *      browser is about to perform the submission natively, which is precisely
 *      what every bail claims.
 *   2. `probe.seen.length` is asserted, so "no submission happened at all", the
 *      failure mode that made the old tests vacuous, cannot pass.
 *   3. The near-miss control must be ROUTED in the same test, so a router that
 *      bailed on everything fails here.
 *
 * Break one rung and exactly one test reds, because only that rung's bail
 * fixture carries the triggering attribute. A rung that fires too eagerly reds
 * every control, which is a broad break reported broadly.
 *
 * Two rungs are pinned from BOTH sides, and their counterfactual reads
 * differently on purpose. Rungs 3 and 8 are the ones a later line depends on
 * (`new FormData(x)` needs a real form; `url` needs to have parsed), so
 * deleting either turns `onSubmit` into a throw rather than a wrong decision.
 * That surfaces as an UNCAUGHT page error, which web-test-runner reports across
 * the file rather than against the one test. Wide blast radius is the honest
 * signal there: the rung is not a preference, it is load-bearing.
 *
 * Turbo tests the same ladder the same way, in a real browser
 * (`src/tests/functional/form_submission_tests.js`), pairing each bail with a
 * positive observation of the native effect it exists to allow. WebJs cannot
 * let a real navigation happen (web-test-runner aborts the whole session, which
 * is why `test/browser-nav-guard.js` exists), so the probe stands in for
 * Turbo's "the response document rendered" half. Rung 7 is the one place the
 * native effect IS observable without navigating, and there this borrows
 * Turbo's assertion verbatim: the `<dialog>` really closed.
 *
 * Rung 1 (router not enabled) is deliberately absent. It is already pinned
 * structurally by `client-router-opt-out.test.js`, which asserts that a
 * disabled router binds no document listeners at all.
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { enableClientRouter, _setHardNavigate } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

const tick = () => new Promise((r) => setTimeout(r, 20));

suite('Client router: the onSubmit bail ladder (#1322)', () => {
  let container, origFetch, calls, navGuard, probe, bOpen, bClose, origPath;

  /**
   * A hard-navigation recorder that covers the WHOLE file, including the gaps
   * `installNavGuard` cannot.
   *
   * A routed control's swap is async, and on a slower engine it can still be in
   * flight when the test's teardown pulls the boundary comments out from under
   * it. The router then (correctly) degrades and asks for a full page load
   * through the `_setHardNavigate` seam, one test LATE. Every test that
   * installs the guard has that late load recorded by the NEXT test's guard, so
   * it was invisible until rung 7, which runs without a guard and let the real
   * navigation through, aborting the whole web-test-runner session on Firefox.
   *
   * So the seam is held for the file's lifetime and re-armed after each guard
   * is removed. These strays are not asserted on: every test here measures the
   * router's DECISION about a submit event (the probe plus the fetch), not
   * whether a swap landed, and the swap-application path is pinned in
   * `form-action-submit.test.js`.
   */
  const strayHardNavigations = [];
  const armStraySeam = () => _setHardNavigate((href) => {
    strayHardNavigations.push(String(href));
  });

  suiteSetup(armStraySeam);
  suiteTeardown(() => { _setHardNavigate(null); });

  /**
   * Read the router's decision on a submit event, positively.
   *
   * WINDOW BUBBLE is the last step of the propagation path, so this always runs
   * after the router's own document-bubble listener regardless of registration
   * order, and `e.defaultPrevented` read here is a direct read of what the
   * router decided about THIS event. `false` means the browser is about to
   * perform the submission natively, which is what every bail in the ladder
   * claims.
   *
   * Installed BEFORE the nav guard, whose own window-bubble `preventDefault()`
   * would otherwise mask that decision. Listeners on the same target in the
   * same phase fire in registration order, so the order below is load-bearing.
   */
  function installSubmitProbe() {
    const seen = [];
    const onProbe = (e) => { seen.push({ target: e.target, routed: e.defaultPrevented }); };
    window.addEventListener('submit', onProbe);
    return { seen, remove() { window.removeEventListener('submit', onProbe); } };
  }

  const okHtml = () => new Response(
    '<!--wj:children:/:/--><p>ok</p><!--/wj:children:/-->',
    { headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
  );

  /**
   * @param {() => Response} responder
   * @param {{ navGuard?: boolean }} [opts] `navGuard: false` skips the shared
   *   navigation backstop. Rung 7 needs that: the guard's window-bubble
   *   `preventDefault()` cancels a `<dialog>` form's own dismissal, which is
   *   the exact native effect that rung's positive assertion reads. It is safe
   *   there because a `method="dialog"` submission can never navigate, so there
   *   is nothing for the guard to protect against.
   */
  function setup(responder, { navGuard: wantGuard = true } = {}) {
    probe = installSubmitProbe();
    navGuard = wantGuard ? installNavGuard() : null;
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
    // Every control here is a REAL routed submission, which records history.
    // Snapshot and restore so each test starts from the same url and the next
    // test's relative actions resolve the same way.
    origPath = location.pathname + location.search;
  }

  async function teardown() {
    // Let any router work THIS test started settle before the DOM it operates
    // on is dismantled. A routed submission's swap is async, so tearing the
    // boundary comments out from under one in flight makes it land during the
    // NEXT test, where it rips out that test's container and turns a clean
    // per-rung failure into a cascade across every test after it. That only
    // shows up under a counterfactual (a broken rung routes a submission this
    // file did not expect), which is exactly when a readable failure matters
    // most.
    await tick();
    // `navGuard.remove()` clears the seam, so re-arm the file-wide recorder
    // behind it: a swap still in flight after the settle above degrades after
    // this line, and without the seam that is a real page load.
    if (navGuard) navGuard.remove();
    armStraySeam();
    navGuard = null;
    probe.remove();
    window.fetch = origFetch;
    container.remove();
    if (bOpen) bOpen.remove();
    if (bClose) bClose.remove();
    // A routed swap replaces the bracketed range, so the boundary comments in
    // the live document may be the RESPONSE's rather than the pair created
    // above. Sweep any that are left, else a later test's swap sees duplicate
    // boundaries, which correctly poisons the scan and degrades to a full load.
    for (const node of [...document.body.childNodes]) {
      if (node.nodeType === 8 && /^\/?wj:children:/.test(node.data)) node.remove();
    }
    history.replaceState(null, '', origPath);
  }

  /**
   * The bail half of a rung: the submission reached the router, the router
   * declined it, and no fetch was issued.
   *
   * @param {HTMLElement} form the element the submit event should have targeted
   * @param {number} [index] which probe entry to read (rung 6 has two bails)
   */
  function assertBailed(form, index = 0) {
    assert.equal(probe.seen.length, index + 1, 'the submit event fired and reached the router');
    assert.equal(probe.seen[index].target, form, 'and it is the form under test');
    assert.equal(probe.seen[index].routed, false,
      'the router declined it, so the browser submits natively');
    assert.equal(calls.length, 0, 'and the router issued no fetch');
  }

  /**
   * The control half: the near-miss form, differing by exactly the triggering
   * attribute, IS routed.
   *
   * @param {number} index which probe entry to read
   */
  function assertRouted(index) {
    assert.equal(probe.seen.length, index + 1, 'the control submission also reached the router');
    assert.equal(probe.seen[index].routed, true, 'the near-miss control IS routed');
    assert.equal(calls.length, 1, 'and issues exactly one fetch');
  }

  // -------------------------------------------------------------------------
  // The floor. Without this, a router that bailed on every submission would
  // keep every bail test below green.
  // -------------------------------------------------------------------------

  test('the floor: an ordinary same-origin POST with no bail attribute IS intercepted', async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="/x">
          <input name="email" value="a@b.com">
          <button type="submit">go</button>
        </form>
      `, container);
      container.querySelector('button').click();
      await tick();
      assert.equal(probe.seen.length, 1, 'the submit event fired');
      assert.equal(probe.seen[0].routed, true, 'and the router took it');
      assert.equal(calls.length, 1, 'issuing exactly one fetch');
      assert.equal(new URL(calls[0].url).pathname, '/x', 'to the form action');
      assert.equal((calls[0].init.method || 'GET').toUpperCase(), 'POST');
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 2: the event was already prevented (`router-client.js`, the
  // `e.defaultPrevented` guard).
  // -------------------------------------------------------------------------

  test('rung 2: an already-prevented submit belongs to the handler that prevented it', async () => {
    // The probe cannot carry this rung: the USER handler set `defaultPrevented`
    // before the router ever saw the event, so the probe reads `true` for both
    // halves and says nothing about who did it. What separates the two is the
    // fetch. The bail form's handler runs and the router stays out of it; the
    // control has no handler and is routed. Delete the rung and the bail half
    // issues a fetch, which is the red.
    setup(okHtml);
    const ran = [];
    try {
      render(html`
        <form method="post" action="/x" @submit=${(e) => { ran.push('user'); e.preventDefault(); }}>
          <button type="submit">go</button>
        </form>
        <form method="post" action="/y">
          <button type="submit">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assert.deepEqual(ran, ['user'], "the component's own handler ran");
      assert.equal(probe.seen.length, 1, 'the submit event fired and reached the router');
      assert.equal(probe.seen[0].target, bail, 'and it is the form under test');
      assert.equal(calls.length, 0, 'the router did not double-handle it: the user handler owns it');

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 3: the event target is not a `<form>`.
  // -------------------------------------------------------------------------

  test('rung 3: a submit event whose target is not a form is left alone', async () => {
    // Same event type, same dispatch, same bubbling: only `target.tagName`
    // differs between the two halves. A synthetic dispatch is the only way to
    // aim a `submit` event at a non-form, and it is exactly what a stray
    // `dispatchEvent` in app code looks like.
    //
    // This rung is load-bearing rather than tidy: without it the handler runs
    // on to `new FormData(div)`, which throws
    // `Failed to construct 'FormData': parameter 1 is not of type
    // 'HTMLFormElement'`, so a stray dispatch would take out the page.
    setup(okHtml);
    try {
      render(html`
        <div id="not-a-form"></div>
        <form method="post" action="/x">
          <button type="submit">go</button>
        </form>
      `, container);
      const div = container.querySelector('#not-a-form');
      const control = container.querySelector('form');

      div.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await tick();
      assertBailed(div);

      control.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await tick();
      assertRouted(1);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 4: `data-no-router` on the form.
  // -------------------------------------------------------------------------

  test('rung 4: a form carrying data-no-router is left to the browser', async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="/x" data-no-router>
          <button type="submit">go</button>
        </form>
        <form method="post" action="/x">
          <button type="submit">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assertBailed(bail);

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 5: `data-no-router` on the submitter (the per-button escape).
  // -------------------------------------------------------------------------

  test('rung 5: a submitter carrying data-no-router opts that button out', async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="/x">
          <button type="submit" data-no-router>go</button>
        </form>
        <form method="post" action="/x">
          <button type="submit">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assertBailed(bail);

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 6: the resolved `target` / `formtarget` is not `_self`.
  // -------------------------------------------------------------------------

  test('rung 6: a target that is not _self goes to the browser, from either level', async () => {
    // Two bails in one test because the rung reads one resolved value from two
    // places. The control declares `target="_self"` explicitly, which proves
    // the check is on the VALUE and not on the attribute being present.
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="/x" target="_blank">
          <button type="submit">go</button>
        </form>
        <form method="post" action="/x">
          <button type="submit" formtarget="_blank">go</button>
        </form>
        <form method="post" action="/x" target="_self">
          <button type="submit">go</button>
        </form>
      `, container);
      const [formTarget, submitterTarget, control] = container.querySelectorAll('form');

      formTarget.querySelector('button').click();
      await tick();
      assertBailed(formTarget, 0);

      submitterTarget.querySelector('button').click();
      await tick();
      assertBailed(submitterTarget, 1);

      control.querySelector('button').click();
      await tick();
      assertRouted(2);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 7: the resolved method is `dialog`.
  //
  // The one rung whose native effect is observable without a navigation, so it
  // gets Turbo's own assertion: the dialog really closed.
  // -------------------------------------------------------------------------

  test('rung 7: a method="dialog" submission dismisses the dialog, natively', async () => {
    // NO nav guard. Its window-bubble `preventDefault()` would cancel the
    // dialog's own dismissal, which is the native effect being measured. Safe
    // here because a `method="dialog"` submission can never navigate.
    setup(okHtml, { navGuard: false });
    try {
      render(html`
        <dialog open>
          <form method="dialog">
            <button type="submit">close</button>
          </form>
        </dialog>
      `, container);
      const dialog = container.querySelector('dialog');
      const form = container.querySelector('form');
      assert.equal(dialog.open, true, 'the dialog starts open');

      form.querySelector('button').click();
      await tick();
      assertBailed(form);
      assert.equal(dialog.open, false,
        'the browser performed the dialog dismissal the bail exists to allow');
    } finally { await teardown(); }
  });

  test('rung 7 control: the same dialog with method="post" IS routed', async () => {
    // Guard ON: a `method="post"` form the router failed to intercept would
    // perform a real navigation and abort the whole session. The load-bearing
    // half here is the probe plus the fetch; `dialog.open` staying true is the
    // consistency check that the routed path does not also dismiss.
    setup(okHtml);
    try {
      render(html`
        <dialog open>
          <form method="post" action="/x">
            <button type="submit">go</button>
          </form>
        </dialog>
      `, container);
      const dialog = container.querySelector('dialog');
      container.querySelector('button').click();
      await tick();
      assertRouted(0);
      assert.equal(dialog.open, true, 'and the dialog was not dismissed');
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 8: the action url does not parse.
  // -------------------------------------------------------------------------

  test('rung 8: an unparseable action is left to the browser', async () => {
    // `http://[` is an invalid IPv6 host, so `new URL` throws. Deleting this
    // rung does not merely red the assertion below: the throw escapes
    // `onSubmit` and web-test-runner reports it as an uncaught error, so the
    // rung is pinned from both sides.
    //
    // The control is a PARSEABLE same-origin ABSOLUTE url, which is the
    // tightest honest near miss: an unparseable url has no origin, so pairing
    // it with a relative action would also be testing rung 9.
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="http://[">
          <button type="submit">go</button>
        </form>
        <form method="post" action="${location.origin}/x">
          <button type="submit">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assertBailed(bail);

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 9: the action url is cross-origin.
  // -------------------------------------------------------------------------

  test('rung 9: a cross-origin action is left to the browser', async () => {
    // Both halves are absolute urls differing only in origin, so the control
    // proves the check is on the ORIGIN and not on the action being absolute.
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="https://other.example.test/x">
          <button type="submit">go</button>
        </form>
        <form method="post" action="${location.origin}/x">
          <button type="submit">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assertBailed(bail);

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 10: the action pathname carries a non-HTML extension.
  // -------------------------------------------------------------------------

  test('rung 10: a file-download action is left to the browser', async () => {
    // The pair differs only in the extension, so the control proves the rung
    // reads the extension rather than bailing on every GET form.
    setup(okHtml);
    try {
      render(html`
        <form method="get" action="/data.pdf">
          <button type="submit">go</button>
        </form>
        <form method="get" action="/data.html">
          <button type="submit">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assertBailed(bail);

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // Rung 11: an unsafe method with a `text/plain` enctype (#1307).
  //
  // The server parses multipart and urlencoded only, so there is no honest way
  // to send text/plain over fetch and have the response mean anything. Bailing
  // makes the JS-on and JS-off paths do the SAME thing.
  // -------------------------------------------------------------------------

  test('rung 11: a text/plain POST bails, an INVALID enctype does not', async () => {
    // The sharpest available control. `enctype` is an enumerated attribute
    // whose invalid-value default is urlencoded, so `nonsense` submits a
    // perfectly parseable body and MUST be routed. A rung written against an
    // allowlist of parseable enctypes instead of `text/plain` alone would bail
    // on that working form, and this pair is what catches it.
    setup(okHtml);
    try {
      render(html`
        <form method="post" enctype="text/plain" action="/never">
          <button type="submit">go</button>
        </form>
        <form method="post" enctype="nonsense" action="/never">
          <button type="submit">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assertBailed(bail);

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
      assert.ok(calls[0].init.body instanceof URLSearchParams,
        'and the invalid enctype was sent as urlencoded, its invalid-value default');
    } finally { await teardown(); }
  });

  test('rung 11: a submitter formenctype="text/plain" bails too', async () => {
    // Native precedence: the submitter's override decides the encoding, so the
    // rung has to read it there as well or a per-button text/plain would be
    // sent as multipart under JS and natively without it. The control carries
    // the other override the same way, so the pair pins the submitter half of
    // the precedence rather than the form half a second time.
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="/never">
          <button type="submit" formenctype="text/plain">go</button>
        </form>
        <form method="post" action="/never">
          <button type="submit" formenctype="multipart/form-data">go</button>
        </form>
      `, container);
      const [bail, control] = container.querySelectorAll('form');

      bail.querySelector('button').click();
      await tick();
      assertBailed(bail);

      control.querySelector('button').click();
      await tick();
      assertRouted(1);
      assert.ok(calls[0].init.body instanceof FormData,
        "and the control's own formenctype decided its encoding");
    } finally { await teardown(); }
  });

  // -------------------------------------------------------------------------
  // A submitter's PRESENT-BUT-EMPTY override wins, per native precedence.
  //
  // The form-submission algorithm asks whether the submitter HAS the attribute,
  // never whether its value is truthy, so `formmethod=""` / `formenctype=""` /
  // `formtarget=""` each override the form and then fall to their OWN
  // invalid-value default. `getSubmitAction` already did this (a present-but-
  // empty `formaction` means submit-to-self); the three siblings used a `||`
  // chain, so an empty value was falsy and silently fell through to the form's.
  //
  // Measured against Chromium, Firefox and WebKit at the request level: a
  // `<button type="submit" formmethod="" formenctype="">` inside a
  // `<form method="post" enctype="multipart/form-data" action="/submit">`
  // submits natively as `GET /submit?a=1` with no body, while the router
  // resolved it as a multipart POST. That is a JS-on versus JS-off divergence
  // of exactly the class #1307 exists to eliminate.
  // -------------------------------------------------------------------------

  test('an empty formmethod overrides the form and falls to GET, its invalid-value default', async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post" enctype="multipart/form-data" action="/submit">
          <input name="a" value="1">
          <button type="submit" formmethod="">go</button>
        </form>
      `, container);
      // The engine's own answer, read from the IDL reflection, which applies
      // the enumerated attribute's invalid-value default. This is the native
      // oracle the router has to agree with, asserted in the same test rather
      // than quoted from a measurement made elsewhere.
      assert.equal(container.querySelector('button').formMethod, 'get',
        'the engine resolves the empty formmethod to GET');

      container.querySelector('button').click();
      await tick();
      assertRouted(0);
      assert.equal((calls[0].init.method || 'GET').toUpperCase(), 'GET',
        "the button's present-but-empty formmethod wins over the form's post");
      assert.equal(new URL(calls[0].url).searchParams.get('a'), '1',
        'and the fields are promoted to the query string, as a GET submission does');
      assert.equal(calls[0].init.body, undefined, 'with no body');
    } finally { await teardown(); }
  });

  test('an empty formenctype overrides the form and falls to urlencoded', async () => {
    setup(okHtml);
    try {
      render(html`
        <form method="post" enctype="multipart/form-data" action="/submit">
          <input name="a" value="1">
          <button type="submit" formenctype="">go</button>
        </form>
      `, container);
      assert.equal(
        container.querySelector('button').formEnctype, 'application/x-www-form-urlencoded',
        'the engine resolves the empty formenctype to urlencoded',
      );

      container.querySelector('button').click();
      await tick();
      assertRouted(0);
      assert.ok(calls[0].init.body instanceof URLSearchParams,
        "the button's present-but-empty formenctype wins over the form's multipart");
      assert.equal(calls[0].init.body.get('a'), '1', 'and the field survives the encoding');
    } finally { await teardown(); }
  });

  test('an empty formtarget overrides the form and means the current context', async () => {
    // The consequence is a rung-6 decision: the form alone would bail on
    // `target="_blank"`, and the button's empty override brings it back.
    setup(okHtml);
    try {
      render(html`
        <form method="post" action="/x" target="_blank">
          <button type="submit" formtarget="">go</button>
        </form>
      `, container);
      // `formtarget` is a plain string reflection, not an enumerated one, so
      // the engine reports the empty string back. The rules for choosing a
      // navigable then treat an empty name as the current navigable, which is
      // why the router must NOT fall through to the form's `_blank`.
      assert.equal(container.querySelector('button').formTarget, '',
        'the engine keeps the empty formtarget rather than inheriting the form');

      container.querySelector('button').click();
      await tick();
      assertRouted(0);
    } finally { await teardown(); }
  });
});
