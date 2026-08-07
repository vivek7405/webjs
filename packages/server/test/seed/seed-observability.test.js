/**
 * Dev observability for SSR action seeding (#1309), the three response shapes
 * the counting has to distinguish and the production silence it owes.
 *
 *   - PROD carries NO `X-Webjs-Seed` header and NO `data-webjs-dev` marker.
 *     This is the prod-leak counterfactual: the whole feature is dev-only, and
 *     a production header would publish how many server calls a page made for
 *     no benefit.
 *   - A STREAMED page (a `Suspense` boundary) reports `emitted=0, streamed`,
 *     because a streamed render's deferred boundaries resolve after the first
 *     flush and cannot ride the block. In dev it still emits a MARKER-ONLY
 *     block, which is the only way the client can name that cause instead of
 *     leaving the developer to guess why every action call went to the network.
 *   - An HTML-cached page (#241) reports `html-cache` rather than zero, because
 *     the cache hit returns before any seed work runs and reporting zero there
 *     reads as "seeding is broken" when it is really the cache answering.
 *
 * Its own file (not seed-ssr.test.js) because `module.registerHooks` is
 * process-global, the same reason seed-ssr-off.test.js is separate: the PROD
 * assertions need a handler booted with `dev: false`, and the dev marker must
 * not be able to ride in from another fixture's boot.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRequestHandler } from '../../src/dev.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_URL = pathToFileURL(resolve(__dirname, '../../../core/index.js')).toString();
const SUSPENSE_URL = pathToFileURL(resolve(__dirname, '../../../core/src/suspense.js')).toString();

const LAYOUT =
  `import { html } from ${JSON.stringify(CORE_URL)};\n` +
  `export default function Layout({ children }) {\n` +
  `  return html\`<!doctype html><html><head><title>s</title></head><body>\${children}</body></html>\`;\n` +
  `}\n`;

const ACTION =
  `'use server';\n` +
  `export async function getThing(id) { return { id, label: 'thing-' + id }; }\n`;

// An action returning a FUNCTION, which the wire cannot carry, so `stringify`
// throws and the whole block is dropped, taking every other seed with it.
const UNSERIALIZABLE_ACTION =
  `'use server';\n` +
  `export async function getThing(id) { return { id, boom: () => id }; }\n`;

// A SHIPPING async component (a reactive prop plus an @click, so elision does
// not drop it): its `async render()` awaits the action, which is what puts a
// seed in the collector.
const COMPONENT =
  `import { html, WebComponent } from ${JSON.stringify(CORE_URL)};\n` +
  `import { getThing } from '../actions/things.server.js';\n` +
  `export class ThingCard extends WebComponent({ tid: Number }) {\n` +
  `  constructor() { super(); this.tid = 1; }\n` +
  `  async render() {\n` +
  `    const t = await getThing(this.tid);\n` +
  `    return html\`<p class="lbl">\${t.label}</p><button @click=\${() => { this.tid = this.tid + 1; }}>+</button>\`;\n` +
  `  }\n` +
  `}\n` +
  `ThingCard.register('thing-card');\n`;

const PAGE =
  `import { html } from ${JSON.stringify(CORE_URL)};\n` +
  `import '../components/thing-card.js';\n` +
  `export default function Page() { return html\`<main><thing-card tid="1"></thing-card></main>\`; }\n`;

// The same page plus a `Suspense` boundary, so the render STREAMS. The seed
// collector still fills (the component's action ran), but nothing can be
// emitted, which is exactly the divergence the header reports.
const STREAMING_PAGE =
  `import { html } from ${JSON.stringify(CORE_URL)};\n` +
  `import { Suspense } from ${JSON.stringify(SUSPENSE_URL)};\n` +
  `import '../components/thing-card.js';\n` +
  `export default function Page() {\n` +
  `  const slow = new Promise((r) => setTimeout(() => r(html\`<p>late</p>\`), 5));\n` +
  `  return html\`<main><thing-card tid="1"></thing-card>\${Suspense({ fallback: html\`<p>loading</p>\`, children: slow })}</main>\`;\n` +
  `}\n`;

// A page that opts into the #241 HTML response cache. Deliberately NOT the
// seeding component: the point here is only which header a cache HIT carries.
const CACHED_PAGE =
  `import { html } from ${JSON.stringify(CORE_URL)};\n` +
  `export const revalidate = 60;\n` +
  `export default function Page() { return html\`<main><h1>cached</h1></main>\`; }\n`;

let tmpRoot;

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: 'seedobs', type: 'module', webjs: {} }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

async function boot(files, dev) {
  const app = await createRequestHandler({ appDir: makeApp(files), dev });
  if (app.warmup) await app.warmup();
  return app.handle;
}

const SEEDING_APP = {
  'app/layout.js': LAYOUT,
  'app/page.js': PAGE,
  'actions/things.server.js': ACTION,
  'components/thing-card.js': COMPONENT,
};

before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-seedobs-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

test('PROD leaks nothing: no X-Webjs-Seed header and no dev marker', async () => {
  const handle = await boot(SEEDING_APP, false);
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-webjs-seed'), null, 'the header is dev-only');
  const html = await res.text();
  assert.match(html, /id="__webjs-seeds"/, 'the seed block itself still ships in prod');
  assert.doesNotMatch(html, /data-webjs-dev/, 'the dev marker never reaches production');
  assert.match(html, /thing-1/, 'and the seeded data is still in the first paint');
});

test('DEV, buffered render: the header carries the collected and emitted counts', async () => {
  const handle = await boot(SEEDING_APP, true);
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.headers.get('x-webjs-seed'), 'collected=1, emitted=1');
  assert.match(await res.text(), /id="__webjs-seeds" data-webjs-dev="ok"/);
});

test('DEV, streamed render: emitted=0, and the block carries the streamed marker alone', async () => {
  const handle = await boot({ ...SEEDING_APP, 'app/page.js': STREAMING_PAGE }, true);
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.headers.get('x-webjs-seed'), 'collected=1, emitted=0, streamed');
  const html = await res.text();
  const block = html.match(/<script type="application\/json" id="__webjs-seeds"([^>]*)>([\s\S]*?)<\/script>/);
  assert.ok(block, 'dev emits a marker block even on a streamed page');
  assert.match(block[1], /data-webjs-dev="streamed"/);
  assert.ok(!block[2].includes('thing-1'), 'but it carries no seeds, which is the point');
});

test('PROD, streamed render: no block at all (unchanged from before #1309)', async () => {
  const handle = await boot({ ...SEEDING_APP, 'app/page.js': STREAMING_PAGE }, false);
  const res = await handle(new Request('http://localhost/'));
  assert.doesNotMatch(await res.text(), /__webjs-seeds/, 'a streamed prod page emits no seed block');
});

test('DEV, #241 HTML cache hit: the header says html-cache, not zero', async () => {
  const handle = await boot({ 'app/layout.js': LAYOUT, 'app/page.js': CACHED_PAGE }, true);
  const first = await handle(new Request('http://localhost/'));
  assert.equal(first.status, 200);
  await first.text();
  assert.notEqual(first.headers.get('x-webjs-seed'), 'html-cache', 'the MISS renders normally');
  const second = await handle(new Request('http://localhost/'));
  assert.equal(second.status, 200);
  await second.text();
  assert.equal(second.headers.get('x-webjs-seed'), 'html-cache');
});

test('DEV, a serializer DROP: emitted is 0 and the block carries only the drop marker', async () => {
  // The regression guard for the header itself. A dropped block still emits a
  // MARKER in dev so the browser can name the cause, and counting that marker as
  // emitted would report `collected=1, emitted=1` on a page that shipped no
  // seeds at all, which is a total success reported on the one failure these
  // counts exist to expose.
  const handle = await boot({ ...SEEDING_APP, 'actions/things.server.js': UNSERIALIZABLE_ACTION }, true);
  const res = await handle(new Request('http://localhost/'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-webjs-seed'), 'collected=1, emitted=0');
  const html = await res.text();
  const block = html.match(/<script type="application\/json" id="__webjs-seeds"([^>]*)>([\s\S]*?)<\/script>/);
  assert.ok(block, 'dev still emits a block so the browser can name the cause');
  assert.match(block[1], /data-webjs-dev="drop"/);
  // Assert the BLOCK's own body is empty. The previous form checked the whole
  // document for a payload string the fixture never renders, so it could not
  // fail either way.
  assert.equal(block[2], '{}', 'and it carries no seeds at all');
});

test('PROD, a serializer DROP: no block at all, unchanged from before #1309', async () => {
  const handle = await boot({ ...SEEDING_APP, 'actions/things.server.js': UNSERIALIZABLE_ACTION }, false);
  const res = await handle(new Request('http://localhost/'));
  assert.doesNotMatch(await res.text(), /__webjs-seeds/);
});
