/**
 * SSR integration for action-result seeding (#472), seeding ON (the default).
 *
 * Drives a minimal app through `createRequestHandler` and asserts the served
 * HTML carries the seed payload for the action a component awaited in
 * `async render()`, that the seeded VALUE is correct (rich types intact), and
 * that the action ran exactly once per rendered component at SSR. The seed key
 * is asserted to equal `hashFile(actionPath)/fn/stringify(args)`, the exact key
 * the generated client stub looks up.
 *
 * `module.registerHooks` (installed at boot by `createRequestHandler`) is
 * process-global, so the seeding-OFF counterfactual lives in its own file
 * (seed-ssr-off.test.js) to run in a process where the hook was never installed.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';
import { hashFile } from '../../src/actions.js';
import { stringify } from '@webjsdev/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_URL = pathToFileURL(resolve(__dirname, '../../../core/index.js')).toString();

let tmpRoot, appDir, handle, actionPath;

function write(rel, body) {
  const abs = join(appDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
}

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-seedssr-'));
  appDir = mkdtempSync(join(tmpRoot, 'app-'));
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'seedssr', type: 'module', webjs: {} }));

  actionPath = write(
    'actions/users.server.js',
    `'use server';\n` +
      `let calls = 0;\n` +
      `export async function getUser(id) {\n` +
      `  calls += 1;\n` +
      `  globalThis.__seedUserCalls = calls;\n` +
      `  return { id, name: 'User ' + id, joined: new Date('2020-01-01T00:00:00.000Z') };\n` +
      `}\n`,
  );
  write(
    'components/user-card.js',
    `import { html, WebComponent } from ${JSON.stringify(CORE_URL)};\n` +
      `import { getUser } from '../actions/users.server.js';\n` +
      `export class UserCard extends WebComponent({ uid: Number }) {\n` +
      `  constructor() { super(); this.uid = 1; }\n` +
      `  async render() {\n` +
      `    const u = await getUser(this.uid);\n` +
      `    return html\`<div class="card"><span class="name" data-y=\${u.joined.getFullYear()}>\${u.name}</span><button @click=\${() => { this.uid = this.uid + 1; }}>b</button></div>\`;\n` +
      `  }\n` +
      `}\n` +
      `UserCard.register('user-card');\n`,
  );
  write(
    'app/layout.js',
    `import { html } from ${JSON.stringify(CORE_URL)};\n` +
      `export default function Layout({ children }) {\n` +
      `  return html\`<!doctype html><html><head><title>s</title></head><body>\${children}</body></html>\`;\n` +
      `}\n`,
  );
  write(
    'app/page.js',
    `import { html } from ${JSON.stringify(CORE_URL)};\n` +
      `import '../components/user-card.js';\n` +
      `export default function Page() { return html\`<main><user-card uid="1"></user-card></main>\`; }\n`,
  );

  const app = await createRequestHandler({ appDir, dev: true });
  if (app.warmup) await app.warmup();
  handle = app.handle;
});

after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

test('the SSR HTML carries the seed payload, keyed exactly as the stub looks it up', async () => {
  globalThis.__seedUserCalls = 0;
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.status, 200);
  const html = await res.text();

  // First paint contains the resolved data (PE-safe, JS-off readable).
  assert.match(html, /User 1/, 'SSR baked the action data into the first paint');
  assert.match(html, /data-y="2020"/, 'rich Date resolved server-side');

  // The seed script is present and keyed by hashFile(actionPath)/getUser/[1].
  // The handler is `dev: true`, so the block also carries the #1309
  // `data-webjs-dev` marker; the attribute list is tolerated here and asserted
  // exactly in seed-observability.test.js.
  const m = html.match(/<script type="application\/json" id="__webjs-seeds"[^>]*>([\s\S]*?)<\/script>/);
  assert.ok(m, 'a __webjs-seeds script is emitted');
  const hash = await hashFile(actionPath);
  const key = `${hash}/getUser/${await stringify([1])}`;
  assert.ok(m[1].includes(hash), 'the seed key carries the action hash the stub embeds');
  assert.ok(m[1].includes('User 1'), 'the seeded value is in the payload');
  // Decode the escaped payload and confirm the exact key + value.
  const inner = m[1].replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&');
  const { parse } = await import('@webjsdev/core');
  const obj = parse(inner);
  assert.ok(Object.prototype.hasOwnProperty.call(obj, key), `payload has the exact stub key ${key}`);
  assert.equal(obj[key].name, 'User 1');
  assert.ok(obj[key].joined instanceof Date);
});

test('a dev render reports its counts on X-Webjs-Seed and marks the block (#1309)', async () => {
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.headers.get('x-webjs-seed'), 'collected=1, emitted=1');
  const html = await res.text();
  assert.match(html, /id="__webjs-seeds" data-webjs-dev="ok"/, 'the client dev gate rides the block');
});

test('the action ran exactly once at SSR (one rendered component, no double-call)', async () => {
  // The action's counter is cumulative across the process, so assert the DELTA
  // of one render is exactly 1 (one rendered <user-card>, no double-invoke).
  const before = globalThis.__seedUserCalls || 0;
  await handle(new Request('http://localhost/'));
  const after = globalThis.__seedUserCalls;
  assert.equal(after - before, 1, 'getUser ran once for the one <user-card>');
});
