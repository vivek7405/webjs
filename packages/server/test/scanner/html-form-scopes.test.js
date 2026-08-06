import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scanHtmlFormScopes,
  classifyActionHole,
  matchClosingBrace,
  extractWebComponentClassBodies,
} from '../../src/js-scan.js';

/**
 * Unit tests for the lexical half of `submitter-needs-bound-form` (#1307):
 * the whole-app rule in `check.js` is only as good as the scan under it, and
 * the shapes it must NOT read as markup (a plain string, a `css` template, an
 * HTML comment) are what keep the rule from firing on a docs page.
 */

test('a submitter reports the scope of its enclosing form', () => {
  assert.deepEqual(
    scanHtmlFormScopes('html`<form action=${save}><button formaction=${del}>x</button></form>`').submitters,
    [{ tag: 'button', scope: 'bound' }],
  );
  assert.deepEqual(
    scanHtmlFormScopes('html`<form><button formaction=${del}>x</button></form>`').submitters,
    [{ tag: 'button', scope: 'unbound' }],
  );
  assert.deepEqual(
    scanHtmlFormScopes('html`<button formaction=${del}>x</button>`').submitters,
    [{ tag: 'button', scope: 'none' }],
  );
});

test('a nested template inherits the enclosing form scope', () => {
  // What the renderer does: `render` threads `formScope` through arrays,
  // `repeat`, and nested templates, so a per-row button in a bound form is
  // bound.
  const bound = 'html`<form action=${save}>${rows.map((r) => html`<button formaction=${del}>x</button>`)}</form>`';
  assert.deepEqual(scanHtmlFormScopes(bound).submitters, [{ tag: 'button', scope: 'bound' }]);
  const unbound = 'html`<form>${rows.map((r) => html`<button formaction=${del}>x</button>`)}</form>`';
  assert.deepEqual(scanHtmlFormScopes(unbound).submitters, [{ tag: 'button', scope: 'unbound' }]);
});

test('the scope closes at </form> and does not leak forward', () => {
  const src = 'html`<form action=${save}></form><button formaction=${del}>x</button>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'none' }]);
});

test('a start tag split across holes is still one tag', () => {
  const src = 'html`<form action=${save} class="a"><button class=${c} formaction=${del}>x</button></form>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'bound' }]);
});

test('a `>` inside a quoted attribute value does not close the tag', () => {
  const src = 'html`<form action=${save}><div title="a>b"></div><button formaction=${del}>x</button></form>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'bound' }]);
});

test('a custom-element start tag is reported, its close tag is not', () => {
  assert.deepEqual(
    scanHtmlFormScopes('html`<form action=${save}><row-btn></row-btn></form>`').tagUses,
    [{ tag: 'row-btn', scope: 'bound' }],
  );
  assert.deepEqual(
    scanHtmlFormScopes('html`<form><row-btn></row-btn></form>`').tagUses,
    [{ tag: 'row-btn', scope: 'unbound' }],
  );
});

test('only an html-tagged literal is read as markup', () => {
  // The carve-out the whole rule rests on: the framework's own website renders
  // `<form action=${fn}>` as a code SAMPLE.
  assert.deepEqual(scanHtmlFormScopes("const s = '<form><button formaction=x></button></form>';").submitters, []);
  assert.deepEqual(scanHtmlFormScopes('css`.a { }` + html`<row-btn></row-btn>`').tagUses, [{ tag: 'row-btn', scope: 'none' }]);
  // A form written inside a plain string cannot open a scope for real markup.
  const mixed = "const s = '<form>'; export default () => html`<button formaction=${del}>x</button>`;";
  assert.deepEqual(scanHtmlFormScopes(mixed).submitters, [{ tag: 'button', scope: 'none' }]);
});

test('an HTML comment is not markup', () => {
  const src = 'html`<!-- <form> --><button formaction=${del}>x</button>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'none' }]);
});

test('classifyActionHole matches the tag and the attribute as a pair', () => {
  assert.equal(classifyActionHole('<form action='), 'form');
  assert.equal(classifyActionHole('<button formaction='), 'submitter');
  assert.equal(classifyActionHole('<input formaction='), 'submitter');
  assert.equal(classifyActionHole('<div action='), null, 'a div binds nothing');
  assert.equal(classifyActionHole('<form formaction='), null, 'wrong attribute for the tag');
  assert.equal(classifyActionHole('<button action='), null, 'wrong attribute for the tag');
  assert.equal(classifyActionHole('<form action=x><span>'), null, 'the tag already closed');
  assert.equal(classifyActionHole('plain text'), null);
});

test('matchClosingBrace walks past a template hole (#1307)', () => {
  // A hole is a CODE context nested in a template, not a brace in the block
  // being matched. Counting it toward the outer depth (the earlier behaviour)
  // meant depth could never return to zero.
  const s = '{ return html`<b>${x}</b>`; }';
  assert.equal(matchClosingBrace(s, 1), s.length - 1);
  const nested = '{ a(html`${ b(html`${c}`) }`); }';
  assert.equal(matchClosingBrace(nested, 1), nested.length - 1);
  // Still returns -1 when there really is no match.
  assert.equal(matchClosingBrace('{ a(', 1), -1);
});

test('a class body holding a template hole is extractable from RAW source', () => {
  // Every other caller passes a masked source in which holes are blanked, so
  // this path was the one that exposed the brace bug.
  const src = [
    'class RowBtn extends WebComponent({}) {',
    '  render() { return html`<button formaction=${del}>x</button>`; }',
    '}',
  ].join('\n');
  const bodies = extractWebComponentClassBodies(src);
  assert.equal(bodies.length, 1);
  assert.match(bodies[0].body, /formaction=\$\{del\}/);
  assert.deepEqual(scanHtmlFormScopes(bodies[0].body).submitters, [{ tag: 'button', scope: 'none' }]);
});
