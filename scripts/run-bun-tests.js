#!/usr/bin/env node
/**
 * Bun test matrix driver (#509).
 *
 * Runs the runtime-sensitive `node:test` files (under `test/`, `packages/core/test/`,
 * and `packages/server/test/`, excluding `browser/`, the `e2e/` gate, and the
 * live-CDN `*.live.test.*` files) under Bun, file by file via `bun test <file>`.
 *
 * SOUNDNESS: the runner does NOT classify failures into skips (a self-classifying
 * runner can silently hide a real bug behind a "skip", which defeats the purpose).
 * The ONLY skips are an EXPLICIT, documented `DENYLIST` of files that assert
 * Node-only behavior or trip a Bun test-runner quirk, each with a reason and a
 * note of where the Bun-relevant behavior IS covered. Every other file MUST pass:
 * a non-zero exit, ANY failed test, or zero tests run (a silent compat gap) is a
 * genuine failure that fails the job. So a real cross-runtime bug can only ever
 * surface as a failure, never be auto-skipped.
 *
 * The Node suite (`npm test`) stays the source of truth; this matrix is additive.
 * Set `WEBJS_BUN_TESTS=…` to a comma-separated path-substring filter to scope a
 * local run.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, sep, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUN = process.env.BUN || 'bun';
const PER_FILE_TIMEOUT_MS = Number(process.env.WEBJS_BUN_TEST_TIMEOUT_MS || 120_000);

/**
 * Files SKIPPED under Bun, each with a reason and where the Bun-relevant behavior
 * is otherwise covered. A file-level skip is coarse, so node-only behavior is
 * SPLIT into its own file (api dev-cache-bust, body-limit server-timeouts) rather
 * than denylisting a file that also carries runtime-agnostic tests. Match is by
 * the exact repo-relative path (normalized to `/`).
 */
