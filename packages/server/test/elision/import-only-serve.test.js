/**
 * Integration test for import-only route-module elision (#605), through the
 * real `createRequestHandler` render path. A page / layout whose only client
 * relevance is importing shipping components is dropped from the boot script
 * and replaced by its component imports directly, so the browser fetches only
 * the interactive leaves, never the page / layout module.
 *
 * The synthetic app lives in a temp dir with a `node_modules` symlink back to
 * the repo, so the page module's `@webjsdev/core` import resolves during SSR
 * (serve.test.js only requests served source, which never executes the import).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequestHandler } from '../../src/dev.js';

const REPO_NODE_MODULES = join(process.cwd(), 'node_modules');

function makeApp(files) {
  const dir = mkdtempSync(join(tmpdir(), 'webjs-importonly-'));
  symlinkSync(REPO_NODE_MODULES, join(dir, 'node_modules'), 'dir');
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return dir;
}

const COUNTER = `import { WebComponent, html } from '@webjsdev/core';
class C extends WebComponent { render() { return html\`<button @click=\${() => {}}>+</button>\`; } }
C.register('x-counter');`;

const INERT_LAYOUT = `import { html } from '@webjsdev/core';
export default ({ children }) => html\`<main>\${children}</main>\`;`;

const ROUTER_LAYOUT = `import '@webjsdev/core/client-router';
import { html } from '@webjsdev/core';
export default ({ children }) => html\`<main>\${children}</main>\`;`;

function bootOf(html) {
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  return m ? m[1] : '';
}

test('an import-only page boots its component directly, not the page or inert layout module (#605)', async () => {
  const dir = makeApp({
    'app/layout.ts': INERT_LAYOUT,
    'app/page.ts': `import { html } from '@webjsdev/core';
import '../components/counter.ts';
export default () => html\`<x-counter></x-counter>\`;`,
    'components/counter.ts': COUNTER,
  });
  try {
    const app = await createRequestHandler({ appDir: dir, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    const boot = bootOf(html);
    assert.match(boot, /\/components\/counter\.ts/, 'the interactive component is emitted');
    assert.doesNotMatch(boot, /\/app\/page\.ts/, 'the import-only page module is dropped');
    assert.doesNotMatch(boot, /\/app\/layout\.ts/, 'the inert layout module is dropped');
    // Progressive enhancement is unaffected: the component is still SSR'd.
    assert.match(html, /<x-counter[^>]*>/, 'the component still renders server-side');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Strip the parts elision is ALLOWED to change (the boot module script + the
// modulepreload hints) so the rest of the document can be compared byte for byte.
function maskJsSet(html) {
  return html
    .replace(/<script type="module">[\s\S]*?<\/script>/g, '<script type="module"></script>')
    .replace(/<link[^>]+rel=["']modulepreload["'][^>]*>\s*/g, '');
}

test('import-only elision does not change the SSR body (on vs off, #605)', async () => {
  const files = {
    'app/layout.ts': INERT_LAYOUT,
    'app/page.ts': `import { html } from '@webjsdev/core';
import '../components/counter.ts';
export default () => html\`<x-counter>seed</x-counter><p>static copy</p>\`;`,
    'components/counter.ts': COUNTER,
  };
  const onDir = makeApp(files);
  const offDir = makeApp(files);
  const prev = process.env.WEBJS_ELIDE;
  try {
    const onApp = await createRequestHandler({ appDir: onDir, dev: false });
    if (onApp.warmup) await onApp.warmup();
    const onHtml = await (await onApp.handle(new Request('http://x/'))).text();

    process.env.WEBJS_ELIDE = '0';
    const offApp = await createRequestHandler({ appDir: offDir, dev: false });
    if (offApp.warmup) await offApp.warmup();
    const offHtml = await (await offApp.handle(new Request('http://x/'))).text();

    // Sanity: the two really did diverge in the JS set (otherwise the mask is
    // vacuous and the equality below proves nothing).
    assert.notEqual(onHtml, offHtml, 'precondition: on and off differ in the JS set');
    assert.equal(maskJsSet(onHtml), maskJsSet(offHtml), 'the SSR body is identical apart from the boot JS set');
  } finally {
    if (prev === undefined) delete process.env.WEBJS_ELIDE; else process.env.WEBJS_ELIDE = prev;
    rmSync(onDir, { recursive: true, force: true });
    rmSync(offDir, { recursive: true, force: true });
  }
});

