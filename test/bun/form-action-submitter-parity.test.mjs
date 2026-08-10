/**
 * Cross-runtime parity test for per-submitter `formaction=${action}` (#1207),
 * and for the submission attributes a bound submitter carries itself (#1307).
 *
 * SSR is runtime-sensitive, so the emission has to be proven on Bun as well as
 * Node: the whole point of #1307 is that the button ships `formmethod="post"`
 * and an enctype in the served HTML, and a runtime that emitted one and not the
 * other would produce a form that silently posts nowhere with JS off.
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
  assert.match(
    out,
    /<button name="__webjs_action" value="hash\/deleteAction" formmethod="post" formenctype="multipart\/form-data">Delete<\/button>/,
  );
});

test('SSR: a bound submitter is self-sufficient on this runtime (#1307)', async () => {
  // The headline of #1307, asserted cross-runtime: a form that binds nothing and
  // declares no method, whose button still submits a POST the action can read.
  // This threw before the change, on both runtimes.
  for (const tpl of [
    html`<form><button formaction=${deleteAction}>Delete</button></form>`,
    html`<button formaction=${deleteAction}>Delete</button>`,
    html`<form method="get"><button formaction=${deleteAction}>Delete</button></form>`,
  ]) {
    const out = await renderToString(tpl, { ssr: true });
    assert.match(out, /name="__webjs_action" value="hash\/deleteAction"/);
    assert.match(out, /formmethod="post"/, 'the button supplies its own method');
    assert.match(out, /formenctype="multipart\/form-data"/, 'and its own enctype');
  }
});

test('SSR: a bound submitter contradicting its own binding refuses on this runtime', async () => {
  for (const [tpl, expected] of [
    [html`<button formaction=${deleteAction} formmethod="get">D</button>`, /formmethod=/],
    [html`<button formaction=${deleteAction} formenctype="text/plain">D</button>`, /formenctype=/],
    [html`<button formaction=${deleteAction} formmethod="dialog">D</button>`, /dialog/],
  ]) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), expected);
  }
});

test("SSR: a PLAIN submitter's own override is left alone on this runtime", async () => {
  // #1307 reverses #1207's Part B, and the reversal has to be identical on both
  // runtimes or the same markup would refuse on one and render on the other.
  const out = await renderToString(
    html`<form action=${saveAction}><button formmethod="get">Search</button></form>`,
    { ssr: true },
  );
  assert.match(out, /formmethod="get"/);
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
test('SSR: a BOUND submitter\'s own contradictions refuse on both runtimes', async () => {
  // Was "Part B refuses ...". #1307 scoped every row here to a submitter that
  // BINDS: the author attached an action to this button and then told this same
  // button to submit in a way that action could never read. The rows about a
  // PLAIN button's override moved to the carve-out test below, because native
  // HTML defines that outcome and the renderer now honours it.
  const refused = [
    ['bound formenctype', html`<button formaction=${deleteAction} formenctype="text/plain">Save</button>`],
    ['bound formmethod', html`<button formaction=${deleteAction} formmethod="get">Save</button>`],
    ['bound padded formmethod', html`<button formaction=${deleteAction} formmethod=" post ">Save</button>`],
    ['bound plus dialog', html`<form action=${saveAction}><button formmethod="dialog" formaction=${deleteAction}>x</button></form>`],
  ];
  for (const [label, tpl] of refused) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), /formenctype=|formmethod=|dialog/, label);
  }
});

test("SSR: a PLAIN submitter's overrides render untouched on both runtimes", async () => {
  // Every row here refused before #1307. The reversal has to be identical on
  // Node and Bun, or the same markup would refuse on one runtime and render on
  // the other, which is the precise class of bug this file exists to catch.
  const allowed = [
    ['plain formenctype', html`<form action=${saveAction}><button formenctype="text/plain">Save</button></form>`, /formenctype="text\/plain"/],
    ['plain formmethod', html`<form action=${saveAction}><button formmethod="get">Save</button></form>`, /formmethod="get"/],
    ['submit input', html`<form action=${saveAction}><input type="submit" formenctype="text/plain">`, /formenctype="text\/plain"/],
    ['nested template', html`<form action=${saveAction}>${html`<button formmethod="get">Save</button>`}</form>`, /formmethod="get"/],
  ];
  for (const [label, tpl, expected] of allowed) {
    const out = await renderToString(tpl, { ssr: true });
    assert.match(out, expected, label);
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