const DENYLIST = [
  { match: 'packages/server/test/api/dev-cache-bust.test.js', reason: 'asserts the bare server-level dev ?t= import cache-bust directly (no supervisor), which Bun ignores by keying its module cache on path. The USER-FACING hot reload is fixed for Bun at the CLI level via `bun --hot` (#514), proven cross-runtime by test/bun/dev-hot-reload.mjs; this unit test exercises the Node-only `?t=` mechanism. The rest of handleApi runs on Bun via api.test.js.' },
  { match: 'packages/server/test/body-limit/server-timeouts.test.js', reason: 'asserts node:http server.requestTimeout/headersTimeout/keepAliveTimeout; the Bun shell uses Bun.serve idleTimeout instead (#511). The runtime-agnostic 413 body-limit tests run on Bun via integration.test.js.' },
  { match: 'packages/server/test/dev/dev-handler.test.js', reason: 'node:http shell internals (toWebRequest / sendWebResponse / server.address, the node ServerResponse streaming path). The Bun shell is covered by test/bun/listener.mjs and test/bun/compression.mjs + listener/compression-parity.test.js (which now assert brotli on the Bun shell too, #517).' },
  { match: 'packages/server/test/dev/watch-extra-paths-live.test.js', reason: 'boots startServer and reads the port via the node:http `server.address()` shape (#894), which the Bun.serve shell does not expose. The Bun behavior (an outside webjs.dev.watch dir live-reloads over SSE) is proven on Bun by test/bun/dev-extra-watch.mjs, which drives the real CLI + fetch. The readDevWatchPathsFromApp reader logic is runtime-agnostic and covered by watch-extra-paths.test.js.' },
  { match: 'packages/server/test/dev/reload-retry-hint.test.js', reason: 'boots startServer and reads the port via the node:http `server.address()` shape (#893). The Bun behavior (the SSE hello carries the retry hint on the Bun.serve shell) is proven on Bun by test/bun/dev-reload-retry.mjs. The client-side reload protocol + boot-id relay are runtime-agnostic and covered by reload-shared-connection.test.js and dev/browser/reload-worker.test.js.' },
  { match: 'packages/server/test/ts-strip/ts-strip.test.js', reason: 'uses the node built-in stripper as the byte-identity reference (absent on Bun). The amaro path (Bun backend) is covered on Bun by test/bun/smoke.mjs + dev/dev-error-overlay.test.js, and a forced-amaro parity test runs on Node.' },
  { match: 'packages/server/test/importmap/importmap.test.js', reason: 'relies on node:test source-order for the shared importmap module singleton; Bun orders/isolates tests differently (the importmap functions themselves are runtime-agnostic).' },
  { match: 'packages/server/test/file-storage/disk-store.test.js', reason: "Bun's test runner mis-attributes the intentional mid-stream ReadableStream error across this file's tests. The FileStore streaming behavior (put/get round-trip AND the no-orphan-on-mid-stream-error invariant) is now proven on Bun by test/bun/file-storage.mjs (the #509 Readable.fromWeb->reader-loop fix)." },
  { match: 'test/bun/compression.test.mjs', reason: "Bun's test runner mis-attributes the intentional mid-stream ReadableStream error (the #517 no-hang test deliberately errors a stream) as a failure; the underlying server handles it (the direct script passes). Surfaced once seeding installs its Bun.plugin (#529), which shifts the boot timing. The Bun compression behavior (brotli + the no-hang) is covered DIRECTLY by the dedicated `bun test/bun/compression.mjs` CI step, which passes." },
  { match: 'test/bun/listener-overhead.test.mjs', reason: "the single test() boots TWO servers (the main app + the basePath app) plus a deliberate 400ms streamed-second-chunk stall, tipping over bun test's 5s default per-test timeout (same class as compression.test.mjs). The Bun behavior (out-of-band IP, sync buffered compress, streamed-head non-blocking, basePath spoof guard) is covered DIRECTLY by the dedicated `bun test/bun/listener-overhead.mjs` CI step (a plain script, no per-test timeout), and the buffered-vs-streamed classification by listener/listener-core.test.js which passes under bun test." },
  { match: 'packages/server/test/cache/cache-redis.test.js', reason: 'needs a running Redis + an ioredis/redis client, not provisioned in the matrix (skipped on Node too).' },
  { match: 'packages/server/test/websocket/websocket.test.js', reason: 'exercises the node `ws`-library upgrade subsystem directly (node:http createServer + attachWebSocket, which do not interoperate on Bun). The Bun WebSocket path (Bun.serve + the BunWsAdapter, #511) is covered by test/bun/listener.mjs.' },
  { match: 'test/cli/typecheck.test.mjs', reason: 'spawns process.execPath (the webjs CLI typecheck, a Node tsc tool); under the matrix process.execPath is bun, which resolves TypeScript differently, so the Node-tooling assertion does not hold.' },
  { match: 'test/types/dts-no-phantom-exports.test.mjs', reason: 'a Node-tooling type-check guard (#1031): it copies each package tree and spawns process.execPath (Node tsc) per overlay entry to enumerate declared vs runtime exports. It has no runtime-sensitive surface (the .d.ts overlays are runtime-agnostic), and the per-package tsc sweep exceeds bun test\'s 5s default per-test timeout; same Node-tooling class as test/cli/typecheck.test.mjs. Fully covered on the Node path by the unit job.' },
  { match: 'packages/server/test/elision/differential-elision.test.js', reason: 'boots the examples/blog app and renders its DB-backed home page, which needs a migrated Drizzle dev.db + jspm vendor resolution the matrix job does not provision (only the e2e / in-repo-app jobs do). The elision LOGIC is covered by the other unit tests in elision/; a real app boot on Bun is covered deterministically by test/bun/listener.mjs.' },
  { match: 'test/docs/', reason: "every test/docs/*.test.mjs boots the app serving the docs via createRequestHandler and asserts rendered HTML / llms output (docs-CONTENT checks, not runtime-sensitive code). The cold boot resolves the docs code-sample bare imports via jspm, which intermittently exceeds bun test's 5s default per-test timeout (node --test has no default timeout); which docs page tips over varies by run (security-page, troubleshooting-page, llms have all flaked). Same app-boot + vendor-resolution class as differential-elision, fully covered on the Node path by the unit job." },
  { match: 'test/preload-subset.test.mjs', reason: "boots the in-repo apps (website, which now serves the docs and the gallery, plus blog) via createRequestHandler and probes every emitted modulepreload (#204). The cold boot resolves each app's bare imports via jspm, and the website boot alone tips just over bun test's 5s default per-test timeout on the CI runner (it runs in ~5.1s locally), the same app-boot + vendor-resolution class as differential-elision and test/docs. The preload-subset invariant is fully covered on the Node path by the unit job; a real app boot on Bun is covered by test/bun/listener.mjs." },
  { match: 'test/integration/blog-http.test.mjs', reason: "boots the examples/blog app via createRequestHandler and asserts its HTTP responses / SSR HTML (the non-browser blocks demoted from the e2e suite, #777). Same cold-boot + jspm-vendor-resolution class as differential-elision / preload-subset (the DB-backed blog boot + vendor resolve exceeds bun test's 5s default per-test timeout). Fully covered on the Node path by the unit job; the Bun listener/handler path is covered by test/bun/listener.mjs." },
  { match: 'test/repo-health/link-worktree-deps.test.mjs', reason: "asserts the behavior of `scripts/link-worktree-deps.mjs`, a Node-only repo-development script (#1323). `npm run worktree:link` invokes it as `node scripts/...` and it never runs under Bun, so there is no cross-runtime behavior to prove. The tests build synthetic databases with `node:sqlite`, which Bun does not implement (it ships `bun:sqlite`), so the import fails to resolve before a single assertion runs. The script's own probe imports `node:sqlite` dynamically inside the seed path, so nothing here is on a Bun code path." },
  { match: 'test/repo-health/e2e-vendor-stub-module.test.mjs', reason: "imports the e2e vendor stub's emitted data: URL to prove it is a working module (#1228); Bun reads a specifier that long as a path and raises NameTooLong. That is a limitation of importing a data: URL FROM Bun, not of the fixture, whose URL is imported by Chromium: the Bun coverage is the `E2E (blog served on Bun)` job, where the differential elision block loads it for real. The runtime-agnostic half of the stub's coverage stays on the matrix as test/repo-health/e2e-vendor-stub.test.mjs." },
];

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && (e.name.endsWith('.test.js') || e.name.endsWith('.test.mjs'))) out.push(full);
  }
}

