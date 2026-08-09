/**
 * Run the cross-runtime boot-config-validation proof under WHICHEVER runtime
 * executes the suite. Picked up by the root `node --test` runner (Node path);
 * the CI `bun` job runs `bun test/bun/webjs-config-validate.mjs` as its own step
 * for the Bun path. The proof is a plain assert script (not `*.test.mjs`), so
 * importing it runs it.
 */
import { test } from 'node:test';

test('a config typo warns and the boot completes on this runtime', async () => {
  await import('./webjs-config-validate.mjs');
});
