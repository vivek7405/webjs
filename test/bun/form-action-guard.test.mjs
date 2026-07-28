/**
 * Run the cross-runtime form-action guard proof (#1154) under WHICHEVER runtime
 * executes the suite. Picked up by the root `node --test` runner (so `npm test`
 * exercises the Node path); CI also runs `bun test/bun/form-action-guard.mjs`
 * for the Bun path. The proof is a plain assert script (`form-action-guard.mjs`,
 * not `*.test.mjs`, so the runner does not double-run it); importing it runs it
 * and throws on any failure.
 */
import { test } from 'node:test';

test('the form-action leak guard refuses identically on this runtime (#1154)', async () => {
  await import('./form-action-guard.mjs');
});
