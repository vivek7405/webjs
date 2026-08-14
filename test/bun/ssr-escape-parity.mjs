/**
 * Cross-runtime proof that the SSR head and error paths serve the SAME bytes
 * on Node and on Bun, for the surfaces the #1365 ssr split rewrote. Run from
 * the repo root:
 *
 *   node test/bun/ssr-escape-parity.mjs
 *   bun  test/bun/ssr-escape-parity.mjs
 *
 * Why this is a Bun-parity concern rather than a plain unit test: the split
 * touched the request path and the response builders, which are exactly the
 * surfaces AGENTS.md names as runtime-sensitive (SSR dispatch, streams, the
 * `Response` shape). It also touched them INVISIBLY to the gate, because
 * `require-bun-parity-with-runtime-src.sh` matched the literal `/ssr\.js` and
 * `/dev\.js` and the split moved the code into `ssr/` and `dev/`. The pattern
 * is widened now, and this is the cross-runtime assertion that gate asks for.
 *
 * Asserts, on whichever runtime executes it:
 *   - the escapers escape `&`, `"` and `<` and leave `>` alone, so a title or
 *     a meta description keeps a bare `>` in the served bytes
 *   - a 404 does not inherit the page's `metadata.cacheControl`
 *   - a boundary module that throws emits no stack trace in production
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequestHandler } from '../../packages/server/src/dev.js';
import { escapeAttr, escapeHtml } from '../../packages/server/src/ssr/escape.js';

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const PKGS = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages');

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpdir(), 'webjs-ssr-escape-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  mkdirSync(join(appDir, 'node_modules/@webjsdev'), { recursive: true });
  for (const pkg of ['core', 'server']) {
    try { symlinkSync(join(PKGS, pkg), join(appDir, `node_modules/@webjsdev/${pkg}`)); } catch { /* linked */ }
  }
  return appDir;
}

// The escapers themselves, which decide served bytes on every head.
{
  assert.equal(escapeHtml('a > b'), 'a > b', `escapeHtml widened on ${runtime}`);
  assert.equal(escapeAttr('a > b'), 'a > b', `escapeAttr widened on ${runtime}`);
  assert.equal(escapeHtml('a & <b>'), 'a &amp; &lt;b>', `escapeHtml diverged on ${runtime}`);
  assert.equal(escapeAttr('a & "b" <c>'), 'a &amp; &quot;b&quot; &lt;c>', `escapeAttr diverged on ${runtime}`);
}

// The head builder serves those bytes end to end.
{
  const appDir = makeApp({
    'app/page.ts': "export const metadata = { title: 'a > b', description: 'x > y' };\nexport default () => 'ok';\n",
  });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();
  const html = await (await h.handle(new Request('http://localhost/'))).text();
  assert.ok(html.includes('<title>a > b</title>'), `title escaping diverged on ${runtime}`);
  assert.ok(html.includes('content="x > y"'), `meta escaping diverged on ${runtime}`);
}

// A 404 is never stored, whatever the page metadata asks for.
{
  const appDir = makeApp({
    'app/layout.ts': "export const metadata = { cacheControl: 'public, max-age=600' };\nexport default ({ children }) => children;\n",
    'app/page.ts': "import { notFound } from '@webjsdev/core';\nexport default () => { notFound(); };\n",
  });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();
  const res = await h.handle(new Request('http://localhost/'));
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('cache-control'), 'no-store', `404 inherited cacheControl on ${runtime}`);
}

// A throwing boundary module says nothing about the server in production.
{
  const appDir = makeApp({
    'app/page.ts': "import { notFound } from '@webjsdev/core';\nexport default () => { notFound(); };\n",
    'app/not-found.ts': "export default () => { throw new Error('boundary blew up'); };\n",
  });
  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();
  const html = await (await h.handle(new Request('http://localhost/'))).text();
  assert.ok(!/\bat\s+\S+:\d+:\d+/.test(html), `a stack trace reached the page on ${runtime}`);
}

console.log(`SSR escaping / 404 / boundary parity OK on ${runtime}`);
