/**
 * Unit tests for `versionAssetUrls` (issue #1194): the SSR pass that appends
 * `?v=<hash>` to same-origin asset urls an APP AUTHOR wrote by hand in a
 * template, so a `<link rel="stylesheet" href="/public/app.css">` cannot serve
 * stale bytes at a live url after a deploy.
 *
 * Two invariants carry the weight here:
 *
 *  - the hash is byte-identical to what `withAssetHash` computes for the same
 *    file, so an authored url and a framework-emitted one agree on the cache
 *    key rather than splitting into two;
 *  - a RENDERED CODE SAMPLE is never rewritten. The docs and brand pages
 *    display markup, and silently editing the code a reader is looking at
 *    would be a lie in the output. The matcher is anchored on a literal tag
 *    name for exactly this reason, since a highlighted sample escapes `<`.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  setAssetRoots,
  clearAssetHashCache,
  withAssetHash,
  versionAssetUrls,
} from '../../src/asset-hash.js';

let root;
let appDir;
let coreDir;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'webjs-versassets-'));
  appDir = join(root, 'app-root');
  coreDir = join(root, 'core-root');
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

test('an authored stylesheet link is fingerprinted', () => {
  const out = versionAssetUrls('<link rel="stylesheet" href="/public/app.css">');
  const expected = withAssetHash('/public/app.css');
  assert.notEqual(expected, '/public/app.css', 'precondition: the file hashes');
  assert.equal(out, `<link rel="stylesheet" href="${expected}">`);
});

test('img and script sources are fingerprinted too', () => {
  const img = versionAssetUrls('<img src="/public/brand/logo.svg" alt="logo">');
  assert.match(img, /src="\/public\/brand\/logo\.svg\?v=[0-9a-f]+"/);
  assert.match(img, /alt="logo"/, 'other attributes survive untouched');
});

test('the hash matches what the framework computes for its own urls', () => {
  // If these ever diverge, an authored url and a framework-emitted one become
  // two cache keys for one file, which is the bug #369 fixed for modules.
  const out = versionAssetUrls('<img src="/public/app.css">');
  const direct = withAssetHash('/public/app.css');
  assert.ok(out.includes(direct), `authored url ${out} should carry ${direct}`);
});

test('the hash changes when the file bytes change', () => {
  const before = versionAssetUrls('<link href="/public/app.css">');
  writeFileSync(join(appDir, 'public', 'app.css'), 'body{color:blue}');
  clearAssetHashCache();
  const after = versionAssetUrls('<link href="/public/app.css">');
  assert.notEqual(before, after, 'new bytes must produce a new url');
});

test('a rendered code sample is never rewritten', () => {
  // A highlighter escapes `<`, so the sample never contains a literal `<img`.
  // This is the property the tag-anchored matcher depends on.
  const sample = '<pre><code>&lt;img src="/public/app.css"&gt;</code></pre>';
  assert.equal(versionAssetUrls(sample), sample);

  // And the real shape webjs's highlighter emits, where the tag name is split
  // across spans, so even `&lt;img` never appears contiguously.
  const tokenized =
    '<pre><code><span class="t-punc">&lt;</span><span class="t-id">img</span> ' +
    '<span class="t-id">src</span><span class="t-punc">=</span>' +
    '<span class="t-str">"/public/app.css"</span></code></pre>';
  assert.equal(versionAssetUrls(tokenized), tokenized);
});

test('cross-origin, relative, and unresolvable urls are untouched', () => {
  for (const url of [
    'https://cdn.example.com/app.css',
    '//cdn.example.com/app.css',
    './app.css',
    '/public/does-not-exist.css',
  ]) {
    const html = `<link href="${url}">`;
    assert.equal(versionAssetUrls(html), html, `${url} must not be rewritten`);
  }
});

test('a url that already carries a query is left alone', () => {
  // Author-controlled and possibly meaningful, so we do not append to it.
  const html = '<img src="/public/app.css?theme=dark">';
  assert.equal(versionAssetUrls(html), html);
});

test('a non-asset tag is not rewritten', () => {
  // An <a href> points at a page, not an asset; versioning it would change a
  // user-visible link.
  const html = '<a href="/public/app.css">download</a>';
  assert.equal(versionAssetUrls(html), html);
});

test('single-quoted attributes are handled', () => {
  const out = versionAssetUrls("<link href='/public/app.css'>");
  assert.match(out, /href='\/public\/app\.css\?v=[0-9a-f]+'/);
});

test('it is a no-op when fingerprinting is disabled', () => {
  // Dev must stay byte-identical, which is why dev never calls setAssetRoots.
  setAssetRoots({ appDir: '', coreDir: '', enabled: false });
  const html = '<link href="/public/app.css">';
  assert.equal(versionAssetUrls(html), html);
});

/*
 * Wiring: the unit tests above prove the transform, these prove it is actually
 * REACHED by the SSR document assembly. `buildDocumentParts` is the single seam
 * every response path funnels through (buffered, streamed, and `buildDocument`),
 * which is why the call lives there rather than at each response site.
 */
const SSR_OPTS = {
  moduleUrls: [], preloadUrls: [], metadata: {},
  importMap: null, lazyComponents: null, nonce: '', dev: false,
};

test('SSR fingerprints an authored asset in the framework-owned shell', async () => {
  const { _buildDocumentParts } = await import('../../src/ssr.js');
  const { streamBody } = _buildDocumentParts(
    '<img src="/public/brand/logo.svg" alt="logo">',
    SSR_OPTS,
  );
  assert.match(streamBody, /src="\/public\/brand\/logo\.svg\?v=[0-9a-f]+"/);
});

test('SSR fingerprints an authored asset in a user-supplied shell', async () => {
  // The root layout may write its own <!doctype><html>…</html>, which takes a
  // different branch of buildDocumentParts. Both must fingerprint, or the site
  // that writes its own shell (this one does) silently keeps stale urls.
  const { _buildDocumentParts } = await import('../../src/ssr.js');
  const { prefix, streamBody } = _buildDocumentParts(
    '<!doctype html><html><head><link rel="stylesheet" href="/public/app.css"></head>' +
      '<body><img src="/public/brand/logo.svg"></body></html>',
    SSR_OPTS,
  );
  assert.match(prefix, /href="\/public\/app\.css\?v=[0-9a-f]+"/, 'head link fingerprinted');
  assert.match(streamBody, /src="\/public\/brand\/logo\.svg\?v=[0-9a-f]+"/, 'body img fingerprinted');
});
