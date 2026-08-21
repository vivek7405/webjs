/**
 * Tests for `webjs doctor` (#266): the project-health checklist.
 *
 * The PURE check runner `runDoctorChecks(appDir, opts?)` is exercised directly
 * against tmp fixture appDirs (it reads files + optionally the network but never
 * exits / prints). The CLI integration is exercised by spawning the binary and
 * asserting the exit code (0 when no hard check fails, non-zero when one does),
 * mirroring typecheck.test.mjs.
 *
 * Network: the vendor-pin freshness check is BEST-EFFORT. We never let a real
 * network call into the test; the no-pin case is asserted directly, and the
 * outdated / network-failure cases are driven through the `opts.vendor`
 * injection seam (a stub `{ hasVendorPin, findOutdated }`), so the test is
 * deterministic and offline-safe.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const CLI = resolve(REPO, 'packages', 'cli', 'bin', 'webjs.js');
const CLI_LIB_DIR = resolve(REPO, 'packages', 'cli', 'lib');

const { runDoctorChecks } = await import(
  resolve(CLI_LIB_DIR, 'doctor.js')
);

const cleanup = [];
after(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });

/** A fresh tmp fixture dir under the OS tmpdir. */
function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'doctor-'));
  cleanup.push(dir);
  return dir;
}

/** Write a file, creating parent dirs. */
function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Find a check result by name. */
function byName(results, name) {
  const r = results.find((x) => x.name === name);
  assert.ok(r, `expected a '${name}' check in the results`);
  return r;
}

// A vendor stub that reports no pin file (the common unpinned-app case), so the
// pin check never touches the network unless a test overrides it.
const noPinVendor = { hasVendorPin: () => false, findOutdated: async () => [] };

/** Base opts that keep every check offline + green-leaning. */
function baseOpts(extra = {}) {
  return { cliDir: CLI_LIB_DIR, vendor: noPinVendor, ...extra };
}

// ---------------------------------------------------------------------------
// A well-configured app: every check should pass, none should fail.
// ---------------------------------------------------------------------------
test('a well-configured app produces no failures', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    name: 'good-app',
    dependencies: { '@webjsdev/core': 'latest', '@webjsdev/server': 'latest' },
  }));
  write(dir, 'tsconfig.json', JSON.stringify({
    compilerOptions: { erasableSyntaxOnly: true, strict: true },
  }));
  write(dir, '.env.example', 'DATABASE_URL=\nAUTH_SECRET=\n');
  write(dir, '.env', 'DATABASE_URL=file:./dev.db\nAUTH_SECRET=abc\n');
  // node_modules installs satisfying `latest`. core carries a resolvable entry
  // (main + index.js) so a well-configured app is also green on framework-resolve.
  write(dir, 'node_modules/@webjsdev/core/package.json', JSON.stringify({ version: '0.7.4', main: 'index.js' }));
  write(dir, 'node_modules/@webjsdev/core/index.js', 'export const x = 1;\n');
  write(dir, 'node_modules/@webjsdev/server/package.json', JSON.stringify({ version: '0.8.0' }));

  const results = await runDoctorChecks(dir, baseOpts());
  const fails = results.filter((r) => r.status === 'fail');
  assert.equal(fails.length, 0, `no hard fails expected, got: ${JSON.stringify(fails)}`);
  assert.equal(byName(results, 'tsconfig-erasable').status, 'pass');
  assert.equal(byName(results, 'env-drift').status, 'pass');
  assert.equal(byName(results, 'vendor-pin').status, 'pass');
  assert.equal(byName(results, 'webjs-versions').status, 'pass');
  assert.equal(byName(results, 'framework-resolve').status, 'pass');
});

// ---------------------------------------------------------------------------
// Node version: pass at/above required, fail below (the counterfactual).
// ---------------------------------------------------------------------------
test('node check passes when the injected version >= required', async () => {
  const dir = tmpDir();
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.4.0' }));
  assert.equal(byName(results, 'node-version').status, 'pass');
});

test('node check FAILS (hard) when an older version is injected', async () => {
  const dir = tmpDir();
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '20.11.0' }));
  const node = byName(results, 'node-version');
  assert.equal(node.status, 'fail', 'an old Node must be a hard fail');
  assert.match(node.fix, /Upgrade to Node/);
});

// ---------------------------------------------------------------------------
// tsconfig erasableSyntaxOnly.
// ---------------------------------------------------------------------------
test('tsconfig check FAILS when erasableSyntaxOnly is missing in an existing tsconfig', async () => {
  const dir = tmpDir();
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'tsconfig-erasable').status, 'fail');
});

test('tsconfig check FAILS when erasableSyntaxOnly is false', async () => {
  const dir = tmpDir();
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { erasableSyntaxOnly: false } }));
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'tsconfig-erasable').status, 'fail');
});

test('tsconfig check WARNS (not fails) when no tsconfig is present', async () => {
  const dir = tmpDir();
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'tsconfig-erasable').status, 'warn');
});

test('tsconfig check tolerates JSONC (comments + trailing commas)', async () => {
  const dir = tmpDir();
  write(dir, 'tsconfig.json',
    '{\n  // editor intelligence\n  "compilerOptions": {\n    "erasableSyntaxOnly": true, /* required */\n  },\n}\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'tsconfig-erasable').status, 'pass');
});

// ---------------------------------------------------------------------------
// .env drift.
// ---------------------------------------------------------------------------
test('env check WARNS listing a key in .env.example missing from .env', async () => {
  const dir = tmpDir();
  write(dir, '.env.example', 'DATABASE_URL=\nAUTH_SECRET=\nWEBJS_PUBLIC_API_URL=\n');
  write(dir, '.env', 'DATABASE_URL=file:./dev.db\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const env = byName(results, 'env-drift');
  assert.equal(env.status, 'warn');
  assert.match(env.message, /AUTH_SECRET/);
  assert.match(env.message, /WEBJS_PUBLIC_API_URL/);
});

test('env check PASSES when all example keys are present', async () => {
  const dir = tmpDir();
  write(dir, '.env.example', 'DATABASE_URL=\n# a comment\nAUTH_SECRET=\n');
  write(dir, '.env', 'AUTH_SECRET=x\nDATABASE_URL=y\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'env-drift').status, 'pass');
});

test('env check WARNS when .env.example exists but .env is absent', async () => {
  const dir = tmpDir();
  write(dir, '.env.example', 'DATABASE_URL=\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const env = byName(results, 'env-drift');
  assert.equal(env.status, 'warn');
  assert.match(env.fix, /cp \.env\.example \.env/);
});

test('env check PASSES (skips) when there is no .env.example', async () => {
  const dir = tmpDir();
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'env-drift').status, 'pass');
});

// ---------------------------------------------------------------------------
// @webjsdev version coherence.
// ---------------------------------------------------------------------------
test('version check WARNS on a missing @webjsdev install', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    dependencies: { '@webjsdev/core': '^0.7.0' },
  }));
  // No node_modules/@webjsdev/core installed.
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const v = byName(results, 'webjs-versions');
  assert.equal(v.status, 'warn');
  assert.match(v.message, /not installed/);
  assert.match(v.message, /@webjsdev\/core/, 'the message must name the dep that is missing');
  assert.match(v.fix, /npm install/);
});

test('version check WARNS on a range drift (installed does not satisfy)', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    dependencies: { '@webjsdev/core': '^0.7.0' },
  }));
  // Installed 0.8.0 does NOT satisfy ^0.7.0 (caret pins the minor for 0.x).
  write(dir, 'node_modules/@webjsdev/core/package.json', JSON.stringify({ version: '0.8.0' }));
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const v = byName(results, 'webjs-versions');
  assert.equal(v.status, 'warn');
  assert.match(v.message, /drift/);
});

test('version check PASSES when installed satisfies the declared range', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    dependencies: { '@webjsdev/core': '^0.7.0' },
    devDependencies: { '@webjsdev/cli': 'latest' },
  }));
  write(dir, 'node_modules/@webjsdev/core/package.json', JSON.stringify({ version: '0.7.4' }));
  write(dir, 'node_modules/@webjsdev/cli/package.json', JSON.stringify({ version: '0.10.1' }));
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'webjs-versions').status, 'pass');
});

// ---------------------------------------------------------------------------
// Resolution, not a per-app directory read (#1300 part 3).
//
// The check used to read `<appDir>/node_modules/<dep>/package.json` directly.
// Under npm workspaces the `@webjsdev/*` deps hoist to the ROOT node_modules, so
// an app subdirectory has no local copy and every declared dep was reported
// missing on a healthy install. It now asks Node's resolver instead, anchored at
// the app dir, which is the same question `framework-resolve` asks (the two
// openly contradicted each other before this).
//
// COUNTERFACTUAL: restore the `join(appDir, 'node_modules', dep, 'package.json')`
// read and all six fixtures below red with "N @webjsdev/* dependency not
// installed", which is the measured before-state on examples/blog and website.
// ---------------------------------------------------------------------------

/**
 * A workspace-shaped tree: deps installed ONLY in the root node_modules, plus an
 * app subdirectory with its own package.json and no node_modules of its own.
 * Returns the app dir.
 *
 * An entry file is written ONLY for a manifest that declares `main` or
 * `exports`, so a bin-only manifest models a real bin-only package. Writing one
 * unconditionally would be the difference between a fixture and a prop: CJS
 * resolution falls back to `index.js`, so `require.resolve('<dep>')` would
 * succeed for a package with no main entry and the bin-only case would stop
 * pinning the resolve ORDER it exists to pin.
 */
function workspaceFixture(installs, ranges) {
  const root = tmpDir();
  write(root, 'package.json', JSON.stringify({ name: 'root', workspaces: ['apps/*'] }));
  for (const [name, manifest] of Object.entries(installs)) {
    write(root, `node_modules/${name}/package.json`, JSON.stringify(manifest));
    if (manifest.main || manifest.exports) {
      write(root, `node_modules/${name}/index.js`, 'export const x = 1;\n');
    }
  }
  write(root, 'apps/web/package.json', JSON.stringify({ name: 'web', dependencies: ranges }));
  return join(root, 'apps/web');
}

test('version check PASSES for a workspace app whose deps hoist to the root node_modules', async () => {
  const appDir = workspaceFixture(
    {
      '@webjsdev/core': { name: '@webjsdev/core', version: '0.7.48', main: 'index.js' },
      '@webjsdev/server': { name: '@webjsdev/server', version: '0.8.60', main: 'index.js' },
    },
    { '@webjsdev/core': '^0.7.0', '@webjsdev/server': '^0.8.0' }
  );
  const results = await runDoctorChecks(appDir, baseOpts({ nodeVersion: '24.0.0' }));
  const v = byName(results, 'webjs-versions');
  assert.equal(v.status, 'pass', v.message);
  assert.match(v.message, /All 2 @webjsdev\/\* dependency/);
});

