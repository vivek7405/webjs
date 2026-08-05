/**
 * Run the proof-script exit-code guard (#1092) under WHICHEVER runtime executes
 * the suite. The root `node --test` runner picks this up (so `npm test` proves
 * the node path); CI runs `bun test/bun/proof-exit-code.mjs` for the Bun path,
 * which is where the swallowed exit code was first observed. The guard is a
 * plain assert script (`proof-exit-code.mjs`, not `*.test.mjs`) so the runner
 * does not double-run it.
 *
 * This is the meta-test for the rest of `test/bun/`: it is what keeps every
 * OTHER script in this directory able to fail.
 */
import { test } from 'node:test';

test('a failing proof script exits non-zero on this runtime (#1092)', async () => {
  await import('./proof-exit-code.mjs');
});
