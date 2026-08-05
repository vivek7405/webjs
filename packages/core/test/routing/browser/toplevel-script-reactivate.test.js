/**
 * Real-browser tests for #1102: a `<script>` that is a TOP-LEVEL node of a
 * swapped range must EXECUTE after a soft navigation.
 *
 * MUST run in a real browser. The unit tests for this live in
 * `../router-client.test.js` and run under linkedom, which never executes
 * script elements, so they can only assert that the node was replaced and
 * carries the right nonce. "The script actually ran" is a different claim, and
 * it rests on the HTML spec's already-started flag: a script parsed by
 * `DOMParser` is inert, so only a fresh clone runs. That is engine behaviour,
 * which is exactly why it is pinned here, where the suite runs on Chromium,
 * Firefox, and WebKit rather than on Chromium alone like the e2e job.
 *
 * The router's fetch is stubbed, so these assert what the swap does to the live
 * document, not a real server.
 */
import { enableClientRouter, navigate, _resetPrefetch } from '../../../src/router-client.js';

import { assert } from '../../../../../test/browser-assert.js';

const tick = () => new Promise((r) => setTimeout(r, 25));

/**
 * The markup of a `/` range carrying, in document order: a top-level script, a
 * NESTED boundary holding the page content, and a second top-level script. The
 * second script is the truncation witness. Reactivating the first DETACHES it,
 * so a live `nextSibling` walk would end there and never reach anything after
 * it. Each script appends its own marker to `window.__wj1102`, so the array
 * records both whether each ran and the order they ran in.
 *
 * This is the docs-layout shape from #1102: the scripts are siblings of the
 * inner boundary (a layout's `${children}`), not descendants of it.
 *
 * @param {string} innerKey  the nested boundary's route-key.
 */
function rangeMarkup(innerKey) {
  return '<script id="wj1102-first">window.__wj1102.push("first");</script>' +
    `<!--wj:children:/docs:${innerKey}-->` +
      '<p id="wj1102-mid">between</p>' +
    '<!--/wj:children:/docs-->' +
    '<script id="wj1102-last">window.__wj1102.push("last");</script>';
}

/**
 * A full response body. The OUTER `/` key is always `/`, because a changed key
 * on the shallowest boundary has no anchored parent to remount at and the
 * router degrades to a full page load. Changing the INNER key is what selects
 * the replace tier, remounting at the parent `/` range (the one holding the
 * scripts); leaving it equal selects the morph tier.
 *
 * @param {string} innerKey
 */
function swapBody(innerKey) {
  return body('<!--wj:children:/:/-->' + rangeMarkup(innerKey) + '<!--/wj:children:/-->');
}

/**
 * The same two scripts around plain content, with NO nested boundary, so `/` is
 * the deepest shared segment and is itself what gets swapped. The morph tier
 * needs this shape: with a nested boundary present the router correctly morphs
 * the INNER range, which does not contain the scripts.
 */
function flatRangeMarkup() {
  return '<script id="wj1102-first">window.__wj1102.push("first");</script>' +
    '<p id="wj1102-mid">between</p>' +
    '<script id="wj1102-last">window.__wj1102.push("last");</script>';
}

function flatBody() {
  return body('<!--wj:children:/:/-->' + flatRangeMarkup() + '<!--/wj:children:/-->');
}

/** @param {string} inner */
function body(inner) {
  return new Response(
    `<!doctype html><html><head></head><body>${inner}</body></html>`,
    { headers: { 'content-type': 'text/html', 'x-webjs-build': '' } },
  );
}

