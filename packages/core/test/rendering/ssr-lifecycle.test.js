/**
 * Pre-render lifecycle at SSR (issue #217).
 *
 * The SSR walker now runs willUpdate + reactive controllers' hostUpdate and
 * reflects reflect:true properties BEFORE render(), and backs the attribute /
 * event / internals surface with a server element shim. These tests pin the
 * acceptance criteria: derived state computed in willUpdate is correct in the
 * SSR'd HTML, controllers contribute, reflected props appear as attributes,
 * attribute reads in render work, and the lit muscle-memory patterns that used
 * to crash (addEventListener / attachInternals in the constructor) render
 * cleanly. The counterfactual at the end proves the willUpdate value is
 * actually produced by the lifecycle, not by the constructor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { WebComponent, prop } from '../../src/component.js';
import { html } from '../../src/html.js';
import { renderToString } from '../../src/render-server.js';

test('willUpdate runs before render at SSR; its derived value appears in the HTML', async () => {
  class DerivesInWillUpdate extends WebComponent({ count: Number }) {
    constructor() {
      super();
      this.count = 0;
      this.label = 'unset'; // overwritten by willUpdate if it runs
    }
    willUpdate() {
      this.label = `count-is-${this.count}`;
    }
    render() {
      return html`<span>${this.label}</span>`;
    }
  }
  DerivesInWillUpdate.register('ssr-will-update');

  const out = await renderToString(html`<ssr-will-update count="5"></ssr-will-update>`);
  assert.match(out, /count-is-5/, 'willUpdate-derived value is in the SSR output');
  assert.doesNotMatch(out, />unset</, 'constructor placeholder did not survive');
});

test('reactive controllers hostUpdate runs before render at SSR', async () => {
  let ran = false;
  class Ctrl {
    constructor(host) {
      this.host = host;
      host.addController(this);
    }
    hostUpdate() {
      ran = true;
      this.host.injected = 'from-controller';
    }
  }
  class HasController extends WebComponent {
    constructor() {
      super();
      this.injected = 'none';
      new Ctrl(this);
    }
    render() {
      return html`<i>${this.injected}</i>`;
    }
  }
  HasController.register('ssr-has-controller');

  const out = await renderToString(html`<ssr-has-controller></ssr-has-controller>`);
  assert.equal(ran, true, 'controller hostUpdate ran during SSR');
  assert.match(out, /from-controller/, 'controller contribution is in the SSR output');
});

test('a reflect:true property set in the constructor appears as an attribute', async () => {
  class ReflectsLevel extends WebComponent({ level: prop(Number, { reflect: true }) }) {
    constructor() {
      super();
      this.level = 7;
    }
    render() {
      return html`<p>l</p>`;
    }
  }
  ReflectsLevel.register('ssr-reflects-ctor');

  const out = await renderToString(html`<ssr-reflects-ctor></ssr-reflects-ctor>`);
  assert.match(out, /<ssr-reflects-ctor[^>]*\blevel="7"/, 'reflected attribute is on the opening tag');
});

test('a reflect:true boolean set in willUpdate appears as a bare attribute', async () => {
  class OpensInWillUpdate extends WebComponent({ open: prop(Boolean, { reflect: true }) }) {
    constructor() {
      super();
      this.open = false;
    }
    willUpdate() {
      this.open = true;
    }
    render() {
      return html`<p>o</p>`;
    }
  }
  OpensInWillUpdate.register('ssr-opens-willupdate');

  const out = await renderToString(html`<ssr-opens-willupdate></ssr-opens-willupdate>`);
  assert.match(out, /<ssr-opens-willupdate[^>]*\bopen\b/, 'bare boolean attribute reflected');
});

test('reading this.getAttribute / hasAttribute in render returns the source value', async () => {
  class ReadsAttr extends WebComponent {
    render() {
      const has = this.hasAttribute('mode') ? 'yes' : 'no';
      return html`<b data-has=${has}>${this.getAttribute('mode')}</b>`;
    }
  }
  ReadsAttr.register('ssr-reads-attr');

  const out = await renderToString(html`<ssr-reads-attr mode="dark"></ssr-reads-attr>`);
  assert.match(out, /data-has="yes"/, 'hasAttribute saw the source attribute');
  assert.match(out, />dark</, 'getAttribute returned the source value');
});

test('addEventListener and attachInternals in the constructor do not crash SSR', async () => {
  class UsesInternals extends WebComponent {
    constructor() {
      super();
      this.addEventListener('click', () => {});
      const internals = this.attachInternals();
      internals.setFormValue('v');
      internals.states.add('ready');
      internals.setValidity({});
    }
    render() {
      return html`<p>ok</p>`;
    }
  }
  UsesInternals.register('ssr-uses-internals');

  const out = await renderToString(html`<ssr-uses-internals></ssr-uses-internals>`);
  assert.match(out, /<p>ok<\/p>/, 'component rendered without throwing');
});

test('a component that neither reflects nor sets attributes keeps a byte-identical opening tag', async () => {
  class Plain extends WebComponent({ name: String }) {
    constructor() {
      super();
      this.name = '';
    }
    render() {
      return html`<p>${this.name}</p>`;
    }
  }
  Plain.register('ssr-plain');

  const out = await renderToString(html`<ssr-plain name="x" class="y"></ssr-plain>`);
  // The authored attributes are preserved verbatim and the framework appends
  // only `data-wj-host` (a light host, uniformly marked). That uniform append is
  // what preserves the elision on-vs-off differential invariant.
  assert.match(out, /<ssr-plain name="x" class="y" data-wj-host><!--webjs-hydrate-->/, 'authored attrs kept, marker appended');
});

test('the server element shim mirrors lit: attributes getter, toggleAttribute, double-attach throws', async () => {
  let snapshot = null;
  let toggledOn = false;
  let secondAttachThrew = false;
  class ShimSurface extends WebComponent {
    constructor() {
      super();
      toggledOn = this.toggleAttribute('data-flag'); // -> true, sets ''
      this.setAttribute('data-x', 'X');
      // `attributes` mirrors Element.attributes: [{name, value}, ...]
      snapshot = this.attributes.map((a) => `${a.name}=${a.value}`).sort();
      this.attachInternals();
      try { this.attachInternals(); } catch { secondAttachThrew = true; }
    }
    render() { return html`<p>shim</p>`; }
  }
  ShimSurface.register('ssr-shim-surface');

  await renderToString(html`<ssr-shim-surface></ssr-shim-surface>`);
  assert.equal(toggledOn, true, 'toggleAttribute with no force adds the attribute and returns true');
  assert.deepEqual(snapshot, ['data-flag=', 'data-x=X'], 'attributes getter reflects the live shim store');
  assert.equal(secondAttachThrew, true, 'a second attachInternals throws, matching the browser and lit');
});

test('an Object/Array attribute carrying JSON is entity-decoded before parse at SSR', async () => {
  // A JSON value in an attribute is escaped to `&quot;` by the renderer. The
  // SSR walker must decode those entities before JSON.parse, or the parse
  // throws and the prop falls to the unparseable-attribute value (`null` since
  // #1253, the raw string before it) instead of the author's array, so
  // render() sees the wrong type either way. Regression for
  // applyAttrsToInstance.
  let seenType = 'unset';
  class JsonAttr extends WebComponent({ data: Object }) {
    constructor() { super(); this.data = null; }
    render() {
      seenType = Array.isArray(this.data) ? 'array' : typeof this.data;
      const first = Array.isArray(this.data) ? this.data[0]?.label : undefined;
      return html`<p>${first ?? 'none'}</p>`;
    }
  }
  JsonAttr.register('ssr-json-attr');

  const payload = [{ label: 'has "quotes" & <ammp>' }];
  const out = await renderToString(html`<ssr-json-attr data=${JSON.stringify(payload)}></ssr-json-attr>`);
  assert.equal(seenType, 'array', 'the Object attribute parsed to an array, not the null an unparseable one yields');
  // In text content, `&` and `<`/`>` are escaped but quotes stay literal.
  assert.match(out, /<p>has "quotes" &amp; &lt;ammp&gt;<\/p>/, 'the decoded value rendered correctly');
});

test('COUNTERFACTUAL: without the willUpdate pass, the derived value would be the constructor placeholder', async () => {
  // Mirrors the first test but proves the assertion would FAIL if willUpdate
  // did not run: a subclass that deliberately renders the raw constructor
  // value shows what the output looks like when the lifecycle is bypassed.
  class NoDerive extends WebComponent({ count: Number }) {
    constructor() {
      super();
      this.count = 5;
      this.label = 'unset';
    }
    // no willUpdate override: label stays at its constructor value
    render() {
      return html`<span>${this.label}</span>`;
    }
  }
  NoDerive.register('ssr-no-derive');

  const out = await renderToString(html`<ssr-no-derive></ssr-no-derive>`);
  assert.match(out, />unset</, 'with no willUpdate, the placeholder is what renders');
  assert.doesNotMatch(out, /count-is-5/, 'no derived value without a willUpdate that computes it');
});
