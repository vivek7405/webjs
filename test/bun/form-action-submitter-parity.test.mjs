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
    ['text input', html`<form action=${saveAction}><input type="text" formaction=${deleteAction}></form>`, /requires a submitter control/],
    ['hidden input', html`<form action=${saveAction}><input type="hidden" formaction=${deleteAction}></form>`, /requires a submitter control/],
    ['image input', html`<form action=${saveAction}><input type="IMAGE" formaction=${deleteAction}></form>`, /coordinate pairs/],
    ['submit input', html`<form action=${saveAction}><input type="submit" formaction=${deleteAction}></form>`, /also its visible label/],
    ['button input', html`<form action=${saveAction}><button type="button" formaction=${deleteAction}>Delete</button></form>`, /requires a submitter control/],
    ['value attribute', html`<form action=${saveAction}><button value="delete" formaction=${deleteAction}>Delete</button></form>`, /already carries a "value" attribute/],
    ['static formaction', html`<form action=${saveAction}><button formaction="/legacy" formaction=${deleteAction}>Delete</button></form>`, /cannot also carry a plain formaction attribute/],
    ['form attribute', html`<form action=${saveAction}><button form="other" formaction=${deleteAction}>Delete</button></form>`, /cannot be used with a "form" attribute/],
  ];
  // Each row asserts its OWN message: a shared alternation matches every
  // message in the module and would only prove that something threw.
  for (const [label, tpl, expected] of refused) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), expected, label);
  }
});

test('SSR: nested submitter templates keep the enclosing form binding', async () => {
  const buttons = () => html`<button formaction=${deleteAction}>Delete</button>`;
  const out = await renderToString(html`<form action=${saveAction}>${buttons()}</form>`, { ssr: true });
  assert.match(out, /name="__webjs_action" value="hash\/deleteAction"/);
});

// #1207 Part B, cross-runtime. The renderers are byte-identical on Node and
// Bun, so the refusals have to be too: a submitter guard that fires on one
// runtime and not the other would ship a page that works in dev and 405s in
// production, which is the same works-one-way-only failure Part B exists to
// close.
test('SSR: Part B refuses an unparseable submitter enctype on both runtimes', async () => {
  const refused = [
    ['plain formenctype', html`<form action=${saveAction}><button formenctype="text/plain">Save</button></form>`],
    ['plain formmethod', html`<form action=${saveAction}><button formmethod="get">Save</button></form>`],
    ['padded formmethod', html`<form action=${saveAction}><button formmethod=" post ">Save</button></form>`],
    ['submit input', html`<form action=${saveAction}><input type="submit" formenctype="text/plain"></form>`],
    ['nested template', html`<form action=${saveAction}>${html`<button formmethod="get">Save</button>`}</form>`],
    ['bound plus dialog', html`<form action=${saveAction}><button formmethod="dialog" formaction=${deleteAction}>x</button></form>`],
  ];
  for (const [label, tpl] of refused) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), /formenctype=|formmethod=|dialog/, label);
  }
});

test('SSR: Part B carve-outs render on both runtimes', async () => {
  const allowed = [
    ['dialog dismissal', html`<form action=${saveAction}><button formmethod="dialog">Close</button></form>`, /formmethod="dialog"/],
    ['retargeted submitter', html`<form action=${saveAction}><button formmethod="get" formaction="/search">Go</button></form>`, /formaction="\/search"/],
    ['non-submitter control', html`<form action=${saveAction}><input type="text" name="q" formenctype="text/plain"></form>`, /name="q"/],
    ['outside a bound form', html`<form method="post"><button formenctype="text/plain">Save</button></form>`, /formenctype="text\/plain"/],
    ['parseable enctype', html`<form action=${saveAction}><button formenctype="multipart/form-data">Save</button></form>`, /formenctype="multipart\/form-data"/],
  ];
  for (const [label, tpl, re] of allowed) {
    assert.match(await renderToString(tpl, { ssr: true }), re, label);
  }
});
