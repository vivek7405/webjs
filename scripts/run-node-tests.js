#!/usr/bin/env node
/**
 * Node test runner driver for the framework repo.
 *
 * Enumerates every `.test.js` and `.test.mjs` under `test/` and
 * `packages/<pkg>/test/`, EXCLUDING anything under a `browser/`
 * subfolder (those run via `npm run test:browser` / web-test-runner)
 * and the e2e gate (the WEBJS_E2E=1 subset, run via `npm run test:e2e`).
 *
 * We use a script rather than inline globs in package.json because
 * Node's `--test` glob support is limited (no portable
 * "exclude this subpath" syntax across platforms).
 */
import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

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

const all = [];
walk(join(ROOT, 'test'), all);
const packagesDir = join(ROOT, 'packages');
for (const pkg of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!pkg.isDirectory()) continue;
  const pkgPath = join(packagesDir, pkg.name);
  walk(join(pkgPath, 'test'), all);
  // Grouped packages live one level deeper (packages/editors/<x>,
  // packages/wrappers/<x> after #402), so walk each sub-package's test/ too.
  for (const sub of readdirSync(pkgPath, { withFileTypes: true })) {
    if (sub.isDirectory() && sub.name !== 'node_modules' && sub.name !== 'test') {
      walk(join(pkgPath, sub.name, 'test'), all);
    }
  }
}

// Run the @webjsdev/ui workspace's own tests separately via its
// existing npm script (so we keep one source of truth for its test
// config), but pick them up here for the unified `npm test` UX.
// Walk handles them via packages/ui/test/ above.

const SEP = sep;
const browserSeg = `${SEP}browser${SEP}`;
const e2eSeg = `${SEP}e2e${SEP}`;
// Live third-party calls live only in `*.live.test.*` files, and those are
// opt-in (#1150). This job is REQUIRED, so a jspm or npm-registry outage must
// not be able to red it; a documentation-only PR was blocked that way on
// #1149. The nightly `vendor-cdn` workflow sets WEBJS_REQUIRE_NETWORK to run
// them for real, where a skip is promoted to a failure.
const LIVE_MARKER = '.live.test.';
const wantsNetwork = Boolean(process.env.WEBJS_REQUIRE_NETWORK);

const files = all
  .filter((f) => !f.includes(browserSeg))
  .filter((f) => !f.includes(e2eSeg))
  .filter((f) => wantsNetwork || !f.includes(LIVE_MARKER));

if (!files.length) {
  console.log('[run-node-tests] no test files matched.');
  process.exit(0);
}

// Opt-in coverage (#774): `WEBJS_COVERAGE=1 npm test` (or `npm run
// test:coverage`) turns on Node's built-in coverage reporter. Kept off the
// default run so the common `npm test` stays fast and its output uncluttered;
// it is purely an observability lever, no new dependency. Test files and the
// scripts/ harness are excluded so the numbers reflect shipped source only.
const coverageArgs = process.env.WEBJS_COVERAGE
  ? [
      '--experimental-test-coverage',
      '--test-coverage-exclude=**/test/**',
      '--test-coverage-exclude=**/*.test.*',
      '--test-coverage-exclude=scripts/**',
    ]
  : [];

// Deny outbound calls to jspm.io / registry.npmjs.org for the whole run, so
// this REQUIRED job cannot be redded by a third-party outage (#1150). Off when
// the caller explicitly asked for the network, which is the same switch that
// selects the *.live.test.* files above. Passed as argv rather than
// NODE_OPTIONS because Bun ignores that variable and the sibling bun runner
// uses the same fixture.
const denyArgs = wantsNetwork
  ? []
  : ['--import', pathToFileURL(resolve(ROOT, 'test', 'fixtures', 'deny-live-hosts.mjs')).href];

const args = ['--test', ...denyArgs, ...coverageArgs, ...files];
const child = spawn(process.execPath, args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
