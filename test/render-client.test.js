import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';

before(() => {
  const { window } = parseHTML('<!doctype html><html><body></body></html>');
  globalThis.document = window.document;
  globalThis.DocumentFragment = window.DocumentFragment;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.Comment = window.Comment;
  globalThis.Text = window.Text;
  globalThis.NodeFilter = window.NodeFilter;
  globalThis.HTMLElement = window.HTMLElement;
});

let html, render;
before(async () => {
  ({ html } = await import('../packages/core/src/html.js'));
  ({ render } = await import('../packages/core/src/render-client.js'));
});

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
  assert.strictEqual(pre, post, '<p> element should be the same node across renders');
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

test('event handler swaps without reattaching a new listener', () => {
  const el = document.createElement('div');
  let clicks = 0;
  const handler1 = () => { clicks += 1; };
  const handler2 = () => { clicks += 10; };
  const make = (fn) => html`<button @click=${fn}>x</button>`;
  render(make(handler1), el);
  const btn = el.querySelector('button');
  btn.click();
  assert.equal(clicks, 1);
  render(make(handler2), el);
  btn.click();
  assert.equal(clicks, 11);
});

test('property set (.value) assigns directly to the element property', () => {
  const el = document.createElement('div');
  render(html`<input .value=${'hi'} />`, el);
  const input = el.querySelector('input');
  assert.equal(input.value, 'hi');
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

test('quoted attribute interpolation does not crash re-renders', () => {
  const el = document.createElement('div');
  // Reproduces the bug where a hole inside a quoted attr value
  // (e.g. class="foo ${bar}") used to bind a broken path and throw on update.
  const view = (cls) =>
    html`<div data-x="${cls}"><button class=${cls} @click=${() => {}}>b</button></div>`;
  render(view('a'), el);
  assert.doesNotThrow(() => render(view('b'), el));
  // Unquoted attr part DID update.
  assert.equal(el.querySelector('button').getAttribute('class'), 'b');
});

test('tab-toggle pattern: click handler flips a sibling class without crashing', () => {
  // Mirrors the auth-forms tab toggle shape that was crashing on click.
  const el = document.createElement('div');
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
  // Click "B" — should not throw, should update classes.
  assert.doesNotThrow(() => buttons[1].click());
  const after = Array.from(el.querySelectorAll('button'));
  assert.equal(after[0].getAttribute('class'), '');
  assert.equal(after[1].getAttribute('class'), 'active');
});

test('swapping templates tears down and rebuilds DOM', () => {
  const el = document.createElement('div');
  render(html`<p>A</p>`, el);
  const pre = el.querySelector('p');
  render(html`<span>B</span>`, el);
  assert.equal(pre.parentNode, null, 'previous element removed');
  assert.equal(el.querySelector('span').textContent, 'B');
});

test('repeat() reconciles by key: matching items reuse element identity', async () => {
  const { repeat } = await import('../packages/core/src/repeat.js');
  const el = document.createElement('div');
  const view = (items) =>
    html`<ul>${repeat(items, (it) => it.id, (it) => html`<li>${it.label}</li>`)}</ul>`;

  render(view([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]), el);
  const [preA, preB] = Array.from(el.querySelectorAll('li'));
  assert.equal(preA.textContent, 'A');
  assert.equal(preB.textContent, 'B');

  // Swap labels; same keys → same elements, updated text.
  render(view([{ id: 'a', label: 'Aaa' }, { id: 'b', label: 'Bbb' }]), el);
  const [postA, postB] = Array.from(el.querySelectorAll('li'));
  assert.strictEqual(postA, preA);
  assert.strictEqual(postB, preB);
  assert.equal(postA.textContent, 'Aaa');
  assert.equal(postB.textContent, 'Bbb');
});

test('repeat() reorder moves nodes, preserves identity', async () => {
  const { repeat } = await import('../packages/core/src/repeat.js');
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

test('repeat() removal drops only removed keys', async () => {
  const { repeat } = await import('../packages/core/src/repeat.js');
  const el = document.createElement('div');
  const view = (items) =>
    html`<ul>${repeat(items, (it) => it.id, (it) => html`<li>${it.label}</li>`)}</ul>`;

  render(view([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]), el);
  const [preA, preB, preC] = Array.from(el.querySelectorAll('li'));
  render(view([{ id: 'a', label: 'A' }, { id: 'c', label: 'C' }]), el);
  const after = Array.from(el.querySelectorAll('li'));
  assert.equal(after.length, 2);
  assert.strictEqual(after[0], preA);
  assert.strictEqual(after[1], preC);
  assert.equal(preB.parentNode, null);
});

test('mixed attr: single hole with surrounding static text composes correctly', () => {
  const el = document.createElement('div');
  const view = (cls) => html`<div class="prefix ${cls} suffix">x</div>`;
  render(view('mid'), el);
  assert.equal(el.querySelector('div').getAttribute('class'), 'prefix mid suffix');
  render(view('new'), el);
  assert.equal(el.querySelector('div').getAttribute('class'), 'prefix new suffix');
});

test('mixed attr: multiple holes in one attribute all update', () => {
  const el = document.createElement('div');
  const view = (a, b) => html`<div class="a ${a} b ${b} c">x</div>`;
  render(view('X', 'Y'), el);
  assert.equal(el.querySelector('div').getAttribute('class'), 'a X b Y c');
  render(view('X2', 'Y2'), el);
  assert.equal(el.querySelector('div').getAttribute('class'), 'a X2 b Y2 c');
});

test('mixed attr: null/undefined values coerce to empty string', () => {
  const el = document.createElement('div');
  const view = (cls) => html`<div data-x="[${cls}]">z</div>`;
  render(view(null), el);
  assert.equal(el.querySelector('div').getAttribute('data-x'), '[]');
  render(view(undefined), el);
  assert.equal(el.querySelector('div').getAttribute('data-x'), '[]');
  render(view('mid'), el);
  assert.equal(el.querySelector('div').getAttribute('data-x'), '[mid]');
});

test('mixed attr: element identity preserved across updates', () => {
  const el = document.createElement('div');
  const view = (a, b) => html`<section data-foo="pre ${a} mid ${b}">k</section>`;
  render(view('1', '2'), el);
  const pre = el.querySelector('section');
  render(view('3', '4'), el);
  const post = el.querySelector('section');
  assert.strictEqual(pre, post, 'element reused across mixed-attr updates');
  assert.equal(post.getAttribute('data-foo'), 'pre 3 mid 4');
});

test('mixed attr: coexists with other part kinds on the same element', () => {
  const el = document.createElement('div');
  let clicked = 0;
  const view = (pref, text) => html`
    <button class="btn ${pref} active" @click=${() => { clicked++; }}>${text}</button>
  `;
  render(view('primary', 'Go'), el);
  const btn = el.querySelector('button');
  assert.equal(btn.getAttribute('class'), 'btn primary active');
  assert.equal(btn.textContent, 'Go');
  btn.click();
  assert.equal(clicked, 1);
  render(view('secondary', 'Stop'), el);
  assert.equal(btn.getAttribute('class'), 'btn secondary active');
  assert.equal(btn.textContent, 'Stop');
});