test('a layout importing the client router keeps its module in the boot (#605)', async () => {
  const dir = makeApp({
    'app/layout.ts': ROUTER_LAYOUT,
    'app/page.ts': `import { html } from '@webjsdev/core';
import '../components/counter.ts';
export default () => html\`<x-counter></x-counter>\`;`,
    'components/counter.ts': COUNTER,
  });
  try {
    const app = await createRequestHandler({ appDir: dir, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    const boot = bootOf(html);
    assert.match(boot, /\/app\/layout\.ts/, 'the client-router layout module must ship');
    assert.match(boot, /\/components\/counter\.ts/, 'the component still loads');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- #623: route-module false positives no longer pin the boot --------------

test('a page registering a component via a `#` alias is dropped from the boot (#623)', async () => {
  const dir = makeApp({
    'package.json': JSON.stringify({ name: 'fp-app', type: 'module', imports: { '#*': './*' } }),
    'app/layout.ts': INERT_LAYOUT,
    'app/page.ts': `import { html } from '@webjsdev/core';
import '#components/counter.ts';
export default () => html\`<x-counter></x-counter>\`;`,
    'components/counter.ts': COUNTER,
  });
  try {
    const app = await createRequestHandler({ appDir: dir, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    const boot = bootOf(html);
    assert.doesNotMatch(boot, /\/app\/page\.ts/, 'the page module must be dropped (the # import is local, not npm)');
    assert.doesNotMatch(boot, /\/app\/layout\.ts/, 'the inert layout is dropped too');
    assert.match(boot, /\/components\/counter\.ts/, 'only the interactive leaf is emitted');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a layout whose template has an inline <script> using document is dropped from the boot (#623)', async () => {
  const dir = makeApp({
    'package.json': JSON.stringify({ name: 'fp-app2', type: 'module', imports: { '#*': './*' } }),
    'app/layout.ts': `import { html } from '@webjsdev/core';
import '#components/counter.ts';
export default ({ children }) => html\`
  <script>
    (function () {
      var t = localStorage.getItem('theme');
      if (t) document.documentElement.dataset.theme = t;
      document.addEventListener('click', function () {});
    })();
  </script>
  <x-counter></x-counter>
  \${children}
\`;`,
    'app/page.ts': `import { html } from '@webjsdev/core';
export default () => html\`<p>hello</p>\`;`,
    'components/counter.ts': COUNTER,
  });
  try {
    const app = await createRequestHandler({ appDir: dir, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    const boot = bootOf(html);
    assert.doesNotMatch(boot, /\/app\/layout\.ts/, 'inline-script globals in a template must not pin the layout');
    assert.match(boot, /\/components\/counter\.ts/, 'the interactive leaf is emitted');
    // The inline script itself must still be present in the served HTML (it runs from there).
    assert.match(html, /localStorage\.getItem\('theme'\)/, 'the inline bootstrap script is still in the SSR HTML');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- #629: webjs.clientRouter opt-out ---------------------------------------

test('webjs.clientRouter:false emits the opt-out flag; default does not (#629)', async () => {
  const page = `import { html } from '@webjsdev/core';
import '../components/counter.ts';
export default () => html\`<x-counter></x-counter>\`;`;
  const off = makeApp({
    'package.json': JSON.stringify({ name: 'router-off', type: 'module', webjs: { clientRouter: false } }),
    'app/layout.ts': INERT_LAYOUT,
    'app/page.ts': page,
    'components/counter.ts': COUNTER,
  });
  try {
    const app = await createRequestHandler({ appDir: off, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    assert.match(html, /window\.__WEBJS_CLIENT_ROUTER__\s*=\s*false/, 'opt-out flag must be emitted when clientRouter:false');
    assert.match(html, /\/components\/counter\.ts/, 'the component still loads (only the router auto-enable is suppressed)');
    // The flag is a classic inline script; it MUST appear before the deferred
    // boot module that loads @webjsdev/core, or the bundle's module-end
    // auto-enable would run before the flag is set. (Classic scripts run at
    // parse, deferred module scripts after, so source order is the guarantee.)
    const flagIdx = html.indexOf('__WEBJS_CLIENT_ROUTER__');
    const bootIdx = html.indexOf('<script type="module"');
    assert.ok(flagIdx !== -1 && bootIdx !== -1 && flagIdx < bootIdx, 'opt-out flag must precede the boot module');
  } finally {
    rmSync(off, { recursive: true, force: true });
  }

  const on = makeApp({
    'package.json': JSON.stringify({ name: 'router-on', type: 'module' }),
    'app/layout.ts': INERT_LAYOUT,
    'app/page.ts': page,
    'components/counter.ts': COUNTER,
  });
  try {
    const app = await createRequestHandler({ appDir: on, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    assert.doesNotMatch(html, /__WEBJS_CLIENT_ROUTER__/, 'no opt-out flag by default (router stays automatic)');
  } finally {
    rmSync(on, { recursive: true, force: true });
  }
});

// Path-aware verdict (#963), at the serve layer: a module-scope signal bus
// imported by the shipping component (never by the page) does not pin the
// page. The boot emits only the frontier component; the page module is
// dropped; the bus module is still served to the browser (the component
// imports it) and the component still SSRs.
test('a signal bus behind the shipping component keeps the page import-only (#963)', async () => {
  const dir = makeApp({
    'app/page.ts': `import { html } from '@webjsdev/core';
import '../components/overlay.ts';
export default () => html\`<x-overlay></x-overlay>\`;`,
    'components/overlay.ts': `import { WebComponent, html } from '@webjsdev/core';
import { bus } from '../lib/bus.ts';
class O extends WebComponent { render() { return html\`<button @click=\${() => bus.set(1)}>go</button>\`; } }
O.register('x-overlay');`,
    'lib/bus.ts': `import { signal } from '@webjsdev/core';
export const bus = signal(0);`,
  });
  try {
    const app = await createRequestHandler({ appDir: dir, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    const boot = bootOf(html);
    assert.match(boot, /\/components\/overlay\.ts/, 'the frontier component is emitted');
    assert.doesNotMatch(boot, /\/app\/page\.ts/, 'the page module is dropped despite the bus in its closure');
    assert.doesNotMatch(boot, /\/lib\/bus\.ts/, 'the bus itself is not boot-emitted (the component imports it)');
    const busResp = await app.handle(new Request('http://x/lib/bus.ts'));
    assert.equal(busResp.status, 200, 'the bus module is still servable for the component import');
    assert.match(html, /<x-overlay[^>]*>/, 'the component still renders server-side');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A component nested behind the frontier component is NOT re-emitted in the
// boot; it loads through its importer, so the wire stays minimal (#963).
test('a nested shipping component is carried by its frontier importer, not re-emitted (#963)', async () => {
  const dir = makeApp({
    'app/page.ts': `import { html } from '@webjsdev/core';
import '../components/outer.ts';
export default () => html\`<x-outer></x-outer>\`;`,
    'components/outer.ts': `import { WebComponent, html } from '@webjsdev/core';
import './inner.ts';
class Outer extends WebComponent { render() { return html\`<button @click=\${() => {}}><x-inner></x-inner></button>\`; } }
Outer.register('x-outer');`,
    'components/inner.ts': `import { WebComponent, html } from '@webjsdev/core';
class Inner extends WebComponent { render() { return html\`<button @click=\${() => {}}>i</button>\`; } }
Inner.register('x-inner');`,
  });
  try {
    const app = await createRequestHandler({ appDir: dir, dev: true });
    if (app.warmup) await app.warmup();
    const html = await (await app.handle(new Request('http://x/'))).text();
    const boot = bootOf(html);
    assert.match(boot, /\/components\/outer\.ts/, 'the frontier component is emitted');
    assert.doesNotMatch(boot, /\/components\/inner\.ts/, 'the nested component loads via its importer');
    assert.doesNotMatch(boot, /\/app\/page\.ts/, 'the page module is dropped');
    const innerResp = await app.handle(new Request('http://x/components/inner.ts'));
    assert.equal(innerResp.status, 200, 'the nested component is still servable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The error-boundary render applies the SAME substitution (#963): an
// import-only page with a bare server import is dropped from the ERROR
// page's boot too, so the throw-at-load stub never crashes the error page.
//
// Since #1298 the boundary's boot set is what actually RENDERED, the boundary
// module plus the layouts wrapping it, so the page is not in the set to be
// substituted for at all. The #963 property this locks is unchanged and in
// fact stronger: the import-only page's module cannot reach the error page's
// boot by any route. What is no longer emitted is the page's frontier
// COMPONENT, and that is the point: the page threw, so its `<x-counter>` is
// not in the boundary's DOM and booting the module that upgrades it registered
// a custom element for nothing. The substitution itself still runs, on the
// wrapping layouts, asserted in the sibling case below and in
// `test/ssr/ssr.test.js`.
test('an error-boundary render drops the import-only page from its boot (#963, #1298)', async () => {
  const dir = makeApp({
    'lib/auth.server.ts': `export async function auth() { throw new Error('boom'); }`,
    'app/error.ts': `import { html } from '@webjsdev/core';
export default ({ error }) => html\`<p class="err">\${error.message}</p>\`;`,
    'app/page.ts': `import { html } from '@webjsdev/core';
import { auth } from '../lib/auth.server.ts';
import '../components/counter.ts';
export default async () => { await auth(); return html\`<x-counter></x-counter>\`; };`,
    'components/counter.ts': COUNTER,
  });
  try {
    const app = await createRequestHandler({ appDir: dir, dev: true });
    if (app.warmup) await app.warmup();
    const resp = await app.handle(new Request('http://x/'));
    const html = await resp.text();
    assert.equal(resp.status, 500, 'the page render throws into the error boundary');
    assert.match(html, /class="err"/, 'the error boundary rendered');
    const boot = bootOf(html);
    assert.doesNotMatch(boot, /\/app\/page\.ts/, 'the import-only page module stays dropped on the error path');
    assert.doesNotMatch(boot, /\/components\/counter\.ts/, 'nor its frontier component, whose element the boundary never rendered');
    assert.match(boot, /\/app\/error\.ts/, 'the boundary module, which DID render, is what boots');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
