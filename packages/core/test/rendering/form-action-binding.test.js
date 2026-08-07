// #1155: `<form action=${importedAction}>` is the ONE way to submit a form to
// a server action. Both SSR machines resolve the action's identity, drop the
// `action` attribute so the form posts to the page's own url, force the
// attributes the submission needs, and emit the hidden identity field the
// server dispatches on.
//
// What these tests pin, in order of how much it would cost to get wrong:
//   - the function's source never appears, on any path (it is still #1154's
//     claim; binding changed how the value is USED, not whether it stringifies)
//   - the hidden field lands INSIDE the form, because a field emitted after
//     the close tag is not submitted and the form would silently post nothing
//   - `method="post"` is forced from the attributes the browser will actually
//     see, not from the ones the template literal spelled out
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let html, renderToString, renderToStream, setFormActionResolver, FORM_ACTION_FIELD, FORM_ACTION_ID_KEY;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ renderToString, renderToStream } = await import('../../src/render-server.js'));
  ({ setFormActionResolver, FORM_ACTION_FIELD, FORM_ACTION_ID_KEY } = await import('../../src/form-action.js'));
});

// The marker is INLINE in the body, not read from an outer const: `String(fn)`
// reproduces source, so a body reading an outer binding stringifies to the
// IDENTIFIER and a /SECRET/ assertion against it is a tautology.
async function submitFeedback(formData) {
  const conn = 'postgres://user:SECRET_MARKER@host/db';
  return { success: true, conn, got: formData };
}

const ID = 'a1b2c3d4e5/submitFeedback';

/** Install a resolver that identifies only `submitFeedback`. */
function withResolver() {
  setFormActionResolver((fn) => (fn === submitFeedback ? ID : null));
}

async function drain(stream) {
  let out = '';
  for await (const c of stream) out += typeof c === 'string' ? c : new TextDecoder().decode(c);
  return out;
}

test('a bound action emits a hidden identity field and no action attribute', async () => {
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><input name="email"></form>`, { ssr: true });
  assert.doesNotMatch(out, /SECRET/, 'the action source must never reach the markup');
  assert.doesNotMatch(out, /\saction=/, 'the attribute is omitted, so the form posts to its own url');
  assert.match(out, new RegExp(`<input type="hidden" name="${FORM_ACTION_FIELD}" value="${ID}">`));
});

test('the hidden field is inside the form, not after it', async () => {
  // A field emitted after `</form>` is not part of the submission, so the
  // server would see no identity and the form would do nothing. Asserting the
  // field merely EXISTS somewhere in the output cannot tell those apart.
  withResolver();
  const out = await renderToString(html`<form action=${submitFeedback}>body</form>`, { ssr: true });
  const field = out.indexOf(FORM_ACTION_FIELD);
  const close = out.indexOf('</form>');
  assert.ok(field > 0 && close > 0, 'both markers present');
  assert.ok(field < close, `hidden field must precede </form>, got field@${field} close@${close}`);
});

test('method and enctype are forced when the author omits them', async () => {
  withResolver();
  const out = await renderToString(html`<form action=${submitFeedback}></form>`, { ssr: true });
  assert.match(out, /method="post"/);
  assert.match(out, /enctype="multipart\/form-data"/);
});

test('an author-written method and enctype are left alone', async () => {
  withResolver();
  const out = await renderToString(
    html`<form method="POST" enctype="application/x-www-form-urlencoded" action=${submitFeedback}></form>`,
    { ssr: true });
  assert.match(out, /method="POST"/);
  assert.match(out, /enctype="application\/x-www-form-urlencoded"/);
  assert.doesNotMatch(out, /multipart/, 'the author enctype wins, nothing is appended');
});

test('an attribute written AFTER the action hole still counts as present', async () => {
  // The forcing decision cannot be made at the hole, because the author may
  // spell `method` later in the same tag. Made there, this would emit two
  // `method` attributes and the browser would keep the first (`post`), so the
  // form would work and the bug would sit invisible until someone wrote
  // `method="get"` after the hole.
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback} enctype="application/x-www-form-urlencoded"></form>`, { ssr: true });
  assert.equal(out.match(/enctype=/g).length, 1, 'exactly one enctype attribute');
  assert.match(out, /enctype="application\/x-www-form-urlencoded"/);
});

test('a method= inside an unrelated attribute VALUE does not count as present', async () => {
  // The attribute scan is a tokenizer, not a regex over the tag text. A regex
  // reports a `method` attribute here, skips the forced `method="post"`, and
  // ships a GET form that submits its fields in the query string and never
  // runs the action.
  withResolver();
  const out = await renderToString(
    html`<form data-note="use method=get here" action=${submitFeedback}></form>`, { ssr: true });
  assert.match(out, /method="post"/, 'the real method attribute is still forced');
});

test('an explicit method="get" is refused rather than silently upgraded', async () => {
  withResolver();
  await assert.rejects(
    () => renderToString(html`<form method="get" action=${submitFeedback}></form>`, { ssr: true }),
    /cannot work/,
  );
});

test('a hole-provided method is judged on its resolved value', async () => {
  // `method=${m}` cannot be read off the source template at all, which is the
  // second reason the decision waits for the `>`.
  withResolver();
  await assert.rejects(
    () => renderToString(html`<form method=${'get'} action=${submitFeedback}></form>`, { ssr: true }),
    /cannot work/,
  );
  const ok = await renderToString(
    html`<form method=${'post'} action=${submitFeedback}></form>`, { ssr: true });
  assert.match(ok, /method="post"/);
  assert.equal(ok.match(/method=/g).length, 1);
});

