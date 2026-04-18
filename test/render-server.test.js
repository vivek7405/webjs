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

test('DSD injection handles attribute values containing slashes', async () => {
  class SlashTag extends WebComponent {
    static shadow = true;
    static properties = { href: { type: String } };
    render() { return html`<a href=${this.href}>x</a>`; }
  }
  customElements.define('slash-tag', SlashTag);
  const out = await renderToString(html`<slash-tag href="/some/path"></slash-tag>`);
  // The opening tag must have DSD injected even though the attribute has /.
  assert.match(out, /<slash-tag href="\/some\/path"><template shadowrootmode="open">/);
});

test('custom element injects declarative shadow DOM', async () => {
  class Greet extends WebComponent {
    static shadow = true;
    static styles = css`span { color: red; }`;
    render() { return html`<span>hi ${'you'}</span>`; }
  }
  customElements.define('g-reet', Greet);
  const out = await renderToString(html`<g-reet></g-reet>`);
  assert.match(out, /<g-reet><template shadowrootmode="open">/);
  assert.match(out, /<style>span \{ color: red; \}<\/style>/);
  assert.match(out, /<span>hi you<\/span>/);
  assert.match(out, /<\/template><\/g-reet>/);
});

test('async component render is awaited', async () => {
  class AsyncGreet extends WebComponent {
    static shadow = true;
    async render() {
      const name = await Promise.resolve('async world');
      return html`<span>hi ${name}</span>`;
    }
  }
  customElements.define('async-greet', AsyncGreet);
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

test('<style> content is raw-text — angle brackets are not parsed as tags', async () => {
  const out = await renderToString(html`<style>a > b { color: ${'red'}; }</style><p>after</p>`);
  assert.match(out, /<style>a > b \{ color: red; \}<\/style>/);
  assert.match(out, /<p>after<\/p>/);
});

test('<script> content is raw-text — interpolated verbatim', async () => {
  const out = await renderToString(html`<script>var x = ${42}; if (x < 10) {}</script><p>k</p>`);
  assert.match(out, /<script>var x = 42; if \(x < 10\) \{\}<\/script>/);
  assert.match(out, /<p>k<\/p>/);
});

test('uppercase </SCRIPT> still closes raw-text (case-insensitive)', async () => {
  const out = await renderToString(html`<script>x<1</SCRIPT><p>hi</p>`);
  assert.match(out, /<\/SCRIPT><p>hi<\/p>/);
});

// ---------------------------------------------------------------------------
// Nested DSD injection — all four shadow/light DOM combinations
// ---------------------------------------------------------------------------

test('nested DSD: shadow parent → shadow child gets DSD with inline styles', async () => {
  class A1Child extends WebComponent {
    static shadow = true;
    static styles = css`:host { display: inline-flex; width: 36px; height: 36px; }`;
    render() { return html`<button>X</button>`; }
  }
  customElements.define('ss-child', A1Child);

  class A1Parent extends WebComponent {
    static shadow = true;
    static styles = css`:host { display: block; }`;
    render() { return html`<div><ss-child></ss-child></div>`; }
  }
  customElements.define('ss-parent', A1Parent);

  const out = await renderToString(html`<ss-parent></ss-parent>`);

  // Parent has DSD
  assert.match(out, /<ss-parent><template shadowrootmode="open">/);
  assert.match(out, /<style>:host \{ display: block; \}<\/style>/);

  // Child inside parent's DSD also has its own DSD with styles
  assert.match(out, /<ss-child><template shadowrootmode="open">/);
  assert.match(out, /width: 36px; height: 36px/);
  assert.match(out, /<button>X<\/button>/);
});

test('nested DSD: shadow parent → light child gets hydration marker', async () => {
  class B1Child extends WebComponent {
    static shadow = false;
    render() { return html`<span>light content</span>`; }
  }
  customElements.define('sl-child', B1Child);

  class B1Parent extends WebComponent {
    static shadow = true;
    static styles = css`:host { display: block; }`;
    render() { return html`<sl-child></sl-child>`; }
  }
  customElements.define('sl-parent', B1Parent);

  const out = await renderToString(html`<sl-parent></sl-parent>`);

  // Parent has DSD
  assert.match(out, /<sl-parent><template shadowrootmode="open">/);

  // Light DOM child inside parent's DSD gets hydration marker, no DSD template
  assert.match(out, /<sl-child><!--webjs-hydrate--><span>light content<\/span>/);
  assert.ok(!out.includes('<sl-child><template shadowrootmode'));
});

test('nested DSD: light parent → shadow child gets DSD with inline styles', async () => {
  class C1Child extends WebComponent {
    static shadow = true;
    static styles = css`button { color: red; }`;
    render() { return html`<button>click</button>`; }
  }
  customElements.define('ls-child', C1Child);

  class C1Parent extends WebComponent {
    static shadow = false;
    render() { return html`<div><ls-child></ls-child></div>`; }
  }
  customElements.define('ls-parent', C1Parent);

  const out = await renderToString(html`<ls-parent></ls-parent>`);

  // Parent is light DOM — hydration marker, no DSD template
  assert.match(out, /<ls-parent><!--webjs-hydrate-->/);

  // Shadow child inside light parent gets its own DSD with styles
  assert.match(out, /<ls-child><template shadowrootmode="open">/);
  assert.match(out, /<style>button \{ color: red; \}<\/style>/);
  assert.match(out, /<button>click<\/button>/);
});

test('nested DSD: light parent → light child gets hydration marker', async () => {
  class D1Child extends WebComponent {
    static shadow = false;
    render() { return html`<em>inner light</em>`; }
  }
  customElements.define('ll-child', D1Child);

  class D1Parent extends WebComponent {
    static shadow = false;
    render() { return html`<ll-child></ll-child>`; }
  }
  customElements.define('ll-parent', D1Parent);

  const out = await renderToString(html`<ll-parent></ll-parent>`);

  // Both are light DOM — hydration markers, no DSD templates
  assert.match(out, /<ll-parent><!--webjs-hydrate-->/);
  assert.match(out, /<ll-child><!--webjs-hydrate--><em>inner light<\/em>/);
  assert.ok(!out.includes('<ll-child><template shadowrootmode'));
  assert.ok(!out.includes('<ll-parent><template shadowrootmode'));
});

test('nested DSD: three levels deep — shadow → shadow → shadow', async () => {
  class DeepLeaf extends WebComponent {
    static shadow = true;
    static styles = css`.leaf { color: green; }`;
    render() { return html`<span class="leaf">leaf</span>`; }
  }
  customElements.define('deep-leaf', DeepLeaf);

  class DeepMid extends WebComponent {
    static shadow = true;
    static styles = css`:host { padding: 8px; }`;
    render() { return html`<deep-leaf></deep-leaf>`; }
  }
  customElements.define('deep-mid', DeepMid);

  class DeepRoot extends WebComponent {
    static shadow = true;
    static styles = css`:host { display: block; }`;
    render() { return html`<deep-mid></deep-mid>`; }
  }
  customElements.define('deep-root', DeepRoot);

  const out = await renderToString(html`<deep-root></deep-root>`);

  // All three levels have DSD with their own styles
  assert.match(out, /<deep-root><template shadowrootmode="open">/);
  assert.match(out, /<deep-mid><template shadowrootmode="open">/);
  assert.match(out, /<deep-leaf><template shadowrootmode="open">/);
  assert.match(out, /\.leaf \{ color: green; \}/);
  assert.match(out, /padding: 8px/);
  assert.match(out, /<span class="leaf">leaf<\/span>/);
});
