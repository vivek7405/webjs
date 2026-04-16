import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, renderToString } from '../packages/core/index.js';
import { unsafeHTML, isUnsafeHTML, live, isLive } from '../packages/core/src/directives.js';

// --- unsafeHTML ---

test('unsafeHTML: creates marker with correct shape', () => {
  const result = unsafeHTML('<b>bold</b>');
  assert.equal(result._$webjs, 'unsafe-html');
  assert.equal(result.value, '<b>bold</b>');
});

test('unsafeHTML: coerces null/undefined to empty string', () => {
  assert.equal(unsafeHTML(null).value, '');
  assert.equal(unsafeHTML(undefined).value, '');
});

test('isUnsafeHTML: detects markers', () => {
  assert.ok(isUnsafeHTML(unsafeHTML('hi')));
  assert.ok(!isUnsafeHTML('hi'));
  assert.ok(!isUnsafeHTML(null));
  assert.ok(!isUnsafeHTML({ _$webjs: 'template' }));
});

test('unsafeHTML: server renderer injects raw HTML without escaping', async () => {
  const result = await renderToString(html`<div>${unsafeHTML('<b>bold</b>')}</div>`);
  assert.ok(result.includes('<b>bold</b>'), `Expected raw HTML, got: ${result}`);
  // Normal text would be escaped
  const escaped = await renderToString(html`<div>${'<b>bold</b>'}</div>`);
  assert.ok(escaped.includes('&lt;b&gt;'), 'Normal text should be escaped');
});

test('unsafeHTML: empty string renders nothing', async () => {
  const result = await renderToString(html`<div>${unsafeHTML('')}</div>`);
  assert.ok(result.includes('<div></div>'));
});

// --- live ---

test('live: creates marker with correct shape', () => {
  const result = live('hello');
  assert.equal(result._$webjs, 'live');
  assert.equal(result.value, 'hello');
});

test('isLive: detects markers', () => {
  assert.ok(isLive(live('x')));
  assert.ok(!isLive('x'));
  assert.ok(!isLive(null));
});

test('live: server renderer unwraps to inner value', async () => {
  const result = await renderToString(html`<div>${live('hello')}</div>`);
  assert.ok(result.includes('hello'), `Expected unwrapped value, got: ${result}`);
});
