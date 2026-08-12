/**
 * Run the cross-runtime dev static-serve check (#1397) under WHICHEVER runtime
 * runs the suite. `npm test` exercises the node:http shell; CI runs
 * `bun test/bun/dev-public-before-warm.mjs` for the `Bun.serve` shell. The
 * behaviour script is a plain assert file (`dev-public-before-warm.mjs`, not
 * `*.test.mjs`, so the runner does not double-run it); importing it spawns the
 * real CLI and throws on any failure.
 */
import { test } from 'node:test';

test('dev serves /public/* before the analysis completes on this runtime (#1397)', async () => {
  await import('./dev-public-before-warm.mjs');
});