test('an enctype the server cannot parse is refused', async () => {
  // `text/plain` is legal HTML and useless here: the router sends FormData, so
  // the form would work under JS and be a bare 405 without it. That is exactly
  // the works-one-way-only near-miss this module refuses everywhere else.
  withResolver();
  await assert.rejects(
    () => renderToString(html`<form enctype="text/plain" action=${submitFeedback}></form>`, { ssr: true }),
    /cannot work/,
  );
  await assert.rejects(
    () => drain(renderToStream(html`<form enctype="text/plain" action=${submitFeedback}></form>`, { ssr: false })),
    /cannot work/,
  );
});

test('both parseable enctypes stay legal, case-insensitively', async () => {
  // The carve-out: a guard that refused every author enctype would satisfy the
  // assertion above just as well.
  withResolver();
  for (const enc of ['application/x-www-form-urlencoded', 'multipart/form-data', 'MULTIPART/FORM-DATA']) {
    const out = await renderToString(html`<form enctype=${enc} action=${submitFeedback}></form>`, { ssr: true });
    assert.match(out, new RegExp(`enctype="${enc}"`), `${enc} is kept`);
    assert.equal(out.match(/enctype=/g).length, 1, 'and not doubled');
  }
});

test('an unidentifiable function is refused, never rendered as an inert form', async () => {
  withResolver();
  await assert.rejects(
    () => renderToString(html`<form action=${async () => {}}></form>`, { ssr: true }),
    /is not a server action/,
  );
});

test('a function carrying its own identity resolves with no resolver', async () => {
  // This is the browser stub's path: the generated stub stamps its identity on
  // itself, so it needs no server resolver. Pinning it on the server renderer
  // keeps the two identity sources from drifting.
  setFormActionResolver(() => null);
  const stub = async () => {};
  Object.defineProperty(stub, FORM_ACTION_ID_KEY, { value: 'ffff000011/stubbed' });
  const out = await renderToString(html`<form action=${stub}></form>`, { ssr: true });
  assert.match(out, /value="ffff000011\/stubbed"/);
});

test('the identity is attribute-escaped', async () => {
  setFormActionResolver(() => 'a"><script>alert(1)</script>/x');
  const out = await renderToString(html`<form action=${submitFeedback}></form>`, { ssr: true });
  assert.doesNotMatch(out, /<script>/, 'a hostile identity cannot break out of the attribute');
});

test('the streaming renderer binds identically', async () => {
  withResolver();
  const out = await drain(renderToStream(
    html`<form action=${submitFeedback}><input name="email"></form>`, { ssr: false }));
  assert.doesNotMatch(out, /SECRET/);
  assert.doesNotMatch(out, /\saction=/);
  assert.match(out, new RegExp(`<input type="hidden" name="${FORM_ACTION_FIELD}" value="${ID}">`));
  assert.match(out, /method="post"/);
  assert.ok(out.indexOf(FORM_ACTION_FIELD) < out.indexOf('</form>'));
});

test('the streaming renderer refuses method="get" too', async () => {
  withResolver();
  await assert.rejects(
    () => drain(renderToStream(html`<form method="get" action=${submitFeedback}></form>`, { ssr: false })),
    /cannot work/,
  );
});

// --- Shapes the two renderers can never agree on -----------------------------
//
// SSR drops a `.prop` on a native element while the browser applies it for real,
// and `method` / `enctype` / `encoding` are reflected IDL attributes on a form.
// So a bound form carrying one submits differently with JS than without it, and
// no reconciliation can close that. Refusing is the only convergent answer, and
// it is the same argument that already refuses `.action` on a form.

test('a bound form that also binds .method / .enctype / .encoding is refused', async () => {
  withResolver();
  for (const prop of ['method', 'enctype', 'encoding']) {
    const tpl = { method: () => html`<form action=${submitFeedback} .method=${'get'}></form>`,
      enctype: () => html`<form action=${submitFeedback} .enctype=${'text/plain'}></form>`,
      encoding: () => html`<form action=${submitFeedback} .encoding=${'text/plain'}></form>` }[prop];
    await assert.rejects(() => renderToString(tpl(), { ssr: true }), /also binds \./, `.${prop} must be refused`);
    await assert.rejects(() => drain(renderToStream(tpl(), { ssr: false })), /also binds \./, `.${prop}, streaming`);
  }
});

test('the same prop on an UNBOUND form is left alone', async () => {
  // The carve-out. An ordinary form with a url action is not this feature's
  // business, and refusing it would break working code to prevent nothing.
  withResolver();
  const out = await renderToString(html`<form action=${'/search'} .method=${'get'}></form>`, { ssr: true });
  assert.match(out, /action="\/search"/);
});

test('two action holes on one form are refused', async () => {
  // SSR would emit the second as a plain url ALONGSIDE the identity field,
  // which is incoherent, while the client resolves last-wins. Counted by hole
  // rather than by value, so it fires whatever the second one resolves to.
  withResolver();
  for (const tpl of [
    () => html`<form action=${submitFeedback} action=${'/legacy'}></form>`,
    () => html`<form action=${submitFeedback} action=${submitFeedback}></form>`,
  ]) {
    await assert.rejects(() => renderToString(tpl(), { ssr: true }), /two action=/);
    await assert.rejects(() => drain(renderToStream(tpl(), { ssr: false })), /two action=/);
  }
});

