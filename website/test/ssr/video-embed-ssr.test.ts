/**
 * The <video-embed> server render, which is a different shape from its client
 * render on purpose.
 *
 * The element ships a noscript fallback carrying the plain player, plus a rule
 * hiding the poster button that a JS-off reader cannot click. Both must come
 * from SSR and ONLY from SSR. A browser parsing served HTML with scripting on
 * treats a noscript body as raw text, so the markup inside stays inert. The
 * client render has no such protection: it builds its nodes in a template,
 * where scripting is disabled, so a style element in there becomes REAL and
 * applies wherever it sits. That shipped once and hid the poster on every
 * JS-enabled visit, which looked like the embed had disappeared entirely.
 *
 * So this file pins the server half, and the browser suite pins the other half
 * by asserting the client render emits no noscript and no style at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@webjsdev/core/server';
import { html } from '@webjsdev/core';
import '#components/video-embed.ts';

const render = () => renderToString(
  html`<video-embed videoid="abc123" label="Intro video"></video-embed>`,
);

test('server render carries the poster, so the first paint needs no JS', async () => {
  const out = await render();
  assert.match(out, /<button/, 'expected the poster button in the SSR bytes');
  assert.match(out, /https:\/\/i\.ytimg\.com\/vi\/abc123\/maxresdefault\.jpg/);
  assert.match(out, /aria-label="Play Intro video"/);
});

test('server render carries the noscript fallback and hides the inert button', async () => {
  const out = await render();
  assert.match(out, /<noscript>/, 'expected a noscript fallback');
  assert.match(out, /https:\/\/www\.youtube-nocookie\.com\/embed\/abc123\?rel=0/);
  assert.match(out, /video-embed button \{ display: none \}/);
});

test('the JS-off player does not autoplay', async () => {
  const out = await render();
  // Nothing asked for playback on that path, and a page that starts a video
  // by itself is the behaviour this element exists to avoid.
  assert.ok(!out.includes('autoplay=1'), 'the noscript player must not autoplay');
});

test('no player frame renders outside the noscript', async () => {
  const out = await render();
  // The whole point of the element: the served HTML must not contain a live
  // cross-origin frame. Strip the noscript body and no iframe may remain.
  const withoutFallback = out.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  assert.ok(
    !withoutFallback.includes('<iframe'),
    'a live frame in the SSR bytes defeats the click-to-load design',
  );
});
