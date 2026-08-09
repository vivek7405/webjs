/**
 * Parity between the two `webjs.basePath` normalizers (#1300, part 1).
 *
 * `normalizeBasePath` (`packages/server/src/base-path.js`) is the source of
 * truth for what a base path means, and `readAppBasePath`
 * (`packages/cli/lib/doctor.js`) is a hand-maintained PORT of it, because
 * doctor must run when `@webjsdev/server` does not resolve from the app dir at
 * all (#954, the fresh-worktree case doctor exists to diagnose). The port is
 * deliberate and stays. This file is what stops it drifting silently.
 *
 * Every row asserts THREE-WAY: the CLI port equals the server reader equals the
 * expected value. Equality alone would pass if both drifted the same way, and
 * the expected column alone would not prove the two agree, so neither assertion
 * is redundant.
 *
 * The rows that matter most are the `//host` ones. Both implementations reject a
 * network-path reference BEFORE collapsing leading slashes. Collapsing first
 * would turn `//evil.com` into `/evil.com` and prefix every emitted URL with an
 * origin escape. Move that guard below the collapse on EITHER side and those
 * rows red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readBasePath } from '../../packages/server/src/base-path.js';
import { readAppBasePath } from '../../packages/cli/lib/doctor.js';

/** @type {string[]} */
const dirs = [];
function tmpApp() {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-basepath-parity-'));
  dirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * `[label, raw basePath value, expected normalized form]`. `MISSING` means the
 * `basePath` key is absent entirely, which is the default every unconfigured
 * app takes.
 */
const MISSING = Symbol('basePath key omitted');
const ROWS = [
  ['key omitted', MISSING, ''],
  ['a number', 42, ''],
  ['a boolean', true, ''],
  ['null', null, ''],
  ['an object', {}, ''],
  ['an array', [], ''],
  ['the empty string', '', ''],
  ['whitespace only', '   ', ''],
  ['the root path', '/', ''],
  ['padded with whitespace', ' /app ', '/app'],
  ['no leading slash', 'app', '/app'],
  ['already canonical', '/app', '/app'],
  ['one trailing slash', '/app/', '/app'],
  ['several trailing slashes', '/app///', '/app'],
  // Not `/app`. The network-path guard fires on the `//` prefix before the
  // leading-slash collapse can run, so the collapse is unreachable for more
  // than one leading slash and this value fails safe like any other `//host`.
  ['several leading slashes', '///app', ''],
  ['a nested path', '/foo/bar', '/foo/bar'],
  ['a nested path with a trailing slash', '/foo/bar/', '/foo/bar'],
  ['a leading traversal', '../app', ''],
  ['a mid-path traversal', '/app/../x', ''],
  ['an absolute url', 'https://evil.com', ''],
  ['a backslash', '/app\\x', ''],
  ['interior whitespace', '/my app', ''],
  ['an interior tab', '/app\tx', ''],
  ['a network-path host', '//evil.com', ''],
  ['a network-path host with a path', '//evil.com/app', ''],
  ['a bare double slash', '//', ''],
  ['a bare triple slash', '///', ''],
];

for (const [label, raw, expected] of ROWS) {
  test(`basePath parity: ${label}`, async () => {
    const dir = tmpApp();
    const webjs = raw === MISSING ? {} : { basePath: raw };
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', webjs }));

    const fromCli = await readAppBasePath(dir);
    const fromServer = readBasePath({ webjs });

    assert.equal(fromServer, expected, `server reader normalized ${label} wrongly`);
    assert.equal(fromCli, expected, `CLI port normalized ${label} wrongly`);
    assert.equal(fromCli, fromServer, `the CLI port and the server reader disagree on ${label}`);
  });
}

/**
 * The two file-level branches, where only the CLI port has a code path (the
 * server reader takes a parsed object, so `dev.js` owns the read). Both yield
 * `''`, which is what `readBasePath` returns for the `undefined` it would have
 * been handed.
 */
test('basePath parity: a missing package.json reads as no base path', async () => {
  const dir = tmpApp();
  assert.equal(await readAppBasePath(dir), '');
  assert.equal(readBasePath(undefined), '');
});

test('basePath parity: an unparseable package.json reads as no base path', async () => {
  const dir = tmpApp();
  writeFileSync(join(dir, 'package.json'), '{ this is not json');
  assert.equal(await readAppBasePath(dir), '');
  assert.equal(readBasePath(undefined), '');
});
