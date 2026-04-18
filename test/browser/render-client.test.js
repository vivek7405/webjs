/**
 * Client-side renderer tests — runs in a REAL browser via WTR + Playwright.
 * No fake DOM (linkedom/jsdom). Full Shadow DOM, events, and layout support.
 */
import { html } from '../../packages/core/src/html.js';
import { render } from '../../packages/core/src/render-client.js';
import { repeat } from '../../packages/core/src/repeat.js';
import { unsafeHTML } from '../../packages/core/src/directives.js';

const { suite, test } = window.Mocha ? Mocha : { suite, test };
const assert = {
  ok: (v, msg) => { if (!v) throw new Error(msg || `Expected truthy, got ${v}`); },
  equal: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected ${b}, got ${a}`); },
  strictEqual: (a, b, msg) => { if (a !== b) throw new Error(msg || `Expected strict equal`); },
  doesNotThrow: (fn, msg) => { try { fn(); } catch (e) { throw new Error(msg || `Unexpected throw: ${e.message}`); } },
};

suite('Client renderer', () => {
  test('renders a simple template into a container', () => {
    const el = document.createElement('div');
    render(html`<p>hello ${'world'}</p>`, el);
    const p = el.querySelector('p');
    assert.ok(p);
    assert.equal(p.textContent, 'hello world');
  });

  test('fine-grained update reuses the same element on value change', () => {
    const el = document.createElement('div');
    const make = (n) => html`<p>n=${n}</p>`;
    render(make(1), el);
    const pre = el.querySelector('p');
    render(make(2), el);
    const post = el.querySelector('p');
    assert.strictEqual(pre, post, '<p> should be the same node across renders');
    assert.equal(post.textContent, 'n=2');
  });

  test('attribute update swaps only the attribute, not the element', () => {
    const el = document.createElement('div');
    const make = (cls) => html`<div class=${cls}>x</div>`;
    render(make('a'), el);
    const pre = el.querySelector('div');
    render(make('b'), el);
    const post = el.querySelector('div');
    assert.strictEqual(pre, post);
    assert.equal(post.getAttribute('class'), 'b');
  });

  test('boolean attribute toggles presence', () => {
    const el = document.createElement('div');
    const make = (v) => html`<button ?disabled=${v}>x</button>`;
    render(make(true), el);
    assert.ok(el.querySelector('button').hasAttribute('disabled'));
    render(make(false), el);
    assert.ok(!el.querySelector('button').hasAttribute('disabled'));
  });

  test('event handler fires and swaps correctly', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let clicks = 0;
    const handler1 = () => { clicks += 1; };
    const handler2 = () => { clicks += 10; };
    const make = (fn) => html`<button @click=${fn}>x</button>`;
    render(make(handler1), el);
    el.querySelector('button').click();
    assert.equal(clicks, 1);
    render(make(handler2), el);
    el.querySelector('button').click();
    assert.equal(clicks, 11);
    el.remove();
  });

  test('property set (.value) assigns directly to the element property', () => {
    const el = document.createElement('div');
    render(html`<input .value=${'hi'} />`, el);
    assert.equal(el.querySelector('input').value, 'hi');
  });

  test('nested template diffing reuses child element on value-only change', () => {
    const el = document.createElement('div');
    const inner = (n) => html`<em>${n}</em>`;
    const outer = (n) => html`<p>count: ${inner(n)}</p>`;
    render(outer(1), el);
    const preEm = el.querySelector('em');
    assert.equal(preEm.textContent, '1');
    render(outer(2), el);
    const postEm = el.querySelector('em');
    assert.strictEqual(preEm, postEm, '<em> reused across renders');
    assert.equal(postEm.textContent, '2');
  });

  test('tab-toggle pattern: click handler flips sibling class', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let mode = 'a';
    const view = () =>
      html`<div>
        <button class=${mode === 'a' ? 'active' : ''} @click=${() => { mode = 'a'; render(view(), el); }}>A</button>
        <button class=${mode === 'b' ? 'active' : ''} @click=${() => { mode = 'b'; render(view(), el); }}>B</button>
      </div>`;
    render(view(), el);
    const buttons = Array.from(el.querySelectorAll('button'));
    assert.equal(buttons[0].getAttribute('class'), 'active');
    assert.equal(buttons[1].getAttribute('class'), '');
    assert.doesNotThrow(() => buttons[1].click());
    const after = Array.from(el.querySelectorAll('button'));
    assert.equal(after[0].getAttribute('class'), '');
    assert.equal(after[1].getAttribute('class'), 'active');
    el.remove();
  });

  test('repeat() reconciles by key: matching items reuse element identity', () => {
    const el = document.createElement('div');
    const view = (items) =>
      html`<ul>${repeat(items, (it) => it.id, (it) => html`<li>${it.label}</li>`)}</ul>`;
    render(view([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]), el);
    const [preA, preB] = Array.from(el.querySelectorAll('li'));
    render(view([{ id: 'a', label: 'Aaa' }, { id: 'b', label: 'Bbb' }]), el);
    const [postA, postB] = Array.from(el.querySelectorAll('li'));
    assert.strictEqual(postA, preA);
    assert.strictEqual(postB, preB);
    assert.equal(postA.textContent, 'Aaa');
  });

  test('repeat() reorder moves nodes, preserves identity', () => {
    const el = document.createElement('div');
    const view = (items) =>
      html`<ul>${repeat(items, (it) => it.id, (it) => html`<li>${it.label}</li>`)}</ul>`;
    render(view([{ id: 1, label: 'one' }, { id: 2, label: 'two' }, { id: 3, label: 'three' }]), el);
    const [li1, li2, li3] = Array.from(el.querySelectorAll('li'));
    render(view([{ id: 3, label: 'three' }, { id: 1, label: 'one' }, { id: 2, label: 'two' }]), el);
    const after = Array.from(el.querySelectorAll('li'));
    assert.strictEqual(after[0], li3);
    assert.strictEqual(after[1], li1);
    assert.strictEqual(after[2], li2);
  });

  test('unsafeHTML renders raw HTML in the DOM', () => {
    const el = document.createElement('div');
    render(html`<div>${unsafeHTML('<b>bold</b><i>italic</i>')}</div>`, el);
    assert.ok(el.querySelector('b'), 'should have <b> element');
    assert.equal(el.querySelector('b').textContent, 'bold');
    assert.ok(el.querySelector('i'), 'should have <i> element');
  });

  test('mixed attr: single hole with surrounding static text', () => {
    const el = document.createElement('div');
    const view = (cls) => html`<div class="pre ${cls} post">x</div>`;
    render(view('mid'), el);
    assert.equal(el.querySelector('div').getAttribute('class'), 'pre mid post');
    render(view('new'), el);
    assert.equal(el.querySelector('div').getAttribute('class'), 'pre new post');
  });

  test('mixed attr: multiple holes in one attribute all update', () => {
    const el = document.createElement('div');
    const view = (a, b) => html`<div data-x="a ${a} b ${b} c">x</div>`;
    render(view('1', '2'), el);
    assert.equal(el.querySelector('div').getAttribute('data-x'), 'a 1 b 2 c');
    render(view('3', '4'), el);
    assert.equal(el.querySelector('div').getAttribute('data-x'), 'a 3 b 4 c');
  });

  test('mixed attr: element identity preserved across updates', () => {
    const el = document.createElement('div');
    const view = (a) => html`<section data-foo="x ${a} y">k</section>`;
    render(view('1'), el);
    const pre = el.querySelector('section');
    render(view('2'), el);
    assert.strictEqual(el.querySelector('section'), pre);
    assert.equal(pre.getAttribute('data-foo'), 'x 2 y');
  });

  test('mixed attr: coexists with event and boolean parts on same element', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    let clicked = 0;
    const view = (cls, disabled) => html`
      <button class="btn ${cls} end" ?disabled=${disabled} @click=${() => { clicked++; }}>Go</button>
    `;
    render(view('primary', false), el);
    const btn = el.querySelector('button');
    assert.equal(btn.getAttribute('class'), 'btn primary end');
    assert.ok(!btn.hasAttribute('disabled'));
    btn.click();
    assert.equal(clicked, 1);
    render(view('secondary', true), el);
    assert.equal(btn.getAttribute('class'), 'btn secondary end');
    assert.ok(btn.hasAttribute('disabled'));
    el.remove();
  });
});

suite('Shadow DOM (real browser)', () => {
  test('attachShadow works and scopes styles', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const shadow = el.attachShadow({ mode: 'open' });
    render(html`<p>inside shadow</p>`, shadow);
    // Shadow content is queryable from shadowRoot
    assert.ok(shadow.querySelector('p'));
    assert.equal(shadow.querySelector('p').textContent, 'inside shadow');
    // But NOT from document
    assert.ok(!el.querySelector('p'), 'shadow content should not leak to light DOM');
    el.remove();
  });

  test('render into shadow root with styles', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const shadow = el.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ':host { display: block; color: red; }';
    shadow.appendChild(style);
    render(html`<p>styled</p>`, shadow);
    assert.ok(shadow.querySelector('p'));
    el.remove();
  });
});
