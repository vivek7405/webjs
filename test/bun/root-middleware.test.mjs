/**
 * Run the cross-runtime root-`middleware.ts` proof under WHICHEVER runtime
 * executes the suite. Picked up by the root `node --test` runner (Node path);
 * the CI `bun` job runs `bun test/bun/root-middleware.mjs` as its own step for
 * the Bun path, the same shape as the other listener proofs. The proof is a
 * plain assert script (not `*.test.mjs`), so importing it runs it.
 */
import { test } from 'node:test';

test('root middleware.ts resolves and runs on this runtime', async () => {
  await import('./root-middleware.mjs');
});
