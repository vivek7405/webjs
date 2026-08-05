/**
 * CLI integration tests for `webjs vendor pin` / `unpin` / `list`.
 *
 * Spawns the actual CLI binary against a temp app directory and asserts the
 * file-system + stdout contracts.
 *
 * OFFLINE (#1150). `webjs vendor pin` resolves through api.jspm.io, and this
 * file used to let the spawned CLI reach it, which is how a jspm outage redded
 * the required CI job on PR #1149, a documentation-only change. Every spawn now
 * carries `test/fixtures/jspm-double-preload.mjs`, so the child answers itself.
 * The live half of the same contract lives in `vendor-pin.live.test.mjs`, which
 * both test runners skip unless `WEBJS_REQUIRE_NETWORK=1`.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { mkdtemp, writeFile, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const CLI = resolve(REPO_ROOT, 'packages', 'cli', 'bin', 'webjs.js');

const PRELOAD = resolve(__dirname, '..', 'fixtures', 'jspm-double-preload.mjs');
// A moved or renamed preload must fail here rather than in the child, where a
// module-not-found would surface as an opaque non-zero exit code and the
// obvious reading would be that the CLI itself broke.
statSync(PRELOAD);

/**
 * The flag that loads the preload into the child, chosen by runtime.
 *
 * It cannot be NODE_OPTIONS, because Bun ignores that variable outright
 * (measured: `NODE_OPTIONS=--import ... bun -e 0` loads nothing). The parent
 * runtime IS the child runtime here, because the spawn below uses
 * `process.execPath`, which under `bun test` is the bun binary.
 *
 * The flags are not symmetric. `node --preload` is a hard `bad option` error,
 * while `bun --import` currently works as an alias, so a bare `--import` would
 * in fact run on both today. Selecting per runtime anyway is the same choice
 * `test/e2e/e2e.test.mjs` made for #1229's stub, and it means this file does
 * not silently depend on Bun continuing to accept a Node spelling. Node wants a
 * URL rather than a path, since the spawn sets `cwd` to the temp app directory
 * and a relative `--import` would resolve against that instead of the repo.
 */
const PRELOAD_ARGS = process.versions.bun
  ? ['--preload', PRELOAD]
  : ['--import', pathToFileURL(PRELOAD).href];

function runCli(args, cwd) {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [...PRELOAD_ARGS, CLI, ...args], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('exit', (code) => {
      // Assert the wiring on EVERY spawn, not in one test. Dropping the flag
      // would otherwise leave this file green while silently restoring the
      // live-CDN dependency, since the CLI's own output is identical either
      // way. The preload also forces a non-zero exit on any request the double
      // does not serve, which the per-test `code` assertions then catch.
      assert.match(stderr, /\[jspm-double\] armed/,
        'the jspm double must be preloaded into every CLI child');
      res({ code, stdout, stderr });
    });
    child.on('error', rej);
  });
}

async function makeApp() {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-vendor-cli-'));
  await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'));
  await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
  await mkdir(join(dir, 'app'), { recursive: true });
  await writeFile(join(dir, 'app', 'page.ts'), `import pico from 'picocolors';\nexport default () => pico.green('ok');`);
  return dir;
}