test('version check resolves a BIN-ONLY package (no main, no exports), like @webjsdev/cli', async () => {
  // require.resolve('<dep>') throws MODULE_NOT_FOUND for a package with no main
  // entry and no index.js to fall back to, which is why the direct
  // `<dep>/package.json` resolve is attempted FIRST rather than as a fallback.
  // Reorder the two attempts in readInstalledVersion and this case reds.
  const appDir = workspaceFixture(
    { '@webjsdev/cli': { name: '@webjsdev/cli', version: '0.10.52', bin: { webjs: 'bin/webjs.js' } } },
    { '@webjsdev/cli': '^0.10.0' }
  );
  const results = await runDoctorChecks(appDir, baseOpts({ nodeVersion: '24.0.0' }));
  const v = byName(results, 'webjs-versions');
  assert.equal(v.status, 'pass', v.message);
});

test('version check resolves an EXPORTS-LOCKED package whose map omits ./package.json', async () => {
  // @webjsdev/server's exports map has no './package.json' entry, so the direct
  // manifest resolve is refused with ERR_PACKAGE_PATH_NOT_EXPORTED and the main
  // entry plus a walk to the package root is the only way in.
  const appDir = workspaceFixture(
    {
      '@webjsdev/server': {
        name: '@webjsdev/server',
        version: '0.8.60',
        exports: { '.': './index.js', './check': './check.js' },
      },
    },
    { '@webjsdev/server': '^0.8.0' }
  );
  const results = await runDoctorChecks(appDir, baseOpts({ nodeVersion: '24.0.0' }));
  const v = byName(results, 'webjs-versions');
  assert.equal(v.status, 'pass', v.message);
});

test('version check still reports drift for a hoisted install, so the resolved version is real', async () => {
  // An undefined version could never produce a drift message, so this doubles as
  // the proof that the resolved version is the manifest's own string.
  const appDir = workspaceFixture(
    { '@webjsdev/core': { name: '@webjsdev/core', version: '0.8.0', main: 'index.js' } },
    { '@webjsdev/core': '^0.7.0' }
  );
  const results = await runDoctorChecks(appDir, baseOpts({ nodeVersion: '24.0.0' }));
  const v = byName(results, 'webjs-versions');
  assert.equal(v.status, 'warn');
  assert.match(v.message, /drift/);
  assert.match(v.message, /@webjsdev\/core@0\.8\.0/, 'the real installed version must appear');
});

test('version check WARNS for a workspace app declaring a dep nothing installed', async () => {
  // The regression guard: resolving through Node must not make the check vacuous.
  const appDir = workspaceFixture(
    { '@webjsdev/core': { name: '@webjsdev/core', version: '0.7.48', main: 'index.js' } },
    { '@webjsdev/core': '^0.7.0', '@webjsdev/server': '^0.8.0' }
  );
  const results = await runDoctorChecks(appDir, baseOpts({ nodeVersion: '24.0.0' }));
  const v = byName(results, 'webjs-versions');
  assert.equal(v.status, 'warn');
  assert.match(v.message, /not installed: @webjsdev\/server/);
});

test('version check does NOT warn on a range shape it cannot statically verify', async () => {
  const appDir = workspaceFixture(
    { '@webjsdev/core': { name: '@webjsdev/core', version: '0.7.48', main: 'index.js' } },
    { '@webjsdev/core': 'github:webjsdev/webjs#main' }
  );
  const results = await runDoctorChecks(appDir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'webjs-versions').status, 'pass');
});

// ---------------------------------------------------------------------------
// framework resolvability (#954): the fresh-git-worktree trap.
// ---------------------------------------------------------------------------
const { frameworkResolves, checkFrameworkResolves } = await import(
  resolve(CLI_LIB_DIR, 'doctor.js')
);

/** A tmp app whose node_modules has a genuinely resolvable @webjsdev/core. */
function appWithResolvableCore() {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'app' }));
  write(dir, 'node_modules/@webjsdev/core/package.json', JSON.stringify({
    name: '@webjsdev/core', version: '0.7.4', main: 'index.js',
  }));
  write(dir, 'node_modules/@webjsdev/core/index.js', 'export const x = 1;\n');
  return dir;
}

test('framework-resolve PASSES (silent) when @webjsdev/core resolves from the app dir', async () => {
  const dir = appWithResolvableCore();
  assert.equal(frameworkResolves(dir), true);
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'framework-resolve').status, 'pass');
});

test('framework-resolve WARNS naming the worktree cause when node_modules is absent in a worktree', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'app' }));
  // A git worktree checks out `.git` as a FILE (a gitdir pointer), not a dir.
  write(dir, '.git', 'gitdir: /some/primary/.git/worktrees/x\n');
  // Counterfactual anchor: with a resolvable core this would PASS; here there
  // is no node_modules at all, the exact #954 condition.
  assert.equal(frameworkResolves(dir), false);
  const r = checkFrameworkResolves(dir);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /git worktree/);
  assert.match(r.message, /node_modules/);
  assert.match(r.fix, /symlink node_modules|npm install/);
});

test('framework-resolve WARNS generically when node_modules is absent outside a worktree', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'app' }));
  const r = checkFrameworkResolves(dir);
  assert.equal(r.status, 'warn');
  assert.doesNotMatch(r.message, /git worktree/);
  assert.match(r.message, /no node_modules/);
});

// ---------------------------------------------------------------------------
// vendor pin freshness (best-effort + network-tolerant).
// ---------------------------------------------------------------------------
test('vendor-pin PASSES (skips) when there is no pin file', async () => {
  const dir = tmpDir();
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'vendor-pin').status, 'pass');
});

test('vendor-pin WARNS (never fails) when the freshness check throws (network)', async () => {
  const dir = tmpDir();
  const throwingVendor = {
    hasVendorPin: () => true,
    findOutdated: async () => { throw new Error('ENOTFOUND registry.npmjs.org'); },
  };
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', vendor: throwingVendor }));
  const pin = byName(results, 'vendor-pin');
  assert.equal(pin.status, 'warn', 'a network failure must be a warn, never a fail');
  assert.match(pin.message, /network|registry/i);
  // And it is flagged best-effort, which is what stops a gate from escalating
  // it (#1257). Without this the required CI job would red on an npm outage.
  assert.equal(pin.bestEffort, true, 'a could-not-check result is bestEffort');
  // And critically, it did not throw out of runDoctorChecks.
});

test('vendor-pin WARNS listing outdated packages', async () => {
  const dir = tmpDir();
  const outdatedVendor = {
    hasVendorPin: () => true,
    findOutdated: async () => [{ pkg: 'dayjs', current: '1.11.0', latest: '1.11.13' }],
  };
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', vendor: outdatedVendor }));
  const pin = byName(results, 'vendor-pin');
  assert.equal(pin.status, 'warn');
  assert.match(pin.message, /dayjs/);
  assert.match(pin.fix, /vendor update/);
});

// ---------------------------------------------------------------------------
// importmap coherence (#450): warn-only, runs over BOTH importmaps with verdict
// parity, degrades gracefully on missing metadata. Driven through the
// `opts.coherence` injection seam so every branch runs offline.
// ---------------------------------------------------------------------------

// The #446 dep set, expressed as a LIVE importmap (jspm URLs) and a VENDORED
// importmap (local pin paths). Both pin the same versions.
const CM_LIVE = {
  '@codemirror/view': 'https://ga.jspm.io/npm:@codemirror/view@6.39.16/dist/index.js',
  '@codemirror/lint': 'https://ga.jspm.io/npm:@codemirror/lint@6.9.6/dist/index.js',
};
const CM_VENDORED = {
  '@codemirror/view': '/__webjs/vendor/@codemirror--view@6.39.16.js',
  '@codemirror/lint': '/__webjs/vendor/@codemirror--lint@6.9.6.js',
};
// lint needs a NEWER view than is pinned -> skew; same graph with ^6.0.0 -> coherent.
const CM_SKEW_MANIFEST = (pkg) =>
  pkg === '@codemirror/lint' ? { dependencies: { '@codemirror/view': '^6.42.0' } } : { dependencies: {} };
const CM_COHERENT_MANIFEST = (pkg) =>
  pkg === '@codemirror/lint' ? { dependencies: { '@codemirror/view': '^6.0.0' } } : { dependencies: {} };

// Build a coherence injection that drives the REAL check over the given
// importmaps + manifest reader (no network, no node_modules read).
async function coherenceInjection({ live, vendored, getManifest }) {
  const mod = await import('@webjsdev/server');
  return {
    check: mod.checkImportmapCoherence,
    getManifest,
    liveImports: async () => live || null,
    vendoredImports: async () => vendored || null,
  };
}

test('coherence WARNS on a #446-style skew, naming both packages + range + pinned version', async () => {
  const dir = tmpDir();
  const coherence = await coherenceInjection({
    live: CM_LIVE, vendored: CM_VENDORED, getManifest: CM_SKEW_MANIFEST,
  });
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  const c = byName(results, 'importmap-coherence');
  assert.equal(c.status, 'warn', 'a skew is a warn, never a hard fail');
  assert.match(c.message, /@codemirror\/lint/);
  assert.match(c.message, /@codemirror\/view/);
  assert.match(c.message, /\^6\.42\.0/);   // required range
  assert.match(c.message, /6\.39\.16/);    // pinned version
});

test('coherence PASSES on a coherent graph', async () => {
  const dir = tmpDir();
  const coherence = await coherenceInjection({
    live: CM_LIVE, vendored: CM_VENDORED, getManifest: CM_COHERENT_MANIFEST,
  });
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  assert.equal(byName(results, 'importmap-coherence').status, 'pass');
});

test('coherence PARITY: live-only and vendored-only inputs reach the SAME verdict', async () => {
  const dir = tmpDir();
  // Skew, live importmap only.
  const liveOnly = await runDoctorChecks(dir, baseOpts({
    nodeVersion: '24.0.0',
    coherence: await coherenceInjection({ live: CM_LIVE, vendored: null, getManifest: CM_SKEW_MANIFEST }),
  }));
  // Skew, vendored importmap only.
  const vendoredOnly = await runDoctorChecks(dir, baseOpts({
    nodeVersion: '24.0.0',
    coherence: await coherenceInjection({ live: null, vendored: CM_VENDORED, getManifest: CM_SKEW_MANIFEST }),
  }));
  const a = byName(liveOnly, 'importmap-coherence');
  const b = byName(vendoredOnly, 'importmap-coherence');
  assert.equal(a.status, b.status, 'the verdict must not depend on which importmap carried the dep set');
  assert.equal(a.status, 'warn');
  assert.equal(a.message, b.message, 'same dep set -> identical warning text');
});

test('coherence PASSES (skips) when there is no vendor importmap at all', async () => {
  const dir = tmpDir();
  const coherence = await coherenceInjection({ live: {}, vendored: null, getManifest: () => null });
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  const c = byName(results, 'importmap-coherence');
  assert.equal(c.status, 'pass');
  assert.match(c.message, /no npm packages on the client|No vendor importmap/i);
});

test('coherence degrades to could-not-verify when metadata is unavailable (no crash, no false warn)', async () => {
  const dir = tmpDir();
  // Importmap present, but every manifest lookup returns null (not installed).
  const coherence = await coherenceInjection({ live: CM_LIVE, vendored: null, getManifest: () => null });
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  const c = byName(results, 'importmap-coherence');
  assert.equal(c.status, 'warn');
  assert.match(c.message, /[Cc]ould not verify/);
  assert.doesNotMatch(c.message, /Incoherent/, 'missing metadata must not be reported as a conflict');
  // Best-effort, so a jspm outage cannot be escalated to a fatal by a gate
  // (#1257). This is what makes it safe to run doctor in the required job.
  assert.equal(c.bestEffort, true, 'a could-not-verify result is bestEffort');
});

