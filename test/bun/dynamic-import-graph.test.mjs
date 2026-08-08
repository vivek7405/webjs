/**
 * Run the cross-runtime dynamic-import-graph proof (#751) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner (so
 * `npm test` exercises the Node path); CI reaches the Bun path through `node
 * scripts/run-bun-tests.js`, which auto-discovers `test/bun/*.test.mjs` and
 * re-runs them under `bun`, rather than through a per-file step. The proof is
 * a plain assert script (`dynamic-import-graph.mjs`, not `*.test.mjs`, so the
 * runner does not double-run it); importing it runs it and throws on any
 * failure.
 */
import { test } from 'node:test';

test('string-literal dynamic imports are gated identically on this runtime (#751)', async () => {
  await import('./dynamic-import-graph.mjs');
});
