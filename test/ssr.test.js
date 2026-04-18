/**
 * Unit + integration tests for SSR helpers introduced on the
 * light-dom-tailwind-v2 branch:
 *   - hoistHeadTags: leading <script>/<style> are lifted to <head>
 *   - data-layout wrapping: layout output is wrapped with a marker
 *   - cache-control default: no-store unless the page opts in
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_MODULE_URL = pathToFileURL(
  resolve(__dirname, '../packages/core/src/html.js')
).toString();
const WEBJS_MODULE_URL = pathToFileURL(
  resolve(__dirname, '../packages/core/index.js')
).toString();

let _hoistHeadTags, ssrPage, ssrNotFound;
let tmpDir;

before(async () => {
  ({ _hoistHeadTags, ssrPage, ssrNotFound } = await import('../packages/server/src/ssr.js'));
  tmpDir = mkdtempSync(join(tmpdir(), 'webjs-ssr-test-'));
});

after(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

/* ------------ hoistHeadTags (pure function) ------------ */

test('hoistHeadTags: no hoisting when body has no leading script/style', () => {
  const { head, body } = _hoistHeadTags(
    '<head><title>x</title></head>',
    '<div>hello</div>'
  );
  assert.equal(head, '<head><title>x</title></head>');
  assert.equal(body, '<div>hello</div>');
});

test('hoistHeadTags: lifts leading <script> to head', () => {
  const bodyHtml = '<script>window.x = 1;</script><main>page</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<script>window.x = 1;</script>'));
  assert.equal(body, '<main>page</main>');
});

test('hoistHeadTags: lifts leading <style> to head', () => {
  const bodyHtml = '<style>.a{color:red}</style><main>page</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<style>.a{color:red}</style>'));
  assert.equal(body, '<main>page</main>');
});

test('hoistHeadTags: lifts multiple consecutive leading script/style tags', () => {
  const bodyHtml =
    '<script src="/a.js"></script>' +
    '<style>.x{}</style>' +
    '<script>window.y = 2;</script>' +
    '<main>rest</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<script src="/a.js"></script>'));
  assert.ok(head.includes('<style>.x{}</style>'));
  assert.ok(head.includes('<script>window.y = 2;</script>'));
  assert.equal(body, '<main>rest</main>');
});

test('hoistHeadTags: does NOT lift script/style that appear after normal content', () => {
  const bodyHtml = '<main>page</main><script>alert(1)</script>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  // The script isn't leading — stays in the body.
  assert.equal(head, '<head></head>');
  assert.equal(body, bodyHtml);
});

test('hoistHeadTags: tolerates whitespace before leading tags', () => {
  const bodyHtml = '  \n  <script>a=1</script><main>ok</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<script>a=1</script>'));
  assert.equal(body, '<main>ok</main>');
});

test('hoistHeadTags: is case-insensitive for script/style tags', () => {
  const bodyHtml = '<SCRIPT>upper = 1;</SCRIPT><main>ok</main>';
  const { head, body } = _hoistHeadTags('<head></head>', bodyHtml);
  assert.ok(head.includes('<SCRIPT>upper = 1;</SCRIPT>'));
  assert.equal(body, '<main>ok</main>');
});

/* ------------ ssrPage integration: cache-control + data-layout wrapping ------------ */

