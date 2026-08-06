/**
 * Unit tests for the pure dev-error frame builder (#264).
 *
 * `buildDevErrorFrame` parses an error stack for the offending file location and
 * reads a source excerpt; `parseStackLocation` / `readCodeFrame` are the pieces.
 * All are dev-only by the caller's contract, so no source ever reaches prod.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseStackLocation, readCodeFrame, buildDevErrorFrame } from '../../src/dev-error.js';

test('parseStackLocation prefers an app frame over a node_modules frame', () => {
  const stack = [
    'Error: boom',
    '    at Object.<anonymous> (/app/node_modules/dep/index.js:1:1)',
    '    at Page (/app/app/page.ts:12:7)',
    '    at handler (/app/node_modules/@webjsdev/server/src/ssr.js:99:3)',
  ].join('\n');
  const loc = parseStackLocation(stack, '/app');
  assert.deepEqual(loc, { file: '/app/app/page.ts', line: 12, column: 7 });
});

test('parseStackLocation handles the file:// and bare-path forms', () => {
  assert.equal(parseStackLocation('at x (file:///a/b.ts:3:4)', '/a').line, 3);
  assert.equal(parseStackLocation('at /a/b.ts:5:6', '/a').column, 6);
  assert.equal(parseStackLocation('no frames here', '/a'), null);
});

test('readCodeFrame marks the offending line and points a caret at the column', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wj-frame-'));
  const file = join(dir, 'x.ts');
  writeFileSync(file, 'line1\nline2\nBOOM here\nline4\nline5\n');
  const frame = readCodeFrame(file, 3, 1, 1);
  rmSync(dir, { recursive: true, force: true });
  assert.match(frame, /> 3 \| BOOM here/, 'the throwing line is marked with >');
  assert.match(frame, /2 \| line2/, 'context line above is present');
  assert.match(frame, /4 \| line4/, 'context line below is present');
  assert.match(frame, /\^/, 'a caret points at the column');
});

test('readCodeFrame returns null for an unreadable file or out-of-range line', () => {
  assert.equal(readCodeFrame('/no/such/file.ts', 1, 1), null);
});

test('buildDevErrorFrame from a thrown error has the message, file, line, and a code frame', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wj-build-'));
  const file = join(dir, 'page.ts');
  writeFileSync(file, 'export default function P() {\n  throw new Error("boom");\n}\n');
  const err = new Error('boom');
  err.stack = `Error: boom\n    at P (${file}:2:9)\n`;
  const frame = buildDevErrorFrame(err, { kind: 'render', appDir: dir });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(frame.kind, 'render');
  assert.equal(frame.message, 'boom');
  assert.equal(frame.file, file);
  assert.equal(frame.line, 2);
  assert.match(frame.codeFrame, /throw new Error/);
});

test('buildDevErrorFrame for a ts-strip mines the message for the file position + carries the hint', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wj-ts-'));
  const file = join(dir, 'bad.ts');
  writeFileSync(file, 'const x = 1;\nenum Color { Red }\nexport { x };\n');
  // Node's strip error embeds the position as `file:line:col` in the message.
  const err = new Error(`Unsupported TypeScript syntax: enum at ${file}:2:1`);
  const frame = buildDevErrorFrame(err, {
    kind: 'ts-strip', appDir: dir, file, hint: 'use erasable equivalents',
  });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(frame.kind, 'ts-strip');
  assert.equal(frame.file, file);
  assert.equal(frame.line, 2, 'line mined from the message');
  assert.match(frame.codeFrame, /enum Color/);
  assert.equal(frame.hint, 'use erasable equivalents');
});

test('buildDevErrorFrame carries an explicit url onto the frame, and null without one (#1047)', () => {
  const stamped = buildDevErrorFrame(new Error('boom'), { kind: 'render', url: '/blog/hello?page=2' });
  assert.equal(stamped.url, '/blog/hello?page=2', 'the request url rides the frame so the overlay can scope it');
  // A ts-strip / rebuild frame passes no url and must stay unscoped: the
  // browser gate renders a url-less frame unconditionally.
  const unstamped = buildDevErrorFrame(new Error('boom'), { kind: 'ts-strip' });
  assert.equal(unstamped.url, null, 'no url passed means an unscoped frame');
  // An empty string is not a url, and must not become one the gate compares
  // against (every real path starts with `/`).
  assert.equal(buildDevErrorFrame(new Error('boom'), { url: '' }).url, null);
});
