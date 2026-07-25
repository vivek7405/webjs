/**
 * Run the cross-runtime forwarded-header proof (#1090) under WHICHEVER runtime
 * executes the suite. The root `node --test` runner picks this up (so `npm test`
 * exercises the node:http shell); CI runs `bun test/bun/forwarded-proto.mjs` for
 * the Bun.serve shell, which is the one the bug was in. The proof is a plain
 * assert script (`forwarded-proto.mjs`, not `*.test.mjs`) so the runner does not
 * double-run it.
 */
import { test } from 'node:test';

test('forwarded proto/host reach the app on this runtime (#1090)', async () => {
  await import('./forwarded-proto.mjs');
});
