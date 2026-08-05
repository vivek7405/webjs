/**
 * What the SERVER emits for a <code-block>, which is the whole no-JS reading
 * path and the first paint for every code sample under /docs and /ui.
 *
 * The component renders a `<slot>` at SSR (`connectedCallback` is a
 * browser-only hook, so the token branch never runs there) and the framework
 * projects the authored code into it as text. Nothing else asserts that. The
 * browser tests start from a hand-written fixture of this shape rather than
 * from the server's real output, and the a11y test reads only `<pre …>` open
 * tags, so if light-DOM projection ever dropped the children, every one of
 * those suites would still pass while every code sample on the docs site
 * rendered blank without JavaScript.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';
import '#components/code-block.ts';
import Routing from '#app/docs/routing/page.ts';

/** The text inside the block's `<pre>`, tags removed, entities decoded. */
function preText(rendered: string) {
  const body = rendered.match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/)?.[1] ?? '';
  return body
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

test('the server projects the code into the pre, so it reads with JavaScript off', async () => {
  const code = "const greeting = 'hi';\nexport function run() {}";
  const out = await renderToString(html`<code-block>${code}</code-block>`);
  assert.match(out, /<pre\b[^>]*tabindex="0"/, 'the served block is a focus stop before any JS runs');
  assert.equal(preText(out), code, 'the code is IN the served pre, not waiting on hydration');
});

test('the server does not tokenize, so the first paint is the plain text', async () => {
  // Deliberate: the docs samples have no string for the server to tokenize,
  // so colour arrives on upgrade. What must never arrive on upgrade is the
  // CONTENT, which is what the assertion above pins.
  const out = await renderToString(html`<code-block>const x = 1;</code-block>`);
  assert.equal(/class="t-[a-z]+"/.test(out), false, 'no token spans at SSR');
});

test('a sample with angle brackets is escaped, not parsed as markup', async () => {
  const code = 'html`<my-tag attr="1"></my-tag>`';
  const out = await renderToString(html`<code-block>${code}</code-block>`);
  assert.equal(out.includes('<my-tag'), false, 'no element was created from the sample text');
  assert.equal(preText(out), code, 'the sample reads back verbatim');
});

test('a named block carries the role that permits its name, an unnamed one carries neither', async () => {
  const named = await renderToString(html`<code-block label="root layout">x</code-block>`);
  assert.match(named, /<pre\b[^>]*role="region"/);
  assert.match(named, /<pre\b[^>]*aria-label="root layout"/);

  const plain = await renderToString(html`<code-block>x</code-block>`);
  const tag = plain.match(/<pre\b[^>]*>/)?.[0] ?? '';
  assert.equal(/\brole=/.test(tag), false, 'no role on an unnamed block');
  assert.equal(/\baria-label=/.test(tag), false, 'and no name, which is what ARIA permits on a pre');
});

test('a real docs page serves its samples as readable text', async () => {
  // End to end through a page as authored, so a projection regression shows
  // up here even if the synthetic cases above kept passing.
  const out = await renderToString(Routing());
  assert.ok(out.includes('page.ts            # home page'), 'the file-tree sample is in the served HTML');
  assert.ok(out.includes('export default async function BlogPost'), 'a code sample is in the served HTML');
  const blocks = out.match(/<pre\b[^>]*>[\s\S]*?<\/pre>/g) ?? [];
  assert.ok(blocks.length > 20, `expected the page's blocks, found ${blocks.length}`);
  assert.equal(blocks.filter((b) => preText(b).trim() === '').length, 0, 'no block was served empty');
});
