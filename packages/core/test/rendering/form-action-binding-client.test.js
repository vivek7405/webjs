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

let html, render, FORM_ACTION_ID_KEY, asyncAppend, repeat;
before(async () => {
  ({ html } = await import('../../src/html.js'));
  ({ render } = await import('../../src/render-client.js'));
  ({ FORM_ACTION_ID_KEY } = await import('../../src/form-action.js'));
  ({ asyncAppend } = await import('../../src/directives.js'));
  ({ repeat } = await import('../../src/repeat.js'));
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
    /cannot work|requires the enclosing <form>/,
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

test('a static action="/url" alongside the bound hole is refused', () => {
  // SSR leaves the static one on the start tag; the client removes it. Either
  // way the two renderers post to different urls, so both refuse instead.
  const host = document.createElement('div');
  const HOISTED = stub(ID);
  assert.throws(
    () => render(html`<form action="/legacy" action=${HOISTED}></form>`, host),
    /plain action="\.\.\." attribute/,
  );
});

test('a whitespace-padded method is refused, not trimmed', () => {
  // Matches SSR: a browser matches `method` against exact keywords with no
  // whitespace stripping, so `" post "` submits as a GET.
  const host = document.createElement('div');
  const HOISTED = stub(ID);
  assert.throws(
    () => render(html`<form action=${HOISTED} method=${' post '}></form>`, host),
    /cannot work/,
  );
});

test('an encoding= CONTENT attribute does not stand in for enctype', () => {
  // The `encoding` fold is for the PROPERTY spelling only. Folding the
  // attribute too made the client honour a value SSR ignores, so the same form
  // uploaded multipart without JS and urlencoded with it, and `encoding=
  // ${'text/plain'}` threw in the browser on markup the server rendered fine.
  const host = document.createElement('div');
  const HOISTED = stub(ID);
  render(html`<form action=${HOISTED} encoding=${'application/x-www-form-urlencoded'}></form>`, host);
  const form = host.querySelector('form');
  assert.equal(form.getAttribute('enctype'), 'multipart/form-data', 'the framework enctype is forced');
  assert.equal(form.getAttribute('encoding'), 'application/x-www-form-urlencoded', 'left alone, inert');

  // The same spelling with an unsubmittable value renders rather than throwing,
  // because SSR does not see it either.
  const host2 = document.createElement('div');
  render(html`<form action=${HOISTED} encoding=${'text/plain'}></form>`, host2);
  assert.equal(host2.querySelector('form').getAttribute('enctype'), 'multipart/form-data');
});

test('two action holes are refused with the BOUND one written second', () => {
  // Recording only the first action hole sent this down the release path and
  // shipped a form posting to /legacy with no identity, while SSR threw.
  const host = document.createElement('div');
  const HOISTED = stub(ID);
  assert.throws(
    () => render(html`<form action=${'/legacy'} action=${HOISTED}></form>`, host),
    /two action=/,
  );
});

test('submitter non-POST formmethod is refused on the client (get and PATCH)', () => {
  const host = document.createElement('div');
  const HOISTED = stub(ID);
  assert.throws(
    () => render(html`<form action=${HOISTED}><button formaction=${HOISTED} formmethod="get">Save</button></form>`, host),
    /formmethod="get"/,
  );
  assert.throws(
    () => render(html`<form action=${HOISTED}><button formaction=${HOISTED} formmethod="PATCH">Save</button></form>`, host),
    /formmethod="PATCH"/,
  );
});

test('submitter controls and conflicting attributes are refused on the client', () => {
  const action = HOISTED();
  // Paired with the message each guard produces, for the reason spelled out in
  // the SSR twin of this test: one shared alternation matches every message in
  // the module and proves only that something threw.
  for (const [tpl, expected] of [
    [html`<form action=${action}><input type="text" formaction=${action}></form>`, /requires a submitter control/],
    [html`<form action=${action}><input type="hidden" formaction=${action}></form>`, /requires a submitter control/],
    [html`<form action=${action}><input type="IMAGE" formaction=${action}></form>`, /coordinate pairs/],
    [html`<form action=${action}><input type="submit" formaction=${action}></form>`, /also its visible label/],
    [html`<form action=${action}><button type="button" formaction=${action}>Save</button></form>`, /requires a submitter control/],
    [html`<form action=${action}><button value="save" formaction=${action}>Save</button></form>`, /already carries a "value" attribute/],
    [html`<form action=${action}><button formaction="/legacy" formaction=${action}>Save</button></form>`, /cannot also carry a plain formaction attribute/],
    [html`<form action=${action}><button form="other" formaction=${action}>Save</button></form>`, /cannot be used with a "form" attribute/],
  ]) {
    assert.throws(() => render(tpl, document.createElement('div')), expected);
  }
});

test('duplicate formaction holes on one submitter are refused on the client', () => {
  const action = HOISTED();
  assert.throws(
    () => render(
      html`<form action=${action}><button formaction=${action} formaction=${action}>Save</button></form>`,
      document.createElement('div'),
    ),
    /two formaction=/,
  );
});

test('a submitter in a nested template sees its enclosing form binding', () => {
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  const host = document.createElement('div');
  render(html`<form action=${formAction}>${html`<button formaction=${buttonAction}>Save</button>`}</form>`, host);
  assert.equal(host.querySelector('button').getAttribute('value'), ID);
  assert.equal(host.querySelector('button').getAttribute('name'), '__webjs_action');
});

test('releasing a submitter binding removes its stale identity', () => {
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  const host = document.createElement('div');
  const tpl = (action) => html`<form action=${formAction}><button formaction=${action}>Save</button></form>`;
  render(tpl(buttonAction), host);
  render(tpl(null), host);
  const button = host.querySelector('button');
  assert.equal(button.hasAttribute('name'), false);
  assert.equal(button.hasAttribute('value'), false);
});
// NOTE: the release path's other guard, "an unbound form keeps a `.method` the
// template writes as a PROPERTY", is asserted in `browser/form-action-guard.test.js`
// instead. It turns entirely on the write reflecting to the content attribute,
// and linkedom's HTMLFormElement has an empty class body with no reflection at
// all, so a `.method` assertion here would pass whether or not the fix is present.

// ---------------------------------------------------------------------------
// #1207: a submitter built by a DETACHED nested template.
//
// `repeat()` and a plain array both build each item through `buildDetached`,
// which reconciles before the nodes are in the tree, so a button there cannot
// reach the `<form>` that lives in the parent template. That is the single most
// ordinary shape this feature exists for, a per-row action button in a list,
// and SSR renders it perfectly. An earlier version asked the enclosing form
// whether it was bound, got no answer because there was no form to ask, and
// THREW, so the page rendered on the server and crashed on hydration.
//
// The rule these pin: an unresolved form SKIPS the boundness assertion and the
// binding is applied. SSR is the renderer that sees every page and refuses a
// genuinely unbound form there, loudly, before anything ships.
// ---------------------------------------------------------------------------

test('a submitter inside repeat() binds instead of refusing', () => {
  const formAction = HOISTED();
  const rowAction = HOISTED();
  const host = document.createElement('div');
  render(
    html`<form action=${formAction}>${repeat([1, 2], (n) => n, (n) => html`<button formaction=${rowAction}>Delete ${n}</button>`)}</form>`,
    host,
  );
  const buttons = host.querySelectorAll('button');
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(button.getAttribute('name'), '__webjs_action');
    assert.equal(button.getAttribute('value'), ID);
    assert.equal(button.hasAttribute('formaction'), false, 'no formaction url is emitted');
  }
});

test('a submitter inside a plain array binds instead of refusing', () => {
  const formAction = HOISTED();
  const rowAction = HOISTED();
  const host = document.createElement('div');
  render(
    html`<form action=${formAction}>${[html`<button formaction=${rowAction}>Delete</button>`]}</form>`,
    host,
  );
  const button = host.querySelector('button');
  assert.equal(button.getAttribute('name'), '__webjs_action');
  assert.equal(button.getAttribute('value'), ID);
});

test('a detached submitter still refuses what the template alone decides', () => {
  // Skipping the boundness question does not relax the refusals that are
  // properties of the TEMPLATE, which are answerable with no form in sight.
  const formAction = HOISTED();
  const rowAction = HOISTED();
  const host = document.createElement('div');
  assert.throws(
    () => render(
      html`<form action=${formAction}>${[html`<button name="intent" formaction=${rowAction}>x</button>`]}</form>`,
      host,
    ),
    /name/,
  );
  assert.throws(
    () => render(
      html`<form action=${formAction}>${[html`<button type="button" formaction=${rowAction}>x</button>`]}</form>`,
      host,
    ),
    /submitter control/,
  );
});

test('a submitter whose enclosing form is UNBOUND now binds, carrying its own submission', () => {
  // The client used to ask "is my enclosing form bound" and refuse when it could
  // reach the form and the answer was no. #1307 removed the question: the button
  // supplies `formmethod` / `formenctype` itself, so the form is irrelevant.
  const rowAction = HOISTED();
  const host = document.createElement('div');
  render(html`<form method="post"><button formaction=${rowAction}>x</button></form>`, host);
  const btn = host.querySelector('button');
  assert.equal(btn.getAttribute('name'), '__webjs_action');
  assert.equal(btn.getAttribute('formmethod'), 'post');
  assert.equal(btn.getAttribute('formenctype'), 'multipart/form-data');
  assert.equal(btn.hasAttribute('formaction'), false, 'no url is emitted');
});

// ---------------------------------------------------------------------------
// The same-element rule on the client, so a component-only page (never SSR'd)
// gets the same answer the server would have given.
// ---------------------------------------------------------------------------

test('the client refuses a BOUND submitter contradicting its own binding', () => {
  const rowAction = HOISTED();
  const host = document.createElement('div');
  assert.throws(
    () => render(html`<button formaction=${rowAction} formenctype="text/plain">Save</button>`, host),
    /formenctype=/,
  );
  assert.throws(
    () => render(html`<button formaction=${rowAction} formmethod="get">Save</button>`, host),
    /formmethod=/,
  );
});

test('the client leaves a PLAIN submitter\'s own override alone, matching SSR', () => {
  // #1207's Part B refused these on both renderers. #1307 allows them on both,
  // which is the half that keeps the two in step.
  const formAction = HOISTED();
  const host = document.createElement('div');
  render(
    html`<form action=${formAction}><button formenctype="text/plain">a</button><button formmethod="get">b</button></form>`,
    host,
  );
  const [a, b] = host.querySelectorAll('button');
  assert.equal(a.getAttribute('formenctype'), 'text/plain');
  assert.equal(b.getAttribute('formmethod'), 'get');
});

test('the client leaves dialog and retargeted submitters alone', () => {
  const formAction = HOISTED();
  const host = document.createElement('div');
  render(
    html`<form action=${formAction}><button formmethod="dialog">Close</button><button formmethod="get" formaction="/search">Search</button></form>`,
    host,
  );
  assert.equal(host.querySelectorAll('button')[0].getAttribute('formmethod'), 'dialog');
  assert.equal(host.querySelectorAll('button')[1].getAttribute('formaction'), '/search');
});

test('the client identity field carries a value ATTRIBUTE, matching SSR markup', () => {
  // Written through setAttribute rather than the `value` IDL property. A `.value`
  // assignment sets the input's value and dirty flag but leaves no content
  // attribute, so a client-created field would serialize without one while SSR
  // always writes it in full, and anything reading the markup (a morph, an
  // outerHTML snapshot) would see two different forms for one template.
  const host = document.createElement('div');
  render(html`<form action=${HOISTED()}><input name="email"></form>`, host);
  const field = host.querySelector('input[name="__webjs_action"]');
  assert.equal(field.getAttribute('value'), ID);
  assert.match(host.querySelector('form').innerHTML, /value="a1b2c3d4e5\/submitFeedback"/);
});

// ---------------------------------------------------------------------------
// A `.prop` spelling on a submitter, the twin of the form-level `.method` /
// `.enctype` refusal. Refused on BOTH sides, because SSR drops a native `.prop`
// while a browser reflects it: `<button .name=${'intent'} formaction=${fn}>`
// rendered clean on the server and then threw on hydration, where `.name` had
// written `name="intent"` over the identity. Refusing at the template level
// means the page never ships and the divergence cannot occur.
// ---------------------------------------------------------------------------

test('a reflected .prop on a bound submitter is refused on the client', () => {
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  for (const tpl of [
    html`<form action=${formAction}><button .name=${'intent'} formaction=${buttonAction}>x</button></form>`,
    html`<form action=${formAction}><button .value=${'v'} formaction=${buttonAction}>x</button></form>`,
    html`<form action=${formAction}><button .formMethod=${'get'} formaction=${buttonAction}>x</button></form>`,
    html`<form action=${formAction}><button .formEnctype=${'text/plain'} formaction=${buttonAction}>x</button></form>`,
  ]) {
    assert.throws(() => render(tpl, document.createElement('div')), /reflected IDL attribute/);
  }
});

test('the client .prop refusal leaves ordinary controls alone', () => {
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  const host = document.createElement('div');
  render(
    html`<form action=${formAction}><input .name=${'q'}><button .textContent=${'Go'} formaction=${buttonAction}></button></form>`,
    host,
  );
  assert.equal(host.querySelector('button').getAttribute('name'), '__webjs_action');
});

test('a .name / .value on a NON-binding submitter is left alone', () => {
  // A plain `<button .name=${'intent'}>` inside a bound form is the ordinary
  // one-action-plus-intent-dispatch pattern, not a conflict: that button
  // carries no identity, so nothing is competing for its name/value pair.
  // Refusing it would reject valid markup, and SSR refusing while the client
  // accepted was a divergence in the direction that 500s the server.
  const formAction = HOISTED();
  const host = document.createElement('div');
  render(
    html`<form action=${formAction}><button .name=${'intent'}>Save</button><button .value=${'v'}>Other</button></form>`,
    host,
  );
  assert.equal(host.querySelectorAll('button').length, 2, 'both plain submitters render');
});

test('an empty name PART on a bound submitter is refused, matching SSR', () => {
  // Judged on the part, not on what it resolved to. `name=${null}` leaves no
  // attribute on the client while SSR emits `name=""` beside the identity, so
  // reading the live value back returned '' and the client waved through a
  // template SSR hard-refuses.
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  for (const value of [null, '', undefined]) {
    assert.throws(
      () => render(
        html`<form action=${formAction}><button name=${value} formaction=${buttonAction}>x</button></form>`,
        document.createElement('div'),
      ),
      /already carries a "name" attribute/,
      `name=\${${String(value)}}`,
    );
  }
});

test('a formaction binding on <input type="submit"> is refused on the client too', () => {
  // The identity has to occupy `value`, which on this control is its visible
  // label, so the binding would render a button captioned with the action id.
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  assert.throws(
    () => render(
      html`<form action=${formAction}><input type="submit" formaction=${buttonAction}></form>`,
      document.createElement('div'),
    ),
    /also its visible label/,
  );
});

test('a name HOLE is judged by what SSR would emit for it, not by its presence', () => {
  // Counting any part called `name` refused templates SSR renders happily. SSR
  // emits `name=""` for an attribute hole whatever it resolved to, but emits
  // NOTHING for a falsy boolean hole and nothing for an `@name` listener, so
  // those two must bind here exactly as they do on the server. Getting this
  // wrong is the render-on-the-server, throw-on-hydration direction.
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  for (const tpl of [
    html`<form action=${formAction}><button ?name=${false} formaction=${buttonAction}>x</button></form>`,
    html`<form action=${formAction}><button @name=${() => {}} formaction=${buttonAction}>x</button></form>`,
  ]) {
    const host = document.createElement('div');
    render(tpl, host);
    assert.equal(host.querySelector('button').getAttribute('name'), '__webjs_action',
      'a hole that emits no name leaves the identity channel free');
  }
  // A TRUTHY boolean hole does emit `name=""`, so it collides and must refuse,
  // which is what SSR does with the resulting duplicate.
  assert.throws(
    () => render(
      html`<form action=${formAction}><button ?name=${true} formaction=${buttonAction}>x</button></form>`,
      document.createElement('div'),
    ),
    /already carries a "name" attribute/,
  );
});

test('a value HOLE is judged by what SSR would emit, exactly as a name hole is', () => {
  // The twin of the `name` test above. Both identity channels ask the same
  // question through one predicate, so a falsy boolean hole binds on both sides
  // and a truthy one refuses on both. Keeping them in step matters because the
  // failure is silent: SSR renders and the client throws on hydration.
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  const host = document.createElement('div');
  render(
    html`<form action=${formAction}><button formaction=${buttonAction} ?value=${false}>x</button></form>`,
    host,
  );
  assert.equal(host.querySelector('button').getAttribute('value'), ID,
    'a falsy boolean hole emits nothing, so the identity channel is free');
  assert.throws(
    () => render(
      html`<form action=${formAction}><button formaction=${buttonAction} ?value=${true}>x</button></form>`,
      document.createElement('div'),
    ),
    /already carries a "value" attribute/,
  );
});

test('a bound submitter binds identically on a first render and an update', () => {
  // This used to guard an enclosing-form verdict whose answer depended on
  // whether the element happened to be in the tree when it reconciled: no on a
  // first render (the fragment is still detached) and yes on an update. That
  // asymmetry made the SAME template with the SAME values bind at first paint
  // and throw on an arbitrary later re-render.
  //
  // #1307 deleted the question, so the property now holds for a much better
  // reason than a carefully-placed cache: there is nothing left to ask. Kept as
  // a regression guard, because any future rule that reads OUTSIDE the element
  // reintroduces exactly this first-render-versus-update split.
  const buttonAction = HOISTED();
  const outer = document.createElement('form');
  outer.setAttribute('method', 'post');
  document.body.appendChild(outer);
  const host = document.createElement('div');
  outer.appendChild(host);
  try {
    const tpl = (n) => html`<button formaction=${buttonAction}>row ${n}</button>`;
    render(tpl(1), host);
    render(tpl(2), host);
    assert.equal(host.querySelector('button').getAttribute('name'), '__webjs_action',
      'the verdict is stable across passes');
  } finally { outer.remove(); }
});

test('releasing a submitter takes back the framework attrs, never the author\'s (#1307)', () => {
  // Both halves matter. A released button that keeps `formmethod="post"` no
  // longer matches what SSR emits for the same template, and one that loses an
  // author's own value has had its markup destroyed by a framework that should
  // never have owned it.
  //
  // Which attribute is whose is RECOMPUTED, not remembered from the bind: it is
  // the framework's exactly when the template supplies nothing for it on this
  // pass. That is why there is no bookkeeping here to go stale.
  const act = HOISTED();

  const host = document.createElement('div');
  const framework = (v) => html`<button formaction=${v}>Go</button>`;
  render(framework(act), host);
  let btn = host.querySelector('button');
  assert.equal(btn.getAttribute('formmethod'), 'post');
  assert.equal(btn.getAttribute('formenctype'), 'multipart/form-data');

  render(framework('/plain-url'), host);
  btn = host.querySelector('button');
  assert.equal(btn.getAttribute('name'), null, 'the identity is released');
  assert.equal(btn.getAttribute('formmethod'), null, 'and the supplied method with it');
  assert.equal(btn.getAttribute('formenctype'), null, 'and the supplied enctype');

  const host2 = document.createElement('div');
  const authored = (v) => html`<button formaction=${v} formmethod="post">Go</button>`;
  render(authored(act), host2);
  render(authored('/plain-url'), host2);
  const btn2 = host2.querySelector('button');
  assert.equal(btn2.getAttribute('name'), null, 'the identity is still released');
  assert.equal(btn2.getAttribute('formmethod'), 'post', "the AUTHOR's own value survives");
  assert.equal(btn2.getAttribute('formenctype'), null, 'only the supplied one is taken back');
});

test('a bound form still binds its submitter on every re-render', () => {
  // The counterfactual for the stability guard: it must not become a blanket
  // skip that stops the binding from being re-applied.
  const formAction = HOISTED();
  const buttonAction = HOISTED();
  const host = document.createElement('div');
  const tpl = (n) => html`<form action=${formAction}><button formaction=${buttonAction}>r${n}</button></form>`;
  render(tpl(1), host);
  render(tpl(2), host);
  const button = host.querySelector('button');
  assert.equal(button.getAttribute('name'), '__webjs_action');
  assert.equal(button.getAttribute('value'), ID);
});
