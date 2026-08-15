/**
 * Run the cross-runtime route-table boundary proof (#848, #1298) under
 * WHICHEVER runtime executes the suite. Picked up by the root `node --test`
 * runner (so `npm test` exercises the Node path); CI reaches the Bun path
 * through `node scripts/run-bun-tests.js`, which auto-discovers
 * `test/bun/*.test.mjs` and re-runs them under `bun`. The proof is a plain
 * assert script (`routing-boundaries.mjs`, not `*.test.mjs`, so the runner does
 * not double-run it); importing it runs it and throws on any failure.
 *
 * Before this wrapper existed the proof ran on Bun in CI and NEVER on Node, so
 * a Node-only regression in it would have gone unseen.
 */
import { test } from 'node:test';

test('route-table boundary parsing and layout derivation on this runtime (#848, #1298)', async () => {
  await import('./routing-boundaries.mjs');
});
