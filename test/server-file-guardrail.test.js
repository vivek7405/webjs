/**
 * Server-file guardrail: the dev/prod HTTP layer MUST never serve the
 * source of a server-only file to the browser. A file is considered
 * server-only if either:
 *   • its filename matches `.server.{js,ts,mjs,mts}`, OR
 *   • its source begins with a literal `'use server'` directive.
 *
 * For such files, every response body must be a generated RPC stub —
 * never the real module source. This guardrail is the last line of
 * defense against an accidental source leak (DB credentials, privileged
 * business logic, scrypt routines, etc.).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequestHandler } from '../packages/server/src/dev.js';

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'webjs-guard-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpDir, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

function assertIsStub(text) {
  assert.ok(
    text.startsWith('// webjs: generated server-action stub'),
    `expected RPC stub, got body starting with: ${text.slice(0, 80)}`
  );
  // Confirm the real source is NOT present by checking secrets markers
  // that only show up in the scaffolded fixture source.
  assert.ok(!/SECRET_DB_PASSWORD/.test(text),
    `stub leaked the source — found SECRET_DB_PASSWORD:\n${text.slice(0, 400)}`);
  assert.ok(!/fakePrismaClient/.test(text),
    `stub leaked the source — found fakePrismaClient reference`);
}

test('guardrail: .server.ts request returns RPC stub, never source', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default function P() { return 'ok'; }`,
    'modules/posts/queries/list-posts.server.ts':
      `const SECRET_DB_PASSWORD = 'hunter2';\n` +
      `const fakePrismaClient = () => ({ findMany: () => [] });\n` +
      `export async function listPosts() { return []; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request(
    'http://localhost/modules/posts/queries/list-posts.server.ts'
  ));
  assert.equal(resp.status, 200);
  assert.equal(
    resp.headers.get('content-type'),
    'application/javascript; charset=utf-8'
  );
  assertIsStub(await resp.text());
});

test(`guardrail: 'use server' plain .ts never leaks source`, async () => {
  const appDir = makeApp({
    'app/page.ts': `export default function P() { return 'ok'; }`,
    'lib/prisma.ts':
      `'use server';\n` +
      `const SECRET_DB_PASSWORD = 'hunter2';\n` +
      `const fakePrismaClient = () => ({ findMany: () => [] });\n` +
      `export const prisma = fakePrismaClient();\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request(
    'http://localhost/lib/prisma.ts'
  ));
  assert.equal(resp.status, 200);
  assertIsStub(await resp.text());
});

test(`guardrail: 'use server' plain .js never leaks source`, async () => {
  const appDir = makeApp({
    'app/page.ts': `export default function P() { return 'ok'; }`,
    'lib/secret.js':
      `"use server";\n` +
      `const SECRET_DB_PASSWORD = 'hunter2';\n` +
      `export const secret = 'nope';\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request(
    'http://localhost/lib/secret.js'
  ));
  assert.equal(resp.status, 200);
  assertIsStub(await resp.text());
});

test('guardrail: .server.js request returns RPC stub, never source', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default function P() { return 'ok'; }`,
    'lib/action.server.js':
      `const SECRET_DB_PASSWORD = 'hunter2';\n` +
      `export async function doWork() { return 1; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request(
    'http://localhost/lib/action.server.js'
  ));
  assert.equal(resp.status, 200);
  assertIsStub(await resp.text());
});

test('guardrail: ordinary .ts files still serve source (negative control)', async () => {
  const appDir = makeApp({
    'app/page.ts': `export default function P() { return 'ok'; }`,
    'components/widget.ts':
      `export function hello() { return 'hi'; }\n`,
  });
  const app = await createRequestHandler({ appDir, dev: true });
  const resp = await app.handle(new Request(
    'http://localhost/components/widget.ts'
  ));
  assert.equal(resp.status, 200);
  const text = await resp.text();
  // Non-server .ts files are compiled (TS stripped) and served as JS.
  assert.ok(!text.startsWith('// webjs: generated server-action stub'),
    'ordinary .ts should NOT be stubbed');
  assert.ok(/function hello/.test(text),
    'ordinary .ts source should be present');
});

test('guardrail: file created AFTER boot is still caught (index race)', async () => {
  // Simulates the race window: the action index is built at boot, but a
  // developer adds a new .server.ts during dev. The guardrail must catch
  // it on first request regardless of index state.
  const appDir = makeApp({
    'app/page.ts': `export default function P() { return 'ok'; }`,
  });
  const app = await createRequestHandler({ appDir, dev: true });

  // Write the server file AFTER createRequestHandler returned.
  const lateFile = join(appDir, 'modules/late.server.ts');
  mkdirSync(join(lateFile, '..'), { recursive: true });
  writeFileSync(lateFile,
    `const SECRET_DB_PASSWORD = 'hunter2';\n` +
    `export async function late() { return 42; }\n`);

  const resp = await app.handle(new Request(
    'http://localhost/modules/late.server.ts'
  ));
  assert.equal(resp.status, 200);
  assertIsStub(await resp.text());
});
