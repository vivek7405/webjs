import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scanHtmlFormScopes,
  classifyActionHole,
  matchClosingBrace,
  extractWebComponentClassBodies,
  redactStringsAndTemplates,
} from '../../src/js-scan.js';
import { PARSEABLE_ENCTYPES } from '../../../core/src/form-action.js';

/**
 * Unit tests for the lexical half of `submitter-needs-bound-form` (#1307):
 * the whole-app rule in `check.js` is only as good as the scan under it, and
 * the shapes it must NOT read as markup (a plain string, a `css` template, an
 * HTML comment) are what keep the rule from firing on a docs page.
 */

test('a submitter reports the scope of its enclosing form', () => {
  assert.deepEqual(
    scanHtmlFormScopes('html`<form action=${save}><button formaction=${del}>x</button></form>`').submitters,
    [{ tag: 'button', scope: 'bound', delivers: null }],
  );
  assert.deepEqual(
    scanHtmlFormScopes('html`<form><button formaction=${del}>x</button></form>`').submitters,
    [{ tag: 'button', scope: 'unbound', delivers: false }],
  );
  assert.deepEqual(
    scanHtmlFormScopes('html`<button formaction=${del}>x</button>`').submitters,
    [{ tag: 'button', scope: 'none', delivers: null }],
  );
});

test('a nested template inherits the enclosing form scope', () => {
  // What the renderer does: `render` threads `formScope` through arrays,
  // `repeat`, and nested templates, so a per-row button in a bound form is
  // bound.
  const bound = 'html`<form action=${save}>${rows.map((r) => html`<button formaction=${del}>x</button>`)}</form>`';
  assert.deepEqual(scanHtmlFormScopes(bound).submitters, [{ tag: 'button', scope: 'bound', delivers: null }]);
  const unbound = 'html`<form>${rows.map((r) => html`<button formaction=${del}>x</button>`)}</form>`';
  assert.deepEqual(scanHtmlFormScopes(unbound).submitters, [{ tag: 'button', scope: 'unbound', delivers: false }]);
});

test('the scope closes at </form> and does not leak forward', () => {
  const src = 'html`<form action=${save}></form><button formaction=${del}>x</button>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'none', delivers: null }]);
});

test('a start tag split across holes is still one tag', () => {
  const src = 'html`<form action=${save} class="a"><button class=${c} formaction=${del}>x</button></form>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'bound', delivers: null }]);
});

test('a `>` inside a quoted attribute value does not close the tag', () => {
  const src = 'html`<form action=${save}><div title="a>b"></div><button formaction=${del}>x</button></form>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'bound', delivers: null }]);
});

test('a custom-element start tag is reported, its close tag is not', () => {
  assert.deepEqual(
    scanHtmlFormScopes('html`<form action=${save}><row-btn></row-btn></form>`').tagUses,
    [{ tag: 'row-btn', scope: 'bound', delivers: null }],
  );
  assert.deepEqual(
    scanHtmlFormScopes('html`<form><row-btn></row-btn></form>`').tagUses,
    [{ tag: 'row-btn', scope: 'unbound', delivers: false }],
  );
});

test('only an html-tagged literal is read as markup', () => {
  // The carve-out the whole rule rests on: the framework's own website renders
  // `<form action=${fn}>` as a code SAMPLE.
  assert.deepEqual(scanHtmlFormScopes("const s = '<form><button formaction=x></button></form>';").submitters, []);
  assert.deepEqual(scanHtmlFormScopes('css`.a { }` + html`<row-btn></row-btn>`').tagUses, [{ tag: 'row-btn', scope: 'none', delivers: null }]);
  // A form written inside a plain string cannot open a scope for real markup.
  const mixed = "const s = '<form>'; export default () => html`<button formaction=${del}>x</button>`;";
  assert.deepEqual(scanHtmlFormScopes(mixed).submitters, [{ tag: 'button', scope: 'none', delivers: null }]);
});

test('an HTML comment is not markup', () => {
  const src = 'html`<!-- <form> --><button formaction=${del}>x</button>`';
  assert.deepEqual(scanHtmlFormScopes(src).submitters, [{ tag: 'button', scope: 'none', delivers: null }]);
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
  assert.deepEqual(scanHtmlFormScopes(bodies[0].body).submitters, [{ tag: 'button', scope: 'none', delivers: null }]);
});

