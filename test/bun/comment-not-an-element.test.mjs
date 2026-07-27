/**
 * Run the cross-runtime HTML-context proof (#1128) under WHICHEVER runtime
 * executes the suite. Picked up by the root `node --test` runner (so `npm test`
 * exercises the Node path); CI also runs `bun test/bun/comment-not-an-element.mjs`
 * for the Bun path. The proof is a plain assert script
 * (`comment-not-an-element.mjs`, not `*.test.mjs`, so the runner does not
 * double-run it); importing it runs it and throws on any failure.
 */
import { test } from 'node:test';

test('SSR treats comments, raw text, and RCDATA as text on this runtime (#1128)', async () => {
  await import('./comment-not-an-element.mjs');
});
