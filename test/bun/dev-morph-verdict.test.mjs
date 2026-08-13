/**
 * Run the cross-runtime dev live-reload verdict check (#1398) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner, so
 * `npm test` exercises it on Node; CI runs `bun test/bun/dev-morph-verdict.mjs`
 * separately for the `Bun.serve` shell. The behaviour script is a plain assert
 * file (`dev-morph-verdict.mjs`, not `*.test.mjs`, so the runner does not
 * double-run it); importing it spawns the real CLI, edits a page and a
 * component, and throws on any failure.
 */
import { test } from 'node:test';

test('the dev reload SSE frame carries the change verdict on this runtime (#1398)', async () => {
  await import('./dev-morph-verdict.mjs');
});
