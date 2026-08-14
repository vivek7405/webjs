/**
 * Run the cross-runtime boundary-chain SSR proof (#1298) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner (so
 * `npm test` exercises the Node path); CI reaches the Bun path through `node
 * scripts/run-bun-tests.js`, which auto-discovers `test/bun/*.test.mjs` and
 * re-runs them under `bun`. The proof is a plain assert script
 * (`ssr-boundary-chain.mjs`, not `*.test.mjs`, so the runner does not
 * double-run it); importing it runs it and throws on any failure.
 */
import { test } from 'node:test';

test('a boundary response carries its layout chain markers on this runtime (#1298)', async () => {
  await import('./ssr-boundary-chain.mjs');
});
