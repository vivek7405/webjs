import { test } from 'node:test';
import assert from 'node:assert/strict';

import { html, renderToString, WebComponent, css } from '../packages/core/index.js';

test('renders plain text', async () => {
  assert.equal(await renderToString(html`<p>hello</p>`), '<p>hello</p>');
});

test('interpolates text with escaping', async () => {
  assert.equal(await renderToString(html`<p>${'<script>'}</p>`), '<p>&lt;script&gt;</p>');
});

test('interpolates regular attributes with escaping', async () => {
  assert.equal(
    await renderToString(html`<a href=${'/x?y=1&z=2'}>x</a>`),
    '<a href="/x?y=1&amp;z=2">x</a>'
  );
});

test('interpolates inside quoted attributes', async () => {
  assert.equal(await renderToString(html`<a class="btn ${'primary'}">x</a>`), '<a class="btn primary">x</a>');
});

test('drops event handlers on server', async () => {
  assert.equal(await renderToString(html`<button @click=${() => {}}>go</button>`), '<button >go</button>');
});

test('drops properties on server', async () => {
  assert.equal(await renderToString(html`<input .value=${'typed'} />`), '<input  />');
});

test('boolean attribute renders only when truthy', async () => {
  assert.equal(await renderToString(html`<button ?disabled=${true}>x</button>`), '<button disabled="">x</button>');
  assert.equal(await renderToString(html`<button ?disabled=${false}>x</button>`), '<button >x</button>');
});

test('nested template', async () => {
  const inner = html`<em>${'there'}</em>`;
  assert.equal(await renderToString(html`<p>hi ${inner}</p>`), '<p>hi <em>there</em></p>');
});

test('array of templates', async () => {
  const items = [1, 2, 3].map((n) => html`<li>${n}</li>`);
  assert.equal(await renderToString(html`<ul>${items}</ul>`), '<ul><li>1</li><li>2</li><li>3</li></ul>');
});

test('awaits promise values in holes', async () => {
  const fetchTitle = Promise.resolve('hello world');
  assert.equal(await renderToString(html`<h1>${fetchTitle}</h1>`), '<h1>hello world</h1>');
});

test('awaits async template (page-style)', async () => {
  const page = (async () => html`<p>${await Promise.resolve('data')}</p>`)();
  assert.equal(await renderToString(page), '<p>data</p>');
});

test('custom element injects declarative shadow DOM', async () => {
  class Greet extends WebComponent {
    static tag = 'g-reet';
    static styles = css`span { color: red; }`;
    render() { return html`<span>hi ${'you'}</span>`; }
  }
  Greet.register();
  const out = await renderToString(html`<g-reet></g-reet>`);
  assert.match(out, /<g-reet><template shadowrootmode="open">/);
  assert.match(out, /<style>span \{ color: red; \}<\/style>/);
  assert.match(out, /<span>hi you<\/span>/);
  assert.match(out, /<\/template><\/g-reet>/);
});

test('async component render is awaited', async () => {
  class AsyncGreet extends WebComponent {
    static tag = 'async-greet';
    async render() {
      const name = await Promise.resolve('async world');
      return html`<span>hi ${name}</span>`;
    }
  }
  AsyncGreet.register();
  const out = await renderToString(html`<async-greet></async-greet>`);
  assert.match(out, /<span>hi async world<\/span>/);
});

test('ignores null/false/undefined values', async () => {
  assert.equal(await renderToString(html`<p>${null}${false}${undefined}x</p>`), '<p>x</p>');
});

test('HTML comments are passed through; holes inside comments do not break parsing', async () => {
  const out = await renderToString(html`<!-- skip ${'me'} --><p>after ${'value'}</p>`);
  assert.match(out, /<!-- skip me -->/);
  assert.match(out, /<p>after value<\/p>/);
});

test('comment containing > does not exit early', async () => {
  const out = await renderToString(html`<!-- a > b --><span>${'x'}</span>`);
  assert.match(out, /<!-- a > b -->/);
  assert.match(out, /<span>x<\/span>/);
});
