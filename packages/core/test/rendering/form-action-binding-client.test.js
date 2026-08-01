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

let html, render, FORM_ACTION_ID_KEY, asyncAppend;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ FORM_ACTION_ID_KEY } = await import('../../src/form-action.js'));
  ({ asyncAppend } = await import('../../src/directives.js'));
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

test('a HOLE-provided method / enctype after the action hole is still refused', () => {
  // The parity trap. The client applies parts in template order, so an
  // attribute written AFTER the action hole has not been committed when the
  // action part runs. Validating at that moment reads `null` and lets the form
  // through, while SSR (which validates the whole start tag at its `>`) refuses
  // it: the client would ship a form that submits its fields in the query
  // string and never runs the action.
  for (const tpl of [
    () => html`<form action=${stub(ID)} method=${'get'}></form>`,
    () => html`<form action=${stub(ID)} enctype=${'text/plain'}></form>`,
  ]) {
    const host = document.createElement('div');
    assert.throws(() => render(tpl(), host), /cannot work/);
  }
});

// The re-render cases below all HOIST the action function. That is load-bearing
// rather than tidy: `updateInstance` skips a part whose value is `Object.is`
// to the last one, so minting a fresh stub inside the template makes the action
// part re-apply and re-bind on every render. The bind re-validates from
// scratch, which means the assertion passes on the strength of the FIRST fix
// and says nothing about the write-path check it claims to cover. Both halves
// of that were true of an earlier version of these tests, so each was satisfied
// by the other and neither was pinned.
const HOISTED = () => {
  const fn = async () => {};
  Object.defineProperty(fn, FORM_ACTION_ID_KEY, { value: ID });
  return fn;
};

test('a re-render that breaks an already-bound form is refused (unquoted hole)', () => {
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (enc) => html`<form action=${fn} enctype=${enc}></form>`;
  render(tpl('multipart/form-data'), host);
  assert.throws(() => render(tpl('text/plain'), host), /cannot work/);
});

test('a re-render that breaks an already-bound form is refused (QUOTED hole)', () => {
  // A quoted hole compiles to a different commit branch (`attr-mixed`), and it
  // is the more common spelling. Instrumenting the branches one at a time is
  // how this one got missed.
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (m) => html`<form action=${fn} method="${m}"></form>`;
  render(tpl('post'), host);
  assert.throws(() => render(tpl('get'), host), /cannot work/);
});

test('a hole resolving to null is refused, with SSR\'s own message', () => {
  // An attribute hole emits an EMPTY value for null (SSR: `String(val ?? '')`),
  // and an empty method cannot submit. What matters is not just that it throws
  // but that it throws the SAME thing SSR does: an earlier design invented a
  // "lost its method attribute" message here, which no server render could ever
  // produce.
  for (const attr of ['method', 'enctype']) {
    const fn = HOISTED();
    const host = document.createElement('div');
    const tpl = attr === 'method'
      ? (v) => html`<form action=${fn} method=${v}></form>`
      : (v) => html`<form action=${fn} enctype=${v}></form>`;
    render(tpl(attr === 'method' ? 'post' : 'multipart/form-data'), host);
    assert.throws(
      () => render(tpl(null), host),
      new RegExp(`<form ${attr}="" action=\\$\\{action\\}> cannot work`),
      `a null ${attr} hole must be refused the way SSR refuses it`,
    );
  }
});

