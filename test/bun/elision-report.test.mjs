/**
 * Run the cross-runtime elision-verdict proof (#1308) under WHICHEVER runtime
 * executes the suite. Picked up by the root `node --test` runner (Node path);
 * the CI `bun` job also runs `bun test/bun/elision-report.mjs` for the Bun path.
 * The proof is a plain assert script (not `*.test.mjs`), so importing it runs it.
 */
import { test } from 'node:test';

test('the app-level elision verdict is identical on this runtime (#1308)', async () => {
  await import('./elision-report.mjs');
});
