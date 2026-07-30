/**
 * Run the cross-runtime `asset()` url-resolution check (#1194) under whichever
 * runtime runs the suite. `npm test` covers Node; CI runs
 * `bun test/bun/asset-url.mjs` for Bun. The behaviour script is a plain assert
 * file (not `*.test.mjs`, so the runner does not double-run it).
 */
import { test } from 'node:test';

test('asset() resolves urls identically on this runtime (#1194)', async () => {
  await import('./asset-url.mjs');
});
