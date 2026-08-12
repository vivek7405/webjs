/**
 * Cross-runtime dev static-serve test (#1397): in dev, `GET /public/*` must be
 * answered BEFORE the whole-app analysis completes, on BOTH the node:http and
 * `Bun.serve` listener shells.
 *
 * The hoist moves a serve branch earlier in the request path, and the two
 * listener shells reach `handle()` differently (the Bun shell may rebuild the
 * `Request` in `forwardedRequest` and classifies the response body through
 * `readBufferedOrStream` / `compressBufferSync`), so the invariant is worth
 * proving on each runtime rather than on Node alone.
 *
 * The fixture's root middleware module has a top-level await sleep, and
 * `loadMiddleware` runs inside `ensureReady()`, so the analysis is
 * deterministically slow with no network involved. `/__webjs/ready` stays 503
 * until the analysis lands, which is the observable the assertion pivots on.
 *
 * COUNTERFACTUAL: revert the dev-only `tryServePublicAsset` call ahead of
 * `await ensureReady()` in dev.js and the CSS request cannot resolve until warm
 * completes, so `/__webjs/ready` is already 200 by the time it does.
 *
 *   node test/bun/dev-public-before-warm.mjs
 *   bun  test/bun/dev-public-before-warm.mjs
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const CLI = join(ROOT, 'packages/cli/bin/webjs.js');
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
// A distinct base is NOT enough on its own, which is the trap here: a base
// only separates two files if the earlier one's modulus window stops before
// the later one's base, and among the existing dev-server scripts it does not.
// Their reachable RANGES are dev-reload-retry 9500-9739, dev-hot-reload
// 9700-9949, dev-extra-watch 9750-9989 and dev-overlay-scope 9800-9979, which
// overlap each other freely. That is pre-existing and not this file's to fix;
// what this file can do is sit entirely ABOVE all of them. 9989 is the highest
// port any of them reaches, so 10000-10255 cannot collide with any of the four
// for any pair of pids. The per-pid offset is NOT doing that work and should
// not be credited with it: the node and bun runs are sequential steps and each
// runner runs a given file once, so nothing here races for a port. It is only
// defensive against a leftover socket from a prior run lingering in TIME_WAIT,
// which is the same account `dev-hot-reload.mjs` gives of the identical
// `base + pid % n` construct.
const PORT = 10000 + (process.pid % 256);
const BASE = `http://localhost:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolves once the port ACCEPTS a TCP connection, which happens before the
 * first request is answered. Polling an HTTP route instead would be circular:
 * the route under test is the one whose timing is being measured. */
function portAccepts() {
  return new Promise((res) => {
    const s = connect(PORT, 'localhost');
    s.once('connect', () => { s.destroy(); res(true); });
    s.once('error', () => { s.destroy(); res(false); });
  });
}

async function until(fn, { timeoutMs, stepMs = 50 }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { if (await fn()) return true; } catch { /* keep polling */ }
    if (Date.now() > deadline) return false;
    await sleep(stepMs);
  }
}

const dir = mkdtempSync(join(tmpdir(), 'webjs-public-warm-'));
let child;
try {
  mkdirSync(join(dir, 'app'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'app/page.ts'), "import { html } from '@webjsdev/core';\nexport default () => html`<h1>ok</h1>`;\n");
  writeFileSync(join(dir, 'public/a.css'), 'body{color:red}\n');
  // Top-level await, so the module does not finish evaluating (and therefore
  // `loadMiddleware`, and therefore `ensureReady()`, does not resolve) for 1.5s.
  writeFileSync(
    join(dir, 'middleware.ts'),
    'await new Promise((r) => setTimeout(r, 1500));\n'
    + 'export default async function middleware(req: Request, next: () => Promise<Response>) { return next(); }\n',
  );
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'public-warm', type: 'module', imports: { '#*': './*' }, webjs: {} }));
  mkdirSync(join(dir, 'node_modules/@webjsdev'), { recursive: true });
  symlinkSync(join(ROOT, 'packages/core'), join(dir, 'node_modules/@webjsdev/core'));
  symlinkSync(join(ROOT, 'packages/server'), join(dir, 'node_modules/@webjsdev/server'));

  // `--no-hot` runs the server in-process, so the listener shell under test is
  // the one this runtime provides rather than a respawned `node --watch` child.
  child = spawn(process.execPath, [CLI, 'dev', '--port', String(PORT), '--no-hot'], {
    cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development' },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  const listening = await until(portAccepts, { timeoutMs: 30_000 });
  assert.ok(listening, `dev server never listened on ${runtime}\n--- server log ---\n${log}`);

  // One pass: the CSS must answer while readiness is still gated on the
  // analysis. Both requests are issued together so neither waits on the other.
  const [css, ready] = await Promise.all([
    fetch(`${BASE}/public/a.css`),
    fetch(`${BASE}/__webjs/ready`),
  ]);
  const cssBody = await css.text();
  assert.equal(css.status, 200, `/public/a.css was not served cold on ${runtime}\n--- server log ---\n${log}`);
  assert.equal(cssBody, 'body{color:red}\n', `/public/a.css served the wrong bytes on ${runtime}`);
  assert.equal(
    ready.status, 503,
    `the analysis had already completed on ${runtime}, so this proves nothing about ordering\n--- server log ---\n${log}`,
  );

  console.log(`OK  dev serves /public/* before the analysis completes on ${runtime} (#1397)`);
} finally {
  if (child && child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } }
    await sleep(500);
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ }
  }
  rmSync(dir, { recursive: true, force: true });
}