test('a REAL coherence conflict is NOT bestEffort (it is a finding, so it is gateable)', async () => {
  const dir = tmpDir();
  const coherence = await coherenceInjection({
    live: CM_LIVE, vendored: CM_VENDORED, getManifest: CM_SKEW_MANIFEST,
  });
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  const c = byName(results, 'importmap-coherence');
  assert.equal(c.status, 'warn');
  assert.ok(!c.bestEffort, 'a real conflict is a finding, not a could-not-check');
});

test('coherence never throws out of runDoctorChecks even if the check itself throws', async () => {
  const dir = tmpDir();
  const coherence = {
    check: async () => { throw new Error('boom'); },
    getManifest: () => null,
    liveImports: async () => CM_LIVE,
    vendoredImports: async () => null,
  };
  // Must resolve, not reject.
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  const c = byName(results, 'importmap-coherence');
  assert.equal(c.status, 'warn', 'a thrown check degrades to a warn');
});

test('@webjsdev/server re-exports checkImportmapCoherence for the un-stubbed doctor path', async () => {
  const mod = await import('@webjsdev/server');
  assert.equal(typeof mod.checkImportmapCoherence, 'function');
  assert.equal(typeof mod.resolveVendorImports, 'function');
  assert.equal(typeof mod.readPinFile, 'function');
  assert.equal(typeof mod.scanBareImports, 'function');
});

test('the coherence check runs on the real import path (no coherence stub) without throwing', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  // No pin file, no client imports: the real path resolves an empty live map
  // and a null vendored map, so the check passes (nothing to verify). Run
  // WITHOUT opts.coherence to exercise the real @webjsdev/server wiring.
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', vendor: undefined, coherence: undefined }));
  const c = results.find((r) => r.name === 'importmap-coherence');
  assert.ok(c, 'an importmap-coherence result is present');
  assert.equal(c.status, 'pass', `empty app must pass, got: ${c.status} ${c.message}`);
});

test('coherence WARNS on a REAL cross-package edge: importmap + on-disk manifest, real getManifest', async () => {
  // End-to-end over a REAL importmap and a REAL on-disk manifest, not a
  // synthetic getManifest. The other coherence tests inject the manifest
  // reader; this one exercises the production path: extractPinnedVersions parses
  // the pinned versions out of a real importmap, and the REAL getPackageManifest
  // (@webjsdev/server) reads the declared range from node_modules on disk. The
  // motivating #446 shape: @codemirror/lint declares view ^6.42.0 while the
  // importmap pins @codemirror/view@6.39.16.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  // Real on-disk manifests the hoist-aware getPackageManifest will read. An
  // empty index.js per package gives require.resolve a real entry to resolve,
  // the way an installed package would have.
  write(dir, 'node_modules/@codemirror/lint/package.json', JSON.stringify({
    name: '@codemirror/lint',
    version: '6.9.6',
    main: 'index.js',
    dependencies: { '@codemirror/view': '^6.42.0' },
  }));
  write(dir, 'node_modules/@codemirror/lint/index.js', '');
  write(dir, 'node_modules/@codemirror/view/package.json', JSON.stringify({
    name: '@codemirror/view',
    version: '6.39.16',
    main: 'index.js',
  }));
  write(dir, 'node_modules/@codemirror/view/index.js', '');
  // A real importmap pinning the skewed versions. Inject ONLY the importmap
  // sources; getManifest stays the REAL @webjsdev/server reader against `dir`.
  const mod = await import('@webjsdev/server');
  const importmap = {
    '@codemirror/view': 'https://ga.jspm.io/npm:@codemirror/view@6.39.16/dist/index.js',
    '@codemirror/lint': 'https://ga.jspm.io/npm:@codemirror/lint@6.9.6/dist/index.js',
  };
  const coherence = {
    check: mod.checkImportmapCoherence,
    getManifest: (pkg) => mod.getPackageManifest(pkg, dir),
    liveImports: async () => importmap,
    vendoredImports: async () => null,
  };
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  const c = byName(results, 'importmap-coherence');
  assert.equal(c.status, 'warn', 'a real skew over a real manifest read must warn');
  assert.match(c.message, /@codemirror\/lint/);    // both packages named
  assert.match(c.message, /@codemirror\/view/);
  assert.match(c.message, /\^6\.42\.0/);            // the required range
  assert.match(c.message, /6\.39\.16/);             // the pinned version
});

test('coherence PASSES on a REAL coherent edge: importmap + on-disk manifest, real getManifest', async () => {
  // Counterfactual to the test above on the SAME real path: align the declared
  // range so the pinned view satisfies it, and the real reader must report pass.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  write(dir, 'node_modules/@codemirror/lint/package.json', JSON.stringify({
    name: '@codemirror/lint',
    version: '6.9.6',
    main: 'index.js',
    dependencies: { '@codemirror/view': '^6.0.0' },
  }));
  write(dir, 'node_modules/@codemirror/lint/index.js', '');
  write(dir, 'node_modules/@codemirror/view/package.json', JSON.stringify({
    name: '@codemirror/view',
    version: '6.39.16',
    main: 'index.js',
  }));
  write(dir, 'node_modules/@codemirror/view/index.js', '');
  const mod = await import('@webjsdev/server');
  const importmap = {
    '@codemirror/view': 'https://ga.jspm.io/npm:@codemirror/view@6.39.16/dist/index.js',
    '@codemirror/lint': 'https://ga.jspm.io/npm:@codemirror/lint@6.9.6/dist/index.js',
  };
  const coherence = {
    check: mod.checkImportmapCoherence,
    getManifest: (pkg) => mod.getPackageManifest(pkg, dir),
    liveImports: async () => importmap,
    vendoredImports: async () => null,
  };
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', coherence }));
  const c = byName(results, 'importmap-coherence');
  assert.equal(c.status, 'pass', `a coherent real edge must pass, got: ${c.status} ${c.message}`);
});

// ---------------------------------------------------------------------------
// CLI integration: exit code behavior.
// ---------------------------------------------------------------------------
function runCli(cwd) {
  return spawnSync(process.execPath, [CLI, 'doctor'], { cwd, encoding: 'utf8' });
}

test('CLI exits 0 when no hard check fails', () => {
  // Run in the OS tmpdir: a fresh app with a good tsconfig and no @webjsdev
  // deps. The running Node is the repo's own (24+), so node-version passes; the
  // only warns are env / versions, which do NOT fail the exit.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { erasableSyntaxOnly: true } }));
  const r = runCli(dir);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /\[pass\] node-version/);
});

test('CLI exits non-zero when a hard check fails (bad tsconfig)', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  // erasableSyntaxOnly missing in an EXISTING tsconfig -> hard fail.
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
  const r = runCli(dir);
  assert.notEqual(r.status, 0, 'a hard fail must produce a non-zero exit');
  assert.match(r.stdout + r.stderr, /\[fail\] tsconfig-erasable/);
});

// ---------------------------------------------------------------------------
// Stable codes (#975): every result carries a machine `code`.
// ---------------------------------------------------------------------------
const { DOCTOR_CODES, codeForName } = await import(resolve(CLI_LIB_DIR, 'doctor.js'));

test('every DoctorResult carries a stable non-empty code', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const codes = new Set(Object.values(DOCTOR_CODES));
  for (const r of results) {
    assert.ok(r.code && typeof r.code === 'string', `${r.name} has a code`);
    assert.ok(codes.has(r.code), `${r.name} code "${r.code}" is a declared DOCTOR_CODE`);
  }
  // The code is stable per check name, independent of the human message.
  assert.equal(byName(results, 'node-version').code, 'NODE_VERSION');
  assert.equal(byName(results, 'tsconfig-erasable').code, 'TSCONFIG_ERASABLE');
});

test('codeForName falls back to a derived code for an unmapped name', () => {
  assert.equal(codeForName('node-version'), 'NODE_VERSION');
  assert.equal(codeForName('Some New Check!'), 'SOME_NEW_CHECK');
});

// ---------------------------------------------------------------------------
// CLI --json + --strict (#975).
// ---------------------------------------------------------------------------
function runCliArgs(cwd, args) {
  return spawnSync(process.execPath, [CLI, 'doctor', ...args], { cwd, encoding: 'utf8' });
}

