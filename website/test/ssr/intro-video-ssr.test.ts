/**
 * The landing page's intro video is hidden until its frame fires load.
 *
 * A cross-origin iframe paints its own canvas before the embedded stylesheet
 * applies, and on some engines that canvas is opaque white, which no
 * background on the iframe element can cover. Hiding the frame until load
 * removes the question: what it paints early is off screen, and the box under
 * it is already black.
 *
 * Each assertion here is a piece that silently breaks the whole thing if it
 * goes missing, which is why they are pinned rather than left to review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import LandingPage from '#app/page.ts';

const render = () => renderToString(LandingPage());

test('the intro frame ships hidden, over a black box', async () => {
  const out = await render();
  assert.match(out, /class="intro-video-frame [^"]*\binvisible\b/, 'the frame must start hidden');
  assert.match(out, /aspect-video[^"]*\bbg-black\b/, 'the box under it must be black');
});

test('the frame reveals itself with a plain onload attribute', async () => {
  const out = await render();
  // A plain HTML attribute, not an @event hole: this page never hydrates, so
  // a template event binding would be dropped at SSR and the frame would stay
  // hidden forever.
  assert.match(out, /onload="this\.classList\.remove\('invisible'\)"/);
});

test('a JS-off reader gets no embed at all', async () => {
  const out = await render();
  // Without JS the load handler never runs AND YouTube's player cannot run
  // inside the frame either, so revealing it would show their own noscript
  // error rather than a video. Hide the whole section instead. The rule must
  // live in noscript, which a browser with scripting on parses as inert text.
  assert.match(out, /<noscript><style>\.intro-video \{ display: none \}<\/style><\/noscript>/);
  assert.match(out, /<section class="intro-video /, 'the rule needs its hook on the section');
});
