/**
 * Run the cross-runtime vendor-scan proof (#1399) under WHICHEVER runtime
 * executes the suite. Picked up by the root `node --test` runner (Node path);
 * the CI `bun` job also runs `bun test/bun/vendor-scan.mjs` for the Bun path.
 * The proof is a plain assert script (not `*.test.mjs`), so importing it runs it.
 */
import { test } from 'node:test';

test('the vendor specifier scan is identical on this runtime (#1399)', async () => {
  await import('./vendor-scan.mjs');
});
