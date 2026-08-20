// #1154, client half: the browser renderer refuses the same commit, so a
// client re-render can never write a function's source into the live DOM.
// Runs under linkedom.
//
// Four `applyPart` clauses guard this, and the tests below pin all four.
// Established by neutering each one separately, not by reading, because which
// clause a given hole shape reaches is not what it looks like:
//
//   'attr'       unquoted `action=${fn}`, including an array-wrapped value
//   'attr-mixed' EVERY quoted single hole (`action="${fn}"`, `.action="${fn}"`,
//                `?action="${fn}"`, `@action="${fn}"`) plus a true mixed value
//   'prop'       unquoted `.action=${fn}` on an element that REFLECTS it
//                (a form, or `.formAction` on a button/input); elsewhere the
//                property is an expando and is deliberately left alone
//   'bool'       unquoted `?action=${fn}`
//
// The second row is the counter-intuitive one: quoting a hole does not keep it
// in the 'attr' case, it moves it to 'attr-mixed'.
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

// #1155 made ONE shape here meaningful rather than merely refused: an unquoted
// `action=${fn}` on a `<form>` binds the action. It still stringifies nothing,
// so every leak claim below is unchanged, but for a function the browser stub
// never stamped, which is every function in this file, the refusal it hits is
// the identity one.
const NOT_AN_ACTION = /is not a server action/;

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
    NOT_AN_ACTION,
  );
});

test('client render of mixed action="/x/${fn}" throws', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action="/x/${fakeAction}"></form>`, host),
    /function was interpolated into action=/,
  );
});

// Case folding on the client half too. Pinned here as well as on the SSR
// machines because the client renderer reaches isFormActionAttr through its own
// four clauses, and a normalization that only the SSR tests covered would leave
// a client re-render free to write the source into a live DOM.
test('client render of camelCase formAction=${fn} throws', () => {
  // Pinned to ONE reason. `fakeAction` carries no identity, so the client enters
  // the binding path (attribute names fold case, so `formAction` binds like
  // `formaction`) and refuses at the identity check, which runs before the
  // enclosing-form question. Accepting either message would let this pass with
  // the case folding it exists to cover removed, since a `formAction` treated
  // as a plain attribute refuses for a different reason entirely.
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<button type="submit" formAction=${fakeAction}></button>`, host),
    /is not a server action/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'no source in the live DOM');
});

test('client re-render swapping in an upper-case ACTION=${fn} throws, live DOM stays clean', () => {
  const host = document.createElement('div');
  const tpl = (a) => html`<form method="post" ACTION=${a}></form>`;
  render(tpl('/ok'), host);
  assert.throws(() => render(tpl(fakeAction), host), NOT_AN_ACTION);
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
});

// Re-render over an ALREADY-MOUNTED form. Here the host really does hold a live
// element, so if the guard let the value through, the source would be sitting
// in the DOM and this would catch it.
test('re-render swapping a string action for a function throws, live DOM stays clean', () => {
  const host = document.createElement('div');
  const tpl = (a) => html`<form method="post" action=${a}></form>`;
  render(tpl('/ok'), host);
  assert.equal(host.querySelector('form').getAttribute('action'), '/ok');
  assert.throws(() => render(tpl(fakeAction), host), NOT_AN_ACTION);
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'live DOM must not carry the source');
  assert.equal(host.querySelector('form').getAttribute('action'), '/ok',
    'the prior value must survive: identity is checked before the attribute is touched');
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

// The reflection boundary on the client, where the property assignment is real
// rather than dropped. `.action` reflects on <form>, `.formAction` on
// <button>/<input>; everywhere else it is an expando that writes no markup.
test('client .formAction=${fn} throws on a button, where it reflects', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<button .formAction=${fakeAction}></button>`, host),
    /function was interpolated into formaction=/,
  );
});

test('client .action=${fn} on a non-reflecting native element is left alone', () => {
  const host = document.createElement('div');
  render(html`<div .action=${fakeAction}>hi</div>`, host);
  const el = host.querySelector('div');
  assert.equal(typeof el.action, 'function', 'the expando is set, as it always was');
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'and nothing reaches the markup');
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
// The file header's clause map is keyed by hole SHAPE, and every test below
// names its shape, so read the clause off that map. There is deliberately no
// per-section restatement of it here: an aggregate summary is a second copy
// that drifts from the first, and both times this section tried to carry one it
// ended up wrong (miscounting the quoted cases, and attributing 'attr' to a
// test that pins 'attr-mixed', since two tests here are array-wrapped and they
// land in different clauses).
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
  // Quoting moves this into 'attr-mixed' like the other quoted holes, so the
  // good value renders as a literal `?action="/submit"` and the helper's
  // default check fits. (Only the UNQUOTED bool below needs an override, since
  // a boolean binding drops the value and writes a bare `action=""`.)
  refusesOnRerender((v) => html`<form ?action="${v}"></form>`, fakeAction, /function was interpolated into \?action=/);
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
  const cyclicProbe = [];
  cyclicProbe.push(cyclicProbe);
  // SKIPPED where the engine's own cycle guard is broken. Bun 1.4.0 regressed
  // `Array.prototype.join`'s, so `String(a)` throws RangeError for
  // `const a = []; a.push(a)` with no framework involved (node and Bun 1.3.14
  // both return ''). Keyed to the BEHAVIOUR, not a version, so this returns
  // automatically once the engine is fixed. See test/bun/form-action-guard.mjs
  // for the full note on why this is scoped rather than worked around.
  let engineJoinsCycles = true;
  try { String(cyclicProbe); } catch { engineJoinsCycles = false; }
  if (!engineJoinsCycles) return;
  const cyclic = cyclicProbe;
  const host = document.createElement('div');
  render(html`<form action=${cyclic}></form>`, host);
  assert.equal(host.querySelector('form').getAttribute('action'), '');
});

test('the client keeps the same scope boundary for unclaimed attributes', () => {
  // The boundary belongs on EVERY renderer. Pinning it on the buffered SSR path
  // alone left the widening it guards against invisible here: dropping function
  // values in every attribute in `applyPart` kept the whole suite green.
  const host = document.createElement('div');
  render(html`<div title=${fakeAction}></div>`, host);
  const title = host.querySelector('div').getAttribute('title');
  assert.match(title, /CLIENT_SECRET/, 'an unclaimed attribute still stringifies the function');

  // Same for the mixed path, which is a separate commit site.
  const host2 = document.createElement('div');
  render(html`<div title="x/${fakeAction}"></div>`, host2);
  assert.match(host2.querySelector('div').getAttribute('title'), /CLIENT_SECRET/, 'and on the mixed path');
});
