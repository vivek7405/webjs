/**
 * The pin directory has ONE owner.
 *
 * `vendor/pins.js` WRITES the pinned bundles and `vendor/resolver.js` READS
 * them. The #1365 split gave each its own copy of the path, one derived from
 * `PIN_DIR_REL` and one hardcoded. They agreed, so nothing failed. But a change
 * to `PIN_DIR_REL` would have moved the write without moving the read, and the
 * resolver would then have missed every pinned bundle and silently fallen back
 * to a live vendor resolve. No error, no failing test, just pinning quietly
 * doing nothing.
 *
 * That is the same drift class as the 247-line duplicated `wrapHead` this same
 * split produced, which is why the fix is one owner rather than two copies kept
 * in sync by hand, and why the assertion below is that the READER derives its
 * path from the WRITER rather than that the two strings happen to match today.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pinDir } from '../../src/vendor/pins.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '../../src/vendor');

test('pinDir is exported by the module that owns the pin layout', () => {
  assert.equal(typeof pinDir, 'function');
  assert.equal(pinDir('/tmp/app'), join('/tmp/app', '.webjs', 'vendor'));
});

test('the resolver imports pinDir rather than redefining it', () => {
  const resolver = readFileSync(join(SRC, 'resolver.js'), 'utf8');

  assert.match(
    resolver,
    /import \{[^}]*\bpinDir\b[^}]*\} from '\.\/pins\.js'/,
    'resolver.js must import pinDir from pins.js, the module that writes the pins',
  );
  assert.doesNotMatch(
    resolver,
    /^\s*(export\s+)?function pinDir\s*\(/m,
    'resolver.js must not define its own pinDir; two copies can drift apart, '
    + 'and the reader silently missing the writer is not an observable failure',
  );
});

test('the layout constant is defined once, in pins.js', () => {
  // Counterfactual guard: importing pinDir would still pass if resolver.js
  // rebuilt the same path inline from its own literals.
  const resolver = readFileSync(join(SRC, 'resolver.js'), 'utf8');
  assert.doesNotMatch(
    resolver,
    /'\.webjs'\s*,\s*'vendor'/,
    'resolver.js must not rebuild the pin path from its own literals',
  );
  const pins = readFileSync(join(SRC, 'pins.js'), 'utf8');
  assert.match(pins, /const PIN_DIR_REL = \['\.webjs', 'vendor'\]/);
});
