/**
 * The blog's fixed header opts into the dialog scroll lock's compensation (#1144).
 *
 * Opening a `<ui-dialog>` locks page scroll, which hides the scrollbar and widens
 * the viewport on any engine that ignores `scrollbar-gutter`. The header here is
 * `position: fixed`, so it lays out against the viewport and cannot be reached by
 * the padding the lock puts on `<html>` to hold in-flow content still. It opts in
 * instead, via `--wj-scrollbar-compensation`.
 *
 * This app owns its copy of the kit's dialog (`components/ui/dialog.ts`, the
 * shadcn model), so the header and the lock have to stay in step by hand. That is
 * exactly how the app kept the #1144 shift for two review rounds after the kit
 * was fixed: the marketing site's copy is a gitignored mirror and tracked
 * automatically, this one did not.
 *
 * The opt-in is a single declaration in the root layout's inline `<style>`, so
 * nothing else on the page would notice it going missing, and the shift would
 * come back silently. This is what makes that fail instead.
 *
 * Run: node --test test/layout/fixed-header-scroll-lock.test.ts
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequestHandler } from '@webjsdev/server';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMPENSATION = '--wj-scrollbar-compensation';

let body: string;

before(async () => {
  const app = await createRequestHandler({ appDir: APP_ROOT, dev: false });
  await app.warmup?.();
  const res = await app.handle(new Request('http://localhost/'));
  assert.equal(res.status, 200, 'the home page should render');
  body = await res.text();
});

test('the fixed header opts into the scroll-lock compensation', () => {
  assert.ok(
    body.includes(COMPENSATION),
    `the served HTML must reference ${COMPENSATION}, or the fixed header goes back ` +
      'to sliding right by half the scrollbar width when a dialog opens',
  );
});

test('the opt-in is on the header itself, which is both viewport-width and painting', () => {
  // Unlike the marketing site, this app's fixed element IS the painting element,
  // so it takes the opt-in directly rather than delegating to a child. Both
  // properties matter. Viewport-width, or a left-aligned child (the brand) still
  // moves while a centred one looks fine. Painting, or the background stops short
  // of the widened edge, since insetting a wrapper insets whatever child paints.
  assert.ok(
    new RegExp(`\\.site-header\\s*\\{[^}]*var\\(${COMPENSATION}`).test(body),
    'a `.site-header` rule consumes the compensation',
  );
  // Exactly one consumer, or two rules would double-compensate.
  const consumers = body.match(new RegExp(`\\{[^{}]*var\\(${COMPENSATION}`, 'g')) ?? [];
  assert.equal(
    consumers.length,
    1,
    `exactly one rule may consume the compensation, found ${consumers.length}`,
  );
  // The element the rule targets has to actually be the fixed one.
  assert.ok(
    /<header class="site-header fixed /.test(body),
    'the .site-header element is the fixed header',
  );
});

test('the compensation resolves to zero when no lock is active', () => {
  // The `0px` fallback is what keeps the header identical to its unpatched self
  // at every other moment. Without it the border width is invalid and the whole
  // declaration is dropped, which fails silently rather than visibly.
  assert.ok(
    body.includes(`var(${COMPENSATION},0px)`) || body.includes(`var(${COMPENSATION}, 0px)`),
    'the compensation must carry a 0px fallback for the un-locked case',
  );
  // A transparent border, so the chrome still paints across the inset.
  assert.ok(
    new RegExp(`border-right:\\s*var\\(${COMPENSATION},\\s*0px\\)\\s*solid\\s*transparent`).test(body),
    'the opt-in is a transparent right border',
  );
});