test('an unbound form reports whether it would still DELIVER the identity', () => {
  // This is the bit that decides broken from working, and it is not boundness.
  // A submitter's identity rides its OWN name/value pair, so an unbound form
  // that still sends a parseable POST body delivers it and the action runs.
  const sub = (formTag) => scanHtmlFormScopes(
    'html`' + formTag + '<button formaction=${del}>x</button></form>`',
  ).submitters[0];

  assert.equal(sub('<form method="post">').delivers, true, 'a POST body carries the pair');
  assert.equal(sub('<form method="POST">').delivers, true, 'the keyword folds case');
  assert.equal(sub('<form method="post" enctype="multipart/form-data">').delivers, true);
  assert.equal(sub('<form>').delivers, false, 'no method is a GET');
  assert.equal(sub('<form method="get">').delivers, false);
  // `method` is an enumerated attribute matched against exact keywords with no
  // whitespace stripping, so a padded value falls to the GET default.
  assert.equal(sub('<form method=" post ">').delivers, false);
  assert.equal(sub('<form method="post" enctype="text/plain">').delivers, false, 'the server cannot parse it');
  // `enctype` is an enumerated attribute whose missing AND invalid value default
  // are both application/x-www-form-urlencoded, so an unrecognised value falls
  // back to a parseable body. Treating it as unparseable reported a working form
  // as broken, which is the one thing this rule must never do.
  assert.equal(sub('<form method="post" enctype="nonsense">').delivers, true, 'an invalid enctype falls back to urlencoded');
  assert.equal(sub('<form method="post" enctype=" text/plain ">').delivers, true, 'padded, so invalid, so urlencoded');
  assert.equal(sub('<form method="post" enctype="TEXT/PLAIN">').delivers, false, 'the keyword folds case');
  // A hole anywhere else in the start tag makes the answer dynamic.
  assert.equal(sub('<form method=${m}>').delivers, null);
  assert.equal(sub('<form enctype=${e} method="post">').delivers, null);
});

test('opensForm reports whether the source opens any form at all', () => {
  assert.equal(scanHtmlFormScopes('html`<button formaction=${d}>x</button>`').opensForm, false);
  assert.equal(scanHtmlFormScopes('html`<form action=${s}></form>`').opensForm, true);
  // A form written only inside a plain string is not a form.
  assert.equal(scanHtmlFormScopes("const s = '<form>';").opensForm, false);
});

test('class-body offsets index the RAW source identically to the mask', () => {
  // How the rule gets a body with its templates intact without asking the brace
  // matcher to lex raw source: locate in the position-preserving mask, slice
  // from `content`. A regex literal holding a brace is the case that broke when
  // raw source was passed directly.
  const src = [
    'class RowBtn extends WebComponent({}) {',
    '  static re = /[{]/;',
    '  render() { return html`<button formaction=${del}>x</button>`; }',
    '}',
  ].join('\n');
  const masked = redactStringsAndTemplates(src);
  assert.equal(masked.length, src.length, 'the mask is position-preserving');
  const bodies = extractWebComponentClassBodies(masked);
  assert.equal(bodies.length, 1, 'the masked view blanks the regex body, so the braces balance');
  const body = src.slice(bodies[0].bodyStart, bodies[0].bodyEnd);
  assert.match(body, /formaction=\$\{del\}/, 'the raw slice keeps the template intact');
  assert.deepEqual(scanHtmlFormScopes(body).submitters, [{ tag: 'button', scope: 'none', delivers: null }]);
});

test('a template in a START-TAG hole does not inherit the lexical scope', () => {
  // A hole inside a start tag is an attribute or property VALUE, so the template
  // is handed to the receiving element and rendered in THAT component's own
  // pass. Scoring it by lexical nesting reported a shape the renderer treats as
  // cannot-tell (and therefore binds) as a conclusive 'unbound'.
  const passed = 'html`<form method="post"><my-thing .tpl=${html`<button formaction=${del}>x</button>`}></my-thing></form>`';
  assert.deepEqual(scanHtmlFormScopes(passed).submitters, [{ tag: 'button', scope: 'none', delivers: null }]);
  // A hole in CHILD position IS rendered inline by this scan, so it still
  // inherits. This is the pair that keeps the fix from being a blanket opt-out.
  const child = 'html`<form method="post">${html`<button formaction=${del}>x</button>`}</form>`';
  assert.deepEqual(scanHtmlFormScopes(child).submitters, [{ tag: 'button', scope: 'unbound', delivers: true }]);
});

test('the unparseable-enctype constant tracks the renderer\'s own set', () => {
  // The scanner states its enctype rule as a DENYLIST of one because of the
  // invalid-value default, while the renderer refuses the wider allowlist. This
  // pins the relationship rather than asserting the two are equal, so a change
  // to core's set surfaces here instead of drifting silently.
  assert.ok(!PARSEABLE_ENCTYPES.has('text/plain'), 'the renderer cannot parse text/plain either');
  for (const e of PARSEABLE_ENCTYPES) {
    const src = `html\`<form method="post" enctype="${e}"><button formaction=\${d}>x</button></form>\``;
    assert.equal(scanHtmlFormScopes(src).submitters[0].delivers, true, `${e} delivers`);
  }
  assert.deepEqual([...PARSEABLE_ENCTYPES].sort(),
    ['application/x-www-form-urlencoded', 'multipart/form-data'],
    'if core gains an enctype, revisit the scanner denylist');
});
