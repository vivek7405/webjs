/**
 * Cross-runtime dev error overlay scope test (#1047): a `render` frame must be
 * stamped with the URL that produced it, a speculative link prefetch must report
 * no frame at all, and the SSE replay handed to a freshly-connected tab must
 * carry that url, on BOTH the node:http and `Bun.serve` listener shells.
 *
 * Why this needs a cross-runtime run rather than a node-only one: the change is
 * on the SSR dispatch path, and each shell replays `getLastDevError()` with its
 * own code (`dev.js` writes it into a node:http `res`, `listener-bun.js` enqueues
 * it into a `ReadableStream` controller), so a serialization difference would
 * only show on one of them. Run:
 *
 *   node test/bun/dev-overlay-scope.mjs
 *   bun  test/bun/dev-overlay-scope.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CLI = join(ROOT, 'packages/cli/bin/webjs.js');
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
const PORT = 9800 + (process.pid % 180);
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, { timeoutMs, stepMs = 200 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if (await fn()) return true; } catch { /* keep polling */ }
    if (Date.now() > deadline) return false;
    await sleep(stepMs);
  }
}

/**
 * Read what a freshly-connected tab is handed on the SSE channel, then hang up.
 *
 * Every read is raced against a deadline, because the interesting assertion here
 * is a NEGATIVE one (no error frame was replayed), and in that case the stream
 * simply goes quiet after the hello frame: a bare `reader.read()` would block
 * until the next keepalive, which is long enough to trip `bun test`'s per-test
 * timeout and turn a passing assertion into a hang.
 */
async function replayedFrames(budgetMs = 700) {
  const res = await fetch(`${BASE}/__webjs/events`, { headers: { accept: 'text/event-stream' } });
  const reader = res.body.getReader();
  const deadline = Date.now() + budgetMs;
  let text = '';
  try {
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        sleep(Math.max(0, deadline - Date.now())).then(() => null),
      ]);
      if (!chunk || chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
      // The server writes hello first and the replayed error frame right after,
      // so once the error frame is in hand there is nothing left to wait for.
      if (text.includes('event: webjs-error')) break;
    }
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
  return text;
}

const dir = mkdtempSync(join(tmpdir(), 'webjs-overlay-scope-'));
let child;
try {
  mkdirSync(join(dir, 'app/crash'), { recursive: true });
  writeFileSync(join(dir, 'app/page.ts'), "import { html } from '@webjsdev/core';\nexport default () => html`<h1>ok</h1>`;\n");
  writeFileSync(join(dir, 'app/crash/page.ts'), "export default function Crash() {\n  throw new Error('demo: this page threw during render');\n}\n");
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'overlay-scope', type: 'module', imports: { '#*': './*' }, webjs: {} }));
  mkdirSync(join(dir, 'node_modules/@webjsdev'), { recursive: true });
  symlinkSync(join(ROOT, 'packages/core'), join(dir, 'node_modules/@webjsdev/core'));
  symlinkSync(join(ROOT, 'packages/server'), join(dir, 'node_modules/@webjsdev/server'));

  child = spawn(process.execPath, [CLI, 'dev', '--port', String(PORT)], {
    cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development' },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const ready = await until(async () => (await fetch(`${BASE}/__webjs/version`)).ok, { timeoutMs: 30_000 });
  assert.ok(ready, `dev server never came up on ${runtime}\n--- server log ---\n${log}`);

  // A speculative prefetch of the throwing page reports nothing, so a tab that
  // connects afterwards is handed no error frame at all.
  const pre = await fetch(`${BASE}/crash`, { headers: { 'x-webjs-router': '1', 'x-webjs-prefetch': '1' } });
  assert.equal(pre.status, 500, `the prefetched page should still render its 500 on ${runtime}`);
  const afterPrefetch = await replayedFrames();
  assert.ok(
    !afterPrefetch.includes('event: webjs-error'),
    `a prefetch render must not become the replayed frame on ${runtime}: ${JSON.stringify(afterPrefetch)}`,
  );

  // A real visit does report, and the replayed frame carries the url, which is
  // what lets the browser overlay decide the frame belongs on this page.
  const real = await fetch(`${BASE}/crash`);
  assert.equal(real.status, 500, `the throwing page renders a 500 on ${runtime}`);
  const afterVisit = await replayedFrames();
  assert.match(afterVisit, /event: webjs-error/, `no replayed error frame on ${runtime}: ${JSON.stringify(afterVisit)}`);
  const line = afterVisit.split('\n').find((l) => l.startsWith('data: ') && l.includes('"kind":"render"'));
  assert.ok(line, `no render frame in the replay on ${runtime}: ${JSON.stringify(afterVisit)}`);
  const frame = JSON.parse(line.slice('data: '.length));
  assert.equal(frame.url, '/crash', `the replayed frame must name its url on ${runtime}`);
  assert.match(frame.message, /this page threw during render/);

  // A good render of a DIFFERENT url must leave the retained frame standing,
  // because the user may still be looking at the page that broke. (The other
  // half of that rule, a good render of the SAME url superseding it, needs a
  // page that recovers, which this fixture's unconditional throw cannot do;
  // it is covered on the Node path by dev-error-overlay.test.js. Nothing about
  // the clear is listener-shell specific, so what matters cross-runtime is
  // that the retained frame is replayed and carries its url, asserted above.)
  await fetch(`${BASE}/`);
  const afterUnrelated = await replayedFrames();
  assert.match(
    afterUnrelated, /event: webjs-error/,
    `an unrelated good render must not clear the retained frame on ${runtime}`,
  );

  console.log(`OK  dev error frames are URL-scoped and prefetch-exempt on ${runtime} (#1047)`);
} finally {
  if (child && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
    await sleep(500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  rmSync(dir, { recursive: true, force: true });
}