// Runtime-sensitive roots only (the issue's "server + core" scope, plus the
// cross-package SSR/scaffold tests under the repo-root test/). The dev-tooling
// packages (cli, mcp, editors, ui) are exercised on Node.
const all = [];
walk(join(ROOT, 'test'), all);
walk(join(ROOT, 'packages', 'core', 'test'), all);
walk(join(ROOT, 'packages', 'server', 'test'), all);

const SEP = sep;
// Exclude browser (needs wtr), e2e (gated), and the example-app smoke/probe
// tests (test/examples/**), which boot a real app that needs a migrated Drizzle
// DB + jspm vendor resolution the matrix job does not provision (the dedicated
// e2e / in-repo-app CI jobs do; on Bun a real app boot is covered
// deterministically by the test/bun/*.mjs scripts).
//
// `packages/server/test/vendor/` used to be excluded here as network-bound.
// That stopped being true in #1150: the suite resolves through an offline
// double now, and it is worth running on Bun precisely BECAUSE that double is a
// `globalThis.fetch` swap, which is the kind of thing the two runtimes are most
// likely to disagree about.
const excludeSegs = [`${SEP}browser${SEP}`, `${SEP}e2e${SEP}`, `${SEP}examples${SEP}`];

// Live third-party calls live only in `*.live.test.*` files, and those are
// opt-in (#1150). A jspm outage must never be able to red a required check, so
// the matrix skips them unless a caller explicitly asks for the network. The
// nightly `vendor-cdn` workflow is what asks.
const LIVE_MARKER = '.live.test.';
const wantsNetwork = Boolean(process.env.WEBJS_REQUIRE_NETWORK);
// Same third-party deny the node runner installs, so a jspm outage cannot red
// this job either (#1150). Bun ignores NODE_OPTIONS, hence the explicit flag.
// It goes AFTER the `test` subcommand: `bun --preload X test <file>` treats
// `test` as the package.json SCRIPT and runs the whole Node suite instead,
// which fails in a way that looks nothing like a flag-order mistake.
const denyArgs = wantsNetwork
  ? []
  : ['--preload', resolve(ROOT, 'test', 'fixtures', 'deny-live-hosts.mjs')];

