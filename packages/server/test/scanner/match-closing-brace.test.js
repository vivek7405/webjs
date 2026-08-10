/**
 * `matchClosingBrace`: balance a `{` against its `}` across strings, comments,
 * regex-free JS, and nested template literals.
 *
 * The template-hole case is the one worth a dedicated file. A hole is a CODE
 * context nested inside a template, not a brace in the enclosing block. The
 * previous implementation kept ONE flat depth counter and incremented it at
 * `${`, but the matching `}` arrived while the scanner was still in template
 * state, so nothing ever decremented it. Depth could not return to zero and a
 * class body containing an interpolated template was unmatchable.
 *
 * It stayed invisible because every caller passes a position-preserving MASK
 * in which holes are already blanked, so no caller ever fed it a `${`. That is
 * exactly the kind of latent defect a shared lexer should not be carrying, and
 * the counterfactual below pins the fix rather than the symptom.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchClosingBrace } from '../../src/js-scan.js';

/** Index of the `}` that closes the `{` at index 0. */
function close(src) {
  assert.equal(src[0], '{', 'fixture must start at the opening brace');
  return matchClosingBrace(src, 1);
}

test('matches a plain nested block', () => {
  const src = '{ a { b } }';
  assert.equal(close(src), src.length - 1);
});

test('walks PAST a template hole, which the flat depth counter could not', () => {
  // The regression case. With one counter this returns -1, because `${`
  // incremented a depth that its own `}` never decremented.
  const src = '{ render() { return html`<p>${x}</p>`; } }';
  assert.equal(close(src), src.length - 1);
});

test('handles several holes, and a hole holding braces of its own', () => {
  for (const src of [
    '{ html`${a}${b}` }',
    '{ html`${ { k: 1 } }` }',
    '{ html`${ items.map((i) => html`<li>${i}</li>`) }` }',
  ]) {
    assert.equal(close(src), src.length - 1, src);
  }
});

test('a brace inside a string or a template TEXT run is not counted', () => {
  for (const src of [
    '{ const a = "}"; }',
    "{ const a = '}'; }",
    '{ const a = `}`; }',
    '{ const a = "${x}"; }',
  ]) {
    assert.equal(close(src), src.length - 1, src);
  }
});

test('a brace inside a comment is not counted', () => {
  for (const src of [
    '{ // }\n }',
    '{ /* } */ }',
    '{ /* ` */ }',
  ]) {
    assert.equal(close(src), src.length - 1, src);
  }
});

test('an escaped quote does not end the string early', () => {
  const src = '{ const a = "\\"}"; }';
  assert.equal(close(src), src.length - 1);
});

test('an unterminated single-quoted string stops at the newline, not at EOF', () => {
  // A JS string cannot span a raw newline, so treating one as still-open would
  // swallow the rest of the file and report no match for a perfectly balanced
  // block.
  const src = "{ const a = 'oops\n }";
  assert.equal(close(src), src.length - 1);
});

test('returns -1 when there is genuinely no balanced brace', () => {
  assert.equal(close('{ a { b }'), -1);
});
