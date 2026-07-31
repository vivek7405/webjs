/**
 * Unit tests for `resolveAssetUrl` (#1194), the server-side body behind the
 * isomorphic `asset()` helper. An author marks a url explicitly:
 *
 *   html`<link rel="stylesheet" href=${asset('/public/app.css')}>`
 *
 * and gets `?v=<content-hash>` in production, which the static route serves
 * `immutable` for a year, so a deploy that changes the file changes the url
 * and no cache can serve the previous bytes.
 *
 * This replaces the approach in #1196, which matched asset urls in the
 * assembled HTML. Two deep-review rounds found six major defects there, five
 * of them the same bug: at that layer framework output and author data are
 * indistinguishable, so the matcher kept rewriting things it did not own (a
 * custom element's reactive prop, a rendered code sample, a `rel=preload`
 * hint, a data-driven `src` pointing at `/.env`). Those whole classes are
 * gone here by construction, because nothing is scanned. What remains worth
 * testing is this function's own contract, and the security gate in
 * particular, since an app may pass user-derived data to `asset()`.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  setAssetRoots,
  clearAssetHashCache,
  setElisionFingerprint,
  withAssetHash,
  resolveAssetUrl,
  assetHashFor,
} from '../../src/asset-hash.js';

let root;
let appDir;
let coreDir;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webjs-asseturl-'));
  appDir = join(root, 'app');
  coreDir = join(root, 'core');
  mkdirSync(join(appDir, 'public', 'brand'), { recursive: true });
  mkdirSync(coreDir, { recursive: true });
  writeFileSync(join(appDir, 'public', 'app.css'), 'body{color:red}');
  writeFileSync(join(appDir, 'public', 'brand', 'logo.svg'), '<svg/>');
  clearAssetHashCache();
  setAssetRoots({ appDir, coreDir, enabled: true });
});

afterEach(() => {
  setAssetRoots({ appDir: '', coreDir: '', enabled: false });
  clearAssetHashCache();
  rmSync(root, { recursive: true, force: true });
});

test('a public asset is fingerprinted', () => {
  const out = resolveAssetUrl('/public/app.css');
  assert.match(out, /^\/public\/app\.css\?v=[0-9a-f]+$/);
  assert.equal(out, withAssetHash('/public/app.css'), 'agrees with the framework hash');
});

test('the hash changes when the bytes change', () => {
  const before = resolveAssetUrl('/public/app.css');
  writeFileSync(join(appDir, 'public', 'app.css'), 'body{color:blue}');
  clearAssetHashCache();
  assert.notEqual(resolveAssetUrl('/public/app.css'), before);
});

test('a public asset hash does not move with the elision verdict', () => {
  // public/ lives under appDir, so the elision-fingerprint fold admits it
  // unless excluded explicitly. That was inert while only module specifiers
  // were hashed; asset() routes public paths here. Without the exclusion a
  // deploy that merely flips an UNRELATED component between elidable and
  // interactive changes every marked asset url, so every visitor re-downloads
  // byte-identical files, which is the cost the hash exists to avoid.
  const seen = new Set();
  for (const fp of ['', 'verdict-a', 'verdict-b']) {
    setElisionFingerprint(fp);
    clearAssetHashCache();
    seen.add(resolveAssetUrl('/public/app.css'));
  }
  setElisionFingerprint('');
  clearAssetHashCache();
  assert.equal(seen.size, 1, `the url must depend on bytes alone, saw: ${[...seen].join(' ')}`);
});

test('a core file hash does not move with the elision verdict either', () => {
  // Same bug as the public/ case, one directory over, and invisible in this
  // monorepo: a REAL install resolves core to <appDir>/node_modules/@webjsdev/
  // core, which IS under appDir, whereas the workspace symlink here lands
  // outside it. So the fold silently applied to core in every deployed app.
  // Core is served verbatim (never elision-transformed), so folding buys
  // nothing and would re-download the whole runtime on any deploy that merely
  // flipped an unrelated component's elidability.
  const realInstallCore = join(appDir, 'node_modules', '@webjsdev', 'core');
  mkdirSync(realInstallCore, { recursive: true });
  const coreFile = join(realInstallCore, 'webjs-core-browser.js');
  writeFileSync(coreFile, 'export const core = 1;');
  setAssetRoots({ appDir, coreDir: realInstallCore, enabled: true });

  const seen = new Set();
  for (const fp of ['', 'verdict-a', 'verdict-b']) {
    setElisionFingerprint(fp);
    clearAssetHashCache();
    seen.add(assetHashFor(coreFile));
  }
  setElisionFingerprint('');
  clearAssetHashCache();
  assert.equal(seen.size, 1, `core must hash over bytes alone, saw: ${[...seen].join(' ')}`);
});

test('a fragment survives and the query precedes it', () => {
  // An SVG sprite (`#icon`) and a media fragment (`#t=10,20`) are real.
  // Appending naively would emit `/logo.svg#icon?v=H`, which requests the
  // file with NO query (losing immutable caching) and leaves a fragment that
  // matches no element id.
  const out = resolveAssetUrl('/public/brand/logo.svg#icon');
  assert.match(out, /^\/public\/brand\/logo\.svg\?v=[0-9a-f]+#icon$/);
});

test('a private file is never read, whatever the caller passes', () => {
  // The gate is defensive: an app may pass user-derived data, e.g.
  // `asset(user.avatarPath)`. Publishing a hash would leak that the file
  // exists AND a stable fingerprint of its bytes, for files the serve path
  // deliberately 404s.
  writeFileSync(join(appDir, '.env'), 'DATABASE_URL=postgres://u:SECRET@h/db');
  mkdirSync(join(appDir, 'db'), { recursive: true });
  writeFileSync(join(appDir, 'db', 'app.db'), 'SQLITE FORMAT 3');
  mkdirSync(join(appDir, 'lib'), { recursive: true });
  writeFileSync(join(appDir, 'lib', 'session.server.ts'), 'export const KEY = 1');
  // Every path here must EXIST, or it is refused by the missing-file fail-safe
  // rather than by the gate under test, and the assertion proves nothing.
  writeFileSync(join(appDir, 'package.json'), '{"name":"probe"}');

  for (const p of ['/.env', '/db/app.db', '/lib/session.server.ts', '/package.json']) {
    assert.equal(resolveAssetUrl(p), p, `${p} must not be fingerprinted`);
  }
});

test('a traversal out of public/ is refused', () => {
  writeFileSync(join(appDir, '.env'), 'SECRET=1');
  for (const p of ['/public/../.env', '/public/%2E%2E/.env', '/public/%2e%2e/.env']) {
    assert.equal(resolveAssetUrl(p), p, `${p} must not escape public/`);
  }
});

test('non-public, cross-origin, relative, and queried paths pass through', () => {
  for (const p of [
    'https://cdn.example.com/a.css',
    '//cdn.example.com/a.css',
    './a.css',
    '/public/app.css?theme=dark',
    '/public/missing.css',
    '',
  ]) {
    assert.equal(resolveAssetUrl(p), p);
  }
});

test('a base path is stripped for resolution and kept on the url', () => {
  // Compose order matches withAssetHash: basePath first, then the hash.
  const out = resolveAssetUrl('/base/public/app.css', '/base');
  assert.match(out, /^\/base\/public\/app\.css\?v=[0-9a-f]+$/);
});

test('it is a no-op when fingerprinting is disabled', () => {
  // Dev never enables it, so dev output stays byte-identical.
  setAssetRoots({ appDir: '', coreDir: '', enabled: false });
  assert.equal(resolveAssetUrl('/public/app.css'), '/public/app.css');
});

/*
 * The isomorphic contract: `asset()` must be safe to call from a module that
 * also loads in the browser, because a layout does exactly that to register
 * its component imports. With no provider installed it returns the path
 * unchanged, which is always a correct url, just an un-versioned one.
 */
test('asset() returns the path unchanged with no provider (the browser case)', async () => {
  // Imported by source path, not by `@webjsdev/core`. The bare specifier
  // resolves through node_modules, which in a git worktree can point at a
  // DIFFERENT checkout of the monorepo, so the test would silently exercise
  // another copy of this file. The relative path pins it to this tree.
  const { asset, setAssetUrlProvider } = await import('../../../core/src/asset-url.js');
  setAssetUrlProvider(null);
  assert.equal(asset('/public/app.css'), '/public/app.css');

  setAssetUrlProvider((p) => resolveAssetUrl(p));
  assert.match(asset('/public/app.css'), /\?v=[0-9a-f]+$/);

  // A throwing provider must degrade to the plain path, never propagate.
  setAssetUrlProvider(() => { throw new Error('boom'); });
  assert.equal(asset('/public/app.css'), '/public/app.css');
  setAssetUrlProvider(null);
});