test('a null hole is refused on the FIRST render too, not only a re-render', () => {
  // The old write-tracking design only noticed this on a re-render, because its
  // check ran before the form was registered as bound. SSR always threw.
  const fn = HOISTED();
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action=${fn} method=${null}></form>`, host),
    /cannot work/,
  );
});

test('an action hole that resolves to a URL releases the binding', () => {
  // `action=${flag ? act : '/legacy'}`. Two things have to happen: the stale
  // identity field goes (or the form posts the old action's identity to its new
  // url), and later `method` writes stop being judged against a binding that no
  // longer exists.
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (a, m) => html`<form action=${a} method=${m}></form>`;
  render(tpl(fn, 'post'), host);
  assert.equal(host.querySelectorAll('input[name="__webjs_action"]').length, 1);

  render(tpl('/legacy', 'get'), host);   // must NOT throw
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('action'), '/legacy');
  assert.equal(form.getAttribute('method'), 'get', 'an ordinary form may be a GET again');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 0,
    'the stale identity field must not survive the release');
});

test('an action hole that resolves to null releases the binding too', () => {
  // The removal branch is a separate path from the string one, and SSR renders
  // this template with no identity at all, so keeping the field would leave the
  // client submitting to an action the server never bound.
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (a) => html`<form action=${a}></form>`;
  render(tpl(fn), host);
  assert.equal(host.querySelectorAll('input[name="__webjs_action"]').length, 1);
  render(tpl(null), host);
  assert.equal(host.querySelectorAll('input[name="__webjs_action"]').length, 0,
    'the identity must not survive an action hole going null');
});

test('a bound form with no author-written attributes survives a plain re-render', () => {
  // The absent-is-an-error rule must not fire on the attributes the BIND
  // supplied. A child-only re-render touches no attribute, so nothing is noted,
  // but this pins the shape most apps actually write.
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (v) => html`<form action=${fn}><input name="a" value=${v}></form>`;
  render(tpl('1'), host);
  render(tpl('2'), host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('method'), 'post');
  assert.equal(form.getAttribute('enctype'), 'multipart/form-data');
});

test('an ordinary form that binds no action keeps its method hole', () => {
  // The carve-out for the write-path check: it must be a no-op on any form that
  // is not bound, or a plain search form stops working.
  const host = document.createElement('div');
  const tpl = (m) => html`<form method=${m} action="/search"><input name="q"></form>`;
  render(tpl('get'), host);
  render(tpl(null), host);   // removing method on an UNBOUND form is fine
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('action'), '/search');
  assert.equal(form.hasAttribute('method'), false);
});

test('a re-render that changes only a child value neither re-binds nor duplicates', () => {
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (v) => html`<form action=${fn}><input name="a" value=${v}></form>`;
  render(tpl('one'), host);
  render(tpl('two'), host);
  const form = host.querySelector('form');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1);
  assert.equal(form.querySelector('input[name="a"]').getAttribute('value'), 'two');
});

// The commit path has FIVE flush sites, one per parts-application loop, and the
// tests above reach only the two a root-level template goes through
// (`createInstance` / `updateInstance`). The ones below cover the rest: a
// nested child hole, an array of templates built detached, and the
// streamed-continuation path.
//
// Each site reconciles only the forms of the template it is committing, so
// removing any one of them drops that template's forms entirely rather than
// deferring them to an enclosing pass. The streamed one is still the worst to
// lose, because `consumeAsyncStream` swallows a throw into a `console.error`,
// so a form that failed to bind there ships silently instead of failing the
// render.

test('a bound form inside a NESTED child hole is bound', () => {
  const fn = HOISTED();
  const host = document.createElement('div');
  render(html`<div>${html`<form action=${fn}><input name="a"></form>`}</div>`, host);
  const form = host.querySelector('form');
  assert.ok(form, 'the nested form rendered');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1);
  assert.equal(form.getAttribute('method'), 'post');
});

test('a bound form inside an array of templates is bound, once per row', () => {
  const fn = HOISTED();
  const host = document.createElement('div');
  const rows = ['a', 'b', 'c'];
  render(html`<ul>${rows.map((r) => html`<li><form action=${fn}><input name=${r}></form></li>`)}</ul>`, host);
  const forms = host.querySelectorAll('form');
  assert.equal(forms.length, 3, 'every row rendered');
  for (const form of forms) {
    assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1,
      'each row carries exactly one identity field');
  }
});

test('a bound form in a nested hole still refuses a bad method', () => {
  // Proves the nested path runs the same validation, not just the same bind.
  const fn = HOISTED();
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<div>${html`<form action=${fn} method=${'get'}></form>`}</div>`, host),
    /cannot work/,
  );
});

test('a bound form in a STREAMED continuation is bound', async () => {
  // `consumeAsyncStream` catches a throw into a console.error, so a missing
  // flush here would ship an identity-less form with nothing in the render to
  // signal it. That makes this the flush site whose absence is quietest.
  const fn = HOISTED();
  const host = document.createElement('div');
  async function* chunks() {
    yield html`<form action=${fn}><input name="a"></form>`;
  }
  render(html`<div>${asyncAppend(chunks())}</div>`, host);
  await new Promise((r) => setTimeout(r, 20));

  const form = host.querySelector('form');
  assert.ok(form, 'the streamed chunk rendered its form');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1,
    'and it carries exactly one identity field');
  assert.equal(form.getAttribute('method'), 'post');
});

