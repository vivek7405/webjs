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
 * Placement is the part that is easy to get wrong, and it took two attempts. The
 * target must be BOTH viewport-width and painting. Viewport-width, or a
 * left-aligned child still moves (the centring bar is capped by max-width, so
 * insetting it held the centred nav and left the logo shifting the full amount).
 * Painting, or the background stops short of the widened edge (`.site-top` paints
 * nothing, so insetting it truncates the header that does). `.site-top > header`
 * is the only element here that is both.
 *
 * Measured on Chromium at a 1400px viewport with a 15px scrollbar and the gutter
 * suppressed to emulate WebKit: logo 0.0, nav 0.0, chrome spanning 0..1400. The
 * earlier check missed this by forcing the property while the scrollbar was still
 * present, so the viewport never widened and only half the effect was visible.
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

test('the compensation targets the header, not the wrapper or the centring bar', () => {
  // The target has to be BOTH viewport-width and painting.
  //
  // Viewport-width, or a left-aligned child still moves: the centring bar is
  // capped by max-width, so insetting it held the centred nav still while the
  // logo kept shifting the full scrollbar width. Measured at a 1400px viewport,
  // logo +7.5px with the bar, 0.0px with the header.
  //
  // Painting, or the background stops short of the widened edge: `.site-top`
  // paints nothing, so insetting IT insets the header that carries the
  // background and border, leaving an unpainted strip at the top right.
  assert.ok(
    new RegExp(`\\.site-top\\s*>\\s*header\\s*\\{[^}]*var\\(${COMPENSATION}`).test(body),
    'a `.site-top > header` rule consumes the compensation',
  );
  // `.site-top` on its own is the wrong target and IS a reachable mistake, since
  // it is the fixed element and the obvious thing to reach for.
  assert.equal(
    new RegExp(`\\.site-top\\s*\\{[^}]*var\\(${COMPENSATION}`).test(body),
    false,
    'the non-painting fixed wrapper must not be the element inset',
  );
  // Exactly ONE rule may consume it. The other wrong target was the centring
  // div, which carries no class, so it cannot be named in a negative selector
  // check; counting the consuming rules catches it anyway, and catches any future
  // second consumer that would double-compensate.
  const consumers = body.match(new RegExp(`\\{[^{}]*var\\(${COMPENSATION}`, 'g')) ?? [];
  assert.equal(
    consumers.length,
    1,
    `exactly one rule may consume the compensation, found ${consumers.length}`,
  );
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
