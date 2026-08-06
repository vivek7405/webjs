/**
 * Ported from lit-html's cache directive test suite
 * (packages/lit-html/src/test/directives/cache_test.ts) to exercise
 * webjs's `cache` directive (applyCache in render-client.js).
 *
 * Goal: surface bugs in DOM retention, re-attach, value reconciliation,
 * and detach/reattach lifecycle when toggling between cached templates.
 *
 * Skipped tests:
 *   - "caches compiled templates" (lit-internal _$LH compile cache,
 *     webjs uses TemplateStringsArray identity instead).
 *   - "cache can switch between TemplateResult and non-TemplateResult"
 *     uses lit's `nothing` sentinel which webjs does not ship.
 *   - "async directives disconnect/reconnect when moved in/out of cache"
 *     requires AsyncDirective + directive() factory which webjs does not
 *     ship (the analogous lifecycle in webjs is part-state mutation).
 */
import { html } from '../../../src/html.js';
import { render } from '../../../src/render-client.js';
import { cache } from '../../../src/directives.js';

import { assert } from '../../../../../test/browser-assert.js';

/**
 * Strip the renderer's marker comments (it brackets each instance with a
 * `wjm-s` / `wjm-e` pair and marks each hole with a `wjm-N`; tests here assert
 * plain HTML). Note this hides marker ACCOUNTING by construction, so it cannot
 * be used to show markers are balanced. Assertions about that live in
 * `rendering/marker-leak-on-teardown.test.js`, which counts them directly.
 */
function stripExpressionComments(s) {
  return s.replace(/<!--[\s\S]*?-->/g, '');
}

