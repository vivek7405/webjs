/**
 * Real-browser tests for the dev stylesheet re-request (#1398).
 *
 * `dev-styles.js` is the BROWSER half of the in-place refresh: the exact source
 * the served reload client inlines (`reloadClientJs` reads this file, strips
 * `export`, and embeds it), so driving it here tests the code that ships.
 *
 * It runs in a real browser because the headline rule is about REAL `load` and
 * `error` events on real `<link>` elements, and which node survives each. A
 * source-shape assertion cannot observe that: an implementation that removed
 * the wrong node in a differently-formatted handler would satisfy a regex and
 * still leave the page unstyled, which is the #936 / #1400 failure mode this
 * asymmetry exists to prevent.
 */
import { refreshStyles } from '../../../src/dev-styles.js';

import { assert } from '../../../../../test/browser-assert.js';

const SHEET = '/packages/server/test/dev/browser/fixture-sheet.css';
const MISSING = '/packages/server/test/dev/browser/does-not-exist-1398.css';

/** Resolve once `el` has fired `load` or `error`, or after a bounded wait. */
function settled(el) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    el.addEventListener('load', finish);
    el.addEventListener('error', finish);
    setTimeout(finish, 3000);
  });
}

function link(container, href, attrs) {
  const el = document.createElement('link');
  el.setAttribute('rel', 'stylesheet');
  el.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  container.appendChild(el);
  return el;
}

suite('dev stylesheet re-request (#1398)', () => {
  let container;

  function setup() {
    container = document.createElement('div');
    document.body.appendChild(container);
  }
  function teardown() { container.remove(); }

  test('a stylesheet that loads replaces the old link, and the page is never unstyled', async () => {
    setup();
    try {
      const old = link(container, SHEET);
      await settled(old);

      const [next] = refreshStyles(container);
      assert.ok(next, 'a replacement link was inserted');
      assert.match(next.getAttribute('href'), /__webjs_dev=/, 'cache-busted, so the server re-runs its regenerate step');
      // BOTH are live until the new one loads. That overlap is what stops the
      // page flashing unstyled.
      assert.equal(container.querySelectorAll('link').length, 2, 'the old sheet is still applied while the new one loads');

      await settled(next);
      assert.equal(old.parentNode, null, 'the old link is dropped once the replacement loaded');
      assert.equal(next.parentNode, container, 'and the replacement stays');
    } finally {
      teardown();
    }
  });

  // THE counterfactual, and the case that matters most: a failed re-request
  // must never take the working sheet down with it.
  test('a stylesheet that FAILS drops the replacement and keeps the working sheet', async () => {
    setup();
    try {
      const old = link(container, SHEET);
      await settled(old);

      // Point the busted request at a path that 404s, which is what a
      // mid-restart server or a renamed file produces.
      old.setAttribute('href', MISSING);
      const [next] = refreshStyles(container);
      await settled(next);

      assert.equal(next.parentNode, null, 'the failed replacement removes itself');
      assert.equal(old.parentNode, container, 'and the sheet that still works stays on the page');
      assert.equal(container.querySelectorAll('link').length, 1, 'so the page is never left with no stylesheet at all');
    } finally {
      teardown();
    }
  });

  test('a duplicate link to the same file is collapsed, so the head cannot grow per refresh', async () => {
    setup();
    try {
      // What the head merge produces: the incoming bare href beside the one a
      // previous refresh busted.
      link(container, SHEET);
      link(container, SHEET + '?__webjs_dev=1');
      refreshStyles(container);
      assert.equal(container.querySelectorAll('link').length, 2,
        'one survivor plus its replacement, not three');
    } finally {
      teardown();
    }
  });

  // The other direction of the same rule: two links to one file are NOT
  // necessarily duplicates, and deleting the second is a real loss.
  test('a media-scoped link to the same file is kept, not treated as a duplicate', async () => {
    setup();
    try {
      link(container, SHEET);
      const print = link(container, SHEET, { media: 'print' });
      refreshStyles(container);
      assert.equal(print.parentNode, container, 'the print sheet survives');
      assert.equal(container.querySelectorAll('link[media="print"]').length, 2,
        'and it got its own replacement rather than being deleted');
    } finally {
      teardown();
    }
  });

  test('a cross-origin stylesheet is left alone', async () => {
    setup();
    try {
      const ext = link(container, 'https://example.invalid/x.css');
      const added = refreshStyles(container);
      assert.deepEqual(added, [], 'nothing was re-requested');
      assert.equal(ext.getAttribute('href'), 'https://example.invalid/x.css', 'and its href is untouched');
    } finally {
      teardown();
    }
  });
});
