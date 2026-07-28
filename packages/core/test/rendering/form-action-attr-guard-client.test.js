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

test('client render of action=${fn} throws, DOM never carries the source', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form method="post" action=${fakeAction}></form>`, host),
    /function was interpolated into action=/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'));
});

test('client render of mixed action="/x/${fn}" throws', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action="/x/${fakeAction}"></form>`, host),
    /function was interpolated into action=/,
  );
  assert.ok(!host.innerHTML.includes('CLIENT_SECRET'));
});

test('string action still renders on the client', () => {
  const host = document.createElement('div');
  render(html`<form method="post" action=${'/submit'}></form>`, host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('action'), '/submit');
});
