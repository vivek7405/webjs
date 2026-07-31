/**
 * Cross-runtime proof that `asset()` url resolution (#1194) behaves identically
 * on Node and Bun. WebJs runs on Node 24+ OR Bun, and this path touches several
 * runtime-sensitive surfaces at once: a synchronous `readFileSync`, a
 * `node:crypto` sha-256 over the bytes, `node:path` joins and separator
 * comparisons for the containment gates, and `decodeURIComponent` for the
 * traversal refusal. A divergence in any of them would either change the
 * emitted url (breaking cache continuity across a mixed-runtime fleet) or,
 * worse, weaken the gate that keeps a private file from being hashed. Run from
 * the repo root:
 *
 *   node test/bun/asset-url.mjs
 *   bun  test/bun/asset-url.mjs
 *
 * Asserts, on whichever runtime executes it: a public asset resolves to
 * `?v=<sha256(bytes) prefix>` computed the same way, the hash tracks the bytes,
 * a fragment survives with the query ahead of it, the hash ignores the elision
 * verdict (core and `public/` are never elision-transformed), and every
 * non-public or traversal path is refused WITHOUT reading the file.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  setAssetRoots,
  setElisionFingerprint,
  clearAssetHashCache,
  resolveAssetUrl,
} from '../../packages/server/src/asset-hash.js';

const runtime = typeof globalThis.Bun !== 'undefined' ? 'bun' : 'node';

const root = mkdtempSync(join(tmpdir(), 'webjs-asset-bun-'));
const appDir = join(root, 'app');
const coreDir = join(root, 'core');
mkdirSync(join(appDir, 'public'), { recursive: true });
mkdirSync(coreDir, { recursive: true });
writeFileSync(join(appDir, 'public', 'app.css'), 'body{color:red}');
writeFileSync(join(appDir, '.env'), 'SECRET=1');

setAssetRoots({ appDir, coreDir, enabled: true });
clearAssetHashCache();

// 1. The emitted hash is sha-256 over the bytes, identically on both runtimes.
// A mismatch would hand the two runtimes different urls for one file, so a
// mixed-runtime fleet would thrash every client's immutable cache.
const expected = createHash('sha256').update('body{color:red}').digest('hex').slice(0, 12);
const url = resolveAssetUrl('/public/app.css');
assert.equal(url, `/public/app.css?v=${expected}`, `${runtime}: hash must be sha256(bytes)[0:12]`);

// 2. The hash tracks the bytes.
writeFileSync(join(appDir, 'public', 'app.css'), 'body{color:blue}');
clearAssetHashCache();
assert.notEqual(resolveAssetUrl('/public/app.css'), url, `${runtime}: new bytes must yield a new url`);

// 3. A fragment survives, with the query ahead of it (string handling parity).
writeFileSync(join(appDir, 'public', 'icons.svg'), '<svg/>');
clearAssetHashCache();
assert.match(
  resolveAssetUrl('/public/icons.svg#logo'),
  /^\/public\/icons\.svg\?v=[0-9a-f]{12}#logo$/,
  `${runtime}: fragment must survive with the query before it`,
);

// 4. The elision verdict must not reach a public asset's hash (path
// containment comparisons use `sep`, which is worth pinning per runtime).
const seen = new Set();
for (const fp of ['', 'verdict-a', 'verdict-b']) {
  setElisionFingerprint(fp);
  clearAssetHashCache();
  seen.add(resolveAssetUrl('/public/app.css'));
}
setElisionFingerprint('');
clearAssetHashCache();
assert.equal(seen.size, 1, `${runtime}: a public url must depend on bytes alone`);

// 5. The security gate holds. These must be refused by the gate, never read,
// so a private file's existence and bytes stay undisclosed.
for (const p of ['/.env', '/public/../.env', '/public/%2E%2E/.env', '/etc/passwd']) {
  assert.equal(resolveAssetUrl(p), p, `${runtime}: ${p} must be refused unchanged`);
}

// Clean up the fixture, matching every sibling in this directory. Both `npm
// test` and the Bun CI step run this file, so leaking would strand a
// `webjs-asset-bun-*` directory in the temp dir on every single run.
rmSync(root, { recursive: true, force: true });

console.log(`[asset-url] ok on ${runtime}`);
