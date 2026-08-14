/**
 * Run the cross-runtime SSR escaping / 404 / boundary check under whichever
 * runtime runs the suite. `npm test` covers Node; CI runs
 * `bun test/bun/ssr-escape-parity.mjs` for Bun. The behaviour script is a plain
 * assert file (not `*.test.mjs`, so the runner does not double-run it).
 */
import { test } from 'node:test';

test('SSR escaping, 404 caching and boundary errors match on this runtime (#1365)', async () => {
  await import('./ssr-escape-parity.mjs');
});