test('a refused tag does not poison the NEXT form in the same template', async () => {
  // The per-tag shape state has to reset at every `>`, bound or not, or one
  // form's prop binding would refuse an innocent later form.
  withResolver();
  const out = await renderToString(
    html`<form action=${'/x'} .method=${'get'}></form><form action=${submitFeedback}></form>`,
    { ssr: true });
  assert.match(out, new RegExp(`name="${FORM_ACTION_FIELD}"`), 'the second form still binds');
});

test('binding is scoped to <form> and bound submitters: non-action shapes refuse', async () => {
  withResolver();
  for (const tpl of [
    html`<div action=${submitFeedback}></div>`,
    html`<form action="${submitFeedback}"></form>`,
  ]) {
    let msg = '';
    try { await renderToString(tpl, { ssr: true }); } catch (e) { msg = String(e.message); }
    assert.match(msg, /function was interpolated into/, 'refused as a stringify, not bound');
    assert.doesNotMatch(msg, /SECRET/);
  }
  // A standalone submitter is NOT a non-action shape. Since #1307 it binds and
  // carries its own submission, so it belongs in neither refusal above.
  const standalone = await renderToString(html`<button formaction=${submitFeedback}></button>`, { ssr: true });
  assert.match(standalone, /name="__webjs_action"/);
});

test('formaction=${fn} on submitter inside a bound form emits submitter action identity', async () => {
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><button formaction=${submitFeedback}>Save</button></form>`,
    { ssr: true }
  );
  assert.match(
    out,
    /<button name="__webjs_action" value="[0-9a-f]{10}\/submitFeedback" formmethod="post" formenctype="multipart\/form-data">Save<\/button>/,
  );
});

test('a bound submitter is SELF-SUFFICIENT: it needs nothing from its form (#1307)', async () => {
  withResolver();
  // The shape #1307 was filed about: a form that binds nothing and declares no
  // method. Before this change SSR refused it where it could see the form, and
  // bound it silently where it could not, producing a GET that ran no action.
  const bare = await renderToString(
    html`<form><button formaction=${submitFeedback}>Go</button></form>`, { ssr: true });
  assert.match(bare, /formmethod="post"/, 'the button supplies its own method');
  assert.match(bare, /formenctype="multipart\/form-data"/, 'and its own enctype');
  assert.match(bare, /name="__webjs_action"/);
  // No enclosing form at all, and a form that explicitly declares GET. The
  // button overrides both, exactly as native HTML says a submitter does.
  for (const tpl of [
    html`<button formaction=${submitFeedback}>Go</button>`,
    html`<form method="get"><button formaction=${submitFeedback}>Go</button></form>`,
  ]) {
    const out = await renderToString(tpl, { ssr: true });
    assert.match(out, /formmethod="post"/);
    assert.match(out, /formenctype="multipart\/form-data"/);
  }
  // COUNTERFACTUAL: delete the two injections in `bindSubmitterStartTag` and
  // every assertion above fails, because the button falls back to whatever the
  // enclosing form declares, which here is a GET carrying no body.
});

test('the author\'s own formmethod / formenctype wins; only the missing one is injected', async () => {
  withResolver();
  const ownMethod = await renderToString(
    html`<button formaction=${submitFeedback} formmethod="post">Go</button>`, { ssr: true });
  assert.equal(ownMethod.match(/formmethod=/g).length, 1, 'not duplicated');
  assert.match(ownMethod, /formenctype="multipart\/form-data"/, 'the missing one is still supplied');

  const ownEnctype = await renderToString(
    html`<button formaction=${submitFeedback} formenctype="application/x-www-form-urlencoded">Go</button>`,
    { ssr: true },
  );
  assert.equal(ownEnctype.match(/formenctype=/g).length, 1);
  assert.match(ownEnctype, /formenctype="application\/x-www-form-urlencoded"/, 'the author\'s value survives');
  assert.match(ownEnctype, /formmethod="post"/);
});

test('a bound form nested among siblings does not disturb them', async () => {
  withResolver();
  const out = await renderToString(html`
    <section><p>before</p><form action=${submitFeedback}><input name="a"></form><p>after</p></section>
  `, { ssr: true });
  assert.match(out, /<p>before<\/p>/);
  assert.match(out, /<p>after<\/p>/);
  assert.match(out, /<input name="a">/);
  assert.equal(out.match(new RegExp(FORM_ACTION_FIELD, 'g')).length, 1);
});

test('two bound forms each carry their own field', async () => {
  setFormActionResolver((fn) => (fn === submitFeedback ? ID : 'bbbbbbbbbb/other'));
  const other = async () => {};
  const out = await renderToString(
    html`<form action=${submitFeedback}></form><form action=${other}></form>`, { ssr: true });
  assert.match(out, new RegExp(`value="${ID}"`));
  assert.match(out, /value="bbbbbbbbbb\/other"/);
  assert.equal(out.match(new RegExp(FORM_ACTION_FIELD, 'g')).length, 2);
});

test('a static action="/url" alongside the bound hole is refused', async () => {
  // The hole drops its own `action`; a SECOND, static one survives into the
  // emitted start tag while the client's reconcile removes it. With JS off the
  // browser would post the identity to the written url, with JS on to the page.
  // Refused rather than reconciled, because either renderer "winning" is a form
  // that submits to a different place depending on whether JS ran.
  withResolver();
  for (const tpl of [
    () => html`<form action="/legacy" action=${submitFeedback}></form>`,
    () => html`<form action=${submitFeedback} action="/legacy"></form>`,
  ]) {
    await assert.rejects(() => renderToString(tpl(), { ssr: true }), /plain action="\.\.\." attribute/);
    await assert.rejects(() => drain(renderToStream(tpl(), { ssr: false })), /plain action="\.\.\." attribute/);
  }
});

test('a whitespace-padded method or enctype is refused, not trimmed', async () => {
  // `method` / `enctype` are enumerated attributes: a browser matches them
  // against exact keywords with NO whitespace stripping, so `method=" post "`
  // falls to the invalid-value default and the form submits as a GET with no
  // body. Trimming before the check would accept it and emit it untouched.
  withResolver();
  await assert.rejects(
    () => renderToString(html`<form action=${submitFeedback} method=${' post '}></form>`, { ssr: true }),
    /cannot work/,
  );
  await assert.rejects(
    () => renderToString(
      html`<form action=${submitFeedback} enctype=${' multipart/form-data '}></form>`, { ssr: true }),
    /cannot work/,
  );
  // The unpadded spellings still render, so the guard is about the padding.
  const ok = await renderToString(
    html`<form action=${submitFeedback} method=${'POST'} enctype=${'multipart/form-data'}></form>`,
    { ssr: true });
  assert.match(ok, new RegExp(`value="${ID}"`));
});

test('an encoding= CONTENT attribute is ignored, so enctype is still forced', async () => {
  // `encoding` is a legacy IDL ALIAS: `form.encoding = x` writes the enctype
  // content attribute, but an `encoding=` attribute in markup is inert (a
  // browser's `form.encoding` reads back `enctype`). SSR therefore ignores it,
  // and the client has to ignore it too or the same form would upload multipart
  // without JS and urlencoded with it.
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback} encoding=${'application/x-www-form-urlencoded'}></form>`,
    { ssr: true });
  assert.match(out, /enctype="multipart\/form-data"/, 'the framework enctype is still forced');
  assert.match(out, /encoding="application\/x-www-form-urlencoded"/, 'the inert attribute is left alone');
});

