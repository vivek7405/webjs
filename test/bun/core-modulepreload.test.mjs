/**
 * Run the cross-runtime core-runtime `modulepreload` check (#1118) under
 * whichever runtime runs the suite. `npm test` covers Node; CI runs
 * `bun test/bun/core-modulepreload.mjs` for Bun. The behaviour script is a
 * plain assert file (not `*.test.mjs`, so the runner does not double-run it).
 */
import { test } from 'node:test';

test('the core modulepreload is emitted identically on this runtime (#1118)', async () => {
  await import('./core-modulepreload.mjs');
});
