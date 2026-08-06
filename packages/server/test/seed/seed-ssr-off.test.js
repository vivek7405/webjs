/**
 * Counterfactual for action-result seeding (#472): with seeding OFF the served
 * HTML carries NO seed payload, yet the SSR data is still in the first paint
 * (the client simply re-fetches on hydration, as before the feature). Proves the
 * flag fully disables the feature and that disabling it leaves the rendered
 * output free of the seed block.
 *
 * Runs in its own process (set via WEBJS_SEED=0 before the handler boots) so the
 * process-global `module.registerHooks` load hook is NEVER installed here.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.WEBJS_SEED = '0';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_URL = pathToFileURL(resolve(__dirname, '../../../core/index.js')).toString();

let tmpRoot, appDir, handle, seedingEnabled;

function write(rel, body) {
  const abs = join(appDir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
}

before(async () => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-seedoff-'));
  appDir = mkdtempSync(join(tmpRoot, 'app-'));
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'seedoff', type: 'module', webjs: {} }));
  write(
    'actions/users.server.js',
    `'use server';\n` +
      `export async function getUser(id) { return { id, name: 'User ' + id }; }\n`,
  );
  write(
    'components/user-card.js',
    `import { html, WebComponent } from ${JSON.stringify(CORE_URL)};\n` +
      `import { getUser } from '../actions/users.server.js';\n` +
      `export class UserCard extends WebComponent({ uid: Number }) {\n` +
      `  constructor() { super(); this.uid = 1; }\n` +
      `  async render() { const u = await getUser(this.uid); return html\`<div class="card"><span @click=\${() => { this.uid++; }}>\${u.name}</span></div>\`; }\n` +
      `}\n` +
      `UserCard.register('user-card');\n`,
  );
  write(
    'app/layout.js',
    `import { html } from ${JSON.stringify(CORE_URL)};\n` +
      `export default function Layout({ children }) { return html\`<!doctype html><html><head></head><body>\${children}</body></html>\`; }\n`,
  );
  write(
    'app/page.js',
    `import { html } from ${JSON.stringify(CORE_URL)};\n` +
      `import '../components/user-card.js';\n` +
      `export default function Page() { return html\`<main><user-card uid="1"></user-card></main>\`; }\n`,
  );

  ({ seedingEnabled } = await import('../../src/action-seed.js'));
  const { createRequestHandler } = await import('../../src/dev.js');
  const app = await createRequestHandler({ appDir, dev: true });
  if (app.warmup) await app.warmup();
  handle = app.handle;
});

after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

test('WEBJS_SEED=0 leaves seeding disabled (no hook installed)', () => {
  assert.equal(seedingEnabled(), false);
});

test('the SSR HTML has NO seed payload but still carries the first-paint data', async () => {
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /User 1/, 'SSR data still in the first paint (PE-safe) with seeding off');
  assert.doesNotMatch(html, /__webjs-seeds/, 'no seed payload is emitted when seeding is off');
});

test('a dev render of a seeding-DISABLED app reports X-Webjs-Seed: off', async () => {
  // #1309: `off` is kept distinct from `collected=0` so a seeding-disabled app
  // never looks like a seeding-BROKEN one. This is why the counting lives with
  // the collector rather than behind `seedingEnabled()`.
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.headers.get('x-webjs-seed'), 'off');
});