test('formaction=${fn} submitter refusals: name attribute, input type=image, unparseable enctype, and method=get', async () => {
  withResolver();
  // 1. Submitter carrying its own name attribute:
  await assert.rejects(
    () => renderToString(html`<form action=${submitFeedback}><button name="intent" formaction=${submitFeedback}>Save</button></form>`, { ssr: true }),
    /already carries a "name" attribute/,
  );

  // 2. <input type="image">:
  await assert.rejects(
    () => renderToString(html`<form action=${submitFeedback}><input type="image" formaction=${submitFeedback}></form>`, { ssr: true }),
    /is not supported on <input type="image">/,
  );

  // 3. Submitter formenctype="text/plain":
  await assert.rejects(
    () => renderToString(html`<form action=${submitFeedback}><button formaction=${submitFeedback} formenctype="text/plain">Save</button></form>`, { ssr: true }),
    /formenctype="text\/plain"/,
  );

  // 4. Submitter formmethod="get":
  await assert.rejects(
    () => renderToString(html`<form action=${submitFeedback}><button formaction=${submitFeedback} formmethod="get">Save</button></form>`, { ssr: true }),
    /formmethod="get"/,
  );

  // 5. Submitter formmethod="PATCH":
  await assert.rejects(
    () => renderToString(html`<form action=${submitFeedback}><button formaction=${submitFeedback} formmethod="PATCH">Save</button></form>`, { ssr: true }),
    /formmethod="PATCH"/,
  );
});

test('a formaction binding on <input type="submit"> is refused for its label', async () => {
  // `<input type="submit">` IS a submitter, but the identity has to occupy
  // `value`, which on this control is also the visible caption. Binding would
  // render a button captioned with the action id, and the only fix
  // (`value="Publish"`) is the channel the identity needs.
  withResolver();
  await assert.rejects(
    () => renderToString(
      html`<form action=${submitFeedback}><input type="submit" formaction=${submitFeedback}></form>`,
      { ssr: true },
    ),
    /also its visible label/,
  );
  // The label refusal fires FIRST, before any submission attribute is looked
  // at, so a bound `<input type="submit">` reports the label conflict whatever
  // else it carries.
  await assert.rejects(
    () => renderToString(
      html`<form action=${submitFeedback}><input type="submit" formaction=${submitFeedback} formmethod="get"></form>`,
      { ssr: true },
    ),
    /also its visible label/,
  );
  // And a plain labelled one renders untouched.
  const ok = await renderToString(
    html`<form action=${submitFeedback}><input type="submit" value="Save"></form>`,
    { ssr: true },
  );
  assert.match(ok, /<input type="submit" value="Save">/);
});

test('formaction submitters require an actual submit control', async () => {
  withResolver();
  for (const tpl of [
    html`<form action=${submitFeedback}><input type="text" formaction=${submitFeedback}></form>`,
    html`<form action=${submitFeedback}><input type="hidden" formaction=${submitFeedback}></form>`,
    html`<form action=${submitFeedback}><input type="IMAGE" formaction=${submitFeedback}></form>`,
    html`<form action=${submitFeedback}><button type="button" formaction=${submitFeedback}>Save</button></form>`,
    html`<form action=${submitFeedback}><button type="reset" formaction=${submitFeedback}>Save</button></form>`,
  ]) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), /submitter control|type="image"/);
  }
});