test('doctor --json emits the results (with codes) + a summary, valid JSON', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { erasableSyntaxOnly: true } }));
  const r = runCliArgs(dir, ['--json']);
  assert.equal(r.status, 0, `no hard fail -> exit 0, got ${r.status}\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.results), 'results is an array');
  assert.ok(out.results.every((x) => x.code), 'every result carries a code');
  assert.equal(typeof out.summary.pass, 'number');
  assert.equal(out.summary.strict, false);
  assert.equal(out.summary.ok, true);
  // --json emits ONLY the JSON object (no human banner leaking onto stdout).
  assert.doesNotMatch(r.stdout, /project-health checklist/);
});

test('doctor --json still exits non-zero on a hard fail', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));
  const r = runCliArgs(dir, ['--json']);
  assert.notEqual(r.status, 0, 'a hard fail exits non-zero even in --json mode');
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.ok, false);
  assert.ok(out.results.some((x) => x.code === 'TSCONFIG_ERASABLE' && x.status === 'fail'));
});

// The --strict counterfactual: an app with a WARN but NO hard fail exits 0
// normally, and 1 under --strict. Proving BOTH sides is what shows --strict is
// what flips it (not some unrelated hard fail).
test('--strict flips a warning-only app from exit 0 to exit 1', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { erasableSyntaxOnly: true } }));
  // Seed a guaranteed WARN with no hard fail: an .env.example whose key is
  // absent from .env is the env-drift warn.
  write(dir, '.env.example', 'DATABASE_URL=\nAUTH_SECRET=\n');
  write(dir, '.env', 'DATABASE_URL=x\n');

  const plain = runCliArgs(dir, []);
  assert.equal(plain.status, 0, `without --strict a warn does NOT fail: got ${plain.status}\n${plain.stdout}`);

  const strict = runCliArgs(dir, ['--strict']);
  assert.equal(strict.status, 1, 'with --strict the same warn fails the exit');
  assert.match(strict.stderr, /--strict was set/);
});

test('--strict with --json reports ok:false and exits 1 on a warning', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { erasableSyntaxOnly: true } }));
  write(dir, '.env.example', 'AUTH_SECRET=\n');
  write(dir, '.env', '\n');
  const r = runCliArgs(dir, ['--json', '--strict']);
  assert.equal(r.status, 1, 'strict + a warn -> exit 1');
  const out = JSON.parse(r.stdout);
  assert.equal(out.summary.strict, true);
  assert.equal(out.summary.ok, false);
  assert.ok(out.summary.warn > 0, 'a warning was present');
  assert.equal(out.summary.fail, 0, 'and it was a warn, not a hard fail');
});

// ---------------------------------------------------------------------------
// Per-check severity gate (#1257): `webjs.doctor.gate` in package.json.
// ---------------------------------------------------------------------------
const { readDoctorPolicy, applyDoctorPolicy, DOCTOR_SEVERITIES } = await import(
  resolve(CLI_LIB_DIR, 'doctor.js')
);

/** Shorthand for a fake result, so the policy tests stay readable. */
function res(code, status, extra = {}) {
  return { name: code.toLowerCase(), code, status, message: '', ...extra };
}

test('readDoctorPolicy returns an empty policy when the app declares nothing', () => {
  const missingPkg = tmpDir();
  const EMPTY = { gate: {}, unknownCodes: [], badSeverities: [], malformed: [], unknownKeys: [] };
  assert.deepEqual(readDoctorPolicy(missingPkg), EMPTY);

  const noBlock = tmpDir();
  write(noBlock, 'package.json', JSON.stringify({ name: 'x', webjs: { dev: { before: [] } } }));
  assert.deepEqual(readDoctorPolicy(noBlock).gate, {});

  // Unparseable JSON is NOT a policy error: checkWebjsVersions already reports
  // that condition, and doctor must never crash on a broken app file.
  const broken = tmpDir();
  write(broken, 'package.json', '{ not json');
  assert.deepEqual(readDoctorPolicy(broken), EMPTY);
});

// A gate that FAILS OPEN is the one outcome this mechanism cannot afford: the
// package.json looks gated, CI is not, and nobody goes looking. The per-entry
// validation only covers what is INSIDE a well-formed object, so the container
// shape needs its own check. The JSON Schema catches these in an editor, but it
// is editor-only and never runs in CI, so it can never be the enforcement.
test('readDoctorPolicy hard-errors on a malformed gate container rather than failing open', () => {
  const cases = [
    ['gate is a string', { gate: 'error' }, 'malformed', 'webjs.doctor.gate'],
    ['gate is an array', { gate: ['UNMARKED_ASSET_LINKS'] }, 'malformed', 'webjs.doctor.gate'],
    ['gate is null', { gate: null }, 'malformed', 'webjs.doctor.gate'],
    ['doctor is a string', 'strict', 'malformed', 'webjs.doctor'],
    ['doctor is an array', [], 'malformed', 'webjs.doctor'],
  ];
  for (const [label, doctor, bucket, path] of cases) {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ name: 'x', webjs: { doctor } }));
    const p = readDoctorPolicy(dir);
    assert.deepEqual(p.gate, {}, `${label}: nothing is gated`);
    assert.deepEqual(p[bucket].map((m) => m.path), [path], `${label}: reported as ${bucket}`);
  }

  // A misspelled sibling of `gate` is the subtler one: the object is well
  // formed, so only an explicit key check catches it.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    name: 'x',
    webjs: { doctor: { gates: { UNMARKED_ASSET_LINKS: 'error' } } },
  }));
  const p = readDoctorPolicy(dir);
  assert.deepEqual(p.gate, {});
  assert.deepEqual(p.unknownKeys, ['webjs.doctor.gates']);
});

test('a malformed gate container exits 1 without running the checks', () => {
  const dir = assetLinkFixture(null);
  write(dir, 'package.json', JSON.stringify({ name: 'x', webjs: { doctor: { gate: 'error' } } }));
  const r = runCliArgs(dir, []);
  assert.equal(r.status, 1, 'a fail-open gate must be loud');
  assert.match(r.stderr, /Expected an object at webjs\.doctor\.gate, got "error"/);
  assert.doesNotMatch(r.stdout, /project-health checklist/, 'the checks did not run');

  write(dir, 'package.json', JSON.stringify({ name: 'x', webjs: { doctor: { gates: {} } } }));
  const typo = runCliArgs(dir, ['--json']);
  assert.equal(typo.status, 1);
  assert.deepEqual(JSON.parse(typo.stdout).configErrors, [
    { kind: 'unknown-key', path: 'webjs.doctor.gates' },
  ]);
});

// `--json` is the agent-loop contract, so the config-error path's `kind`
// discriminants are a real API surface and not an implementation detail. Pin
// the whole set here: broadening the trigger without documenting the new kinds
// is exactly the drift this asserts against.
test('the --json configErrors contract is the four documented kinds', () => {
  const dir = assetLinkFixture(null);
  /** @type {Array<[unknown, object]>} */
  const cases = [
    [{ gate: 'error' }, { kind: 'malformed', path: 'webjs.doctor.gate', value: 'error' }],
    [{ gates: {} }, { kind: 'unknown-key', path: 'webjs.doctor.gates' }],
    [{ gate: { NOPE: 'error' } }, { kind: 'unknown-code', code: 'NOPE' }],
    [{ gate: { ENV_DRIFT: 'loud' } }, { kind: 'bad-severity', code: 'ENV_DRIFT', value: 'loud' }],
  ];
  for (const [doctor, expected] of cases) {
    write(dir, 'package.json', JSON.stringify({ name: 'x', webjs: { doctor } }));
    const r = runCliArgs(dir, ['--json']);
    assert.equal(r.status, 1, `${JSON.stringify(doctor)} exits 1`);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.results, [], 'no check ran');
    assert.equal(out.summary.ok, false);
    assert.deepEqual(out.configErrors, [expected]);
  }
});

test('readDoctorPolicy keeps well-formed entries and reports the rest separately', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    name: 'x',
    webjs: {
      doctor: {
        gate: {
          UNMARKED_ASSET_LINKS: 'error',
          ELISION_CARRIERS: 'off',
          NOT_A_REAL_CODE: 'error',
          ENV_DRIFT: 'fatal',
          NODE_VERSION: 3,
        },
      },
    },
  }));
  const p = readDoctorPolicy(dir);
  assert.deepEqual(p.gate, { UNMARKED_ASSET_LINKS: 'error', ELISION_CARRIERS: 'off' });
  assert.deepEqual(p.unknownCodes, ['NOT_A_REAL_CODE']);
  assert.deepEqual(
    p.badSeverities.map((b) => b.code).sort(),
    ['ENV_DRIFT', 'NODE_VERSION'],
    'a non-severity string and a non-string both land in badSeverities',
  );
  // DOCTOR_SEVERITIES is the vocabulary the reader validates against.
  assert.deepEqual(DOCTOR_SEVERITIES, ['off', 'warn', 'error']);
});

test('applyDoctorPolicy defaults severity from status when nothing is gated', () => {
  const out = applyDoctorPolicy([
    res('NODE_VERSION', 'fail'),
    res('ENV_DRIFT', 'warn'),
    res('GIT_HOOK', 'pass'),
  ]);
  assert.deepEqual(out.map((r) => r.severity), ['error', 'warn', 'pass']);
});

test('applyDoctorPolicy honours a gate entry in BOTH directions', () => {
  const out = applyDoctorPolicy(
    [res('ENV_DRIFT', 'warn'), res('NODE_VERSION', 'fail'), res('GIT_HOOK', 'warn')],
    { ENV_DRIFT: 'error', NODE_VERSION: 'off', GIT_HOOK: 'off' },
  );
  assert.deepEqual(out.map((r) => r.severity), ['error', 'off', 'off']);
});

test('applyDoctorPolicy reports a PASSING check as pass even when its code is gated error', () => {
  // The severity is the EFFECTIVE level, not the declared one, so the obvious
  // `results.some(r => r.severity === 'error')` has no false positive.
  const [r] = applyDoctorPolicy([res('UNMARKED_ASSET_LINKS', 'pass')], { UNMARKED_ASSET_LINKS: 'error' });
  assert.equal(r.severity, 'pass');
});

test('applyDoctorPolicy CLAMPS a bestEffort result to warn under an error gate', () => {
  const [clamped] = applyDoctorPolicy(
    [res('VENDOR_PIN', 'warn', { bestEffort: true })],
    { VENDOR_PIN: 'error' },
  );
  assert.equal(clamped.severity, 'warn', 'a could-not-check result can never be escalated');

  // But `off` still applies: silencing is not an escalation.
  const [silenced] = applyDoctorPolicy(
    [res('VENDOR_PIN', 'warn', { bestEffort: true })],
    { VENDOR_PIN: 'off' },
  );
  assert.equal(silenced.severity, 'off');
});

test('applyDoctorPolicy never mutates its input', () => {
  const input = [res('ENV_DRIFT', 'warn')];
  const out = applyDoctorPolicy(input, { ENV_DRIFT: 'error' });
  assert.equal(input[0].severity, undefined, 'the caller\'s results are untouched');
  assert.notEqual(out[0], input[0], 'each result is a fresh object');
});

/**
 * A fixture whose ONLY non-pass finding is the unmarked stylesheet link, so a
 * gate on UNMARKED_ASSET_LINKS is the sole thing that can flip the exit. `.env`
 * matching `.env.example` keeps env-drift quiet, and the tsconfig flag keeps the
 * hard check green.
 */
function assetLinkFixture(gate) {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    name: 'x',
    ...(gate ? { webjs: { doctor: { gate } } } : {}),
  }));
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { erasableSyntaxOnly: true } }));
  write(dir, 'app/layout.ts', [
    "import { html } from '@webjsdev/core';",
    'export default function Layout({ children }) {',
    '  return html`<html><head><link rel="stylesheet" href="/public/app.css"></head><body>${children}</body></html>`;',
    '}',
  ].join('\n'));
  return dir;
}

// The counterfactual PAIR, mirroring the --strict pair above: the SAME fixture
// exits 0 ungated and 1 gated, which is what proves the gate itself flips the
// exit rather than some unrelated hard fail.
test('a gated warning fails the exit; the same warning ungated does not', () => {
  const ungated = runCliArgs(assetLinkFixture(null), []);
  assert.equal(ungated.status, 0, `ungated, a warn does NOT fail: got ${ungated.status}\n${ungated.stdout}`);
  assert.match(ungated.stdout, /\[warn\] .*UNMARKED_ASSET_LINKS/);

  const gated = runCliArgs(assetLinkFixture({ UNMARKED_ASSET_LINKS: 'error' }), []);
  assert.equal(gated.status, 1, 'gated to error, the same warn fails the exit');
  assert.match(gated.stdout, /\[fail\] .*\(UNMARKED_ASSET_LINKS, gated: error\)/);
  assert.match(gated.stderr, /webjs\.doctor\.gate/);
});

// The two hard toolchain checks fail the exit with NO gate entry, because
// either would 500 the app at runtime. Easy to state the gate as "only what
// you mark error is fatal", which is false and would have an agent misdiagnose
// a red CI as impossible, so pin it.
test('a hard toolchain check fails the exit with no gate entry naming it', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    name: 'x',
    webjs: { doctor: { gate: { UNMARKED_ASSET_LINKS: 'error' } } },
  }));
  write(dir, 'tsconfig.json', JSON.stringify({ compilerOptions: { strict: true } }));

  const r = runCliArgs(dir, ['--json']);
  assert.equal(r.status, 1, 'TSCONFIG_ERASABLE fails the exit though the gate never mentions it');
  const out = JSON.parse(r.stdout);
  const tsconfig = out.results.find((x) => x.code === 'TSCONFIG_ERASABLE');
  assert.equal(tsconfig.status, 'fail');
  assert.equal(tsconfig.severity, 'error', 'a fail defaults to error, gate entry or not');
  assert.equal(out.summary.fail, 1);

  // And it is silenceable like anything else, which is the uniform-`off` rule.
  write(dir, 'package.json', JSON.stringify({
    name: 'x',
    webjs: { doctor: { gate: { TSCONFIG_ERASABLE: 'off' } } },
  }));
  const silenced = runCliArgs(dir, []);
  assert.equal(silenced.status, 0, 'off silences a hard check too');
});

test('a gated `off` silences a warning even under --strict', () => {
  // A tmp fixture also warns on the environment-shaped checks (it has no
  // node_modules), so silence those too and `--strict` has nothing left to fail
  // on. That is exactly the CI shape this feature exists for.
  const env = { FRAMEWORK_RESOLVE: 'off', WEBJS_VERSIONS: 'off' };
  const strict = runCliArgs(assetLinkFixture({ ...env, UNMARKED_ASSET_LINKS: 'off' }), ['--strict']);
  assert.equal(strict.status, 0, `every warn silenced, so --strict passes\n${strict.stdout}\n${strict.stderr}`);
  assert.match(strict.stdout, /\[off\] .*\(UNMARKED_ASSET_LINKS, gated: off\)/);
  // Assert the OUTCOME (nothing left to warn about, and the summary says some
  // were silenced), not an exact silenced count. How many of the
  // environment-shaped checks warn in the first place is runtime-dependent:
  // FRAMEWORK_RESOLVE passes under Bun from a tmp dir and warns under Node, so
  // a hard-coded count reds the Bun matrix on a change that has nothing to do
  // with it.
  assert.match(strict.stdout, /0 warning\(s\)/);
  assert.match(strict.stdout, /\d+ silenced/);

  // `off` silences the FINDING too, not just its contribution to the exit.
  // An app that turned a code off asked not to hear about it, so printing the
  // message and a Fix line every run would be the noise it just silenced
  // (ESLint's `off` drops the message as well). The [off] line and the
  // silenced count keep it from being invisible.
  const offBlock = strict.stdout.split('\n\n').find((b) => b.includes('UNMARKED_ASSET_LINKS'));
  assert.ok(offBlock, 'the silenced check is still listed on the checklist');
  assert.doesNotMatch(offBlock, /Fix:/, 'a silenced check prints no Fix line');
  assert.doesNotMatch(offBlock, /un-versioned url/, 'a silenced check prints no finding');
  // A NON-silenced finding still prints both, so the assertion above is about
  // `off` and not about the renderer having stopped printing findings at all.
  const warned = runCliArgs(assetLinkFixture(env), []);
  assert.match(warned.stdout, /un-versioned url/);
  assert.match(warned.stdout, /Fix: Wrap the path in asset\(\)/);

  // The counterfactual: leave the asset-link warn ungated and --strict fails on
  // it, so `off` is what silenced it and not the other two entries.
  const stillWarns = runCliArgs(assetLinkFixture(env), ['--strict']);
  assert.equal(stillWarns.status, 1, 'the un-silenced warn still fails under --strict');
});

test('an unknown gate code exits 1 naming it, WITHOUT running the checks', () => {
  const dir = assetLinkFixture({ UNMARKD_ASSET_LINKS: 'error' });
  const r = runCliArgs(dir, []);
  assert.equal(r.status, 1, 'a typo must be loud, never silently un-gating CI');
  assert.match(r.stderr, /Unknown check code: UNMARKD_ASSET_LINKS/);
  assert.match(r.stderr, /Valid codes:.*UNMARKED_ASSET_LINKS/);
  assert.doesNotMatch(r.stdout, /project-health checklist/, 'the checks did not run');
});

test('a bad gate severity exits 1 naming it, and --json carries configErrors', () => {
  const dir = assetLinkFixture({ ENV_DRIFT: 'fatal' });
  const plain = runCliArgs(dir, []);
  assert.equal(plain.status, 1);
  assert.match(plain.stderr, /Invalid severity for ENV_DRIFT: "fatal"/);
  assert.match(plain.stderr, /Valid severities: off \/ warn \/ error/);

  const json = runCliArgs(dir, ['--json']);
  assert.equal(json.status, 1);
  const out = JSON.parse(json.stdout);
  assert.deepEqual(out.results, [], 'no checks ran');
  assert.equal(out.summary.ok, false);
  assert.deepEqual(out.configErrors, [{ kind: 'bad-severity', code: 'ENV_DRIFT', value: 'fatal' }]);
});

test('--json carries severity on every result plus off in the summary', () => {
  const dir = assetLinkFixture({ UNMARKED_ASSET_LINKS: 'off' });
  const r = runCliArgs(dir, ['--json']);
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.results.every((x) => x.severity), 'every result carries a severity');
  assert.ok(
    out.results.every((x) => ['pass', 'off', 'warn', 'error'].includes(x.severity)),
    'severity is one of the four effective levels',
  );
  assert.equal(out.results.find((x) => x.code === 'UNMARKED_ASSET_LINKS').severity, 'off');
  assert.equal(out.summary.off, 1);
});

// An app with NO gate block must produce exactly today's numbers, which is the
// whole back-compat promise of folding policy in at the summary layer.
test('an app with no gate block gets status-derived counts, unchanged', () => {
  const dir = assetLinkFixture(null);
  const out = JSON.parse(runCliArgs(dir, ['--json']).stdout);
  const byStatus = { pass: 0, warn: 0, fail: 0 };
  for (const r of out.results) byStatus[r.status]++;
  assert.equal(out.summary.pass, byStatus.pass);
  assert.equal(out.summary.warn, byStatus.warn);
  assert.equal(out.summary.fail, byStatus.fail);
  assert.equal(out.summary.off, 0);
});

// Regression: the doctor pin check imports hasVendorPin from @webjsdev/server on
// the REAL (un-stubbed) path. If it is not re-exported, the check silently
// reports "no pin file" for a pinned app and the freshness check is inert. The
// other vendor tests inject opts.vendor, so they never caught this.
test('@webjsdev/server re-exports hasVendorPin so the un-stubbed pin check works', async () => {
  const mod = await import('@webjsdev/server');
  assert.equal(typeof mod.hasVendorPin, 'function', 'hasVendorPin must be exported');
  assert.equal(typeof mod.findOutdated, 'function', 'findOutdated must be exported');
});

test('the pin check detects a pin on the real import path (no vendor stub)', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  // A pin file with no imports: hasVendorPin sees it, findOutdated has nothing
  // to check (no network call), so the check recognizes the pin and does NOT
  // report "no pin file". Run WITHOUT opts.vendor to exercise the real import.
  mkdirSync(join(dir, '.webjs', 'vendor'), { recursive: true });
  writeFileSync(join(dir, '.webjs', 'vendor', 'importmap.json'), JSON.stringify({ imports: {} }));
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0', vendor: undefined }));
  const pin = results.find((r) => r.name === 'vendor-pin');
  assert.ok(pin, 'a vendor-pin result is present');
  assert.ok(
    !/No vendor pin file/.test(pin.message),
    `the real pin check must detect the pin, got: ${pin.status} ${pin.message}`,
  );
});

// ---------------------------------------------------------------------------
// vendor-gitignore: the `.gitignore` must keep `.webjs/vendor/` committable.
// Moved here from `webjs check`'s `gitignore-vendor-not-ignored` rule (#461):
// inspecting `.gitignore` is a project-config concern, and vendoring is opt-in,
// so it is a doctor WARN, not a check error / CI hard fail. Uses a real
// `git init` so `git check-ignore` behaves as it would in a real project.
// ---------------------------------------------------------------------------

/** `git init` in dir with inherited GIT_* stripped so it targets dir, not an
 *  outer repo whose env leaked in via a worktree pre-commit hook. */
function initGit(dir) {
  const { GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_PREFIX, ...env } = process.env;
  return spawnSync('git', ['init', '-q'], { cwd: dir, stdio: 'pipe', env }).status === 0;
}

test('vendor-gitignore: warns on the broken `.webjs/` pattern', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  if (!initGit(dir)) return; // git unavailable: skip
  // Parent excluded, so the `!` child negation can never re-include anything.
  write(dir, '.gitignore', '.webjs/\n!.webjs/vendor/\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const r = byName(results, 'vendor-gitignore');
  assert.equal(r.status, 'warn', 'broken pattern must warn');
  assert.match(r.fix, /\*\*\/\.webjs\/\*/, 'fix names the depth-robust pattern');
});

test('vendor-gitignore: passes for the depth-robust `**/.webjs/*` pattern', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  if (!initGit(dir)) return;
  write(dir, '.gitignore', '**/.webjs/*\n!**/.webjs/vendor/\n!**/.webjs/vendor/**\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'vendor-gitignore').status, 'pass');
});

test('vendor-gitignore: warns on a broader `*.js` rule that hides bundle files', async () => {
  // The .json manifest gets through, but `webjs vendor pin --download` writes
  // <pkg>@<version>.js bundles, which `*.js` blocks. The two-probe check catches it.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  if (!initGit(dir)) return;
  write(dir, '.gitignore', '.webjs/*\n!.webjs/vendor/\n!.webjs/vendor/**\n*.js\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const r = byName(results, 'vendor-gitignore');
  assert.equal(r.status, 'warn', 'broader *.js rule must warn');
  assert.match(r.message, /sample-pkg|\.js/, 'message references the bundle-file probe');
});

test('vendor-gitignore: passes (skips) when not a git repo', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  // No `git init`. A .gitignore exists but there is no .git/, so the check
  // must not false-positive.
  write(dir, '.gitignore', '.webjs/\n');
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'vendor-gitignore').status, 'pass');
});

test('vendor-gitignore: passes (skips) when no .gitignore exists', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  if (!initGit(dir)) return;
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  assert.equal(byName(results, 'vendor-gitignore').status, 'pass');
});

test('vendor-gitignore: ignores leaked GIT_WORK_TREE/GIT_DIR (worktree pre-commit)', async () => {
  // The check strips inherited GIT_* so cwd is the sole authority on which repo
  // is consulted. Simulate a worktree pre-commit hook leaking the outer repo's
  // context and assert the check still reads dir's own .gitignore.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  const saved = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
  };
  try {
    if (!initGit(dir)) return;
    write(dir, '.gitignore', '.webjs/*\n!.webjs/vendor/\n!.webjs/vendor/**\n*.js\n');
    process.env.GIT_DIR = join(REPO, '.git');
    process.env.GIT_WORK_TREE = REPO;
    delete process.env.GIT_INDEX_FILE;
    const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
    assert.equal(
      byName(results, 'vendor-gitignore').status,
      'warn',
      'must read dir gitignore despite leaked GIT_* env',
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// ---------------------------------------------------------------------------
// Page/layout elision advisory (#646): name why a page/layout ships.
// ---------------------------------------------------------------------------
const CARRIER_CHECK = 'Page/layout elision (carrier hygiene)';

test('a page pinned by a client-effecting non-component WARNS and names the blocker', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x', type: 'module' }));
  // The page is a pure carrier EXCEPT it side-effect-imports a util that
  // touches a browser global at module load, so it ships whole.
  write(dir, 'app/page.js',
    `import { html } from '@webjsdev/core';\nimport '../lib/track.js';\nexport default () => html\`<p>hi</p>\`;\n`);
  write(dir, 'lib/track.js', `document.title = 'set at module load';\nexport const y = 1;\n`);

  const results = await runDoctorChecks(dir, baseOpts());
  const r = byName(results, CARRIER_CHECK);
  assert.equal(r.status, 'warn', 'a shipping page is a warn advisory');
  assert.match(r.message, /app\/page\.js/, 'names the page that ships');
  assert.match(r.message, /lib\/track\.js/, 'names the client-effecting blocker');
  assert.ok(r.fix, 'offers an actionable fix line');
  // Advisory only: it must NOT make doctor hard-fail.
  assert.ok(!results.some((x) => x.status === 'fail'), 'the advisory never produces a hard fail');
});

test('an inert app passes the carrier check (no advisory)', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x', type: 'module' }));
  write(dir, 'app/page.js',
    `import { html } from '@webjsdev/core';\nexport default () => html\`<p>static</p>\`;\n`);

  const results = await runDoctorChecks(dir, baseOpts());
  assert.equal(byName(results, CARRIER_CHECK).status, 'pass', 'a static page is elided, nothing to advise');
});

test('elision disabled (webjs.elide=false) skips the carrier advisory', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x', type: 'module', webjs: { elide: false } }));
  write(dir, 'app/page.js',
    `import { html } from '@webjsdev/core';\nimport '../lib/track.js';\nexport default () => html\`<p>hi</p>\`;\n`);
  write(dir, 'lib/track.js', `document.title = 'x';\nexport const y = 1;\n`);

  const results = await runDoctorChecks(dir, baseOpts());
  assert.equal(byName(results, CARRIER_CHECK).status, 'pass', 'opted-out apps ship everything by design, so no advice');
});

// ---------------------------------------------------------------------------
// Component elision verdict (#1308): the OTHER direction. The carrier check
// above reports the benign over-ship; this one reports what was DROPPED, which
// is where a wrong verdict silently costs an app its interactivity.
// ---------------------------------------------------------------------------
const COMPONENT_CHECK = 'Component elision (what the browser drops)';

/** A page rendering one display-only component, which the analyser elides. */
function elidedComponentApp(extraPkg = {}) {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x', type: 'module', ...extraPkg }));
  write(dir, 'components/badge.js',
    `import { WebComponent, html } from '@webjsdev/core';\nexport class Badge extends WebComponent {\n  render() { return html\`<span>verified</span>\`; }\n}\nBadge.register('my-badge');\n`);
  write(dir, 'app/page.js',
    `import { html } from '@webjsdev/core';\nimport '../components/badge.js';\nexport default () => html\`<my-badge></my-badge>\`;\n`);
  return dir;
}

test('a healthy app PASSES and the message carries the elided inventory', async () => {
  // An elided component is the DESIRED outcome, so this must never warn about
  // one: a check that fires on every healthy app trains the reader to skip
  // doctor output entirely. The inventory rides the passing message instead,
  // which is what makes the check a discovery surface.
  const r = byName(await runDoctorChecks(elidedComponentApp(), baseOpts()), COMPONENT_CHECK);
  assert.equal(r.status, 'pass');
  assert.match(r.message, /1 of 1 component module\(s\) are elided/);
  assert.match(r.message, /my-badge/, 'names the tag the browser never downloads');
  assert.match(r.message, /webjs elision/, 'points at the detail surface');
});

test('an orphan class WARNS, names the class and file, and never fails', async () => {
  // The one always-wrong condition: a class registered with a computed tag is
  // invisible to the scanner, so it gets no elision verdict at all
  // and `static interactive = true` cannot rescue it.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x', type: 'module' }));
  write(dir, 'components/dyn.js',
    `import { WebComponent, html } from '@webjsdev/core';\nconst TAG = 'dyn-' + 'badge';\nexport class DynBadge extends WebComponent {\n  render() { return html\`<span>x</span>\`; }\n}\nDynBadge.register(TAG);\n`);
  write(dir, 'app/page.js',
    `import { html } from '@webjsdev/core';\nimport '../components/dyn.js';\nexport default () => html\`<p>hi</p>\`;\n`);

  const results = await runDoctorChecks(dir, baseOpts());
  const r = byName(results, COMPONENT_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /DynBadge/, 'names the class');
  assert.match(r.message, /components\/dyn\.js/, 'names the file');
  assert.match(r.message, /static interactive = true. cannot rescue/, 'says the override does not help');
  assert.ok(r.fix, 'offers an actionable fix line');
  assert.ok(!results.some((x) => x.status === 'fail'), 'this check never hard-fails');
});

test('an orphan with NO registration call at all is reported the same way', async () => {
  // `findOrphanComponents` reports TWO shapes under one name, and this is the
  // ORIGINAL one the dev server has always warned about (a class someone
  // forgot to register). The computed-tag shape is the other. The message must
  // fit both, or a plain forgot-to-register class gets diagnosed with a cause
  // it does not have.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x', type: 'module' }));
  write(dir, 'components/unreg.js',
    `import { WebComponent, html } from '@webjsdev/core';\nexport class Unregistered extends WebComponent {\n  render() { return html\`<span>x</span>\`; }\n}\n`);
  write(dir, 'app/page.js',
    `import { html } from '@webjsdev/core';\nimport '../components/unreg.js';\nexport default () => html\`<p>hi</p>\`;\n`);

  const r = byName(await runDoctorChecks(dir, baseOpts()), COMPONENT_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /Unregistered/);
  assert.match(r.message, /no registration call at all/,
    'the message must name this shape, not only the computed-tag one');
  assert.match(r.fix, /Register it with a literal tag/);
});

test('elision disabled reports pass and names the switch', async () => {
  const r = byName(await runDoctorChecks(elidedComponentApp({ webjs: { elide: false } }), baseOpts()), COMPONENT_CHECK);
  assert.equal(r.status, 'pass');
  assert.match(r.message, /elision is disabled/);
  assert.match(r.message, /WEBJS_ELIDE/);
});

test('the check carries the stable code ELISION_COMPONENTS and is gateable', async () => {
  // `webjs.doctor.gate` (#1257) addresses a check by its stable code, and
  // `readDoctorPolicy` rejects an UNKNOWN code as a hard config error, so this
  // is also the counterfactual for the DOCTOR_CODES entry: drop that entry and
  // the gate below stops being accepted.
  const r = byName(await runDoctorChecks(elidedComponentApp(), baseOpts()), COMPONENT_CHECK);
  assert.equal(r.code, 'ELISION_COMPONENTS');

  // Gate the case that actually FIRES: a passing check contributes `pass`
  // whatever the gate says (a check that did not fire contributes nothing), so
  // only the orphan warning can demonstrate the clamp.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({
    name: 'x', type: 'module', webjs: { doctor: { gate: { ELISION_COMPONENTS: 'off' } } },
  }));
  write(dir, 'components/dyn.js',
    `import { WebComponent, html } from '@webjsdev/core';\nconst TAG = 'dyn-' + 'badge';\nexport class DynBadge extends WebComponent {\n  render() { return html\`<span>x</span>\`; }\n}\nDynBadge.register(TAG);\n`);
  write(dir, 'app/page.js',
    `import { html } from '@webjsdev/core';\nimport '../components/dyn.js';\nexport default () => html\`<p>hi</p>\`;\n`);

  const policy = readDoctorPolicy(dir);
  assert.deepEqual(policy.malformed, [], 'a known code is accepted, so the DOCTOR_CODES entry is present');
  assert.deepEqual(policy.unknownCodes ?? [], [], 'ELISION_COMPONENTS is a known code');
  assert.equal(policy.gate.ELISION_COMPONENTS, 'off');

  const cli = runCliArgs(dir, ['--json']);
  const gated = JSON.parse(cli.stdout).results.find((x) => x.code === 'ELISION_COMPONENTS');
  assert.equal(gated.status, 'warn', 'the check still FOUND the orphan');
  assert.equal(gated.severity, 'off', 'but the gate silences what it contributes');
});

