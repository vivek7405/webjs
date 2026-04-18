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

let _hoistHeadTags, ssrPage;
let tmpDir;

before(async () => {
  ({ _hoistHeadTags, ssrPage } = await import('../packages/server/src/ssr.js'));
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