test('bind, release, and re-bind leave no stale forced attributes', () => {
  // Which attributes are the framework's is recomputed from the template every
  // pass rather than remembered from the bind, so a form that cycles has to end
  // up with exactly what the template asks for, not an accumulation.
  const a1 = HOISTED();
  const a2 = HOISTED();
  const host = document.createElement('div');
  const tpl = (a) => html`<form action=${a}></form>`;
  render(tpl(a1), host);
  render(tpl('/legacy'), host);
  render(tpl(a2), host);
  render(tpl('/other'), host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('action'), '/other');
  assert.equal(form.hasAttribute('method'), false, 'no forced method survives the last release');
  assert.equal(form.hasAttribute('enctype'), false);
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 0);
});

test('swapping one bound action for another keeps a single identity field', () => {
  const a1 = HOISTED();
  const a2 = HOISTED();
  const host = document.createElement('div');
  const tpl = (a) => html`<form action=${a}></form>`;
  render(tpl(a1), host);
  render(tpl(a2), host);
  const form = host.querySelector('form');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1);
  assert.equal(form.getAttribute('method'), 'post');
});

test('a boolean write on a bound form is re-checked', () => {
  // `?enctype=${b}` toggling on writes an EMPTY enctype, which is unparseable
  // and which SSR refuses. The bool branch is a separate commit path from
  // `attr` and `attr-mixed`.
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (b) => html`<form action=${fn} ?enctype=${b}></form>`;
  render(tpl(false), host);
  assert.throws(() => render(tpl(true), host), /cannot work/);
});

test('releasing a binding takes back ONLY the attributes the bind forced', () => {
  // SSR of `<form action=${'/legacy'}>` emits no method at all, so a client
  // that kept `method="post" enctype="multipart/form-data"` would POST
  // multipart to a url the server renders as an ordinary GET form.
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (a) => html`<form action=${a}></form>`;
  render(tpl(fn), host);
  assert.equal(host.querySelector('form').getAttribute('method'), 'post');

  render(tpl('/legacy'), host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('action'), '/legacy');
  assert.equal(form.hasAttribute('method'), false, 'the forced method is taken back');
  assert.equal(form.hasAttribute('enctype'), false, 'and the forced enctype');
});

test("releasing a binding KEEPS an author's own method", () => {
  // The other half: it must take back what the BIND added and nothing else.
  const fn = HOISTED();
  const host = document.createElement('div');
  const tpl = (a) => html`<form action=${a} method="post"></form>`;
  render(tpl(fn), host);
  render(tpl('/legacy'), host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('method'), 'post', "the author's own method survives");
  assert.equal(form.hasAttribute('enctype'), false, 'while the forced enctype is taken back');
});

test('a boolean hole that is FALSE leaves the attribute to the framework', () => {
  // The shape that proves the oracle reads the template rather than the DOM.
  // `?method=${false}` and `method=${null}` both leave no method attribute, and
  // SSR resolves them to opposite answers: it emits nothing for the first (so
  // the framework supplies `post`) and `method=""` for the second (refused).
  // Nothing observable in the DOM can tell them apart.
  const fn = HOISTED();
  const host = document.createElement('div');
  render(html`<form action=${fn} ?method=${false}></form>`, host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('method'), 'post', 'a falsy boolean hole is ABSENT, so it is supplied');
  assert.equal(form.querySelectorAll('input[name="__webjs_action"]').length, 1);
});

test('a failed render does not poison the NEXT one', () => {
  // The queue is module-level state, so a pass that throws BETWEEN queueing a
  // form and flushing (here a `formaction=${fn}` refusal later in the same
  // template) would otherwise leave its entry behind for an unrelated later
  // render to apply. Measured before the fix: the second render below failed
  // with the FIRST render's form error.
  const leaky = async () => { const S = 'LEAK_MARKER'; return S; };
  const h1 = document.createElement('div');
  assert.throws(
    () => render(html`<form method="get" action=${stub(ID)}></form><button formaction=${leaky}></button>`, h1),
    /function was interpolated into/,
  );

  const h2 = document.createElement('div');
  render(html`<p>${'unrelated'}</p>`, h2);
  assert.match(h2.innerHTML, /unrelated/, 'the next render must be unaffected');

  // And a legitimate bound form still works after the failure.
  const h3 = document.createElement('div');
  render(html`<form action=${stub(ID)}></form>`, h3);
  assert.equal(h3.querySelectorAll('input[name="__webjs_action"]').length, 1);
});

test('a function with no identity is refused, never rendered as an inert form', () => {
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<form action=${async () => {}}></form>`, host),
    /is not a server action/,
  );
});
