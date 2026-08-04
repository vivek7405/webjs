/**
 * The one node-only assertion about the e2e's vendor stub (#1228), split out
 * so the rest of its coverage still runs on Bun.
 *
 * The stub answers the dev server's vendor resolve with a `data:` URL carrying
 * this repo's own copy of the package. Whether that URL is a WORKING module is
 * the property everything else rests on: a map naming a module that exports
 * nothing passes every structural check in `e2e-vendor-stub.test.mjs` and
 * still leaves the page unhydrated, which is the failure the fixture exists to
 * remove. dayjs ships UMD, and the wrap depends on it taking its global branch
 * in module scope, so a future dayjs that changed its wrapper has to fail here.
 *
 * Node-only because Bun cannot `import()` a data: URL of this size (it reads
 * the specifier as a path and raises `NameTooLong`), so this file is on the
 * Bun matrix DENYLIST. That is a limitation of importing one from Bun, not of
 * the fixture: on the Bun e2e job the URL is imported by CHROMIUM, and the
 * `differential elision (#181)` block passing under `WEBJS_E2E_RUNTIME=bun` is
 * what covers it there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// See the sibling file: the sentinel is installed before the import so the
// fixture captures it as its pass-through target and nothing reaches the
// network.
globalThis.fetch = async () => new Response('sentinel', { status: 418 });
const { localImportsFor } = await import('../e2e/fixtures/stub-jspm.mjs');

test('the emitted data: URL is a module that really exports a working dayjs', async () => {
  const imports = localImportsFor(['dayjs@1.11.21']);
  assert.ok(imports, 'the repo can serve dayjs locally');
  const mod = await import(imports.dayjs);
  assert.equal(typeof mod.default, 'function');
  // Parse a DATE STRING, not an epoch. dayjs parses `'2025-01-01'` as local
  // midnight and formats back in local time, so the round trip holds in every
  // zone. An epoch is an instant in UTC, and formatting one lands on the
  // previous day anywhere west of it, which made this fail for a contributor
  // in the Americas while CI stayed green on its UTC runners. The utc plugin
  // would be the other way out, but a `data:` URL cannot resolve it.
  assert.equal(mod.default('2025-01-01').format('MMM D, YYYY'), 'Jan 1, 2025');
});