test('formaction submitters refuse conflicting author attributes', async () => {
  // Each row asserts the message its OWN guard produces. A shared alternation
  // like /value|formaction|form.*attribute/ matches every message in this
  // module (they all contain the literal `formaction=${action}`), so it
  // degenerates to "an Error was thrown" and a wrong-guard-fired regression
  // would sail through.
  withResolver();
  for (const [tpl, expected] of [
    [html`<form action=${submitFeedback}><button value="delete" formaction=${submitFeedback}>Delete</button></form>`,
      /already carries a "value" attribute/],
    [html`<form action=${submitFeedback}><button formaction=${submitFeedback} value="delete">Delete</button></form>`,
      /already carries a "value" attribute/],
    [html`<form action=${submitFeedback}><button formaction="/legacy" formaction=${submitFeedback}>Delete</button></form>`,
      /cannot also carry a plain formaction attribute/],
    [html`<form action=${submitFeedback}><button formaction=${submitFeedback} formaction="/legacy">Delete</button></form>`,
      /cannot also carry a plain formaction attribute/],
    [html`<form action=${submitFeedback}><button form="other" formaction=${submitFeedback}>Delete</button></form>`,
      /cannot be used with a "form" attribute/],
  ]) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), expected);
  }
});

test('duplicate formaction holes on one submitter are refused', async () => {
  withResolver();
  await assert.rejects(
    () => renderToString(
      html`<form action=${submitFeedback}><button formaction=${submitFeedback} formaction=${submitFeedback}>Delete</button></form>`,
      { ssr: true },
    ),
    /two formaction=/,
  );
});

test('formaction submitters work when rendered by a nested template', async () => {
  withResolver();
  const buttons = () => html`<button formaction=${submitFeedback}>Delete</button>`;
  const out = await renderToString(html`<form action=${submitFeedback}>${buttons()}</form>`, { ssr: true });
  assert.match(out, /<button name="__webjs_action" value="[0-9a-f]{10}\/submitFeedback" formmethod="post" formenctype="multipart\/form-data">Delete<\/button>/);
});

test('two action holes are refused whichever position the bound one is in', async () => {
  // The refusal is by HOLE COUNT once any hole resolves to an action, so a
  // template that writes the url first and the action second refuses too.
  withResolver();
  await assert.rejects(
    () => renderToString(html`<form action=${'/legacy'} action=${submitFeedback}></form>`, { ssr: true }),
    /two action=/,
  );
});

// ---------------------------------------------------------------------------
// #1307 REVERSES #1207's Part B.
//
// Part B refused a `formmethod` / `formenctype` on EVERY submitter inside a
// bound form, binding or not, on the stated grounds that either "works under JS
// (the router posts FormData) and is a bare 405 without it". That reasoning was
// only ever true of `formenctype`. For `formmethod` the router already honours
// the submitter's override with native precedence and promotes a safe-method
// body to the query string, so both paths lose the identity identically and
// there was never a works-one-way-only half to refuse.
//
// The rule now is same-element only: a BOUND submitter's own contradictory
// value refuses, and a PLAIN submitter's override is a legal native
// instruction that renders untouched. The dev-time client guard reports at
// submit time when a submission holds an identity it cannot deliver.
// ---------------------------------------------------------------------------

test('a PLAIN submitter\'s own formenctype inside a bound form renders untouched', async () => {
  // #1207 refused every one of these. Native HTML says the submitter's override
  // wins, the author typed it deliberately, and the form's action simply does
  // not run, which is what the same markup does in any other framework.
  withResolver();
  for (const tpl of [
    html`<form action=${submitFeedback}><button formenctype="text/plain">Save</button></form>`,
    html`<form action=${submitFeedback}><input type="submit" formenctype="text/plain"></form>`,
    html`<form action=${submitFeedback}><button formenctype="TEXT/PLAIN">Save</button></form>`,
  ]) {
    const out = await renderToString(tpl, { ssr: true });
    assert.match(out, /formenctype="(text\/plain|TEXT\/PLAIN)"/, 'left exactly as written');
  }
});

test('a PLAIN submitter\'s own formmethod inside a bound form renders untouched', async () => {
  withResolver();
  for (const tpl of [
    html`<form action=${submitFeedback}><button formmethod="get">Save</button></form>`,
    html`<form action=${submitFeedback}><button formmethod="GET">Save</button></form>`,
    html`<form action=${submitFeedback}><input type="submit" formmethod="get"></form>`,
    html`<form action=${submitFeedback}><button formmethod=" post ">Save</button></form>`,
  ]) {
    const out = await renderToString(tpl, { ssr: true });
    assert.match(out, /formmethod=/, 'left exactly as written');
  }
});

test('a padded formmethod on a BOUND submitter is refused, matching the form-level untrimmed rule', async () => {
  // `formmethod` is an enumerated attribute matched against exact keywords with
  // no whitespace stripping, so `" post "` falls to the invalid-value default
  // and the button submits as a GET. Trimming here would accept it and ship the
  // silently-posts-nowhere submitter the refusal exists to prevent. Scoped to a
  // BOUND submitter now: on a plain one the author owns the consequence.
  withResolver();
  await assert.rejects(
    () => renderToString(
      html`<button formaction=${submitFeedback} formmethod=" post ">Save</button>`,
      { ssr: true },
    ),
    /formmethod=" post "/,
  );
});

test('a BOUND submitter contradicting its own binding is still refused', async () => {
  // The surviving half of Part B, and the whole of the new rule: the author
  // bound an action to THIS button and then told THIS button to submit in a way
  // that action could never read.
  withResolver();
  for (const [tpl, pattern] of [
    [html`<button formaction=${submitFeedback} formmethod="get">x</button>`, /formmethod=/],
    [html`<button formaction=${submitFeedback} formmethod="PATCH">x</button>`, /formmethod=/],
    [html`<button formaction=${submitFeedback} formenctype="text/plain">x</button>`, /formenctype=/],
  ]) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), pattern);
  }
});

