/**
 * Cross-runtime parity test for per-submitter `formaction=${action}` (#1207).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, html, setFormActionResolver } from '@webjsdev/core';

setFormActionResolver(async (fn) => {
  return fn.name ? `hash/${fn.name}` : null;
});

async function saveAction() {}
async function deleteAction() {}

test('SSR: formaction=${fn} on submitter inside bound form emits submitter name=__webjs_action', async () => {
  const tpl = html`
    <form action=${saveAction}>
      <button formaction=${deleteAction}>Delete</button>
    </form>
  `;
  const out = await renderToString(tpl, { ssr: true });
  assert.match(out, /<input type="hidden" name="__webjs_action" value="hash\/saveAction">/);
  assert.match(out, /<button name="__webjs_action" value="hash\/deleteAction">Delete<\/button>/);
});

test('SSR: formaction=${fn} on unbound button throws actionable refusal', async () => {
  const tpl = html`<button formaction=${deleteAction}>Delete</button>`;
  await assert.rejects(
    () => renderToString(tpl, { ssr: true }),
    /requires the enclosing <form> to also be bound/,
  );
});

test('SSR: formaction=${fn} on submitter with name attribute throws refusal', async () => {
  const tpl = html`
    <form action=${saveAction}>
      <button name="intent" formaction=${deleteAction}>Delete</button>
    </form>
  `;
  await assert.rejects(
    () => renderToString(tpl, { ssr: true }),
    /already carries a "name" attribute/,
  );
});

test('SSR: submitter guards stay identical for Bun and Node', async () => {
  const refused = [
    ['text input', html`<form action=${saveAction}><input type="text" formaction=${deleteAction}></form>`],
    ['hidden input', html`<form action=${saveAction}><input type="hidden" formaction=${deleteAction}></form>`],
    ['image input', html`<form action=${saveAction}><input type="IMAGE" formaction=${deleteAction}></form>`],
    ['button input', html`<form action=${saveAction}><button type="button" formaction=${deleteAction}>Delete</button></form>`],
    ['value attribute', html`<form action=${saveAction}><button value="delete" formaction=${deleteAction}>Delete</button></form>`],
    ['static formaction', html`<form action=${saveAction}><button formaction="/legacy" formaction=${deleteAction}>Delete</button></form>`],
    ['form attribute', html`<form action=${saveAction}><button form="other" formaction=${deleteAction}>Delete</button></form>`],
  ];
  for (const [label, tpl] of refused) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), /submitter|value|formaction|form.*attribute/, label);
  }
});

test('SSR: nested submitter templates keep the enclosing form binding', async () => {
  const buttons = () => html`<button formaction=${deleteAction}>Delete</button>`;
  const out = await renderToString(html`<form action=${saveAction}>${buttons()}</form>`, { ssr: true });
  assert.match(out, /name="__webjs_action" value="hash\/deleteAction"/);
});