async function makeRoute({ pageSrc, layoutSrc, metadata = null }) {
  const sub = mkdtempSync(join(tmpDir, 'route-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });
  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile, pageSrc);
  const files = { file: pageFile, layouts: [] };
  if (layoutSrc) {
    const layoutFile = join(appDir, 'layout.js');
    writeFileSync(layoutFile, layoutSrc);
    files.layouts = [layoutFile];
  }
  if (metadata) {
    const metaFile = join(appDir, 'metadata.js');
    writeFileSync(metaFile, metadata);
    files.metadataFiles = [metaFile];
  }
  return {
    route: {
      file: files.file,
      layouts: files.layouts,
      errors: [],
      metadataFiles: files.metadataFiles || [],
    },
    appDir,
  };
}

test('ssrPage: default cache-control is no-store (opt-in caching)', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>plain page</p>\`; }\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.equal(resp.headers.get('cache-control'), 'no-store');
});

test('ssrPage: page metadata.cacheControl is honoured', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export const metadata = { cacheControl: 'public, max-age=60' };\n` +
      `export default function Page() { return html\`<p>cached</p>\`; }\n`,
    metadata:
      `export const metadata = { cacheControl: 'public, max-age=60' };\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.equal(resp.headers.get('cache-control'), 'public, max-age=60');
});

test('ssrPage: layout output is wrapped with data-layout attribute', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>page content</p>\`; }\n`,
    layoutSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Layout({ children }) {\n` +
      `  return html\`<div class="shell">\${children}</div>\`;\n` +
      `}\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('data-layout="layout"'),
    `expected data-layout wrapper, got: ${body.slice(0, 400)}`);
  const idxWrap = body.indexOf('data-layout=');
  const idxShell = body.indexOf('class="shell"');
  assert.ok(idxWrap >= 0 && idxShell >= 0);
  assert.ok(idxWrap < idxShell, 'wrapper element precedes layout content');
});

test('ssrPage: no data-layout wrapper when route has no layouts', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>no layout</p>\`; }\n`,
  });
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  const body = await resp.text();
  assert.ok(!body.includes('data-layout='),
    `no layouts → no wrapper, got: ${body.slice(0, 400)}`);
});

test('ssrPage: modulepreload never points at server-only files', async () => {
  // Set up a page that imports a .server.ts AND a 'use server' plain .ts.
  // Both files should be excluded from the <link rel="modulepreload"> set:
  // they're server-imports, and the client only ever sees a safe RPC stub
  // served lazily on first import, never a preload.
  const sub = mkdtempSync(join(tmpDir, 'route-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const serverSuffix = join(appDir, 'query.server.ts');
  writeFileSync(serverSuffix,
    `export async function list() { return []; }\n`);

  const useServerPlain = join(appDir, 'db.ts');
  writeFileSync(useServerPlain,
    `'use server';\nexport async function q() { return null; }\n`);

  const pageFile = join(appDir, 'page.ts');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `import { list } from './query.server.ts';\n` +
    `import { q } from './db.ts';\n` +
    `export default async function Page() {\n` +
    `  await list(); await q();\n` +
    `  return html\`<p>hi</p>\`;\n` +
    `}\n`);

  // Build a minimal module graph mirroring the imports above.
  const moduleGraph = new Map([
    [pageFile, new Set([serverSuffix, useServerPlain])],
    [serverSuffix, new Set()],
    [useServerPlain, new Set()],
  ]);

  // serverFiles mimics the action index (abs-path keyed).
  const serverFiles = new Map([
    [serverSuffix, 'hashA'],
    [useServerPlain, 'hashB'],
  ]);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [] };
  const url = new URL('http://localhost/');
  const resp = await ssrPage(route, {}, url, {
    dev: false,
    appDir,
    moduleGraph,
    serverFiles,
  });
  const body = await resp.text();

  const preloads = (body.match(/modulepreload[^>]*href="[^"]*"/g) || []).join('\n');
  assert.ok(!/\.server\.ts"/.test(preloads),
    `.server.ts should not be preloaded; got preloads:\n${preloads}`);
  assert.ok(!/\bdb\.ts"/.test(preloads),
    `'use server' plain file should not be preloaded; got preloads:\n${preloads}`);
});

/* ------------ ssrNotFound + not-found.js rendering ------------ */

test('ssrNotFound: no notFound file → plain 404 fallback', async () => {
  const resp = await ssrNotFound(null, { dev: false, appDir: tmpDir });
  assert.equal(resp.status, 404);
  const body = await resp.text();
  assert.ok(body.includes('404 — Not found'));
});

test('ssrNotFound: renders the user-supplied not-found.js module', async () => {
  const sub = mkdtempSync(join(tmpDir, 'nf-'));
  const notFoundFile = join(sub, 'not-found.js');
  writeFileSync(notFoundFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function NotFound() { return html\`<p>custom missing</p>\`; }\n`);
  const resp = await ssrNotFound(notFoundFile, { dev: false, appDir: sub });
  assert.equal(resp.status, 404);
  const body = await resp.text();
  assert.ok(body.includes('<p>custom missing</p>'));
});

test('ssrNotFound: not-found.js that throws falls back to an inline error body', async () => {
  const sub = mkdtempSync(join(tmpDir, 'nf-err-'));
  const notFoundFile = join(sub, 'not-found.js');
  writeFileSync(notFoundFile,
    `export default function NotFound() { throw new Error('boom'); }\n`);
  const resp = await ssrNotFound(notFoundFile, { dev: false, appDir: sub });
  assert.equal(resp.status, 404);
  const body = await resp.text();
  assert.ok(body.includes('404 — Not found'));
  assert.ok(body.includes('boom'));
});

/* ------------ ssrPage: redirect / notFound / error boundaries ------------ */

test('ssrPage: redirect() thrown during render → 3xx Response with location', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { redirect } from ${JSON.stringify(WEBJS_MODULE_URL)};\n` +
      `export default function Page() { redirect('/login'); }\n`,
  });
  const url = new URL('http://localhost/old');
  const resp = await ssrPage(route, {}, url, { dev: false, appDir });
  assert.ok(resp.status >= 300 && resp.status < 400, `got status ${resp.status}`);
  assert.equal(resp.headers.get('location'), '/login');
});

test('ssrPage: notFound() thrown during render → 404 Response', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { notFound } from ${JSON.stringify(WEBJS_MODULE_URL)};\n` +
      `export default function Page() { notFound(); }\n`,
  });
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 404);
});

