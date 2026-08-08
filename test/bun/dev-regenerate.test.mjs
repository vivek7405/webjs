/**
 * Run the cross-runtime on-request-regeneration proof (#967) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner (so
 * `npm test` exercises the Node path); CI reaches the Bun path through `node
 * scripts/run-bun-tests.js`, which auto-discovers `test/bun/*.test.mjs` and
 * re-runs them under `bun`, rather than through a per-file step. The proof is
 * a plain assert script (`dev-regenerate.mjs`, not `*.test.mjs`, so the runner
 * does not double-run it); importing it runs it and throws on any failure.
 */
import { test } from 'node:test';

test('on-request dev regeneration rebuilds a stale output and skips a fresh one on this runtime (#967)', async () => {
  await import('./dev-regenerate.mjs');
});
