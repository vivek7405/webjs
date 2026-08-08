/**
 * Regression for the `/client-router` half of the #222 class, found while
 * widening the `.d.ts` coverage guard (#1291): `@webjsdev/core/client-router`'s
 * `default` condition points at `dist/webjs-core-browser.js`, so in DIST mode
 * the subpath resolves to the browser bundle rather than to
 * `src/router-client.js`. The bundle re-exported four of the five functions the
 * subpath's published `types` (`src/router-client.d.ts`) declare, so
 * `import { loadFrame } from '@webjsdev/core/client-router'` type-checked,
 * worked in DEV (where the subpath maps to the source module) and was
 * `undefined` in production.
 *
 * Neither `.d.ts` guard can see this. The forward one
 * (`test/types/dts-export-coverage.test.mjs`) checks each overlay against its
 * NODE sibling, and the reverse one's browser pass covers only the `.` overlay,
 * so the four browser-collapsed subpaths have no browser check in either
 * direction. This closes that hole for the router subpath the same way
 * `directives/directive-export-parity.test.js` closed it for `/directives`.
 *
 * The contract is derived from the OVERLAY rather than a hand-written list: the
 * `.d.ts` IS the published surface of the subpath, so every function it
 * declares must be carried by whatever the subpath resolves to in either mode.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as routerClient from '../../src/router-client.js';
import * as indexNode from '../../index.js';
import * as indexBrowser from '../../index-browser.js';

const here = dirname(fileURLToPath(import.meta.url));
const overlay = readFileSync(join(here, '..', '..', 'src', 'router-client.d.ts'), 'utf8');

/** The public router surface, read from the subpath's own published overlay. */
const declared = [...overlay.matchAll(/^export\s+function\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);

test('the overlay declares a non-empty public router surface (anti-vacuum)', () => {
  // A parse regression here would make every assertion below pass on an empty
  // list, which is exactly the vacuous green this file exists to prevent.
  assert.ok(
    declared.length >= 5,
    `expected >= 5 declared router functions in src/router-client.d.ts, got ${declared.length}: ${declared.join(', ')}`,
  );
});

test('every declared router function exists at runtime in src/router-client.js', () => {
  const missing = declared.filter((k) => typeof routerClient[k] !== 'function');
  assert.deepEqual(missing, [], `src/router-client.d.ts declares functions the module lacks: ${missing.join(', ')}`);
});

test('every declared router function is re-exported by index.js (the bare Node specifier)', () => {
  const missing = declared.filter((k) => !(k in indexNode));
  assert.deepEqual(missing, [], `index.js is missing router exports: ${missing.join(', ')}`);
});

test('every declared router function is re-exported by index-browser.js (the dist bundle source)', () => {
  // This is the assertion that fails when `loadFrame` is dropped from the
  // browser entry, which is the production-only defect described above.
  const missing = declared.filter((k) => !(k in indexBrowser));
  assert.deepEqual(missing, [], `index-browser.js is missing router exports: ${missing.join(', ')}`);
});

test('the two index entries agree on the router surface', () => {
  // index-browser.js documents itself as a mirror of index.js minus the
  // server-only exports, so the router half must be symmetric in BOTH
  // directions. An export present in only one entry means a bare
  // `@webjsdev/core` import resolves in one runtime and is a link-time
  // SyntaxError in the other.
  const onlyNode = declared.filter((k) => k in indexNode && !(k in indexBrowser));
  const onlyBrowser = declared.filter((k) => k in indexBrowser && !(k in indexNode));
  assert.deepEqual(
    { onlyNode, onlyBrowser },
    { onlyNode: [], onlyBrowser: [] },
    'the router surface must be identical on both index entries (no router export is server-only)',
  );
});