suite('cache directive (lit parity port)', () => {
  let container;

  setup(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  teardown(() => {
    container.remove();
  });

  test('caches templates', () => {
    // Stable factories so `strings` identity is preserved across renders.
    // The webjs cache map keys on `strings`; if the template literal is
    // re-evaluated per call against fresh strings, the cache miss would
    // hide the retention behavior the test wants to verify.
    const tplDiv = (v) => html`<div v=${v}></div>`;
    const tplSpan = (v) => html`<span v=${v}></span>`;
    const renderCached = (condition, v) =>
      render(
        html`${cache(condition ? tplDiv(v) : tplSpan(v))}`,
        container
      );

    renderCached(true, 'A');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<div v="A"></div>'
    );
    const element1 = container.firstElementChild;

    renderCached(false, 'B');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<span v="B"></span>'
    );
    const element2 = container.firstElementChild;

    assert.notStrictEqual(element1, element2);

    renderCached(true, 'C');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<div v="C"></div>'
    );
    assert.strictEqual(container.firstElementChild, element1,
      'Returning to template A should re-attach the original element');

    renderCached(false, 'D');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<span v="D"></span>'
    );
    assert.strictEqual(container.firstElementChild, element2,
      'Returning to template B should re-attach the original element');
  });

  // SKIPPED: webjs does not ship lit's _$LH CompiledTemplate format.
  // The "caches templates" test above already exercises the equivalent
  // path via TemplateStringsArray identity.

  test('renders non-TemplateResults', () => {
    render(html`${cache('abc')}`, container);
    assert.equal(stripExpressionComments(container.innerHTML), 'abc');
  });

  test('caches templates when switching against non-TemplateResults', () => {
    const tplDiv = (v) => html`<div v=${v}></div>`;
    const renderCached = (condition, v) =>
      render(
        html`${cache(condition ? tplDiv(v) : v)}`,
        container
      );

    renderCached(true, 'A');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<div v="A"></div>'
    );
    const element1 = container.firstElementChild;

    renderCached(false, 'B');
    assert.equal(stripExpressionComments(container.innerHTML), 'B');

    renderCached(true, 'C');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<div v="C"></div>'
    );
    assert.strictEqual(container.firstElementChild, element1,
      'Re-attaching template A after a non-template excursion should ' +
      'restore the original element');

    renderCached(false, 'D');
    assert.equal(stripExpressionComments(container.innerHTML), 'D');
  });

  test('caches templates when switching against TemplateResult and undefined values', () => {
    const tplA = html`A`;
    const tplB = html`B`;
    const renderCached = (v) =>
      render(html`<div>${cache(v)}</div>`, container);

    renderCached(tplA);
    assert.equal(stripExpressionComments(container.innerHTML), '<div>A</div>');

    renderCached(undefined);
    assert.equal(stripExpressionComments(container.innerHTML), '<div></div>');

    renderCached(tplB);
    assert.equal(stripExpressionComments(container.innerHTML), '<div>B</div>');
  });

  test('cache can be dynamic', () => {
    const tplDiv = (v) => html`<div v=${v}></div>`;
    // Outer template literal differs depending on the branch (cache vs raw)
    // so this also stresses the "directive applied at varying part" path.
    const renderMaybeCached = (condition, v) =>
      render(
        html`${condition ? cache(tplDiv(v)) : v}`,
        container
      );

    renderMaybeCached(true, 'A');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<div v="A"></div>'
    );

    renderMaybeCached(false, 'B');
    assert.equal(stripExpressionComments(container.innerHTML), 'B');

    renderMaybeCached(true, 'C');
    assert.equal(
      stripExpressionComments(container.innerHTML),
      '<div v="C"></div>'
    );

    renderMaybeCached(false, 'D');
    assert.equal(stripExpressionComments(container.innerHTML), 'D');
  });

  // SKIPPED: lit uses `nothing` to clear a part. webjs has no `nothing`
  // sentinel; the analogous behavior is tested via `undefined` and via
  // non-template values above.

  // SKIPPED: AsyncDirective / directive() are lit-internal abstractions
  // webjs does not ship. The disconnect/reconnect lifecycle webjs offers
  // is part-level, not directive-level, and is exercised by the
  // "preserves input state" test in directives.test.js.

  // ---- Additional coverage beyond the lit port ----
  // These tests probe the same DOM-retention contract from angles the
  // lit suite doesn't exercise, surfacing implementation-specific bugs.

  test('cache: input state survives detach and re-attach', () => {
    // Confirms the cache really detaches into a holder fragment (not
    // re-creates) so live state like input.value is preserved.
    const tplForm = (label) => html`<form><input class="x" value=${label}></form>`;
    const tplOther = () => html`<p>other</p>`;
    const renderCached = (which) =>
      render(html`<div>${cache(which === 'a' ? tplForm('init') : tplOther())}</div>`, container);

    renderCached('a');
    const input = container.querySelector('input.x');
    assert.ok(input);
    input.value = 'user-typed';

    renderCached('b');
    assert.equal(container.querySelector('input.x'), null);

    renderCached('a');
    const reattached = container.querySelector('input.x');
    assert.strictEqual(reattached, input, 'identity preserved');
    assert.equal(reattached.value, 'user-typed', 'live state preserved');
  });

  test('cache: same template re-rendered in place reconciles values without detach', () => {
    const tpl = (v) => html`<div v=${v}></div>`;
    const renderCached = (v) => render(html`${cache(tpl(v))}`, container);

    renderCached('1');
    const first = container.firstElementChild;
    renderCached('2');
    const second = container.firstElementChild;
    assert.strictEqual(first, second,
      'Re-rendering the same cached template should NOT detach or remount');
    assert.equal(second.getAttribute('v'), '2');
  });

  test('cache: three-way toggle preserves all three templates', () => {
    const tplA = (v) => html`<a-tag v=${v}></a-tag>`;
    const tplB = (v) => html`<b-tag v=${v}></b-tag>`;
    const tplC = (v) => html`<c-tag v=${v}></c-tag>`;
    const renderCached = (which, v) =>
      render(
        html`${cache(which === 'a' ? tplA(v) : which === 'b' ? tplB(v) : tplC(v))}`,
        container,
      );

    renderCached('a', '1');
    const elA = container.firstElementChild;
    renderCached('b', '1');
    const elB = container.firstElementChild;
    renderCached('c', '1');
    const elC = container.firstElementChild;
    assert.notStrictEqual(elA, elB);
    assert.notStrictEqual(elB, elC);
    assert.notStrictEqual(elA, elC);

    renderCached('a', '2');
    assert.strictEqual(container.firstElementChild, elA);
    assert.equal(elA.getAttribute('v'), '2');

    renderCached('b', '2');
    assert.strictEqual(container.firstElementChild, elB);
    assert.equal(elB.getAttribute('v'), '2');

    renderCached('c', '2');
    assert.strictEqual(container.firstElementChild, elC);
    assert.equal(elC.getAttribute('v'), '2');
  });

  test('cache: nested cache directives each retain their own DOM', () => {
    const innerTplA = (v) => html`<inner-a v=${v}></inner-a>`;
    const innerTplB = (v) => html`<inner-b v=${v}></inner-b>`;
    const outerTplX = (innerWhich, innerVal) =>
      html`<outer-x>${cache(innerWhich === 'a' ? innerTplA(innerVal) : innerTplB(innerVal))}</outer-x>`;
    const outerTplY = (innerWhich, innerVal) =>
      html`<outer-y>${cache(innerWhich === 'a' ? innerTplA(innerVal) : innerTplB(innerVal))}</outer-y>`;
    const renderAll = (outerWhich, innerWhich, innerVal) =>
      render(
        html`${cache(outerWhich === 'x' ? outerTplX(innerWhich, innerVal) : outerTplY(innerWhich, innerVal))}`,
        container,
      );

    renderAll('x', 'a', '1');
    const outerX = container.querySelector('outer-x');
    const innerA = container.querySelector('inner-a');
    assert.ok(outerX);
    assert.ok(innerA);

    renderAll('y', 'b', '1');
    const outerY = container.querySelector('outer-y');
    assert.ok(outerY);
    assert.equal(container.querySelector('outer-x'), null);

    renderAll('x', 'a', '2');
    assert.strictEqual(container.querySelector('outer-x'), outerX,
      'outer cached node restored');
    // Inner cache lives on the OUTER instance, so when the outer instance
    // is re-attached, the inner instance it last had (inner-a from '1')
    // is what comes back. Lit + webjs both behave this way.
    assert.strictEqual(container.querySelector('inner-a'), innerA);
    assert.equal(innerA.getAttribute('v'), '2');
  });

  test('cache: clearing to undefined then returning re-attaches', () => {
    const tpl = (v) => html`<div v=${v}></div>`;
    const renderCached = (val) => render(html`<x>${cache(val)}</x>`, container);

    renderCached(tpl('A'));
    const el1 = container.querySelector('div');
    assert.ok(el1);

    renderCached(undefined);
    assert.equal(container.querySelector('div'), null);

    renderCached(tpl('B'));
    const el2 = container.querySelector('div');
    assert.strictEqual(el2, el1, 'div re-attached after undefined excursion');
    assert.equal(el2.getAttribute('v'), 'B');
  });
});
