/**
 * Run the cross-runtime form-action dispatch proof (#1155) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner (so
 * `npm test` exercises the Node path); the Bun path runs as its own
 * `bun test/bun/form-action-dispatch.mjs` step in the `bun` job and again
 * through the `scripts/run-bun-tests.js` matrix. The proof is a plain assert
 * script (`form-action-dispatch.mjs`, not `*.test.mjs`, so the runner does not
 * double-run it); importing it runs it and throws on any failure.
 */
import { test } from 'node:test';

test('form-action dispatch behaves identically on this runtime (#1155)', async () => {
  await import('./form-action-dispatch.mjs');
});
