/**
 * Run the cross-runtime `live()`-in-an-attribute-hole proof (#1443) under
 * WHICHEVER runtime executes the suite. Picked up by the root `node --test`
 * runner (so `npm test` exercises the Node path); CI also runs
 * `bun test/bun/live-attribute-hole.mjs` for the Bun path. The proof is a plain
 * assert script (`live-attribute-hole.mjs`, not `*.test.mjs`, so the runner does
 * not double-run it); importing it runs it and throws on any failure.
 */
import { test } from 'node:test';

test('live() resolves in an attribute hole identically on this runtime (#1443)', async () => {
  await import('./live-attribute-hole.mjs');
});
