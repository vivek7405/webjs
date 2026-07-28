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

function mount() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
}

suite('form-action guard in a real browser', () => {

  test('action=${fn} throws and writes nothing to the document', () => {
    const host = mount();
    let threw = null;
    try { render(html`<form method="post" action=${secretAction}></form>`, host); }
    catch (e) { threw = e; }
    assert.ok(threw, 'render must throw');
    assert.ok(/function was interpolated into action=/.test(threw.message), threw.message);
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'no source in the document');
  });

  test('.action=${fn} property binding cannot reflect the source into the attribute', () => {
    // THE case linkedom cannot see. Without the guard, `el.action = fn` here
    // reflects the stringified function into the live `action` attribute.
    //
    // Renders the SAME template with a string first, so there is a real,
    // attached form to inspect afterwards. On a fresh host a throwing part
    // leaves the container empty, and every assertion below would then hold
    // vacuously against a form that does not exist, which is exactly what this
    // test would be worth nothing for.
    const host = mount();
    const tpl = (v) => html`<form .action=${v}></form>`;
    render(tpl('/submit'), host);

    const form = host.querySelector('form');
    assert.ok(form, 'the string render must produce a form to inspect');
    // Confirms the property really does reflect in this browser. If it did not,
    // the leak this test guards could not happen and the test would be inert.
    assert.ok(String(form.action).includes('/submit'), 'action must reflect, else this test proves nothing');

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
