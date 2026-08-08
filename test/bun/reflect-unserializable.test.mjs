/**
 * Run the cross-runtime unserializable-reflection proof (#1253) under WHICHEVER
 * runtime executes the suite. Picked up by the root `node --test` runner (so
 * `npm test` exercises the Node path); CI also runs
 * `bun test/bun/reflect-unserializable.mjs` for the Bun path. The proof is a
 * plain assert script (`reflect-unserializable.mjs`, not `*.test.mjs`, so the
 * runner does not double-run it); importing it runs it and throws on any
 * failure.
 */
import { test } from 'node:test';

test('an unserializable reflected value drops identically on this runtime (#1253)', async () => {
  await import('./reflect-unserializable.mjs');
});
