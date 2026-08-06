/**
 * `webjs vendor pin` against the real jspm CDN (#1150).
 *
 * `vendor-cli.test.mjs` preloads an offline double into every CLI child, which
 * is what keeps a jspm outage from redding the required CI job. The cost is
 * that the command a user actually runs would otherwise stop being exercised
 * end to end anywhere, against anything real. This file is that one real run.
 *
 * Both test runners skip `*.live.test.*` unless `WEBJS_REQUIRE_NETWORK=1`, so
 * this never runs in a required check. `.github/workflows/vendor-cdn.yml` runs
 * it nightly with that variable set; a skip there is a warning rather than a
 * failure, since an outage is not a regression. `WEBJS_FAIL_ON_SKIP=1`
 * promotes it when you want to force the question.
 *
 * It asserts only what a live resolve is uniquely able to prove: that jspm
 * answers with a url of the shape the pin file expects, and that the bytes
 * behind that url hash into an SRI value. Everything about pin file structure,
 * pruning, gitignore healing, and the failure paths belongs in the offline
 * file, where it is deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(REPO_ROOT, 'packages', 'cli', 'bin', 'webjs.js');

/** Deliberately NO preload here. This one is supposed to reach the network. */
function runCli(args, cwd) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('exit', (code) => res({ code, stdout, stderr }));
    child.on('error', rej);
  });
}

test('pin resolves picocolors against the real CDN and hashes the bytes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-vendor-live-'));
  try {
    await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'));
    await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'page.ts'),
      `import pico from 'picocolors';\nexport default () => pico.green('ok');`);

    const { code, stdout, stderr } = await runCli(['vendor', 'pin'], dir);
    // Upstream trouble is not a regression. `WEBJS_FAIL_ON_SKIP` promotes it,
    // and is deliberately NOT the variable that selects this file nor one the
    // nightly sets, so a jspm outage does not red a scheduled run.
    const skip = (why) => {
      if (process.env.WEBJS_FAIL_ON_SKIP) {
        assert.fail(`live \`webjs vendor pin\` could not run (${why})`);
      }
      console.warn(`[vendor-pin.live] SKIP live pin (${why})`);
      t.skip('jspm.io was not in a state that can answer a pin');
    };

    if (code !== 0) {
      skip(`exit ${code}: ${(stderr || stdout).split('\n').filter(Boolean).slice(-1)[0] || 'no output'}`);
      return;
    }

    const parsed = JSON.parse(await readFile(join(dir, '.webjs', 'vendor', 'importmap.json'), 'utf8'));
    const url = parsed.imports.picocolors;
    assert.match(url, /^https:\/\/ga\.jspm\.io\/npm:picocolors@\d+\.\d+\.\d+\//,
      'a real resolve must carry a concrete version in a jspm CDN url');
    // The offline double mints this tail, so its absence is what proves this
    // run really went to the network rather than picking up a stray preload.
    assert.doesNotMatch(url, /\/double\.js$/, 'this test must NOT be running against the double');

    // A hiccup on the BUNDLE GET is the wider version of the same trap: pin
    // exits 0 with the entry pinned and no hash, and the CLI says so, so
    // asserting the hash outright would hard-fail on an outage the exit code
    // already forgave.
    if (!parsed.integrity || !parsed.integrity[url]) {
      skip('jspm.io resolved the package but would not serve its bundle to hash');
      return;
    }
    assert.match(parsed.integrity[url], /^sha384-/,
      'the bundle behind the resolved url must have been fetched and hashed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