test('ssrPage: error.js boundary catches a render throw and returns 500', async () => {
  const sub = mkdtempSync(join(tmpDir, 'err-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `export default function Page() { throw new Error('kaboom'); }\n`);

  const errorFile = join(appDir, 'error.js');
  writeFileSync(errorFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Err({ error }) {\n` +
    `  return html\`<p>Handled: \${error.message}</p>\`;\n` +
    `}\n`);

  const route = { file: pageFile, layouts: [], errors: [errorFile], metadataFiles: [] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 500);
  const body = await resp.text();
  assert.ok(body.includes('Handled: kaboom'));
});

test('ssrPage: error.js that itself throws falls through to the default 500', async () => {
  const sub = mkdtempSync(join(tmpDir, 'errfb-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `export default function Page() { throw new Error('outer'); }\n`);

  const errorFile = join(appDir, 'error.js');
  writeFileSync(errorFile,
    `export default function Err() { throw new Error('boundary-broke'); }\n`);

  const route = { file: pageFile, layouts: [], errors: [errorFile], metadataFiles: [] };
  // Silence the intentional console.error from the unhandled-render path
  const prev = console.error;
  console.error = () => {};
  try {
    const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
    assert.equal(resp.status, 500);
    const body = await resp.text();
    // Prod default: terse message, no stack.
    assert.ok(body.includes('Something went wrong'));
    assert.ok(!body.includes('boundary-broke'));
  } finally { console.error = prev; }
});

test('ssrPage: dev=true exposes the error stack, prod hides it', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `export default function Page() { throw new Error('stacky'); }\n`,
  });
  const prev = console.error;
  console.error = () => {};
  try {
    const dev = await ssrPage(route, {}, new URL('http://localhost/'), { dev: true, appDir });
    const devBody = await dev.text();
    assert.ok(devBody.includes('stacky'));

    const prod = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
    const prodBody = await prod.text();
    assert.ok(!prodBody.includes('stacky'));
    assert.ok(prodBody.includes('Something went wrong'));
  } finally { console.error = prev; }
});

/* ------------ metadata: generateMetadata fn, openGraph, preload links ------------ */

test('ssrPage: metadata.generateMetadata(ctx) is called and merged', async () => {
  const sub = mkdtempSync(join(tmpDir, 'metagen-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export async function generateMetadata(ctx) {\n` +
    `  return { title: 'Dyn ' + (ctx.params.id || 'x') };\n` +
    `}\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [pageFile] };
  const resp = await ssrPage(route, { id: '42' }, new URL('http://localhost/'), { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('<title>Dyn 42</title>'));
});

test('ssrPage: metadata.openGraph emits og:* meta tags', async () => {
  const sub = mkdtempSync(join(tmpDir, 'og-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export const metadata = {\n` +
    `  title: 'Blog',\n` +
    `  description: 'A blog',\n` +
    `  themeColor: '#ff0000',\n` +
    `  viewport: 'width=device-width, initial-scale=2',\n` +
    `  openGraph: { title: 'OG Blog', image: '/cover.png' },\n` +
    `  preload: [ { href: '/font.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous' } ],\n` +
    `};\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [pageFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  const body = await resp.text();
  assert.ok(body.includes('<meta name="description" content="A blog">'));
  assert.ok(body.includes('<meta name="theme-color" content="#ff0000">'));
  assert.ok(body.includes('<meta property="og:title" content="OG Blog">'));
  assert.ok(body.includes('<meta property="og:image" content="/cover.png">'));
  assert.ok(/<meta name="viewport"[^>]*initial-scale=2/.test(body));
  assert.ok(/<link rel="preload"[^>]*href="\/font\.woff2"/.test(body));
  assert.ok(/<link rel="preload"[^>]*as="font"/.test(body));
});

test('ssrPage: a metadata file that throws is silently skipped', async () => {
  const sub = mkdtempSync(join(tmpDir, 'metaerr-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const brokenMeta = join(appDir, 'broken.js');
  writeFileSync(brokenMeta,
    `export function generateMetadata() { throw new Error('meta boom'); }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [brokenMeta, pageFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('<p>ok</p>'));
});

/* ------------ loading.ts → automatic Suspense wrap ------------ */

test('ssrPage: loading.js wraps the page in Suspense (fallback in initial HTML)', async () => {
  const sub = mkdtempSync(join(tmpDir, 'loading-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default async function Page() {\n` +
    `  await new Promise(r => setTimeout(r, 10));\n` +
    `  return html\`<p>ready</p>\`;\n` +
    `}\n`);

  const loadingFile = join(appDir, 'loading.js');
  writeFileSync(loadingFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Loading() { return html\`<p>loading…</p>\`; }\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [], loadings: [loadingFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('loading…'), 'fallback should appear in initial HTML');
  assert.ok(body.includes('ready'), 'resolved content streamed in');
  // Streaming flush inserts a <template data-webjs-resolve="..."> chunk.
  assert.ok(/data-webjs-resolve/.test(body));
});

test('ssrPage: loading.js that fails to load → page renders without Suspense', async () => {
  const sub = mkdtempSync(join(tmpDir, 'loading-err-'));
  const appDir = join(sub, 'app');
  mkdirSync(appDir, { recursive: true });

  const pageFile = join(appDir, 'page.js');
  writeFileSync(pageFile,
    `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
    `export default function Page() { return html\`<p>ok</p>\`; }\n`);

  const loadingFile = join(appDir, 'loading.js');
  writeFileSync(loadingFile, `throw new Error('cannot load');\n`);

  const route = { file: pageFile, layouts: [], errors: [], metadataFiles: [], loadings: [loadingFile] };
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir });
  assert.equal(resp.status, 200);
  const body = await resp.text();
  assert.ok(body.includes('<p>ok</p>'));
});

/* ------------ CSP nonce + CSRF cookie ------------ */

test('ssrPage: CSP nonce on request → nonce attribute on injected scripts', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
  });
  const req = new Request('http://localhost/', {
    headers: { 'content-security-policy': "script-src 'nonce-abc123XYZ' 'self'" },
  });
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req });
  const body = await resp.text();
  assert.ok(body.includes('nonce="abc123XYZ"'));
});

test('ssrPage: response attaches a csrf set-cookie when request has no token', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
  });
  const req = new Request('http://localhost/');
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, req });
  const setCookie = resp.headers.get('set-cookie');
  assert.ok(setCookie && /csrf/i.test(setCookie), `expected csrf cookie, got ${setCookie}`);
});

/* ------------ bundle mode skips per-file preloads ------------ */

test('ssrPage: bundle=true emits /__webjs/bundle.js import and no per-file preloads', async () => {
  const { route, appDir } = await makeRoute({
    pageSrc:
      `import { html } from ${JSON.stringify(HTML_MODULE_URL)};\n` +
      `export default function Page() { return html\`<p>ok</p>\`; }\n`,
  });
  const resp = await ssrPage(route, {}, new URL('http://localhost/'), { dev: false, appDir, bundle: true });
  const body = await resp.text();
  assert.ok(body.includes('/__webjs/bundle.js'), 'bundle import present');
  const pageImports = body.match(/modulepreload[^>]*href="[^"]*page\.js"/g) || [];
  assert.equal(pageImports.length, 0, 'no per-file preloads in bundle mode');
});
