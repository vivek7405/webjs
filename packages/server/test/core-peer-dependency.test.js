/**
 * `@webjsdev/core` must stay a PEER dependency of `@webjsdev/server`.
 *
 * Three of core's server-facing features are provider seams held in MODULE
 * scope: `asset()` (`asset-url.js`), `cspNonce()` (`csp-nonce.js`), and the
 * bound-form identity resolver (`form-action.js`). The server installs each at
 * boot by importing core and calling a setter, and that only reaches the app
 * when both sides load the SAME module instance. Two copies of core on disk
 * are two independent sets of that state, so the setter lands on one and the
 * app reads the other.
 *
 * Nothing throws when that happens, which is what makes it worth a guard:
 * `asset()` returns bare paths and quietly loses its `immutable` caching,
 * `cspNonce()` returns empty so an inline script is blocked under a CSP, and
 * `formActionId` answers null so a bound `<form action=${fn}>` loses the
 * identity the dispatcher reads. It was found from the far end, as an
 * `asset-helper-serve` failure whose only symptom was a url with no `?v=`.
 *
 * A regular `dependencies` entry lets npm nest a second copy under
 * `@webjsdev/server` whenever it cannot dedupe to one. A peer is resolved
 * against the app's own copy, and a genuine version conflict is reported at
 * install time instead of being silently satisfied by duplication.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));

test('core is a peer dependency, not a regular one', () => {
  assert.ok(PKG.peerDependencies?.['@webjsdev/core'],
    'core must be declared as a peer so npm resolves it against the app copy');
  assert.equal(PKG.dependencies?.['@webjsdev/core'], undefined,
    'a regular dependency lets npm nest a SECOND core, which splits the provider seams');
});

test('the peer range is also carried as a dev dependency', () => {
  // Workspace development and the test suite both import core directly, and a
  // peer alone is not installed for this package in isolation.
  assert.equal(PKG.devDependencies?.['@webjsdev/core'], PKG.peerDependencies['@webjsdev/core'],
    'the dev range must track the peer range so local dev resolves what apps will');
});
