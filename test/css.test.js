/**
 * Unit tests for css`` tagged template + adoptStyles fallbacks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { css, isCSS, adoptStyles, stylesToString } from '../packages/core/index.js';

test('css`...` returns a CSSResult object with text + sentinel', () => {
  const r = css`a { color: red; }`;
  assert.equal(r._$webjsCss, true);
  assert.equal(r.text, 'a { color: red; }');
});

test('css interpolation: interpolates string values', () => {
  const fg = 'red';
  const r = css`a { color: ${fg}; }`;
  assert.equal(r.text, 'a { color: red; }');
});

test('css interpolation: nullish values coerce to empty string', () => {
  const r = css`a { color: ${null}; }${undefined}`;
  assert.equal(r.text, 'a { color: ; }');
});

test('isCSS: true for css`` results, false for other objects/primitives', () => {
  assert.equal(isCSS(css`x{}`), true);
  assert.equal(isCSS({ text: 'x', _$webjsCss: false }), false);
  assert.equal(isCSS({}), false);
  assert.equal(isCSS(null), false);
  assert.equal(isCSS('a{}'), false);
});

test('stylesToString: empty input returns empty string', () => {
  assert.equal(stylesToString([]), '');
  assert.equal(stylesToString(null), '');
  assert.equal(stylesToString(undefined), '');
});

test('stylesToString: wraps concatenated text in a <style> tag', () => {
  const out = stylesToString([css`a{}`, css`b{}`]);
  assert.equal(out, '<style>a{}\nb{}</style>');
});

test('adoptStyles: no-op on empty/nullish input', () => {
  assert.doesNotThrow(() => adoptStyles(/** @type any */ ({}), []));
  assert.doesNotThrow(() => adoptStyles(/** @type any */ ({}), null));
});

test('adoptStyles: uses adoptedStyleSheets when available on the root', () => {
  // Simulate a ShadowRoot that supports adoptedStyleSheets. Node has no
  // native CSSStyleSheet; shim a minimal one that records replaceSync().
  const replaced = [];
  class FakeSheet {
    replaceSync(text) { replaced.push(text); }
  }
  const prev = /** @type any */ (globalThis).CSSStyleSheet;
  /** @type any */ (globalThis).CSSStyleSheet = FakeSheet;
  try {
    const root = /** @type any */ ({ adoptedStyleSheets: [] });
    adoptStyles(root, [css`a{color:red}`, css`b{display:none}`]);
    assert.equal(root.adoptedStyleSheets.length, 2);
    assert.equal(replaced[0], 'a{color:red}');
    assert.equal(replaced[1], 'b{display:none}');
  } finally {
    /** @type any */ (globalThis).CSSStyleSheet = prev;
  }
});

test('adoptStyles: falls back to <style> tag when adoptedStyleSheets unavailable', () => {
  // Simulate a legacy root without adoptedStyleSheets. In this branch
  // the code calls `document.createElement('style')` and appends it to
  // the root — we shim both.
  const appended = [];
  const el = { textContent: '' };
  const docBefore = globalThis.document;
  globalThis.document = /** @type any */ ({
    createElement: (tag) => { assert.equal(tag, 'style'); return el; },
  });
  try {
    const root = /** @type any */ ({
      // Critically: NO adoptedStyleSheets property, NO CSSStyleSheet
      // constructor reachability is still fine — the guard on line 32
      // is `'adoptedStyleSheets' in root`, which is false here.
      appendChild: (node) => { appended.push(node); },
    });
    adoptStyles(root, [css`a{color:red}`, css`b{display:none}`]);
    assert.equal(appended.length, 1);
    assert.equal(appended[0], el);
    assert.equal(el.textContent, 'a{color:red}\nb{display:none}');
  } finally {
    globalThis.document = docBefore;
  }
});
