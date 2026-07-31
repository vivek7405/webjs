// #1155, client half: a shipping component re-renders its whole template on
// hydration, so the client renderer has to reproduce what SSR emitted for
// `<form action=${action}>`. If it did not, the SSR'd hidden field would be
// replaced by an `action` attribute holding a stringified function and the form
// would post to a garbage url.
//
// The identity comes off the function itself here, not from a resolver: the
// browser import of a `'use server'` module is the generated RPC stub, and the
// stub stamps its own `<hash>/<fn>`. Runs under linkedom.
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

let html, render, FORM_ACTION_ID_KEY;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ FORM_ACTION_ID_KEY } = await import('../../src/form-action.js'));
});

/**
 * A stand-in for the generated RPC stub, stamped the way the stub stamps
 * itself. Called from inside a test, never at module scope: the key comes from
 * the dynamic import in `before`, so a stub built at module-evaluation time
 * would be stamped under `undefined` and never resolve.
 */
function stub(id) {
  const fn = async () => { const S = 'CLIENT_SECRET'; return S; };
  Object.defineProperty(fn, FORM_ACTION_ID_KEY, { value: id });
  return fn;
}

const ID = 'a1b2c3d4e5/submitFeedback';

test('a bound action produces the hidden field and forces the submit attributes', () => {
  const host = document.createElement('div');
  render(html`<form action=${stub(ID)}><input name="email"></form>`, host);

  const form = host.querySelector('form');
  assert.equal(form.hasAttribute('action'), false, 'the form posts to its own url');
  assert.equal(form.getAttribute('method'), 'post');
  assert.equal(form.getAttribute('enctype'), 'multipart/form-data');
  const field = form.querySelector('input[name="__webjs_action"]');
  assert.ok(field, 'the identity field exists');
  assert.equal(field.getAttribute('value'), ID);
  assert.equal(field.getAttribute('type'), 'hidden');
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'), 'no source in the live DOM');
});

test('the identity field is the first child, ahead of the template content', () => {
  // A child part re-render replaces the nodes between its own markers. Inserted
  // in front of them, the field is out of that range for good; appended, a
  // later update could take it out and the form would silently stop working.
  const host = document.createElement('div');
  render(html`<form action=${stub(ID)}><input name="email"></form>`, host);
  const form = host.querySelector('form');
  assert.equal(form.firstElementChild.getAttribute('name'), '__webjs_action');
});

test('a re-render does not accumulate identity fields', () => {
  const host = document.createElement('div');
  const tpl = (a, v) => html`<form action=${a}><input name="email" value=${v}></form>`;
  render(tpl(stub(ID), 'one'), host);
  render(tpl(stub(ID), 'two'), host);
  const form = host.querySelector('form');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1);
  assert.equal(form.querySelector('input[name="email"]').getAttribute('value'), 'two');
});

test('a re-render that swaps the bound action updates the field in place', () => {
  const host = document.createElement('div');
  const tpl = (a) => html`<form action=${a}></form>`;
  render(tpl(stub(ID)), host);
  render(tpl(stub('ffff000011/other')), host);
  const fields = host.querySelectorAll('input[name="__webjs_action"]');
  assert.equal(fields.length, 1);
  assert.equal(fields[0].getAttribute('value'), 'ffff000011/other');
});

test('the identity field survives a child update', () => {
  const host = document.createElement('div');
  const tpl = (rows) => html`<form action=${stub(ID)}>${rows.map((r) => html`<p>${r}</p>`)}</form>`;
  render(tpl(['a']), host);
  render(tpl(['a', 'b', 'c']), host);
  const form = host.querySelector('form');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1);
  assert.equal(form.querySelectorAll('p').length, 3);
});

test("an author's method and enctype are left alone", () => {
  const host = document.createElement('div');
  render(html`<form method="POST" enctype="application/x-www-form-urlencoded" action=${stub(ID)}></form>`, host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('method'), 'POST');
  assert.equal(form.getAttribute('enctype'), 'application/x-www-form-urlencoded');
});

test('a method the action cannot use is refused, matching SSR', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form method="get" action=${stub(ID)}></form>`, host),
    /cannot work/,
  );
});

test('an enctype the server cannot parse is refused, matching SSR', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form enctype="text/plain" action=${stub(ID)}></form>`, host),
    /cannot work/,
  );
});

test('a function with no identity is refused, never rendered as an inert form', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action=${async () => {}}></form>`, host),
    /is not a server action/,
  );
});
