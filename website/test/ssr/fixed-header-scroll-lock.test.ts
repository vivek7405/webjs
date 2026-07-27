/**
 * The site's fixed header opts into the dialog scroll lock's compensation (#1144).
 *
 * Opening a `<ui-dialog>` or `<ui-alert-dialog>` hides the page scrollbar, which
 * widens the viewport. The kit's lock reserves the scrollbar gutter so nothing
 * moves, but WebKit ignores `scrollbar-gutter`, and there the lock publishes the
 * leftover width as `--wj-scrollbar-compensation` for a fixed element to opt
 * into. This site is the reported case: the Delete-account demo on /ui moved the
 * navbar.
 *
 * The opt-in is one declaration inside the root layout's inline `<style>` and
 * markup, so nothing stops a future edit from dropping it, and the shift would
 * come back silently on WebKit with every existing test still green. These
 * assertions are what make that fail instead.
 *
 * Two properties, and the second is the one that is easy to get wrong. The
 * compensation must sit on the CENTRING BAR, not on the fixed `.site-top`
 * wrapper: the wrapper paints nothing, so insetting it insets the header element
 * that carries the background and bottom border and leaves an unpainted strip at
 * the top right. Verified in Chromium with the property forced to 15px: on the
 * wrapper the painted chrome ends 15px early, on the bar it stays full bleed at
 * 1265 while the nav centre moves the compensating 7.5px.
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const WEBSITE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPENSATION = '--wj-scrollbar-compensation';

let body: string;

before(async () => {
  const app = await createRequestHandler({ appDir: WEBSITE_ROOT, dev: false });
  await app.warmup?.();
  const res = await app.handle(new Request('http://localhost/'));
  assert.equal(res.status, 200, 'the home page should render');
  body = await res.text();
});

test('the header opts into the scroll-lock compensation', () => {
  assert.ok(
    body.includes(COMPENSATION),
    `the served HTML must reference ${COMPENSATION}, or the fixed header goes back ` +
      'to sliding right by half the scrollbar width when a dialog opens',
  );
});

test('the compensation targets the centring bar, not the fixed wrapper', () => {
  // The rule must select the bar. Insetting `.site-top` would inset the header
  // element that paints the background and bottom border, leaving an unpainted
  // strip at the top right for as long as a dialog is open.
  const rule = new RegExp(`\\.site-bar\\s*\\{[^}]*var\\(${COMPENSATION}`);
  assert.ok(rule.test(body), 'a .site-bar rule consumes the compensation');
  assert.equal(
    new RegExp(`\\.site-top\\s*\\{[^}]*var\\(${COMPENSATION}`).test(body),
    false,
    'the fixed wrapper must NOT be the one inset',
  );

  const start = body.indexOf('<div class="site-top');
  assert.ok(start >= 0, 'the fixed header wrapper is present');
  const bar = body.indexOf('class="site-bar', start);
  assert.ok(bar > start, 'the centring bar inside the header carries the site-bar hook');
});

test('the compensation resolves to zero when no lock is active', () => {
  // The `0px` fallback is what makes the header identical to its unpatched self
  // at every moment except an open modal on an engine that ignores the gutter.
  // Without it the border width would be invalid and the declaration dropped,
  // which is silent rather than visible.
  assert.ok(
    body.includes(`var(${COMPENSATION},0px)`) || body.includes(`var(${COMPENSATION}, 0px)`),
    'the compensation must carry a 0px fallback for the un-locked case',
  );
  // A transparent border, so the chrome still paints across it.
  assert.ok(
    /border-right:\s*var\(--wj-scrollbar-compensation,\s*0px\)\s*solid\s*transparent/.test(body),
    'the opt-in is a transparent right border',
  );
});
