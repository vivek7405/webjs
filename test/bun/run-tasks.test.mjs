/**
 * Run the cross-runtime dev/start task-orchestration proof (#550) under
 * WHICHEVER runtime executes the suite. Picked up by the root `node --test`
 * runner (so `npm test` exercises the Node path); CI reaches the Bun path
 * through `node scripts/run-bun-tests.js`, which auto-discovers
 * `test/bun/*.test.mjs` and re-runs them under `bun`, rather than through a
 * per-file step. The proof is a plain assert script (`run-tasks.mjs`, not
 * `*.test.mjs`, so the runner does not double-run it); importing it runs it
 * and throws on any failure.
 */
import { test } from 'node:test';

test('dev/start before-steps + parallel teardown behave identically on this runtime (#550)', async () => {
  await import('./run-tasks.mjs');
});
