/**
 * Run the cross-runtime host-display-default proof under WHICHEVER runtime
 * executes the suite. Picked up by the root `node --test` runner (so `npm
 * test` exercises the Node path); CI reaches the Bun path through `node
 * scripts/run-bun-tests.js`, which auto-discovers `test/bun/*.test.mjs` and
 * re-runs them under `bun`, rather than through a per-file step. The proof is
 * a plain assert script (`host-display-default.mjs`, not `*.test.mjs`, so the
 * runner does not double-run it); importing it runs it and throws on any
 * failure.
 */
import { test } from 'node:test';

test('component host display default marker renders identically on this runtime', async () => {
  await import('./host-display-default.mjs');
});