const filter = (process.env.WEBJS_BUN_TESTS || '').split(',').map((s) => s.trim()).filter(Boolean);
// Repo-relative path, always forward-slashed so DENYLIST matching is OS-stable.
const rel = (f) => f.slice(ROOT.length + 1).split(sep).join('/');
// A denylist entry ending in `/` is a DIRECTORY prefix (skips every file under
// it); otherwise it is an exact repo-relative file path.
const denyOf = (f) => DENYLIST.find((d) => (d.match.endsWith('/') ? rel(f).startsWith(d.match) : rel(f) === d.match));

const files = all
  .filter((f) => !excludeSegs.some((s) => f.includes(s)))
  .filter((f) => wantsNetwork || !f.includes(LIVE_MARKER))
  .filter((f) => filter.length === 0 || filter.some((q) => f.includes(q)))
  .sort();

// Guard against a silent green from validating nothing: if discovery found no
// files (a moved test root or a broken walk) and no explicit filter was given,
// that is a failure, not a pass.
if (files.length === 0 && filter.length === 0) {
  console.error('[bun-matrix] FAIL: discovered 0 test files (the test roots moved or the walk broke).');
  process.exit(1);
}

const results = { pass: [], deny: [], fail: [] };

console.log(`[bun-matrix] running ${files.length} test files under ${BUN}\n`);

for (const f of files) {
  const deny = denyOf(f);
  if (deny) {
    results.deny.push({ f, why: deny.reason });
    console.log(`SKIP(node-only) ${rel(f)}`);
    continue;
  }
  const r = spawnSync(BUN, ['test', ...denyArgs, f], {
    cwd: ROOT, encoding: 'utf8', timeout: PER_FILE_TIMEOUT_MS,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.error && r.error.code === 'ETIMEDOUT') {
    results.fail.push({ f, why: `timed out after ${PER_FILE_TIMEOUT_MS}ms (a hang is a genuine Bun failure)` });
    console.log(`TIMEOUT  ${rel(f)}`);
    continue;
  }
  const verdict = classify(r.status, out);
  if (verdict.ok) {
    results.pass.push(f);
  } else {
    results.fail.push({ f, why: verdict.why });
    console.log(`FAIL     ${rel(f)}  [${verdict.why}]`);
  }
}

/**
 * A file PASSES only if Bun exited 0, reported NO failed tests, and actually RAN
 * at least one test (a zero-test run is a silent compat gap, not a pass).
 * @param {number|null} status
 * @param {string} out
 */
function classify(status, out) {
  const passN = num(out, /(\d+)\s+pass\b/);
  const failN = num(out, /(\d+)\s+fail\b/);
  const ranN = num(out, /Ran\s+(\d+)\s+test/);
  if (status !== 0) return { ok: false, why: `non-zero exit (${status}); ${failN} failed` + firstFail(out) };
  if (failN > 0) return { ok: false, why: `${failN} test(s) failed` + firstFail(out) };
  const executed = ranN || passN;
  if (executed === 0) return { ok: false, why: 'zero tests ran (a silent Bun node:test compat gap)' };
  return { ok: true };
}

function num(out, re) { const m = re.exec(out); return m ? Number(m[1]) : 0; }
function firstFail(out) {
  const line = out.split('\n').find((l) => /AssertionError|error:|\(fail\)/.test(l));
  return line ? `: ${line.trim().slice(0, 160)}` : '';
}

console.log('\n[bun-matrix] summary');
console.log(`  pass:            ${results.pass.length}`);
console.log(`  skip(node-only): ${results.deny.length}  (explicit DENYLIST; each documented, Bun behavior covered elsewhere)`);
console.log(`  genuine fail:    ${results.fail.length}`);

if (results.fail.length) {
  console.log('\n[bun-matrix] GENUINE FAILURES (these fail the job):');
  for (const { f, why } of results.fail) console.log(`  - ${rel(f)}: ${why}`);
  process.exit(1);
}
console.log('\n[bun-matrix] OK: no genuine Bun failures.');
