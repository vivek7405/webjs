/**
 * The form-action guard, in a REAL browser (#1154).
 *
 * The node-side coverage runs under linkedom, which does not implement IDL
 * attribute reflection: there, `form.action = fn` sets a plain JS property and
 * the `action` content attribute stays untouched, so the leak the property
 * binding causes is INVISIBLE to that layer. In a real browser `action` is a
 * reflected IDL attribute, so the assignment stringifies the function into the
 * element's own markup, which is the actual leak. That difference is exactly
 * why this file exists rather than trusting the linkedom tests.
 *
 * It also pins the real-DOM behaviour of the attribute path: a refused render
 * must leave the previously-rendered value in place, never a half-written one.
 */

import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { FORM_ACTION_ID_KEY } from '../../../src/form-action.js';

import { assert } from '../../../../../test/browser-assert.js';

// The sentinel lives inside the function body, so it appears in the output only
// if the function was stringified.
async function secretAction(formData) {
  const CONNECTION = 'postgres://user:BROWSER_LEAK_MARKER@host/db';
  return CONNECTION;
}

/**
 * A host attached to the live document, which the reflection cases need: an
 * IDL attribute only reflects on an element that is really in a document.
 *
 * Each host is removed after its test. Without that, `document.body` accumulates
 * every earlier test's markup, and the document-wide leak assertions below stop
 * describing the test they sit in. It is not theoretical: with the prop guard
 * reverted, the custom-element case failed on the marker left behind by the
 * PREVIOUS case, which is a misattribution that would send someone debugging the
 * wrong test.
 */
const mounted = [];
function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mounted.push(host);
  return host;
}

teardown(() => {
  while (mounted.length) mounted.pop().remove();
});

