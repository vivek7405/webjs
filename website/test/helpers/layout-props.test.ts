/**
 * Guard for the `layoutProps` test helper.
 *
 * The helper rebuilds the thenable `params` / `searchParams` shape the server
 * hands a layout (#848), and the rebuild has one detail that is easy to get
 * wrong and impossible to notice: `then` has to be NON-ENUMERABLE, and the
 * promise it returns has to resolve to a copy that does not carry it. Install
 * `then` as an ordinary own property instead and the resolved copy is itself a
 * thenable, so `Promise.resolve` adopts it, calls its `then`, and gets another
 * thenable. `await params` then never settles and starves the microtask queue
 * hard enough that timers stop firing, which reads as a hung process rather
 * than a failed assertion.
 *
 * The bug is invisible to every other test in this suite, because none of them
 * awaits `params`. So it is asserted here directly: read it synchronously,
 * await it, and confirm nothing enumerable leaked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { html } from '@webjsdev/core';
import { layoutProps } from '#test/helpers/layout-props.ts';

test('params and searchParams are synchronously readable', () => {
  const props = layoutProps(html`<main>x</main>`, {
    params: { slug: 'hello' },
    searchParams: { page: '2' },
  });
  assert.equal(props.params.slug, 'hello');
  assert.equal(props.searchParams.page, '2');
});

test('params and searchParams are awaitable, and awaiting settles', async () => {
  const props = layoutProps(html`<main>x</main>`, { params: { slug: 'hello' } });
  assert.deepEqual(await props.params, { slug: 'hello' });
  assert.deepEqual(await props.searchParams, {});
  // A timer firing after the awaits proves the microtask queue was not starved,
  // which is the symptom of an enumerable `then` re-adopting its own copy.
  await new Promise((resolve) => setTimeout(resolve, 20));
});

test('the thenable never leaks into enumeration, spread, or JSON', () => {
  const props = layoutProps(html`<main>x</main>`, { params: { slug: 'hello' } });
  assert.deepEqual(Object.keys(props.params), ['slug']);
  assert.deepEqual({ ...props.params }, { slug: 'hello' });
  assert.deepEqual(JSON.parse(JSON.stringify(props.params)), { slug: 'hello' });
});

test('overrides fill the fields a test names and default the rest', () => {
  const props = layoutProps(html`<main>x</main>`, { url: 'https://webjs.dev/blog' });
  assert.equal(props.url, 'https://webjs.dev/blog');
  assert.deepEqual(Object.keys(props.params), []);
  assert.equal(layoutProps(html`<main>x</main>`).url, 'https://webjs.dev/');
});