test('parseable submitter enctypes stay fully supported', async () => {
  // The rule refuses VALUES that cannot work, never the attribute itself.
  withResolver();
  for (const enc of ['multipart/form-data', 'application/x-www-form-urlencoded']) {
    const out = await renderToString(
      html`<form action=${submitFeedback}><button formaction=${submitFeedback} formenctype="${enc}">Save</button></form>`,
      { ssr: true },
    );
    assert.match(out, new RegExp(`formenctype="${enc.replace(/[/]/g, '\\/')}"`));
  }
});

test('formmethod="dialog" is not a submission and is left alone', async () => {
  // A native <dialog> dismissal, never a submission, so there is no body for
  // the action to miss. Refusing it would break a legal pattern the client
  // router already skips deliberately.
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><button formmethod="dialog">Close</button></form>`,
    { ssr: true },
  );
  assert.match(out, /<button formmethod="dialog">Close<\/button>/);
});

test('formmethod="dialog" on a BOUND submitter is refused as a contradiction', async () => {
  // The carve-out above is about a button that does not bind. One that binds an
  // action and then declares it will never submit is two things that cannot
  // both be true.
  withResolver();
  await assert.rejects(
    () => renderToString(
      html`<form action=${submitFeedback}><button formmethod="dialog" formaction=${submitFeedback}>x</button></form>`,
      { ssr: true },
    ),
    /dialog/,
  );
});

test('a submitter retargeted by a static formaction keeps its own method', async () => {
  // A plain `formaction="/url"` points the submission away from the page's
  // bound action entirely, so a GET there is an ordinary form the author is
  // entitled to write and the bound form says nothing about it.
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><button formmethod="get" formaction="/search">Search</button></form>`,
    { ssr: true },
  );
  assert.match(out, /formaction="\/search"/);
  assert.match(out, /formmethod="get"/);
});

test('formmethod / formenctype on a non-submitting control are inert and untouched', async () => {
  // Inert on anything that is not a submitter, so touching them there would be a
  // false positive on valid markup.
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><input type="text" name="q" formenctype="text/plain"><button type="button" formmethod="get">x</button></form>`,
    { ssr: true },
  );
  assert.match(out, /name="q"/);
});

test('an ordinary hand-written form is not this module\'s business', async () => {
  withResolver();
  const out = await renderToString(
    html`<form method="post"><button formenctype="text/plain">Save</button></form>`,
    { ssr: true },
  );
  assert.match(out, /formenctype="text\/plain"/);
});

test('a plain submitter after a bound form closes is untouched', async () => {
  // There is no enclosing-form scope left to leak (#1307 deleted it), so this
  // pins the absence: a plain button anywhere keeps whatever it was written
  // with, before or after any form.
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><button>Save</button></form><form method="post"><button formmethod="get">Later</button></form>`,
    { ssr: true },
  );
  assert.match(out, /formmethod="get"/);
});

test('a plain submitter arriving through a nested template is untouched too', async () => {
  // Nothing is threaded into nested renders any more, which is the point: the
  // verdict does not depend on how the button reached the page.
  withResolver();
  const row = () => html`<button formenctype="text/plain">Save</button>`;
  const out = await renderToString(html`<form action=${submitFeedback}>${row()}</form>`, { ssr: true });
  assert.match(out, /formenctype="text\/plain"/);
});

test('the streaming machine judges a BOUND submitter identically', async () => {
  // `streamTemplate` is a SEPARATE state machine that inherits nothing, and
  // #1154 already shipped a guard in one machine and not the other once.
  withResolver();
  await assert.rejects(
    () => drain(renderToStream(
      html`<button formaction=${submitFeedback} formenctype="text/plain">Save</button>`,
      { ssr: false },
    )),
    /formenctype=/,
  );
  await assert.rejects(
    () => drain(renderToStream(
      html`<button formaction=${submitFeedback} formmethod="get">Save</button>`,
      { ssr: false },
    )),
    /formmethod=/,
  );
  // And INJECTS identically, which is the half a refusal-only test would miss.
  const bound = await drain(renderToStream(
    html`<form><button formaction=${submitFeedback}>Save</button></form>`, { ssr: false }));
  assert.match(bound, /formmethod="post" formenctype="multipart\/form-data"/);
  const ok = await drain(renderToStream(
    html`<form action=${submitFeedback}><button formmethod="dialog">Close</button></form>`,
    { ssr: false },
  ));
  assert.match(ok, /formmethod="dialog"/);
});

// ---------------------------------------------------------------------------
// Boundness is BEST EFFORT in SSR too, which an earlier version got wrong.
//
// A COMPONENT renders its own template in a separate pass (`injectDSD` walks the
// already-emitted HTML and renders each component), so that pass has no view of
// the host page and cannot see the enclosing `<form>`. Treating that as "no
// form" refused a perfectly good per-row button, and because component SSR
// errors are ISOLATED, production returned 200 with the button silently gone.
//
// So the scan distinguishes cannot-tell from conclusively-none, and only the
// latter refuses.
// ---------------------------------------------------------------------------

test('a submitter rendered by a component inside a bound form binds', async () => {
  withResolver();
  const { WebComponent } = await import('../../src/component.js');
  class RowActions extends WebComponent({}) {
    render() { return html`<button formaction=${submitFeedback}>Delete</button>`; }
  }
  RowActions.register('row-actions-bind');
  const out = await renderToString(
    html`<form action=${submitFeedback}><row-actions-bind></row-actions-bind></form>`,
    { ssr: true, dev: false },
  );
  assert.match(out, /<button name="__webjs_action" value="[0-9a-f]{10}\/submitFeedback" formmethod="post" formenctype="multipart\/form-data">Delete<\/button>/,
    'the component-rendered button carries the identity');
  assert.ok(!out.includes('data-webjs-error'), 'and the component did not fail to render');
});

