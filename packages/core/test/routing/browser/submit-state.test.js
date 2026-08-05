/**
 * Real-browser tests for the client router's form submission-state events +
 * aria-busy (#246). When a `<form>` submits through the enhanced router the
 * framework:
 *
 *   - sets the native `aria-busy="true"` on the FORM and dispatches a bubbling
 *     `webjs:submit-start` (detail `{ form, url }`) when the fetch starts;
 *   - clears `aria-busy` and dispatches `webjs:submit-end`
 *     (detail `{ form, url, ok }`) on EVERY settle (success, validation
 *     re-render, error, abort), where `ok` reflects `response.ok`.
 *
 * The race case: two rapid submits abort the first; its teardown must NOT clear
 * the busy state the second set (the nav-token guard), so the form stays busy
 * until the second settles.
 *
 * MUST run in a real browser: we stub fetch with a deferred promise to observe
 * the mid-flight aria-busy and the start/end event pair.
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { enableClientRouter } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';
import { installNavGuard } from '../../../../../test/browser-nav-guard.js';

/** Shared across the suites below; installed per test in setup(). */
let navGuard;
const tick = () => new Promise((r) => setTimeout(r, 20));

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html', 'x-webjs-build': '' },
  });
}

suite('Client router: form submission-state events + aria-busy (#246)', () => {
  let container, origFetch;
  // A queue of deferred fetch settlers so a test can hold a submission
  // mid-flight, then resolve it to observe the settle.
  let pending;

  let bOpen, bClose;
  function setup() {
    navGuard = installNavGuard();
    enableClientRouter(); // idempotent
    container = document.createElement('div');
    // Bracket the container with a live keyed boundary pair (#1015): the
    // settle responses carry the matching pair, so the applied swap stays
    // soft instead of degrading to a full load (which would navigate the
    // test page away).
    bOpen = document.createComment('wj:children:/:/');
    bClose = document.createComment('/wj:children:/');
    document.body.appendChild(bOpen);
    document.body.appendChild(container);
    document.body.appendChild(bClose);
    pending = [];
    origFetch = window.fetch;
    window.fetch = (url) => new Promise((resolve, reject) => {
      pending.push({ url: String(url), resolve, reject });
    });
  }
  function teardown() {
    navGuard.remove();
    window.fetch = origFetch;
    container.remove();
    bOpen.remove();
    bClose.remove();
  }

  // Resolve the Nth (default last) in-flight fetch with the given Response.
  function settle(resp, idx) {
    const p = pending[idx == null ? pending.length - 1 : idx];
    p.resolve(resp);
  }

  test('submit-start fires + aria-busy set mid-flight; submit-end fires + aria-busy cleared on success', async () => {
    setup();
    const events = [];
    const onStart = (e) => events.push(['start', e.detail]);
    const onEnd = (e) => events.push(['end', e.detail]);
    document.addEventListener('webjs:submit-start', onStart);
    document.addEventListener('webjs:submit-end', onEnd);
    try {
      render(html`
        <main>
          <form method="POST" action="/save">
            <input name="title" value="hi">
            <button type="submit">go</button>
          </form>
        </main>
      `, container);
      const form = container.querySelector('form');
      form.querySelector('button').click();
      await tick();

      // Mid-flight: fetch is pending, so the form is busy and start fired.
      assert.equal(pending.length, 1, 'the submission fetch is in flight');
      assert.equal(form.getAttribute('aria-busy'), 'true', 'aria-busy set during submission');
      assert.equal(events.length, 1, 'exactly one event so far (start)');
      assert.equal(events[0][0], 'start', 'submit-start fired');
      assert.equal(events[0][1].form, form, 'detail.form is the submitted form');
      assert.ok(events[0][1].url.includes('/save'), 'detail.url is the action target');

      // Settle with a 200 success.
      settle(htmlResponse('<!--wj:children:/:/--><main><p>saved</p></main><!--/wj:children:/-->', 200));
      await tick();

      assert.equal(form.getAttribute('aria-busy'), 'false', 'aria-busy cleared on settle');
      const end = events.find((e) => e[0] === 'end');
      assert.ok(end, 'submit-end fired');
      assert.equal(end[1].form, form, 'end detail.form is the form');
      assert.equal(end[1].ok, true, 'ok=true on a 200 success');
    } finally {
      document.removeEventListener('webjs:submit-start', onStart);
      document.removeEventListener('webjs:submit-end', onEnd);
      teardown();
    }
  });

  test('submit-end reports ok=false on a 422 validation re-render (still applied in place)', async () => {
    setup();
    const ends = [];
    const onEnd = (e) => ends.push(e.detail);
    document.addEventListener('webjs:submit-end', onEnd);
    try {
      render(html`
        <main>
          <form method="POST" action="/save">
            <input name="title" value="">
            <button type="submit">go</button>
          </form>
        </main>
      `, container);
      const form = container.querySelector('form');
      form.querySelector('button').click();
      await tick();
      assert.equal(form.getAttribute('aria-busy'), 'true', 'busy during the 422 round-trip');

      settle(htmlResponse('<!--wj:children:/:/--><main><form method="POST" action="/save"><p>required</p></form></main><!--/wj:children:/-->', 422));
      await tick();

      assert.equal(form.getAttribute('aria-busy'), 'false', 'busy cleared after 422 settle');
      assert.equal(ends.length, 1, 'one submit-end');
      assert.equal(ends[0].ok, false, 'ok=false on a 422 (response.ok is false)');
    } finally {
      document.removeEventListener('webjs:submit-end', onEnd);
      teardown();
    }
  });

  test('rapid re-submit: the form stays busy until the SECOND submit settles (token guard)', async () => {
    setup();
    const events = [];
    const onStart = (e) => events.push(['start', e.detail]);
    const onEnd = (e) => events.push(['end', e.detail]);
    document.addEventListener('webjs:submit-start', onStart);
    document.addEventListener('webjs:submit-end', onEnd);
    try {
      render(html`
        <main>
          <form method="POST" action="/save">
            <input name="title" value="hi">
            <button type="submit">go</button>
          </form>
        </main>
      `, container);
      const form = container.querySelector('form');

      // First submit: in flight.
      form.querySelector('button').click();
      await tick();
      assert.equal(form.getAttribute('aria-busy'), 'true', 'busy after first submit');
      assert.equal(pending.length, 1, 'first fetch in flight');

      // Second submit BEFORE the first settles. performSubmission aborts the
      // first fetch (reject AbortError) and re-marks the form busy under a new
      // token. The first submit's teardown must not clear the busy state.
      form.querySelector('button').click();
      await tick();

      // The form is still busy (the second submit owns it). Only ONE start
      // edge fired (idle -> busy), never a redundant second start, and the
      // first submit's abort did NOT emit a submit-end yet.
      assert.equal(form.getAttribute('aria-busy'), 'true', 'still busy under the second submit');
      const starts = events.filter((e) => e[0] === 'start');
      const endsMid = events.filter((e) => e[0] === 'end');
      assert.equal(starts.length, 1, 'exactly one start edge (no redundant start)');
      assert.equal(endsMid.length, 0, 'no submit-end fired while still busy (aborted submit suppressed)');
      assert.ok(pending.length >= 2, 'second fetch issued');

      // Settle the SECOND (latest) fetch -> the live submission completes.
      settle(htmlResponse('<!--wj:children:/:/--><main><p>saved</p></main><!--/wj:children:/-->', 200));
      await tick();

      assert.equal(form.getAttribute('aria-busy'), 'false', 'busy cleared once the live submit settles');
      const ends = events.filter((e) => e[0] === 'end');
      assert.equal(ends.length, 1, 'exactly one submit-end for the whole episode');
      assert.equal(ends[0][1].ok, true, 'final settle is ok');
    } finally {
      document.removeEventListener('webjs:submit-start', onStart);
      document.removeEventListener('webjs:submit-end', onEnd);
      teardown();
    }
  });
});
