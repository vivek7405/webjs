// A node unit test (webjs test --server): `renderToString` server-renders an
// html`` template to a string, with Declarative Shadow DOM for shadow-DOM
// components. Import it from `@webjsdev/core/server` (NOT the root), so the test
// stays explicit about which side it runs on. Use it to assert SSR output and
// escaping without a browser; for a full request through the pipeline, use the
// handle() harness from @webjsdev/server/testing instead (see the testing docs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

test('renderToString renders interpolated text and escapes it', async () => {
  const out = await renderToString(html`<p>${'hello'}</p>`);
  assert.match(out, /hello/);
});

test('renderToString escapes an interpolated angle bracket (no injection)', async () => {
  const out = await renderToString(html`<p>${'<script>'}</p>`);
  assert.doesNotMatch(out, /<script>/);
});