test('a form-less submitter BINDS now, which is the whole of #1307', async () => {
  // This block used to prove the opposite. SSR distinguished cannot-tell from
  // conclusively-none and refused the latter, because a submitter could not
  // supply `method="post"` for itself. It can now, so every shape below binds.
  withResolver();
  for (const tpl of [
    html`<button formaction=${submitFeedback}>x</button>`,
    html`<form action=${submitFeedback}><button>a</button></form><button formaction=${submitFeedback}>x</button>`,
    html`<form method="post"><button formaction=${submitFeedback}>x</button></form>`,
    html`<form><button formaction=${submitFeedback}>x</button></form>`,
  ]) {
    const out = await renderToString(tpl, { ssr: true });
    assert.match(out, /formmethod="post"/);
    assert.match(out, /formenctype="multipart\/form-data"/);
  }
});

test("a component's own unbound form no longer swallows its submitter", async () => {
  // The #1307 failure in its purest form. A component renders in a SEPARATE SSR
  // pass with no view of the host page, so the old scan seeded 'unknown' and
  // could not judge the enclosing form. Where it thought it COULD judge (the
  // component's own form), it refused, and because a component's SSR error is
  // ISOLATED the button silently vanished from a page that still returned 200.
  //
  // Both halves are fixed by the same change: nothing is judged, so nothing is
  // isolated away.
  withResolver();
  const { WebComponent } = await import('../../src/component.js');
  class OwnUnbound extends WebComponent({}) {
    render() { return html`<form method="post"><button formaction=${submitFeedback}>P</button></form>`; }
  }
  OwnUnbound.register('own-unbound-form');
  const out = await renderToString(
    html`<form action=${submitFeedback}><own-unbound-form></own-unbound-form></form>`,
    { ssr: true, dev: false },
  );
  assert.match(out, /<button name="__webjs_action"/, 'the component\'s submitter bound');
  assert.match(out, /formmethod="post"/);
  assert.ok(!out.includes('data-webjs-error'), 'and nothing was isolated away');
});

test('a component that closes its own form still binds a later submitter', async () => {
  withResolver();
  const { WebComponent } = await import('../../src/component.js');
  class ClosesOwnForm extends WebComponent({}) {
    render() {
      return html`<form action="/search"><input name="q"></form><button formaction=${submitFeedback}>P</button>`;
    }
  }
  ClosesOwnForm.register('closes-own-form');
  const out = await renderToString(
    html`<form action=${submitFeedback}><closes-own-form></closes-own-form></form>`,
    { ssr: true, dev: false },
  );
  assert.match(out, /<button name="__webjs_action" value="[0-9a-f]{10}\/submitFeedback" formmethod="post" formenctype="multipart\/form-data">P<\/button>/);
  assert.ok(!out.includes('data-webjs-error'), 'and the component did not fail to render');
});

// ---------------------------------------------------------------------------
// Suspense (#1207, #1307). The page pipeline in @webjsdev/server drains
// `ctx.pending` ITSELF and re-renders each resolved child through
// `renderToString`, which is a fresh scan with no view of the shell. That used
// to need the enclosing form scope threaded back in, or a bound form's boundary
// content read as form-less, was refused, and the drain's catch turned it into
// an EMPTY boundary on a page that still returned 200.
//
// #1307 removed the need: a bound submitter carries its own submission, so a
// fresh scan with no view of the shell has nothing left to be told.
// ---------------------------------------------------------------------------

async function drainSuspense(tpl) {
  const ctx = { pending: [], nextId: 1, dev: false };
  const shell = await renderToString(tpl, { ssr: true, suspenseCtx: ctx });
  const parts = [];
  for (const p of ctx.pending) {
    const sub = { pending: [], nextId: ctx.nextId, dev: false };
    // Mirrors ssr.js's drain. Nothing about the shell is carried forward, which
    // is exactly what this suite now pins.
    parts.push(await renderToString(await p.promise, { ssr: true, suspenseCtx: sub }));
  }
  return { shell, parts, pending: ctx.pending };
}

test('a submitter inside a bound form\'s Suspense boundary binds', async () => {
  withResolver();
  const { Suspense } = await import('../../src/suspense.js');
  const { shell, parts, pending } = await drainSuspense(html`<form action=${submitFeedback}>${Suspense({
    fallback: html`<p>loading</p>`,
    children: Promise.resolve(html`<button formaction=${submitFeedback}>Publish</button>`),
  })}</form>`);
  assert.match(shell, /<webjs-boundary id="s1"><p>loading<\/p><\/webjs-boundary>/);
  assert.equal(pending[0].formScope, undefined, 'no scope is recorded, because none is needed');
  assert.match(parts[0], /<button name="__webjs_action" value="[0-9a-f]{10}\/submitFeedback" formmethod="post" formenctype="multipart\/form-data">Publish<\/button>/,
    'and the resolved content binds on its own');
});

