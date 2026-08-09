/**
 * Run the cross-runtime attribute-converter parity proof (#1340) under
 * WHICHEVER runtime executes the suite. Picked up by the root `node --test`
 * runner (so `npm test` exercises the Node path); CI reaches the Bun path
 * through `node scripts/run-bun-tests.js`, which auto-discovers
 * `test/bun/*.test.mjs` and re-runs them under `bun`, rather than through an
 * explicit per-file step. The proof is a plain assert script
 * (`attribute-converter-parity.mjs`, not `*.test.mjs`, so the runner does not
 * double-run it); importing it runs it and throws on any failure.
 */
import { test } from 'node:test';

test('a converter.fromAttribute reads identically at SSR on this runtime (#1340)', async () => {
  await import('./attribute-converter-parity.mjs');
});