// ---------------------------------------------------------------------------
// Static build-output freshness (dev.regenerate, #967): the parity backstop.
// Dev recompiles on request; this WARNs when a committed / built output is
// older than a source (the case that bites `webjs start` or a committed file).
// ---------------------------------------------------------------------------
const FRESHNESS_CHECK = 'Static build outputs (dev.regenerate freshness)';

const regenPkg = () => JSON.stringify({
  name: 'ui-app',
  dependencies: { '@webjsdev/core': 'latest', '@webjsdev/server': 'latest' },
  webjs: { dev: { regenerate: [{
    output: 'public/tailwind.css',
    command: 'tailwindcss -i ./public/input.css -o ./public/tailwind.css --minify',
    inputs: ['app', 'public/input.css'],
  }] } },
});

test('freshness advisory PASSES when no regenerate rules are declared', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'plain' }));
  const r = byName(await runDoctorChecks(dir, baseOpts()), FRESHNESS_CHECK);
  assert.equal(r.status, 'pass');
  assert.match(r.message, /no webjs\.dev\.regenerate/);
});

test('freshness advisory PASSES when the output is missing (built on first boot)', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', regenPkg());
  write(dir, 'app/page.ts', 'export default () => 1;');
  write(dir, 'public/input.css', '@import "tailwindcss";');
  // No public/tailwind.css on disk: a fresh clone, not a staleness fail.
  const r = byName(await runDoctorChecks(dir, baseOpts()), FRESHNESS_CHECK);
  assert.equal(r.status, 'pass');
});

