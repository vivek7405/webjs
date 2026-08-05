/**
 * Integration tests for the dev error overlay channel (#264), through the REAL
 * request pipeline (`createRequestHandler`).
 *
 * In dev, a render crash and a non-erasable-TS strip failure each push a dev
 * error frame (captured here via the `onDevError` hook, the same frame the
 * server writes to the SSE overlay channel) carrying the offending file path
 * and a source excerpt. In prod NEITHER fires and no source / path is built
 * (the counterfactual), and the overlay client (`/__webjs/reload.js`) 404s.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequestHandler } from '../../src/dev.js';

let tmpRoot;
before(() => { tmpRoot = mkdtempSync(join(tmpdir(), 'webjs-dev-overlay-')); });
after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });

function makeApp(files) {
  const appDir = mkdtempSync(join(tmpRoot, 'app-'));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(appDir, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, body);
  }
  return appDir;
}

test('a render crash in dev pushes a frame with the offending file + a source excerpt', async () => {
  const appDir = makeApp({
    'app/page.js': 'export default function P() {\n  throw new Error("kaboom render");\n}\n',
  });
  const frames = [];
  const app = await createRequestHandler({ appDir, dev: true, onDevError: (f) => frames.push(f) });

  const res = await app.handle(new Request('http://x/'));
  assert.equal(res.status, 500, 'the crash renders a 500');
  assert.equal(frames.length, 1, 'one dev error frame pushed');
  const f = frames[0];
  assert.equal(f.kind, 'render');
  assert.match(f.message, /kaboom render/);
  assert.match(f.file || '', /app[/\\]page\.js$/, 'the frame points at the page file');
  assert.match(f.codeFrame || '', /throw new Error/, 'the frame carries the throwing source line');
  // The handler also exposes the latest unresolved frame for SSE replay.
  assert.equal(app.getLastDevError().message, f.message, 'getLastDevError returns the same frame');
});

test('a non-erasable-TS module in dev pushes a frame with the file + the no-erasable hint', async () => {
  const appDir = makeApp({
    'app/page.js': "import '../components/bad.ts';\nexport default function P() { return 'ok'; }\n",
    'components/bad.ts': 'export enum Color { Red, Green }\n',
  });
  const frames = [];
  const app = await createRequestHandler({ appDir, dev: true, onDevError: (f) => frames.push(f) });
  await app.warmup();

  // Fetch the offending module the way the browser would (it is import-reachable
  // from the page, so the gate serves it and tsResponse runs the strip).
  const res = await app.handle(new Request('http://x/components/bad.ts'));
  assert.equal(res.status, 500, 'the strip failure is a 500 stub');
  const tsFrame = frames.find((f) => f.kind === 'ts-strip');
  assert.ok(tsFrame, 'a ts-strip frame was pushed');
  assert.match(tsFrame.file || '', /components[/\\]bad\.ts$/, 'the frame points at the .ts file');
  assert.match(tsFrame.hint || '', /erasable/i, 'the no-non-erasable hint is in the frame (not only a JS comment)');
});

test('a render frame is stamped with the URL that produced it (#1047)', async () => {
  const appDir = makeApp({
    'app/crash/page.js': 'export default function P() {\n  throw new Error("kaboom scope");\n}\n',
  });
  const frames = [];
  const app = await createRequestHandler({ appDir, dev: true, onDevError: (f) => frames.push(f) });

  await app.handle(new Request('http://x/crash?from=list'));
  assert.equal(frames.length, 1, 'one frame pushed');
  assert.equal(
    frames[0].url, '/crash?from=list',
    'the frame names the path AND query, the form the browser sees in location',
  );
});

test('a speculative prefetch render pushes NO frame and does not become the retained error (#1047)', async () => {
  const appDir = makeApp({
    'app/page.js': "export default function P() { return 'home'; }\n",
    'app/crash/page.js': 'export default function P() {\n  throw new Error("kaboom prefetch");\n}\n',
  });
  const frames = [];
  const app = await createRequestHandler({ appDir, dev: true, onDevError: (f) => frames.push(f) });

  // The exact request the client router's link prefetch sends.
  const res = await app.handle(new Request('http://x/crash', {
    headers: { 'x-webjs-router': '1', 'x-webjs-prefetch': '1' },
  }));
  assert.equal(res.status, 500, 'the prefetched page still renders its 500 (the response is unchanged)');
  assert.equal(frames.length, 0, 'hovering a link to a throwing page raises no overlay');
  assert.equal(app.getLastDevError(), null, 'and never becomes the frame replayed to a new tab');

  // The same URL fetched normally (a real navigation) still reports.
  await app.handle(new Request('http://x/crash'));
  assert.equal(frames.length, 1, 'a real visit to the same page still reports');
  assert.equal(frames[0].url, '/crash');
});

test('a successful render supersedes a retained error for the SAME url only (#1047)', async () => {
  const appDir = makeApp({
    'app/page.js': "export default function P() { return 'home'; }\n",
    'app/flaky/page.js': "export default function P() {\n  if (!globalThis.__wjFixed) throw new Error('kaboom flaky');\n  return 'fixed';\n}\n",
  });
  const app = await createRequestHandler({ appDir, dev: true });

  await app.handle(new Request('http://x/flaky'));
  assert.equal(app.getLastDevError()?.url, '/flaky', 'the error is retained for replay');

  // A good render of a DIFFERENT page must leave it standing: the user may
  // still be looking at /flaky.
  await app.handle(new Request('http://x/'));
  assert.equal(app.getLastDevError()?.url, '/flaky', 'an unrelated good render does not erase it');

  // A good render of the SAME page supersedes it.
  globalThis.__wjFixed = true;
  try {
    await app.handle(new Request('http://x/flaky'));
    assert.equal(app.getLastDevError(), null, 'the page recovered, so the retained frame is dropped');
  } finally { delete globalThis.__wjFixed; }
});

test('the stamped url carries webjs.basePath, so the gate works on a sub-path deploy (#1047)', async () => {
  const appDir = makeApp({
    'package.json': JSON.stringify({ name: 'bp', type: 'module', webjs: { basePath: '/app' } }),
    'app/crash/page.js': 'export default function P() {\n  throw new Error("kaboom basepath");\n}\n',
  });
  const frames = [];
  const app = await createRequestHandler({ appDir, dev: true, onDevError: (f) => frames.push(f) });

  await app.handle(new Request('http://x/app/crash'));
  assert.equal(frames.length, 1, 'the sub-path request still renders + reports');
  assert.equal(
    frames[0].url, '/app/crash',
    'the base path is put back, because the browser location carries it',
  );
});

test('PROD counterfactual: no frame is built and the overlay client 404s', async () => {
  const appDir = makeApp({
    'app/page.js': 'export default function P() {\n  throw new Error("kaboom prod");\n}\n',
  });
  const frames = [];
  const app = await createRequestHandler({ appDir, dev: false, onDevError: (f) => frames.push(f) });

  const res = await app.handle(new Request('http://x/'));
  assert.equal(res.status, 500, 'still a 500');
  const body = await res.text();
  assert.ok(!body.includes('kaboom prod'), 'prod 500 is terse: no stack / message leak');
  assert.equal(frames.length, 0, 'no dev error frame built in prod');
  assert.equal(app.getLastDevError(), null, 'no frame stored in prod');

  const reload = await app.handle(new Request('http://x/__webjs/reload.js'));
  assert.equal(reload.status, 404, 'the dev overlay client is not served in prod');
});
