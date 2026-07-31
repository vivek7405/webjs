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

});
