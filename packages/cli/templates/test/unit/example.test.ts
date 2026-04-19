/**
 * Example unit test — replace with tests for your modules.
 *
 * Run:  npx webjs test
 * Or:   node --test test/unit/*.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, renderToString } from '@webjs/core';

test('html template renders correctly', async () => {
  const result = await renderToString(html`<p>Hello, ${'world'}!</p>`);
  assert.ok(result.includes('Hello, world!'));
});

test('example: your first server action test', async () => {
  // Import your server action:
  // import { createPost } from '../../modules/posts/actions/create-post.server.ts';
  //
  // const result = await createPost({ title: 'Test', body: 'Content' });
  // assert.equal(result.success, true);
  // assert.ok(result.data.id);
  assert.ok(true, 'Replace this with real tests');
});