test('freshness advisory PASSES when the output is newer than every source', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', regenPkg());
  write(dir, 'app/page.ts', 'export default () => 1;');
  write(dir, 'public/input.css', '@import "tailwindcss";');
  write(dir, 'public/tailwind.css', '/* built */');
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(dir, 'app/page.ts'), past, past);
  utimesSync(join(dir, 'public/input.css'), past, past);
  const r = byName(await runDoctorChecks(dir, baseOpts()), FRESHNESS_CHECK);
  assert.equal(r.status, 'pass');
});

test('freshness advisory WARNs (never fails) when a source is newer than the output', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', regenPkg());
  write(dir, 'public/input.css', '@import "tailwindcss";');
  write(dir, 'public/tailwind.css', '/* stale */');
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(dir, 'public/tailwind.css'), past, past);
  utimesSync(join(dir, 'public/input.css'), past, past);
  write(dir, 'app/page.ts', 'export default () => "grid-cols-4";'); // edited now
  const results = await runDoctorChecks(dir, baseOpts());
  const r = byName(results, FRESHNESS_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /public\/tailwind\.css/);
  assert.equal(results.filter((x) => x.status === 'fail').length, 0, 'advisory only, never a hard fail');
});

// ---------------------------------------------------------------------------
// Unmarked stylesheet links (#1095). An advisory over the author's SOURCE: a
// page/layout that hand-writes `<link rel="stylesheet" href="/public/…">`
// without `asset()` serves it at an un-versioned url, so a CDN keeps the
// pre-deploy bytes for the whole TTL. Scoped tightly on purpose, so the
// negative cases below are the real contract: a cross-origin sheet, an icon,
// and a `rel=preload` are all legitimate NON-marks and must never be flagged.
// ---------------------------------------------------------------------------

