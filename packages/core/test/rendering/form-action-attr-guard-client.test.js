// #1154, client half: the browser renderer refuses the same commit, so a
// client re-render can never write a function's source into the live DOM
// (`applyPart`'s 'attr' and 'attr-mixed' cases). Runs under linkedom.
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
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
});

async function fakeAction() { const S = 'CLIENT_SECRET'; return S; }

// NOTE on what these DON'T assert: `createInstance` applies every part before
// it calls `container.replaceChildren(...)`, so a throwing part leaves `host`
// empty no matter what. An `assert.ok(!host.innerHTML.includes(SECRET))` here
// would pass unconditionally and prove nothing. The load-bearing assertion is
// the throw itself, plus the SECOND-render cases below, where the host DOES
// hold a live form and a leak would therefore be observable.
test('client render of action=${fn} throws', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form method="post" action=${fakeAction}></form>`, host),
    /function was interpolated into action=/,
  );
});

test('client render of mixed action="/x/${fn}" throws', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action="/x/${fakeAction}"></form>`, host),
    /function was interpolated into action=/,
  );
});

// Re-render over an ALREADY-MOUNTED form. Here the host really does hold a live
// element, so if the guard let the value through, the source would be sitting
// in the DOM and this would catch it.
test('re-render swapping a string action for a function throws, live DOM stays clean', () => {
  const host = document.createElement('div');
  const tpl = (a) => html`<form method="post" action=${a}></form>`;
  render(tpl('/ok'), host);
  assert.equal(host.querySelector('form').getAttribute('action'), '/ok');
  assert.throws(() => render(tpl(fakeAction), host), /function was interpolated into action=/);
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
  assert.equal(host.querySelector('form').getAttribute('action'), '/ok', 'the prior value must survive');
});

// `.action=${fn}` is a PROPERTY binding, a different commit site from the
// attribute one. `action` is a reflected IDL attribute, so assigning a function
// writes its source into the element's own `action` in a real browser.
test('client .action=${fn} property binding on a native form throws', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form .action=${fakeAction}></form>`, host),
    /function was interpolated into action=/,
  );
});

test('a custom element keeps accepting a function on .action', () => {
  // Not a reflected IDL attribute, just an author-defined property, so passing
  // a function is legitimate and must not be refused.
  const host = document.createElement('div');
  render(html`<my-widget .action=${fakeAction}></my-widget>`, host);
  assert.equal(typeof host.querySelector('my-widget').action, 'function');
});

test('string action still renders on the client', () => {
  const host = document.createElement('div');
  render(html`<form method="post" action=${'/submit'}></form>`, host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('action'), '/submit');
});

// --- Bypasses found reviewing the first cut of the guard -------------------
//
// A quoted binding hole compiles to a plain `attr` part whose name still
// carries the sigil, so comparing the raw name let `.action="${fn}"` through
// on this side too. These pin the client half of that fix.

test('client refuses a quoted property hole .action="${fn}"', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form .action="${fakeAction}"></form>`, host),
    /function was interpolated into \.action=/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
});

test('client refuses a quoted boolean hole ?action="${fn}"', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form ?action="${fakeAction}"></form>`, host),
    /function was interpolated into \?action=/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
});

test('client refuses a quoted event hole @action="${fn}"', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form @action="${fakeAction}"></form>`, host),
    /function was interpolated into @action=/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
});

test('client refuses an array-wrapped function', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action=${[fakeAction]}></form>`, host),
    /function was interpolated into action=/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
});

test('client refuses an array-wrapped function inside a mixed hole', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action="/x/${[fakeAction]}"></form>`, host),
    /function was interpolated into action=/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
});

test('client still renders an array of plain strings', () => {
  const host = document.createElement('div');
  render(html`<form action=${['/a', '/b']}></form>`, host);
  assert.equal(host.querySelector('form').getAttribute('action'), '/a,/b');
});
