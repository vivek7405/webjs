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

test('swapping templates tears down and rebuilds DOM', () => {
  const el = document.createElement('div');
  render(html`<p>A</p>`, el);
  const pre = el.querySelector('p');
  render(html`<span>B</span>`, el);
  assert.equal(pre.parentNode, null, 'previous element removed');
  assert.equal(el.querySelector('span').textContent, 'B');
});
