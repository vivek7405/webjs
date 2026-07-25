/**
 * Root middleware file resolution.
 *
 * The root `middleware.{ts,js,mts,mjs}` lookup used to be the single literal
 * `middleware.js`, so an app whose root middleware was written in TypeScript
 * (the documented default for an app, and what both the scaffold and the dev
 * supervisor emit / watch) silently ran with NO global middleware: no error,
 * no warning, indistinguishable from an app that has none. These tests pin
 * each accepted extension, so the resolution list cannot quietly shrink back.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createRequestHandler } from '../../src/dev.js';

let tmpRoot;

before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-root-mw-'));
});
after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

/** A page so the app has at least one route to fall through to. */
const PAGE = `export default function Home() { return 'home'; }\n`;

/**
 * Middleware that both short-circuits (so its effect is unmissable) and
 * names the extension it was loaded from, so a test cannot pass by loading
 * a DIFFERENT candidate file than the one it wrote.
 */
function middlewareSource(tag, typed) {
  const sig = typed
    ? 'export default async function mw(req: Request, next: () => Promise<Response>): Promise<Response> {'
    : 'export default async function mw(req, next) {';
  return `${sig}\n  return new Response(${JSON.stringify(tag)});\n}\n`;
}

for (const ext of ['ts', 'js', 'mts', 'mjs']) {
  test(`root middleware.${ext} is loaded and runs`, async () => {
    const typed = ext === 'ts' || ext === 'mts';
    const appDir = makeApp({
      'app/page.js': PAGE,
      [`middleware.${ext}`]: middlewareSource(`from-${ext}`, typed),
    });

    const h = await createRequestHandler({ appDir, dev: false });
    await h.warmup?.();
    const res = await h.handle(new Request('http://localhost/'));

    assert.equal(await res.text(), `from-${ext}`, `middleware.${ext} did not run`);
  });
}

test('an app with no root middleware still serves its pages', async () => {
  const appDir = makeApp({ 'app/page.js': PAGE });

  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();
  const res = await h.handle(new Request('http://localhost/'));

  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes('home'));
});

test('middleware.ts wins over middleware.js when both exist', async () => {
  // Only one root middleware can run, so the order has to be pinned rather
  // than left to whichever candidate the loop happens to reach first.
  const appDir = makeApp({
    'app/page.js': PAGE,
    'middleware.ts': middlewareSource('from-ts', true),
    'middleware.js': middlewareSource('from-js', false),
  });

  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();
  const res = await h.handle(new Request('http://localhost/'));

  assert.equal(await res.text(), 'from-ts');
});

test('root middleware can post-process instead of short-circuiting', async () => {
  const appDir = makeApp({
    'app/page.js': PAGE,
    'middleware.ts': [
      'export default async function mw(req: Request, next: () => Promise<Response>): Promise<Response> {',
      '  const res = await next();',
      "  res.headers.set('x-mw', 'ran');",
      '  return res;',
      '}',
      '',
    ].join('\n'),
  });

  const h = await createRequestHandler({ appDir, dev: false });
  await h.warmup?.();
  const res = await h.handle(new Request('http://localhost/'));

  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-mw'), 'ran');
});