suite('form-action guard in a real browser', () => {

  test('action=${fn} on an unidentifiable function throws and writes nothing', () => {
    // #1155 made this shape a BINDING, so it refuses on identity rather than on
    // stringification. Nothing may reach the document either way, which is the
    // claim that has to hold whichever refusal fires.
    const host = mount();
    let threw = null;
    try { render(html`<form method="post" action=${secretAction}></form>`, host); }
    catch (e) { threw = e; }
    assert.ok(threw, 'render must throw');
    assert.ok(/is not a server action/.test(threw.message), threw.message);
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'no source in the document');
  });

  test('a BOUND action produces a real, submittable form (#1155)', () => {
    // The end state the whole feature is for, asserted in a real browser
    // through the DOM the browser would actually submit: `new FormData(form)`
    // is what a native submission serializes, so if the identity field were
    // outside the form, or the method not a POST, this is where it shows.
    const host = mount();
    const stub = async () => {};
    Object.defineProperty(stub, '$$webjsAction', { value: 'a1b2c3d4e5/subscribe' });
    render(html`<form action=${stub}><input name="email" value="a@b.com"></form>`, host);

    const form = host.querySelector('form');
    assert.ok(form, 'the form renders');
    assert.equal(form.method, 'post', 'method is forced to post');
    assert.equal(form.enctype, 'multipart/form-data', 'enctype is forced');
    // The IDL getter resolves an ABSENT action to the document url, which is
    // exactly the behaviour the omitted attribute is for. Assert the attribute.
    assert.equal(form.hasAttribute('action'), false, 'no action attribute, so it posts to this page');
    const fd = new FormData(form);
    assert.equal(fd.get('__webjs_action'), 'a1b2c3d4e5/subscribe', 'the identity is submitted');
    assert.equal(fd.get('email'), 'a@b.com', 'alongside the real fields');
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'and no source anywhere');
  });

  test('.action=${fn} property binding cannot reflect the source into the attribute', () => {
    // THE case linkedom cannot see. Without the guard, `el.action = fn` here
    // reflects the stringified function into the live `action` attribute.
    //
    // Renders the SAME template with a string first, so there is a real,
    // attached form to inspect afterwards. That is not a guard against hollow
    // assertions, it is what gives the test anything to assert about: without
    // it the container is empty, `assert.ok(form, ...)` below fails, and since
    // an assertion failure throws, the test aborts there and NOTHING after it
    // runs. Verified in all three engines by removing the string render.
    //
    // Said plainly because two earlier attempts at this comment described the
    // remaining assertions as passing vacuously or as throwing TypeErrors.
    // Neither happens, because control flow never reaches them.
    const host = mount();
    const tpl = (v) => html`<form .action=${v}></form>`;
    render(tpl('/submit'), host);

    const form = host.querySelector('form');
    assert.ok(form, 'the string render must produce a form to inspect');
    // Confirms the property really does REFLECT in this browser, which is the
    // premise of the whole file. It has to read the CONTENT ATTRIBUTE: the
    // `form.action` IDL getter returns what was assigned even where nothing
    // reflects (linkedom does exactly that), so asserting on the getter would
    // be an inertness check that is itself inert.
    assert.equal(form.getAttribute('action'), '/submit', 'action must reflect, else this test proves nothing');

    let threw = null;
    try { render(tpl(secretAction), host); } catch (e) { threw = e; }
    assert.ok(threw, 'render must throw');

    const after = host.querySelector('form');
    assert.ok(after, 'the form must still be attached after the refusal');
    assert.ok(!String(after.getAttribute('action') || '').includes('BROWSER_LEAK_MARKER'), 'no source in the action attribute');
    assert.ok(!String(after.action || '').includes('BROWSER_LEAK_MARKER'), 'no source on the action property');
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'no source in the document');
  });

  test('a custom element keeps its own .action property, which does not reflect', () => {
    // The carve-out the guard depends on: a custom element's `.action` is an
    // ordinary author-defined property, so a function there is legitimate and
    // nothing reflects into markup.
    const host = mount();
    render(html`<my-action-holder .action=${secretAction}></my-action-holder>`, host);
    const el = host.querySelector('my-action-holder');
    assert.ok(el, 'the custom element renders');
    assert.equal(typeof el.action, 'function', 'the property is kept as a function');
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'and nothing reflects into markup');
  });

  test('a refused re-render leaves the previously rendered action intact', () => {
    const host = mount();
    const tpl = (a) => html`<form method="post" action=${a}></form>`;
    render(tpl('/submit'), host);
    // Reaches the identity refusal, not the stringify one, and the point is the
    // same either way: a refusal must not half-write the attribute.
    const before = host.querySelector('form').getAttribute('action');
    assert.equal(before, '/submit');

    let threw = null;
    try { render(tpl(secretAction), host); } catch (e) { threw = e; }
    assert.ok(threw, 'the re-render must throw');
    assert.equal(host.querySelector('form').getAttribute('action'), '/submit', 'prior value survives');
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'no source in the document');
  });

  test('a real form still submits to a string action', () => {
    // The guard must not disturb the ordinary case: a string action has to
    // survive into a working, submittable form.
    const host = mount();
    render(html`<form method="post" action=${'/feedback'}><input name="msg" value="hi"></form>`, host);
    const form = host.querySelector('form');
    assert.equal(form.getAttribute('action'), '/feedback');
    assert.equal(form.method, 'post');
    assert.equal(new FormData(form).get('msg'), 'hi');
  });

  test('releasing an unbound form keeps a .method the template writes', () => {
    // Only observable in a real browser: `method` is a reflected IDL attribute,
    // so `.method=${'post'}` puts `method="post"` on the element. linkedom's
    // HTMLFormElement has an empty class body and reflects nothing, so the same
    // assertion node-side would pass with or without the fix.
    //
    // The release path removes the attributes the framework supplied, and
    // decides which those are by asking whether the template supplies anything
    // for them on this pass. A property binding is not an attribute part, so
    // that question answered "no" for it and the removal wiped the author's own
    // value on every re-render, silently downgrading the form to a GET.
    const host = mount();
    render(html`<form action=${'/search'} .method=${'post'}></form>`, host);
    const form = host.querySelector('form');
    assert.equal(form.getAttribute('method'), 'post', 'the reflected attribute survives');
    assert.equal(form.method, 'post');

    // And again on a re-render, which is when the stale-bookkeeping version of
    // this bug used to bite.
    render(html`<form action=${'/search2'} .method=${'post'}></form>`, host);
    assert.equal(host.querySelector('form').method, 'post', 'still post after a re-render');
  });

  test('an encoding= attribute is inert, so a bound form still forces enctype', () => {
    // `form.encoding` is a legacy IDL ALIAS that reads back `enctype`, which is
    // why this belongs in a real browser: it proves the CONTENT attribute does
    // nothing, and therefore that the client is right to ignore it exactly as
    // SSR does. Folding the attribute spelling into enctype made the same form
    // upload multipart without JS and urlencoded with it.
    const host = mount();
    const bound = async () => {};
    Object.defineProperty(bound, FORM_ACTION_ID_KEY, { value: 'a1b2c3d4e5/bound' });
    render(html`<form action=${bound} encoding=${'application/x-www-form-urlencoded'}></form>`, host);
    const form = host.querySelector('form');
    assert.equal(form.getAttribute('enctype'), 'multipart/form-data');
    assert.equal(form.enctype, 'multipart/form-data');
    // The browser agrees the attribute is inert: the alias reads the enctype.
    assert.equal(form.encoding, 'multipart/form-data');
  });


  // -------------------------------------------------------------------------
  // #1207: per-submitter actions, in the browser, because the whole mechanism
  // rests on two real-DOM behaviours linkedom cannot show. `new FormData(form,
  // submitter)` is what a native submission serializes and is the only place
  // the pressed button's name/value pair actually appears; and duplicate
  // `__webjs_action` entries have to arrive in DOM order for last-wins
  // precedence to mean anything.
  // -------------------------------------------------------------------------

  function boundStub(id) {
    const fn = async () => {};
    Object.defineProperty(fn, FORM_ACTION_ID_KEY, { value: id });
    return fn;
  }

  test('a bound submitter overrides the form action, last-wins in DOM order', () => {
    const host = mount();
    render(
      html`<form action=${boundStub('a1b2c3d4e5/save')}>
        <input name="title" value="hi">
        <button formaction=${boundStub('a1b2c3d4e5/remove')}>Delete</button>
      </form>`,
      host,
    );
    const form = host.querySelector('form');
    const button = host.querySelector('button');

    // No submitter pressed: the form's own identity is what the server sees.
    assert.equal(new FormData(form).get('__webjs_action'), 'a1b2c3d4e5/save');

    // Pressed: BOTH entries ride the submission, and the dispatcher takes the
    // LAST. That ordering is a fact about the DOM (the form's hidden field is
    // its first child, so a submitter's entry always follows it), which is why
    // it is asserted here rather than assumed.
    const fd = new FormData(form, button);
    const all = fd.getAll('__webjs_action');
    assert.equal(all.length, 2, 'the form field and the submitter both submit');
    assert.equal(all[0], 'a1b2c3d4e5/save');
    assert.equal(all[all.length - 1], 'a1b2c3d4e5/remove', 'the pressed button wins');
    assert.equal(fd.get('title'), 'hi', 'alongside the real fields');
    assert.equal(button.hasAttribute('formaction'), false, 'no formaction url is emitted');
  });

  test('an unpressed sibling submitter contributes nothing', () => {
    // The reason the submitter's own name/value is the right channel: a browser
    // submits it ONLY for the button that was pressed, unlike a hidden input.
    const host = mount();
    render(
      html`<form action=${boundStub('a1b2c3d4e5/save')}>
        <button formaction=${boundStub('a1b2c3d4e5/one')}>One</button>
        <button formaction=${boundStub('a1b2c3d4e5/two')}>Two</button>
      </form>`,
      host,
    );
    const form = host.querySelector('form');
    const [first, second] = host.querySelectorAll('button');
    assert.deepEqual(
      new FormData(form, second).getAll('__webjs_action'),
      ['a1b2c3d4e5/save', 'a1b2c3d4e5/two'],
      'only the pressed button of the two appears',
    );
    assert.deepEqual(
      new FormData(form, first).getAll('__webjs_action'),
      ['a1b2c3d4e5/save', 'a1b2c3d4e5/one'],
    );
  });

  test('a submitter built by a detached nested template still binds', () => {
    // The shape the feature exists for, a per-row action button in a list.
    // Array and repeat() items are built DETACHED, so the button cannot reach
    // the <form> in the parent template while it reconciles. SSR renders this
    // perfectly, so refusing it on the client would mean a page that renders on
    // the server and crashes on hydration.
    const host = mount();
    const rows = [1, 2].map((n) => html`<button formaction=${boundStub('a1b2c3d4e5/del')}>Delete ${n}</button>`);
    render(html`<form action=${boundStub('a1b2c3d4e5/save')}>${rows}</form>`, host);

    const form = host.querySelector('form');
    const buttons = host.querySelectorAll('button');
    assert.equal(buttons.length, 2);
    assert.deepEqual(
      new FormData(form, buttons[1]).getAll('__webjs_action'),
      ['a1b2c3d4e5/save', 'a1b2c3d4e5/del'],
      'the detached row button still submits its own action',
    );
  });

  test('the identity never carries the action source, on the submitter path either', () => {
    const host = mount();
    let threw = null;
    try {
      render(html`<form action=${boundStub('a1b2c3d4e5/save')}><button formaction=${secretAction}>x</button></form>`, host);
    } catch (e) { threw = e; }
    assert.ok(threw, 'an unidentifiable submitter action must refuse');
    assert.ok(/is not a server action/.test(threw.message), threw.message);
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'no source in the document');
  });

  test('formmethod="dialog" survives on a plain submitter inside a bound form', () => {
    // Part B refuses values that cannot submit, but a dialog dismissal never
    // submits at all. The browser is where `button.formMethod` reflects, so
    // this is where "we left it alone" is really observable.
    const host = mount();
    render(
      html`<form action=${boundStub('a1b2c3d4e5/save')}><button formmethod="dialog">Close</button></form>`,
      host,
    );
    assert.equal(host.querySelector('button').formMethod, 'dialog');
  });

});
