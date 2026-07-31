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
    html`<form action=${submitFeedback} enctype="text/plain"></form>`, { ssr: true });
  assert.equal(out.match(/enctype=/g).length, 1, 'exactly one enctype attribute');
  assert.match(out, /enctype="text\/plain"/);
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

test('binding is scoped to <form>: the same function elsewhere still refuses', async () => {
  withResolver();
  for (const tpl of [
    html`<div action=${submitFeedback}></div>`,
    html`<button formaction=${submitFeedback}></button>`,
    html`<form action="${submitFeedback}"></form>`,
  ]) {
    let msg = '';
    try { await renderToString(tpl, { ssr: true }); } catch (e) { msg = String(e.message); }
    assert.match(msg, /function was interpolated into/, 'refused as a stringify, not bound');
    assert.doesNotMatch(msg, /SECRET/);
  }
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