test('a Suspense boundary outside a bound form binds its submitter too', async () => {
  // This asserted a refusal, as the counterfactual proving the carried scope was
  // not a blanket amnesty. There is no scope and nothing to amnesty: the button
  // is self-sufficient wherever the boundary sits.
  withResolver();
  const { Suspense } = await import('../../src/suspense.js');
  for (const shell of [
    html`<div>${Suspense({ fallback: html`<p>l</p>`, children: Promise.resolve(html`<button formaction=${submitFeedback}>P</button>`) })}</div>`,
    html`<form method="post">${Suspense({ fallback: html`<p>l</p>`, children: Promise.resolve(html`<button formaction=${submitFeedback}>P</button>`) })}</form>`,
  ]) {
    const { parts } = await drainSuspense(shell);
    assert.match(parts[0], /formmethod="post" formenctype="multipart\/form-data"/);
  }
});

// ---------------------------------------------------------------------------
// A `.prop` spelling on a submitter, the twin of the form-level `.method` /
// `.enctype` refusal. `name`, `value`, `formAction`, `formMethod` and
// `formEnctype` are all REFLECTED IDL attributes on a submitter, so a property
// binding is dropped at SSR and written to the attribute in the browser: the
// page renders on the server and throws on hydration.
// ---------------------------------------------------------------------------

test('a reflected .prop on a submitter is refused, in both machines', async () => {
  withResolver();
  // Every row binds its own action (#1307). The rule is same-element: a `.prop`
  // on a button the author bound is refused, because SSR drops it and the
  // browser reflects it, so the SAME button would submit differently with JS
  // than without. On a PLAIN button it is an ordinary native property and is
  // left alone, which is the row below this test.
  const refused = [
    html`<button .name=${'intent'} formaction=${submitFeedback}>x</button>`,
    html`<button .value=${'v'} formaction=${submitFeedback}>x</button>`,
    html`<button .formMethod=${'get'} formaction=${submitFeedback}>x</button>`,
    html`<button .formEnctype=${'text/plain'} formaction=${submitFeedback}>x</button>`,
    html`<button .formAction=${'/elsewhere'} formaction=${submitFeedback}>x</button>`,
  ];
  for (const tpl of refused) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), /reflected IDL attribute/);
    await assert.rejects(() => drain(renderToStream(tpl, { ssr: false })), /reflected IDL attribute/);
  }
});

test('the submitter .prop refusal does not fire on ordinary controls', async () => {
  // These properties reflect on ANY control, so an ungated check refused
  // `<input .name=${'q'}>`, an ordinary field that has nothing to do with the
  // action.
  withResolver();
  const ok = await renderToString(
    html`<form action=${submitFeedback}><input .name=${'q'}><button type="button" .name=${'x'}>y</button><button .textContent=${'Go'} formaction=${submitFeedback}></button></form>`,
    { ssr: true },
  );
  assert.match(ok, /name="__webjs_action"/, 'the real binding still applies');
});

test('an empty author name after the hole is refused, not shipped as a duplicate', async () => {
  // `name=${null}` emits `name=""`. The parse keeps the LAST duplicate, so
  // reading the value back found `''` and waved through a tag carrying TWO
  // `name` attributes. A browser keeps the FIRST, so whichever came first would
  // silently win, and SSR would ship markup the client never produces.
  withResolver();
  for (const tpl of [
    html`<form action=${submitFeedback}><button formaction=${submitFeedback} name=${null}>x</button></form>`,
    html`<form action=${submitFeedback}><button name=${null} formaction=${submitFeedback}>x</button></form>`,
  ]) {
    await assert.rejects(() => renderToString(tpl, { ssr: true }), /already carries a "name" attribute/);
  }
});

test('a .prop on a submitter that binds NOTHING is an ordinary native property', async () => {
  // #1307 narrowed this. `.formMethod` / `.formEnctype` / `.formAction` on a
  // button that binds no action used to be refused, on the grounds that they
  // could defeat the enclosing form's binding. That is a rule about the
  // author's OTHER element, and the ordinary native-property behaviour (SSR
  // drops a `.prop`, the browser reflects it) is what this codebase already
  // accepts everywhere else, including for an unbound form's own `.method`.
  withResolver();
  for (const tpl of [
    html`<form action=${submitFeedback}><button .formAction=${'/elsewhere'}>Save</button></form>`,
    html`<form action=${submitFeedback}><button .formMethod=${'get'}>Save</button></form>`,
    html`<form action=${submitFeedback}><button .formEnctype=${'text/plain'}>Save</button></form>`,
  ]) {
    const out = await renderToString(tpl, { ssr: true });
    assert.match(out, /<button\s*>Save<\/button>/, 'the prop is dropped at SSR, as every native prop is');
    assert.ok(!/formaction|formmethod|formenctype/.test(out), 'and nothing is invented for it');
  }

  const ok = await renderToString(
    html`<form action=${submitFeedback}><button formaction="/search" formmethod="get">Go</button></form>`,
    { ssr: true },
  );
  assert.match(ok, /formaction="\/search"/, 'a static retarget is still allowed');
});

test('a falsy boolean name hole leaves the identity channel free', async () => {
  // The SSR half of the client test with the same name: `?name=${false}` emits
  // nothing, so there is no collision and the binding applies.
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><button ?name=${false} formaction=${submitFeedback}>x</button></form>`,
    { ssr: true },
  );
  assert.match(out, /<button\s+name="__webjs_action" value="[0-9a-f]{10}\/submitFeedback" formmethod="post" formenctype="multipart\/form-data">x<\/button>/);
  // Truthy emits `name=""`, which collides with the identity.
  await assert.rejects(
    () => renderToString(
      html`<form action=${submitFeedback}><button ?name=${true} formaction=${submitFeedback}>x</button></form>`,
      { ssr: true },
    ),
    /already carries a "name" attribute/,
  );
});
