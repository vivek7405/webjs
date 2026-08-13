/**
 * Run the cross-runtime client-IP resolution proof (#1389) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner (so
 * `npm test` exercises the Node path); CI reaches the Bun path through
 * `node scripts/run-bun-tests.js`, which auto-discovers `test/bun/*.test.mjs`
 * and re-runs them under `bun`. The proof is a plain assert script
 * (`rate-limit-client-ip.mjs`, not `*.test.mjs`, so the runner does not
 * double-run it); importing it runs it and throws on any failure.
 */
import { test } from 'node:test';

test('rateLimit resolves the client IP identically on this runtime (#1389)', async () => {
  await import('./rate-limit-client-ip.mjs');
});
