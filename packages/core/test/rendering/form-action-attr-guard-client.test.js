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
// A quoted binding hole keeps its sigil in the part's name, so comparing the
// raw name let `.action="${fn}"` through on this side too.
//
// WHICH clause each case pins, verified by reverting them one at a time rather
// than assumed: a quoted single hole compiles to an `attr-mixed` part, NOT a
// plain `attr` one, so the quoted cases below exercise the guard in the
// `attr-mixed` piece loop. Neutering the `attr` case leaves them green. The
// plain `attr` guard is pinned by the UNQUOTED cases (`action=${fn}` and the
// array-wrapped one). Worth stating because the obvious reading is backwards,
// and an edit to the wrong branch would look covered.
//
// Each case renders the SAME template with a good value first and only then
// swaps in the bad one, per the note above. That matters twice over: on a fresh
// host a throwing part leaves the container empty, so a "no secret in the DOM"
// assertion would hold with or without the guard; and only a same-template
// re-render patches in place, so only then is there a live form whose surviving
// state is worth asserting.

/**
 * @param {(v: unknown) => unknown} tpl a template taking the value under test
 * @param {unknown} bad the value that must be refused
 * @param {RegExp} messagePattern
 * @param {string} goodRendered what the good value leaves in the DOM
 */
function refusesOnRerender(tpl, bad, messagePattern, goodRendered = '/submit') {
  const host = document.createElement('div');
  render(tpl('/submit'), host);
  const before = host.innerHTML;
  assert.ok(host.querySelector('form'), 'the good value must render a form');
  assert.ok(before.includes(goodRendered), `expected ${goodRendered} in ${before}`);

  assert.throws(() => render(tpl(bad), host), messagePattern);

  assert.ok(host.querySelector('form'), 'the previously rendered form must still be there');
  assert.equal(host.innerHTML, before, 'the refused render must leave the DOM untouched');
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
}

test('client refuses a quoted property hole .action="${fn}"', () => {
  refusesOnRerender((v) => html`<form .action="${v}"></form>`, fakeAction, /function was interpolated into \.action=/);
});

test('client refuses a quoted event hole @action="${fn}"', () => {
  refusesOnRerender((v) => html`<form @action="${v}"></form>`, fakeAction, /function was interpolated into @action=/);
});

test('client refuses a quoted boolean hole ?action="${fn}"', () => {
  // Written directly rather than through the helper: a quoted `?action` is an
  // ordinary attribute, so the good render leaves a literal `?action="/submit"`
  // rather than the `action` the helper checks for. Kept because dropping it
  // would leave this shape with NO client coverage; the SSR machines cover it,
  // but this is a separate renderer.
  const host = document.createElement('div');
  const tpl = (v) => html`<form ?action="${v}"></form>`;
  render(tpl('/submit'), host);
  const before = host.innerHTML;
  assert.ok(host.querySelector('form'), 'the good value must render a form');

  assert.throws(() => render(tpl(fakeAction), host), /function was interpolated into \?action=/);

  assert.equal(host.innerHTML, before, 'the refused render must leave the DOM untouched');
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
});

test('client refuses an array-wrapped function', () => {
  refusesOnRerender((v) => html`<form action=${v}></form>`, [fakeAction], /function was interpolated into action=/);
});

test('client refuses an array-wrapped function inside a mixed hole', () => {
  refusesOnRerender((v) => html`<form action="/x/${v}"></form>`, [fakeAction], /function was interpolated into action=/, '/x//submit');
});

test('client refuses an unquoted boolean hole ?action=${fn}', () => {
  // A boolean binding renders the bare attribute for any truthy value, so the
  // good render leaves `action=""` rather than the value itself.
  refusesOnRerender((v) => html`<form ?action=${v}></form>`, fakeAction, /function was interpolated into action=/, 'action=""');
});

// The carve-outs. An event binding never stringifies its value and a function
// is the legitimate thing to pass one, so refusing it would be a false
// positive.

test('an unquoted @action=${fn} event binding stays legal', () => {
  const host = document.createElement('div');
  render(html`<form @action=${fakeAction}></form>`, host);
  const form = host.querySelector('form');
  assert.ok(form, 'the form still renders');
  assert.ok(!form.hasAttribute('action'), 'an event binding writes no action attribute');
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'and leaks nothing');
});

test('client still renders an array of plain strings', () => {
  const host = document.createElement('div');
  render(html`<form action=${['/a', '/b']}></form>`, host);
  assert.equal(host.querySelector('form').getAttribute('action'), '/a,/b');
});

test('a self-referential array does not crash the render', () => {
  // `Array.prototype.join` has a cycle guard, so `String(cyclic)` is ''. The
  // function check has to match that rather than recurse forever.
  const cyclic = [];
  cyclic.push(cyclic);
  const host = document.createElement('div');
  render(html`<form action=${cyclic}></form>`, host);
  assert.equal(host.querySelector('form').getAttribute('action'), '');
});
