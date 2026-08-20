// #1443, client CHILD positions: live() must resolve wherever the server
// resolves it, not only in the hole's own value.
//
// applyPart unwraps live() once, at the top, for the hole's OWN value. The
// server instead RECURSES through isLive inside render() / streamRender(), so
// it resolves a live() nested one level down. That gap is the same divergence
// class as the attribute half of #1443, and it bites in two shapes:
//
//   ${[live('a'), 'b']}          an ARRAY item (each item is consumed by its
//                                own path: fresh build, in-place reconcile,
//                                or the streamed/detached renderer)
//   ${keyed(1, live('x'))}       a directive WRAPPING a live(), which the
//                                client re-enters applyChildInnerRaw with
//
// Both were served correct and corrupted to "[object Object]" on upgrade.
//
// NOT covered here, deliberately: a live() inside a NESTED array
// (`${[[live('a')]]}`). The client stringifies a nested array rather than
// recursing, so a nested TemplateResult renders "[object Object]" too. That is
// a pre-existing client gap independent of live(), and papering over it for
// this one directive would leave an inconsistent surface.
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

let html, render, renderToString, live, keyed, cache, guard, asyncAppend;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ renderToString } = await import('../../src/render-server.js'));
  ({ live, keyed, cache, guard, asyncAppend } = await import('../../src/directives.js'));
});

/**
 * Render the SAME template through the server and a fresh client render and
 * assert the text agrees. Parity is the real contract, so asserting it directly
 * beats asserting a literal on one side: if the server's own handling ever
 * changes, this fails rather than silently blessing a new divergence.
 */
async function assertParity(mk, label) {
  const el = document.createElement('div');
  render(mk(), el);
  const clientText = el.querySelector('i').textContent;
  const serverText = (await renderToString(mk())).trim().replace(/^<i>|<\/i>$/g, '');
  assert.equal(clientText, serverText, `${label}: client must render what the server rendered`);
  assert.ok(!/object Object/.test(clientText), `${label}: no wrapper reached the DOM, got ${clientText}`);
}

test('a live() ARRAY item resolves on the client, matching the server (#1443)', async () => {
  await assertParity(() => html`<i>${[live('a'), 'b']}</i>`, 'array item');
});

test('every item of an all-live() array resolves on the client (#1443)', async () => {
  await assertParity(() => html`<i>${[live('a'), live('b'), live('c')]}</i>`, 'all-live array');
});

test('an in-place array re-render writes the new inner value (#1443)', async () => {
  // The positional reconcile path, distinct from the fresh build: the array
  // keeps its shape, so each item is updated in place rather than rebuilt. A
  // fix applied only to the fresh-build path would leave this one stale.
  const el = document.createElement('div');
  const tpl = (v) => html`<i>${['s', live(v)]}</i>`;
  render(tpl('x'), el);
  assert.equal(el.querySelector('i').textContent, 'sx', 'first render resolves');
  render(tpl('z'), el);
  assert.equal(el.querySelector('i').textContent, 'sz', 're-render resolves the NEW inner value');
});

test('a directive wrapping a live() resolves on the client (#1443)', async () => {
  // keyed / cache / guard each re-enter the child commit with their inner
  // value, which the server resolves by recursion. Without the matching
  // client-side recursion all three render the wrapper.
  await assertParity(() => html`<i>${keyed(1, live('x'))}</i>`, 'keyed(live)');
  await assertParity(() => html`<i>${cache(live('y'))}</i>`, 'cache(live)');
  await assertParity(() => html`<i>${guard([1], () => live('z'))}</i>`, 'guard(live)');
});

test('a streamed live() chunk resolves on the client (#1443)', async () => {
  // The fourth consumer of a child value, distinct from the three above: the
  // streamed / detached renderer builds nodes directly rather than going
  // through the array item paths. Asserted against the client only, since
  // asyncAppend renders nothing at SSR (its content arrives after the first
  // paint by design), so there is no server output to compare with.
  async function* gen() { yield live('a'); yield 'b'; }
  const el = document.createElement('div');
  render(html`<i>${asyncAppend(gen())}</i>`, el);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(
    el.querySelector('i').textContent,
    'ab',
    'a live() yielded into a stream must resolve, not stringify its wrapper',
  );
});
