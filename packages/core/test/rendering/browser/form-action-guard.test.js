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
    const host = mount();
    let threw = null;
    try { render(html`<form .action=${secretAction}></form>`, host); }
    catch (e) { threw = e; }
    assert.ok(threw, 'render must throw');
    assert.ok(!document.body.innerHTML.includes('BROWSER_LEAK_MARKER'), 'no source in the document');
    const form = host.querySelector('form');
    if (form) {
      assert.ok(!String(form.getAttribute('action') || '').includes('BROWSER_LEAK_MARKER'), 'no source in the action attribute');
      assert.ok(!String(form.action || '').includes('BROWSER_LEAK_MARKER'), 'no source on the action property');
    }
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
