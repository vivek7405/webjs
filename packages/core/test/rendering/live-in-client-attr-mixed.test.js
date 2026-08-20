// #1443, client half: the attr-mixed commit must unwrap live() PER PIECE.
//
// applyPart's top-of-function unwrap only sees the anchor hole's own value,
// while the attr-mixed branch reads every group piece raw from `allValues`.
// Every hole inside a QUOTED attribute is classified attr-mixed by the client
// compiler (single-hole included), so without the per-piece unwrap a
// `title="${live(v)}"` the server now emits correctly is rewritten to the
// wrapper's stringification by the first client commit: correct served bytes,
// corrupted a moment after upgrade, the same divergence class as the server
// half of #1443. The reconciler's effectiveFormAttr already unwraps each
// group piece, so this pins the commit path to the model the reconcile
// already judges by.
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

let html, render, live;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ live } = await import('../../src/directives.js'));
});

test('a quoted single-hole attribute unwraps live() on the client (#1443)', () => {
  const el = document.createElement('div');
  render(html`<i title="${live('hi')}"></i>`, el);
  assert.equal(el.querySelector('i').getAttribute('title'), 'hi');
});

test('every piece of a mixed attribute unwraps live() on the client (#1443)', () => {
  const el = document.createElement('div');
  render(html`<i class="a ${live('b')} c ${live('d')}"></i>`, el);
  assert.equal(el.querySelector('i').getAttribute('class'), 'a b c d');
});

test('a re-render through the mixedAnchor path alone unwraps every piece (#1443)', () => {
  // Isolates the #845 mixedAnchor re-apply. The ANCHOR piece is a plain
  // constant that never changes, so `Object.is` skips its hole and the ONLY
  // reason the attribute is rebuilt is the later live() hole, whose bound part
  // is a noop pointing back at the anchor. A fix applied to the first-render
  // path alone would leave this stale.
  //
  // Deliberately not `live()` in both slots: that makes the anchor hole differ
  // on every render, so the attribute rebuilds at i=0 and the noop path is
  // never the thing under test.
  const el = document.createElement('div');
  const tpl = (b) => html`<i class="s ${'fixed'} ${live(b)}"></i>`;
  render(tpl('y'), el);
  assert.equal(el.querySelector('i').getAttribute('class'), 's fixed y', 'first render resolves');
  render(tpl('z'), el);
  assert.equal(
    el.querySelector('i').getAttribute('class'),
    's fixed z',
    'the mixedAnchor rebuild read the NEW inner value, unwrapped',
  );
});

test('mixed live() and plain pieces coexist (#1443)', () => {
  const el = document.createElement('div');
  render(html`<i class="a ${live('b')} ${'c'}"></i>`, el);
  assert.equal(el.querySelector('i').getAttribute('class'), 'a b c');
});