describe('webjs vendor CLI', () => {
  let appDir;

  before(async () => {
    appDir = await makeApp();
  });

  after(async () => {
    await rm(appDir, { recursive: true, force: true });
  });

  test('list with no pin file reports "No pin file"', async () => {
    const { code, stdout } = await runCli(['vendor', 'list'], appDir);
    assert.equal(code, 0);
    assert.match(stdout, /No pin file/);
  });

  test('pin writes .webjs/vendor/importmap.json with picocolors entry', async () => {
    const { code, stdout, stderr } = await runCli(['vendor', 'pin'], appDir);
    assert.equal(code, 0, `pin failed: ${stderr}`);
    assert.match(stdout, /Pinning vendor packages/);
    assert.match(stdout, /picocolors@/);
    assert.match(stdout, /wrote \.webjs\/vendor\/importmap\.json/);

    const file = await readFile(join(appDir, '.webjs', 'vendor', 'importmap.json'), 'utf8');
    const parsed = JSON.parse(file);
    assert.ok(parsed.imports.picocolors, 'picocolors should be in the pinned importmap');
    assert.match(parsed.imports.picocolors, /^https:\/\/ga\.jspm\.io\/npm:picocolors@/);
    // The prefix above is equally true of the real CDN, so on its own it cannot
    // tell a doubled resolve from a live one. This tail can: jspm never emits
    // it, so it only appears when the preload is actually in the child.
    assert.match(parsed.imports.picocolors, /\/double\.js$/,
      'the url must come from the jspm double, not from the network');
  });

  test('list with pin file reports the pinned package + URL', async () => {
    const { code, stdout } = await runCli(['vendor', 'list'], appDir);
    assert.equal(code, 0);
    assert.match(stdout, /picocolors@/);
    assert.match(stdout, /https:\/\/ga\.jspm\.io\/npm:picocolors@/);
  });

  test('unpin removes a package entry from importmap.json', async () => {
    const { code, stdout } = await runCli(['vendor', 'unpin', 'picocolors'], appDir);
    assert.equal(code, 0);
    assert.match(stdout, /picocolors\s+unpinned/);

    // If unpinning the LAST entry, the file is removed entirely so
    // the next boot falls back to live API resolution (otherwise an
    // empty `{ imports: {} }` would shadow that fallback). If the
    // test scaffold had multiple pinned packages we'd assert the
    // file persists with the other entries; here it had just
    // picocolors, so the file is gone.
    const { existsSync } = await import('node:fs');
    assert.equal(existsSync(join(appDir, '.webjs', 'vendor', 'importmap.json')), false,
      'pin file removed when last pin unpinned');
  });

  test('unpin a non-existent package reports "not in pin file" and exits non-zero', async () => {
    const { code, stderr } = await runCli(['vendor', 'unpin', 'not-pinned-xyz'], appDir);
    // Exit non-zero so scripts wrapping the CLI can detect that
    // nothing was removed. The message alone wasn't enough for
    // pipelines that rely on the exit code.
    assert.equal(code, 1);
    assert.match(stderr, /not in pin file/);
  });

  test('pin --download writes bundle files alongside importmap.json', async () => {
    const { code, stdout, stderr } = await runCli(['vendor', 'pin', '--download'], appDir);
    assert.equal(code, 0, `pin --download failed: ${stderr}`);
    assert.match(stdout, /downloading bundles/);
    assert.match(stdout, /picocolors@.*\d+\.\d+ KB/);
    assert.match(stdout, /wrote \.webjs\/vendor\/importmap\.json \+ \d+ bundle/);

    const file = await readFile(join(appDir, '.webjs', 'vendor', 'importmap.json'), 'utf8');
    const parsed = JSON.parse(file);
    assert.match(parsed.imports.picocolors, /^\/__webjs\/vendor\/picocolors@.*\.js$/);

    const bundleName = parsed.imports.picocolors.slice('/__webjs/vendor/'.length);
    const bundleBytes = await readFile(join(appDir, '.webjs', 'vendor', bundleName), 'utf8');
    assert.ok(bundleBytes.length > 0, 'bundle file should have bytes');
  });

  test('unknown vendor subcommand exits with usage message', async () => {
    const { code, stderr } = await runCli(['vendor', 'invalid'], appDir);
    assert.equal(code, 1);
    assert.match(stderr, /Unknown vendor subcommand/);
    assert.match(stderr, /webjs vendor pin/);
  });

  test('pin names a found-but-uninstalled specifier instead of "no bare imports" (#953)', async () => {
    // A package imported from client code but not installed under node_modules
    // (a CDN-only import like three). The scan finds it, the version gate
    // drops it, and the CLI must NAME it and point at `npm install`, not claim
    // there were none. No network: an unresolvable specifier never hits jspm.
    const dir = await mkdtemp(join(tmpdir(), 'webjs-vendor-cli-drop-'));
    try {
      await symlink(join(REPO_ROOT, 'node_modules'), join(dir, 'node_modules'));
      await writeFile(join(dir, 'package.json'), '{"name":"tmp","version":"0.0.0"}');
      await mkdir(join(dir, 'app'), { recursive: true });
      await writeFile(join(dir, 'app', 'page.ts'), `import * as THREE from 'three';\nexport default () => 'ok';`);

      const { code, stdout, stderr } = await runCli(['vendor', 'pin'], dir);
      const out = stdout + stderr;
      assert.equal(code, 1, `expected non-zero exit, got ${code}: ${out}`);
      assert.doesNotMatch(out, /no bare-specifier npm imports found/,
        'must NOT print the misleading "none found" message');
      assert.match(out, /could not resolve a version/);
      assert.match(out, /three/, 'names the dropped specifier');
      assert.match(out, /npm install three/, 'points at the remedy');
      // No pin file written for an all-unresolvable set.
      const { existsSync } = await import('node:fs');
      assert.equal(existsSync(join(dir, '.webjs', 'vendor', 'importmap.json')), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// #448: the opt-in pins `webjs vendor pin` writes must be committable. A
// `.gitignore` that excludes `.webjs/` silently swallows them; pinning must
// self-heal that so a user can commit what they deliberately created.
describe('webjs vendor pin makes pins committable (#448)', () => {
  function git(args, cwd) {
    return new Promise((res) => {
      const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_PREFIX, ...env } = process.env;
      const child = spawn('git', args, { cwd, env });
      let out = '';
      child.stdout.on('data', (d) => { out += d.toString(); });
      child.on('exit', (code) => res({ code, out }));
    });
  }

  test('a blanket .webjs/ ignore is healed so the pin is committable', async () => {
    const dir = await makeApp();
    try {
      await git(['init', '-q'], dir);
      // The exact regression: an app whose .gitignore excludes the whole
      // .webjs directory, which swallows the pin output.
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.webjs/\n');
      assert.equal((await git(['check-ignore', '-q', '.webjs/vendor/importmap.json'], dir)).code, 0,
        'precondition: the pin file is ignored before pinning');

      const { code, stdout } = await runCli(['vendor', 'pin'], dir);
      assert.equal(code, 0);
      // The pins the user just created are now committable.
      assert.equal((await git(['check-ignore', '-q', '.webjs/vendor/importmap.json'], dir)).code, 1,
        'pin file is NOT ignored after pinning');
      assert.match(stdout, /Added the `\.webjs\/vendor\/` exception to \.gitignore/);
      // The transient cache exclusion still works: routes.d.ts stays ignored.
      await writeFile(join(dir, '.webjs', 'routes.d.ts'), 'export {}');
      assert.equal((await git(['check-ignore', '-q', '.webjs/routes.d.ts'], dir)).code, 0,
        'transient .webjs cache stays ignored');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a scaffold-correct .gitignore is left unchanged (no-vendor default unaffected)', async () => {
    const dir = await makeApp();
    try {
      await git(['init', '-q'], dir);
      // The current scaffold template already un-ignores vendor.
      const scaffold = 'node_modules/\n**/.webjs/*\n!**/.webjs/vendor/\n!**/.webjs/vendor/**\n';
      await writeFile(join(dir, '.gitignore'), scaffold);

      const { code, stdout } = await runCli(['vendor', 'pin'], dir);
      assert.equal(code, 0);
      const after = await readFile(join(dir, '.gitignore'), 'utf8');
      assert.equal(after, scaffold, 'an already-committable app sees no .gitignore change');
      assert.doesNotMatch(stdout, /Added the `\.webjs\/vendor\/` exception/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