const ASSET_LINK_CHECK = 'Asset urls (unmarked stylesheet links)';

test('asset-link advisory WARNs on a page/layout stylesheet link missing asset()', async () => {
  const dir = tmpDir();
  write(dir, 'app/layout.ts', [
    "import { html } from '@webjsdev/core';",
    'export default function Layout({ children }) {',
    '  return html`<link rel="stylesheet" href="/public/tailwind.css">${children}`;',
    '}',
  ].join('\n'));
  const results = await runDoctorChecks(dir, baseOpts());
  const r = byName(results, ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /app\/layout\.ts:3/, 'names the file and line');
  assert.match(r.message, /\/public\/tailwind\.css/);
  assert.match(r.fix, /asset\(/, 'the fix names the helper');
  assert.equal(results.filter((x) => x.status === 'fail').length, 0, 'advisory only, never a hard fail');
});

test('asset-link advisory PASSES when the href is wrapped in asset()', async () => {
  const dir = tmpDir();
  write(dir, 'app/layout.ts', [
    "import { html, asset } from '@webjsdev/core';",
    'export default function Layout({ children }) {',
    "  return html`<link rel=\"stylesheet\" href=${asset('/public/tailwind.css')}>${children}`;",
    '}',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'pass');
});

test('asset-link advisory leaves a cross-origin stylesheet, an icon, and a preload alone', async () => {
  const dir = tmpDir();
  write(dir, 'app/layout.ts', [
    "import { html } from '@webjsdev/core';",
    'export default function Layout({ children }) {',
    '  return html`',
    '    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X">',
    '    <link rel="icon" href="/public/favicon.svg" type="image/svg+xml">',
    '    <link rel="preload" href="/public/font.woff2" as="font" crossorigin>',
    '    ${children}`;',
    '}',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(
    r.status,
    'pass',
    'a CDN sheet keeps its exact url, an icon is a valid deliberate non-mark, and a preload MUST stay unversioned to match the CSS url() request',
  );
});

test('asset-link advisory PASSES when there is no app/ directory', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', '{"name":"x"}');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'pass');
});

test('asset-link advisory reports every occurrence across pages and layouts', async () => {
  const dir = tmpDir();
  write(dir, 'app/layout.ts', 'export default () => `<link rel="stylesheet" href="/public/a.css">`;');
  write(dir, 'app/blog/page.ts', 'export default () => `<link rel="stylesheet" href="/public/b.css">`;');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /a\.css/);
  assert.match(r.message, /b\.css/);
  assert.match(r.message, /^2 stylesheet link/);
});

test('asset-link advisory does not flag rel="stylesheet" appearing inside another attribute value', async () => {
  const dir = tmpDir();
  // The canonical async-CSS idiom. `rel` is `preload` here; the `stylesheet`
  // string lives in the onload swap. Flagging it would be actively harmful:
  // wrapping this href in asset() versions the HINT, which then can never match
  // the unversioned request the browser makes, so the file downloads twice.
  // A `data-rel` is the same class of near-miss on a genuine icon.
  write(dir, 'app/layout.ts', [
    "import { html } from '@webjsdev/core';",
    'export default function Layout({ children }) {',
    '  return html`',
    '    <link rel="preload" as="style" href="/public/app.css" onload="this.rel=\'stylesheet\'">',
    '    <link data-rel="stylesheet" rel="icon" href="/public/favicon.svg">',
    '    ${children}`;',
    '}',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'pass', 'rel must mean the rel ATTRIBUTE, not the string anywhere in the tag');
});

test('asset-link advisory still flags an unmarked sheet written in uppercase', async () => {
  const dir = tmpDir();
  write(dir, 'app/layout.ts', 'export default () => `<LINK REL="stylesheet" HREF="/public/up.css">`;');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn', 'HTML tag and attribute names are case-insensitive');
  assert.match(r.message, /up\.css/);
});

test('asset-link advisory tolerates a > inside a quoted attribute value', async () => {
  const dir = tmpDir();
  // A quote-unaware tag scan would end the tag at the `>` in the title and miss
  // the href entirely (the #406 class of bug in the SSR hoist scanner).
  write(dir, 'app/layout.ts', 'export default () => `<link title="a > b" rel="stylesheet" href="/public/q.css">`;');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /q\.css/);
});

test('asset-link advisory does not raise a warning asset() could never clear', async () => {
  const dir = tmpDir();
  // resolveAssetUrl returns a path carrying a query or a `..` UNCHANGED, so
  // flagging one would tell the author to apply a fix that changes nothing:
  // they wrap it, the warning stays, and `doctor --strict` can never go green.
  // A hand-rolled ?v= cache-buster is the likeliest thing an author who has not
  // adopted asset() will already have written.
  write(dir, 'app/layout.ts', [
    'export default () => `',
    '  <link rel="stylesheet" href="/public/app.css?v=3">',
    '  <link rel="stylesheet" href="/public/../db/app.db">`;',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'pass', 'only advise a fix that actually works');
});

test('asset-link advisory honours webjs.basePath', async () => {
  const dir = tmpDir();
  // Under a sub-path deploy the author writes the prefix themselves
  // (`asset('/myapp/public/x.css')`), so a check that only knows `/public/`
  // would be silently inert for exactly the apps with extra ceremony to forget.
  write(dir, 'package.json', JSON.stringify({ name: 'x', webjs: { basePath: '/myapp' } }));
  write(dir, 'app/layout.ts', 'export default () => `<link rel="stylesheet" href="/myapp/public/app.css">`;');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /\/myapp\/public\/app\.css/);
});

test('asset-link advisory ignores a commented-out tag but keeps line numbers accurate', async () => {
  const dir = tmpDir();
  write(dir, 'app/layout.ts', [
    'export default () => `',
    '  <!-- <link rel="stylesheet" href="/public/old.css"> -->',
    '  <link rel="stylesheet" href="/public/live.css">`;',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.doesNotMatch(r.message, /old\.css/, 'a commented-out tag emits nothing');
  assert.match(r.message, /app\/layout\.ts:3 href="\/public\/live\.css"/, 'blanking comments must not shift line numbers');
});

test('asset-link advisory normalizes webjs.basePath the way the framework does', async () => {
  // normalizeBasePath (packages/server/src/base-path.js) trims and PREPENDS the
  // slash, so these three forms are one base path. A check that only accepted a
  // leading-slash value stayed silently inert for the first of them.
  for (const form of ['myapp', '/myapp', '/myapp/']) {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ name: 'x', webjs: { basePath: form } }));
    write(dir, 'app/layout.ts', 'export default () => `<link rel="stylesheet" href="/myapp/public/app.css">`;');
    const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
    assert.equal(r.status, 'warn', `basePath ${JSON.stringify(form)} should normalize to /myapp`);
  }
});

test('asset-link advisory fails safe on a basePath that is not a plain path prefix', async () => {
  // normalizeBasePath rejects these to '' rather than stripping them, so the
  // check must fall back to requiring a literal /public/ rather than trusting
  // an origin-escaping prefix.
  for (const bad of ['//evil.example', 'https://evil.example', '../up', 'has space']) {
    const dir = tmpDir();
    write(dir, 'package.json', JSON.stringify({ name: 'x', webjs: { basePath: bad } }));
    write(dir, 'app/layout.ts', 'export default () => `<link rel="stylesheet" href="/public/app.css">`;');
    const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
    assert.equal(r.status, 'warn', `basePath ${JSON.stringify(bad)} must fail safe to no base path`);
  }
});

test('asset-link advisory decodes the href before judging it, as resolveAssetUrl does', async () => {
  const encodedTraversal = tmpDir();
  // Decodes to /public/../db/app.db, which resolveAssetUrl refuses, so warning
  // here would be a warning asset() can never clear.
  write(encodedTraversal, 'app/layout.ts', 'export default () => `<link rel="stylesheet" href="/public/%2e%2e/db/app.db">`;');
  assert.equal(byName(await runDoctorChecks(encodedTraversal, baseOpts()), ASSET_LINK_CHECK).status, 'pass');

  const encodedPublic = tmpDir();
  // Decodes to /public/app.css, which resolveAssetUrl DOES fingerprint, so
  // skipping it would be a silent miss.
  write(encodedPublic, 'app/layout.ts', 'export default () => `<link rel="stylesheet" href="/%70ublic/app.css">`;');
  assert.equal(byName(await runDoctorChecks(encodedPublic, baseOpts()), ASSET_LINK_CHECK).status, 'warn');
});

test('asset-link advisory flags an href carrying only a #fragment', async () => {
  // resolveAssetUrl splits the fragment and still fingerprints, so this one IS
  // fixable and must be reported (unlike a query, which it refuses).
  const dir = tmpDir();
  write(dir, 'app/layout.ts', 'export default () => `<link rel="stylesheet" href="/public/app.css#a">`;');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
});

test('asset-link advisory skips _private folders the router never routes', async () => {
  const dir = tmpDir();
  write(dir, 'app/_scratch/page.ts', 'export default () => `<link rel="stylesheet" href="/public/dead.css">`;');
  write(dir, 'app/real/page.ts', 'export default () => `<link rel="stylesheet" href="/public/live.css">`;');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.doesNotMatch(r.message, /dead\.css/, 'a _private route is never rendered');
  assert.match(r.message, /live\.css/);
});

test('asset-link advisory ignores a tag commented out with JS comments', async () => {
  const dir = tmpDir();
  // Commenting a tag out in a .ts page is done with `//` or a block comment, not
  // an HTML comment. A warning the author can only clear by deleting a comment
  // is the un-clearable advice this check must never give.
  write(dir, 'app/layout.ts', [
    'export default () => {',
    '  // <link rel="stylesheet" href="/public/line.css">',
    '  /* <link rel="stylesheet" href="/public/block.css"> */',
    '  return `<link rel="stylesheet" href="/public/live.css">`;',
    '};',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.doesNotMatch(r.message, /line\.css|block\.css/, 'a commented-out tag emits nothing');
  assert.match(r.message, /app\/layout\.ts:4 href="\/public\/live\.css"/, 'line numbers must survive blanking');
});

test('asset-link advisory does not mistake a https:// url for a comment', async () => {
  const dir = tmpDir();
  write(dir, 'app/layout.ts', [
    'export default () => `',
    '  <link rel="stylesheet" href="https://cdn.example/x.css">',
    '  <link rel="stylesheet" href="/public/after.css">`;',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /after\.css/, 'the // in a url must not blank the rest of the line');
});

test('asset-link advisory covers the boundary modules, not just page and layout', async () => {
  const dir = tmpDir();
  // global-error renders its OWN doctype/html/head and is returned verbatim with
  // no framework head splice, so it is the likeliest place outside the root
  // layout to hand-write a stylesheet link. error/not-found always ship too.
  write(dir, 'app/global-error.ts', 'export default () => `<html><head><link rel="stylesheet" href="/public/ge.css"></head></html>`;');
  write(dir, 'app/not-found.ts', 'export default () => `<link rel="stylesheet" href="/public/nf.css">`;');
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /ge\.css/);
  assert.match(r.message, /nf\.css/);
});

test('asset-link advisory scans global-error only at the app root, as the router does', async () => {
  const nested = tmpDir();
  // router.js registers global-error / global-not-found only when dir === '.',
  // so a nested one is never in the route table and never renders.
  write(nested, 'app/admin/global-error.ts', 'export default () => `<link rel="stylesheet" href="/public/dead.css">`;');
  assert.equal(byName(await runDoctorChecks(nested, baseOpts()), ASSET_LINK_CHECK).status, 'pass');

  const root = tmpDir();
  write(root, 'app/global-error.ts', 'export default () => `<link rel="stylesheet" href="/public/ge.css">`;');
  assert.equal(byName(await runDoctorChecks(root, baseOpts()), ASSET_LINK_CHECK).status, 'warn');
});

test('asset-link advisory does not treat a // inside an attribute value as a comment', async () => {
  // A protocol-relative CDN sheet beside a local one is the exact layout this
  // check targets. A flat `//` comment matcher blanks the rest of that line and
  // makes the scan silently inert there.
  for (const [label, markup] of [
    ['protocol-relative sheet', '<link rel="stylesheet" href="//cdn.example/x.css"><link rel="stylesheet" href="/public/a.css">'],
    ['preconnect', '<link rel="preconnect" href="//fonts.example"><link rel="stylesheet" href="/public/a.css">'],
    ['// inside a data attribute', '<link data-x="a//b" rel="stylesheet" href="/public/a.css">'],
  ]) {
    const dir = tmpDir();
    write(dir, 'app/layout.ts', 'export default () => `' + markup + '`;');
    const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
    assert.equal(r.status, 'warn', label);
    assert.match(r.message, /a\.css/, label);
  }
});

test('asset-link advisory survives nested html`` templates in ${} holes', async () => {
  // The framework's most common idiom. A quote-tracking lexer cannot model it
  // with one quote char: the inner backtick reads as closing the outer template
  // and inverts string/code polarity for the rest of the file.
  const sameLine = tmpDir();
  write(sameLine, 'app/layout.ts', [
    'export default ({ nav }) => html`',
    '  <nav>${nav.map(n => html`<a href=//${n.host}>x</a>`)}</nav><link rel="stylesheet" href="/public/app.css">`;',
  ].join('\n'));
  assert.equal(
    byName(await runDoctorChecks(sameLine, baseOpts()), ASSET_LINK_CHECK).status,
    'warn',
    'a // inside a nested template must not blank a live tag later on the line',
  );

  const apostrophe = tmpDir();
  write(apostrophe, 'app/layout.ts', [
    'export default ({ rows }) => html`',
    "  <table>${rows.map(r => html`<td>it's ${r}</td>`)}</table>",
    '  // <link rel="stylesheet" href="/public/dead.css">',
    '`;',
  ].join('\n'));
  assert.equal(
    byName(await runDoctorChecks(apostrophe, baseOpts()), ASSET_LINK_CHECK).status,
    'pass',
    'an unbalanced apostrophe must not desynchronize the scan and resurrect dead markup',
  );
});

test('asset-link advisory ignores a tag inside a multi-line block comment', async () => {
  // The interior lines of a block comment carry no marker of their own, which
  // is what an editor's toggle-block-comment produces. Judging from the tag's
  // own line prefix alone cannot see it.
  const dir = tmpDir();
  write(dir, 'app/layout.ts', [
    '/*',
    '  const legacy = html`<link rel="stylesheet" href="/public/legacy.css">`;',
    '*/',
    'export default () => html`<link rel="stylesheet" href="/public/live.css">`;',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.doesNotMatch(r.message, /legacy\.css/, 'a block-commented tag emits nothing');
  assert.match(r.message, /app\/layout\.ts:4 href="\/public\/live\.css"/);
});

test('asset-link advisory is not confused by balanced CSS comments in a style block', async () => {
  // A `<style>` block legitimately contains /* */ pairs. Balanced ones must
  // leave the backward scan where it started.
  const dir = tmpDir();
  write(dir, 'app/layout.ts', [
    'export default () => html`',
    '  <style>/* tokens */ :root { --a: 1 } /* end */</style>',
    '  <link rel="stylesheet" href="/public/after.css">`;',
  ].join('\n'));
  const r = byName(await runDoctorChecks(dir, baseOpts()), ASSET_LINK_CHECK);
  assert.equal(r.status, 'warn');
  assert.match(r.message, /after\.css/);
});

// ---------------------------------------------------------------------------
// framework LINK integrity (#1442): an install run inside a linked worktree
// corrupts the primary's `@webjsdev/*` links. The framework-resolve check above
// cannot see it, because a link into a live FOREIGN checkout resolves fine.
// ---------------------------------------------------------------------------
const { inspectFrameworkLink, checkFrameworkLinks } = await import(
  resolve(CLI_LIB_DIR, 'doctor.js')
);

/** An app dir with `node_modules/@webjsdev/core` planted as `plant` describes. */
function linkFixture(plant) {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  mkdirSync(join(dir, 'node_modules', '@webjsdev'), { recursive: true });
  mkdirSync(join(dir, 'packages', 'core'), { recursive: true });
  write(dir, 'packages/core/package.json', '{"name":"@webjsdev/core"}');
  plant(dir);
  return dir;
}

test('framework-links PASSES when @webjsdev/core is a real directory', () => {
  const dir = linkFixture((d) => {
    mkdirSync(join(d, 'node_modules', '@webjsdev', 'core'), { recursive: true });
  });
  assert.equal(inspectFrameworkLink(dir).state, 'real');
  assert.equal(checkFrameworkLinks(dir).status, 'pass');
});

test('framework-links PASSES when the link resolves inside the tree that owns node_modules', () => {
  const dir = linkFixture((d) => {
    symlinkSync('../../packages/core', join(d, 'node_modules', '@webjsdev', 'core'));
  });
  assert.equal(inspectFrameworkLink(dir).state, 'ok');
  assert.equal(checkFrameworkLinks(dir).status, 'pass');
});

test('framework-links PASSES through a SYMLINKED node_modules, the linked-worktree shape', () => {
  // The no-false-positive case, and the one that caught a real bug: through a
  // symlinked node_modules the link's LEXICAL directory is under the worktree
  // while the link physically lives in the primary, so resolving `../../` the
  // lexical way reports every healthy linked worktree as `foreign`.
  const primary = linkFixture((d) => {
    symlinkSync('../../packages/core', join(d, 'node_modules', '@webjsdev', 'core'));
  });
  const worktree = tmpDir();
  write(worktree, 'package.json', JSON.stringify({ name: 'wt' }));
  mkdirSync(join(worktree, 'packages', 'core'), { recursive: true });
  symlinkSync(join(primary, 'node_modules'), join(worktree, 'node_modules'));

  assert.equal(inspectFrameworkLink(worktree).state, 'ok');
  assert.equal(checkFrameworkLinks(worktree).status, 'pass');
});

test('framework-links WARNS when the link DANGLES', () => {
  const dir = linkFixture((d) => {
    symlinkSync('/nonexistent/removed-worktree/packages/core', join(d, 'node_modules', '@webjsdev', 'core'));
  });
  assert.equal(inspectFrameworkLink(dir).state, 'dangling');
  const r = checkFrameworkLinks(dir);
  assert.equal(r.status, 'warn');
  assert.match(r.fix, /owns this node_modules|owning checkout/);
  assert.match(r.fix, /do NOT run `npm install`/i);
});

test('framework-links WARNS when the link resolves OUTSIDE the owning tree', () => {
  const foreign = tmpDir();
  mkdirSync(join(foreign, 'packages', 'core'), { recursive: true });
  // A RESOLVABLE package, so the assertion below can show that
  // `frameworkResolves` is perfectly happy with a link into a foreign checkout.
  writeFileSync(join(foreign, 'packages', 'core', 'package.json'), '{"name":"@webjsdev/core","main":"index.js"}');
  writeFileSync(join(foreign, 'packages', 'core', 'index.js'), 'export {};');
  const dir = linkFixture((d) => {
    symlinkSync(join(foreign, 'packages', 'core'), join(d, 'node_modules', '@webjsdev', 'core'));
  });
  assert.equal(inspectFrameworkLink(dir).state, 'foreign');
  const r = checkFrameworkLinks(dir);
  assert.equal(r.status, 'warn');
  // It resolves fine, so the resolve check cannot see it. That is the point.
  assert.equal(frameworkResolves(dir), true);
  assert.match(r.message, /resolves OUTSIDE/);
});

test('framework-links PASSES when there is no @webjsdev entry at all', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  assert.equal(checkFrameworkLinks(dir).status, 'pass');
});

test('framework-resolve stops recommending a bare npm install through a symlink', () => {
  // node_modules exists as a SYMLINK but carries no @webjsdev/core, so the
  // resolve check falls into its corrupted-install branch. Recommending
  // `npm install` there is what caused #1442 in the first place.
  const target = tmpDir();
  mkdirSync(join(target, 'node_modules'), { recursive: true });
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  symlinkSync(join(target, 'node_modules'), join(dir, 'node_modules'));

  const r = checkFrameworkResolves(dir);
  assert.equal(r.status, 'warn');
  assert.match(r.fix, /do NOT run `npm install`/);
  assert.match(r.fix, /checkout that owns the tree/);
});

test('the published-CLI remedies never name a script a scaffolded app does not have', () => {
  // These strings ship in the published CLI, and `bin/webjs.js` prints them
  // verbatim as the `webjs dev` / `webjs start` preflight failure. The #954
  // audience is a scaffolded APP worktree, which has no `worktree:link` script,
  // so naming it there sends the user to run something that does not exist.
  const app = tmpDir();
  write(app, 'package.json', JSON.stringify({ name: 'my-app', scripts: { dev: 'webjs dev' } }));
  write(app, '.git', 'gitdir: /somewhere/.git/worktrees/x');

  const fresh = checkFrameworkResolves(app);
  assert.equal(fresh.status, 'warn');
  assert.doesNotMatch(fresh.fix, /worktree:link/, 'no monorepo-only script for a scaffolded app');
  assert.match(fresh.fix, /npm install/, 'a fresh worktree with no symlink CAN just install');

  // The same repo, once it DOES declare the script, may name it.
  const mono = tmpDir();
  write(mono, 'package.json', JSON.stringify({ name: 'repo', scripts: { 'worktree:link': 'node x.mjs' } }));
  write(mono, '.git', 'gitdir: /somewhere/.git/worktrees/y');
  assert.match(checkFrameworkResolves(mono).fix, /worktree:link/);
});

test('framework-links is wired into the runner and carries its declared code', async () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'x' }));
  const results = await runDoctorChecks(dir, baseOpts({ nodeVersion: '24.0.0' }));
  const r = results.find((x) => x.name === 'framework-links');
  assert.ok(r, 'the check runs');
  assert.equal(r.code, 'FRAMEWORK_LINKS');
});
