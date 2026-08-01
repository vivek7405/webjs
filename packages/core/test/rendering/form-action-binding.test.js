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
  // Standalone submitter outside a bound form throws the form-binding requirement error:
  let unboundMsg = '';
  try { await renderToString(html`<button formaction=${submitFeedback}></button>`, { ssr: true }); } catch (e) { unboundMsg = String(e.message); }
  assert.match(unboundMsg, /requires the enclosing <form> to also be bound/);
});

test('formaction=${fn} on submitter inside a bound form emits submitter action identity', async () => {
  withResolver();
  const out = await renderToString(
    html`<form action=${submitFeedback}><button formaction=${submitFeedback}>Save</button></form>`,
    { ssr: true }
  );
  assert.match(out, /<button name="__webjs_action" value="[0-9a-f]{10}\/submitFeedback">Save<\/button>/);
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

test('two action holes are refused whichever position the bound one is in', async () => {
  // The refusal is by HOLE COUNT once any hole resolves to an action, so a
  // template that writes the url first and the action second refuses too.
  withResolver();
  await assert.rejects(
    () => renderToString(html`<form action=${'/legacy'} action=${submitFeedback}></form>`, { ssr: true }),
    /two action=/,
  );
});
