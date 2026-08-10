/**
 * Run the cross-runtime attribute-reader parity proof (#1341) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner (so
 * `npm test` exercises the Node path); CI reaches the Bun path through
 * `node scripts/run-bun-tests.js`, which auto-discovers `test/bun/*.test.mjs`
 * and re-runs them under `bun`, rather than through an explicit per-file step.
 * The proof is a plain assert script (`attribute-reader-parity.mjs`, not
 * `*.test.mjs`, so the runner does not double-run it); importing it runs it and
 * throws on any failure.
 */
import { test } from 'node:test';

test('the SSR attribute reader sees the browser attribute set on this runtime (#1341)', async () => {
  await import('./attribute-reader-parity.mjs');
});
