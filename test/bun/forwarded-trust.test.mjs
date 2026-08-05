/**
 * Run the cross-runtime reverse-proxy trust proof (#1097, #1104) under
 * WHICHEVER runtime executes the suite. The root `node --test` runner picks
 * this up (so `npm test` exercises the node:http shell), and
 * `scripts/run-bun-tests.js` picks it up under `bun test` for the Bun.serve
 * shell. The AUTHORITATIVE Bun coverage is the dedicated
 * `bun test/bun/forwarded-trust.mjs` CI step (`.github/workflows/ci.yml`,
 * beside the `forwarded-proto.mjs` one it companions), which runs the plain
 * script with no per-test timeout; that step is what must be kept in step with
 * this file, since `bun test`'s 5s default per-test timeout is what put similar
 * server-booting proofs on the runner's DENYLIST. The proof itself is a plain
 * assert script (`forwarded-trust.mjs`, not `*.test.mjs`) so the runner does not
 * double-run it.
 */
import { test } from 'node:test';

test('the proxy trust posture holds on this runtime (#1097, #1104)', async () => {
  await import('./forwarded-trust.mjs');
});
