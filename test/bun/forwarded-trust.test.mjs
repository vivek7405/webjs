/**
 * Run the cross-runtime reverse-proxy trust proof (#1097, #1104) under
 * WHICHEVER runtime executes the suite. The root `node --test` runner picks
 * this up (so `npm test` exercises the node:http shell); CI runs
 * `bun test/bun/forwarded-trust.mjs` for the Bun.serve shell. The proof is a
 * plain assert script (`forwarded-trust.mjs`, not `*.test.mjs`) so the runner
 * does not double-run it.
 */
import { test } from 'node:test';

test('the proxy trust posture holds on this runtime (#1097, #1104)', async () => {
  await import('./forwarded-trust.mjs');
});
