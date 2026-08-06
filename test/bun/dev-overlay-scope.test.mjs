/**
 * Run the cross-runtime dev error overlay scope check (#1047) under WHICHEVER
 * runtime runs the suite. `npm test` exercises the node:http shell; CI runs
 * `bun test/bun/dev-overlay-scope.mjs` for the `Bun.serve` shell. The behaviour
 * script is a plain assert file (`dev-overlay-scope.mjs`, not `*.test.mjs`, so
 * the runner does not double-run it); importing it spawns the real CLI and
 * throws on any failure.
 */
import { test } from 'node:test';

test('dev error frames are URL-scoped and prefetch-exempt on this runtime (#1047)', async () => {
  await import('./dev-overlay-scope.mjs');
});