suite('Client router: a top-level script in a swapped range executes (#1102)', () => {
  // NOTE: not named `setup` / `teardown`. web-test-runner runs mocha in TDD
  // ui, where those names ARE the beforeEach / afterEach registrars, so a
  // local function of either name shadows the hook and a later real hook in
  // this suite would silently call the fixture helper instead of registering.
  let origFetch, before;

  /**
   * @param {string} liveBody  the live document's body markup.
   * @param {() => Response} responder
   */
  function mount(liveBody, responder) {
    enableClientRouter(); // idempotent
    _resetPrefetch();
    document.body.innerHTML = liveBody;
    // Reset AFTER mounting: assigning innerHTML never executes a script, so
    // anything that lands here was put there by the navigation.
    window.__wj1102 = [];
    before = location.href;
    origFetch = window.fetch;
    window.fetch = () => Promise.resolve(responder());
  }

  function unmount() {
    window.fetch = origFetch;
    try { history.replaceState(null, '', before); } catch { /* ignore */ }
    _resetPrefetch();
    delete window.__wj1102;
    document.body.innerHTML = '';
  }

  test('replace tier: both top-level scripts run, so the range walk is not truncated', async () => {
    // A CHANGED route-key is the replace tier, the path a navigation into a new
    // route takes. This is the shape that surfaced the bug: a layout emitting
    // its progressive-enhancement script as a sibling of its children.
    mount(
      '<!--wj:children:/:/-->' + rangeMarkup('/docs/a') + '<!--/wj:children:/-->',
      () => swapBody('/docs/b'),
    );
    try {
      const firstBefore = document.getElementById('wj1102-first');
      await navigate(location.origin + '/docs/b');
      for (let i = 0; i < 20 && window.__wj1102.length < 2; i++) await tick();

      assert.deepEqual(window.__wj1102, ['first', 'last'],
        `both top-level scripts executed, in document order; got ${JSON.stringify(window.__wj1102)}`);
      // The swap really happened. A degraded nav would leave the old DOM in
      // place with the counters untouched, which would pass nothing here but
      // could mislead a future reader into thinking it had.
      assert.notEqual(document.getElementById('wj1102-first'), firstBefore,
        'the range was actually swapped');
    } finally { unmount(); }
  });

  test('morph tier: a keyed top-level script re-runs rather than staying inert', async () => {
    // An UNCHANGED route-key morphs in place, and `keyOf` reads `data-key || id`,
    // so the differ REUSES the live `#wj1102-first` node. Re-running it is the
    // deliberate call: a descendant script in a reused container has always
    // re-run through this same pass, and "runs once and then never again" is
    // the failure #1102 is about.
    // Equal keys on both sides, and `/` is a leaf on both, so this morphs `/`
    // in place. The live range already holds the scripts, so the differ has a
    // keyed node to reuse.
    mount(
      '<!--wj:children:/:/-->' + flatRangeMarkup() + '<!--/wj:children:/-->',
      flatBody,
    );
    try {
      const firstBefore = document.getElementById('wj1102-first');

      await navigate(location.origin + '/?x=1');
      for (let i = 0; i < 20 && window.__wj1102.length < 2; i++) await tick();

      assert.deepEqual(window.__wj1102, ['first', 'last'],
        `a reused keyed script re-executes; got ${JSON.stringify(window.__wj1102)}`);
      assert.notEqual(document.getElementById('wj1102-first'), firstBefore,
        'the reused node was replaced by a fresh clone, which is what makes it run');
    } finally { unmount(); }
  });

  test('a data-webjs-permanent script still runs on the swap that first mounts it', async () => {
    // Guards a fix that looks obviously right and is not. Exempting a permanent
    // script from reactivation reads like the natural opt-out, but the regraft
    // that would preserve its identity has a both-exist guard, so on the swap
    // that FIRST mounts a route there is no live node: the inert parsed copy is
    // what lands, and an exemption would leave it never executing on a soft
    // navigation while still working on a cold load. That is #1102 itself,
    // reintroduced. The live range below deliberately has no `#wj1102-perm`.
    mount(
      '<!--wj:children:/:/--><p id="wj1102-mid">plain</p><!--/wj:children:/-->',
      () => body(
        '<!--wj:children:/:/-->' +
          '<script id="wj1102-perm" data-webjs-permanent>window.__wj1102.push("perm");</script>' +
          '<p id="wj1102-mid">arrived</p>' +
        '<!--/wj:children:/-->',
      ),
    );
    try {
      await navigate(location.origin + '/?perm=1');
      for (let i = 0; i < 20 && !window.__wj1102.length; i++) await tick();

      assert.deepEqual(window.__wj1102, ['perm'],
        `a permanent script arriving for the first time must still run; got ${JSON.stringify(window.__wj1102)}`);
    } finally { unmount(); }
  });
});
