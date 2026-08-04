/**
 * Cross-runtime proof that a `test/bun/*.mjs` proof script REPORTS its failure
 * through the exit code (#1092):
 *
 *   node test/bun/proof-exit-code.mjs   # the node:http shell
 *   bun  test/bun/proof-exit-code.mjs   # the Bun.serve shell
 *
 * This is the meta-test guarding the whole `test/bun/` layer. Every script in it
 * boots a real app through `startServer`, and `startServer` installs an
 * `uncaughtException` handler that begins a graceful shutdown. That shutdown
 * used to end in `process.exit(0)` unconditionally, so a top-level assertion
 * failure (which arrives at that handler on BOTH runtimes) was swallowed and the
 * script exited 0. The scripts pass a `quiet` logger, so the logged error went
 * nowhere either and the run was completely silent. CI runs roughly twenty of
 * those scripts directly (`run: bun test/bun/smoke.mjs` and friends) and trusts
 * the step's exit code, so those steps could not fail. Found while adding
 * `test/bun/forwarded-proto.mjs` in #1091, whose counterfactual came back green.
 *
 * The fix is in `makeShutdown` (`packages/server/src/listener-core.js`): the exit
 * code now reports WHY the process is going down. A signal-driven stop still
 * exits 0, a fatal one exits 1. So this file asserts all three arms, because
 * only the three together prove the mechanism DISCRIMINATES rather than always
 * failing (or always passing):
 *
 *   1. a proof script whose assertion fails exits NON-ZERO,
 *   2. a proof script whose assertions pass exits ZERO,
 *   3. SIGTERM against a live server still exits ZERO (the graceful-shutdown
 *      path a real deploy depends on, which the fix must not disturb).
 *
 * The three children are spawned with `process.execPath`, so they run under
 * WHICHEVER runtime runs this file and the assertion holds for both. They import
 * `@webjsdev/server` by absolute file URL rather than by bare specifier, since a
 * child written into a temp dir outside the repo cannot resolve `@webjsdev/*`.
 *
 * A plain assert script (not node:test), so the SAME file runs on both runtimes.
 * Run from the repo root.
 *
 * Its own failure is reported by an explicit `process.exit(1)`: this file boots
 * no server of its own, but keeping the shape uniform across `test/bun/` means a
 * script is never one forgotten line away from the silent-green class again.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE = pathToFileURL(resolve(__dirname, '../../packages/core/index.js')).toString();
const SERVER = pathToFileURL(resolve(__dirname, '../../packages/server/index.js')).toString();
const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;

const dir = mkdtempSync(join(tmpdir(), 'wj-proof-exit-'));
const w = (rel, body) => {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body);
  return abs;
};

/**
 * Run one child under the current runtime and resolve its exit code.
 *
 * `signalAfter` covers arm 3: the child prints a ready line once it is
 * listening, and the signal is sent only then, so the SIGTERM cannot land
 * before the handler `startServer` installs.
 *
 * @param {string} file absolute path of the script to run
 * @param {{ signalAfter?: NodeJS.Signals }} [opts]
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, out: string }>}
 */
function run(file, { signalAfter } = {}) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [file], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let signalled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); rej(new Error(`child ${file} timed out`)); }, 60_000);
    const onChunk = (d) => {
      out += d;
      if (signalAfter && !signalled && out.includes('READY')) { signalled = true; child.kill(signalAfter); }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (e) => { clearTimeout(timer); rej(e); });
    child.on('exit', (code, signal) => { clearTimeout(timer); res({ code, signal, out }); });
  });
}

/**
 * The body every child shares: the exact shape of a real proof script, a real
 * app booted through `startServer` with the same `quiet` logger they all pass.
 * @param {string} tail the script's own body, appended after the boot
 */
const child = (tail) => `
import assert from 'node:assert/strict';
import { startServer } from ${JSON.stringify(SERVER)};
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const { close } = await startServer({ appDir: ${JSON.stringify(dir)}, dev: false, port: 0, logger: quiet });
${tail}
`;

/** @type {unknown} */
let failure = null;
try {
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'proof-exit', type: 'module', webjs: {} }));
  w('app/layout.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default ({ children }: { children: unknown }) => html\`<!doctype html><html><head></head><body>\${children}</body></html>\`;`);
  w('app/page.ts', `import { html } from ${JSON.stringify(CORE)};\nexport default () => html\`<main>proof</main>\`;`);

  // 1. A failing assertion after the boot, the shape every proof script has.
  // This is the arm that was silently green: the throw reaches the
  // `uncaughtException` handler, which shuts the server down cleanly, and a
  // clean close used to exit 0 no matter what started it.
  const failing = w('failing.mjs', child(`assert.equal(1, 2, 'deliberate failure');`));
  const failed = await run(failing);
  assert.notEqual(
    failed.code, 0,
    `a failed assertion in a booted proof script must exit non-zero on ${runtime} (got ${failed.code})`,
  );

  // 2. The same script with its assertion satisfied. Without this arm, a fix
  // that made EVERY script exit non-zero would pass arm 1 and break all of CI.
  const passing = w('passing.mjs', child(`assert.equal(1, 1);\nawait close();\nprocess.exit(0);`));
  const passed = await run(passing);
  assert.equal(
    passed.code, 0,
    `a passing proof script must still exit 0 on ${runtime} (got ${passed.code}: ${passed.out.slice(0, 400)})`,
  );

  // 3. SIGTERM against a live server. This is the graceful-shutdown path a real
  // deploy rides (a rolling restart sends SIGTERM and reads the code), and it
  // shares one `makeShutdown` with the fatal path, so it is exactly what a fix
  // in that function can break. An operator-requested stop is a success.
  const term = w('sigterm.mjs', child(`console.log('READY');\nsetInterval(() => {}, 1000);`));
  const terminated = await run(term, { signalAfter: 'SIGTERM' });
  assert.equal(
    terminated.code, 0,
    `SIGTERM must still exit 0 on ${runtime} (got code ${terminated.code}, signal ${terminated.signal})`,
  );

  console.log(`OK  proof-script exit codes discriminate on ${runtime} (fail non-zero, pass 0, SIGTERM 0)`);
} catch (e) {
  failure = e;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failure) {
  console.error(`FAIL proof-script exit codes on ${runtime}`);
  console.error(failure instanceof Error ? failure.stack || failure.message : String(failure));
  process.exit(1);
}
