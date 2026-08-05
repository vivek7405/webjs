/**
 * Live third-party calls belong only in `*.live.test.*` files (#1150).
 *
 * That is the whole policy, and it is worth enforcing mechanically because the
 * failure it prevents is invisible: a test that quietly reaches api.jspm.io or
 * registry.npmjs.org passes every day until the third party has a bad hour,
 * and then reds a pull request that never touched vendoring. PR #1149, a
 * five-file documentation change, is what finally made the case. The old
 * `WEBJS_SKIP_NETWORK_TESTS` convention could not prevent it: it was opt-OUT,
 * so CI always ran live, and two `registry.npmjs.org` callers were never
 * covered by it at all.
 *
 * The rule is enforced on the PROPERTY, not on a spelling. Asserting that some
 * marker constant appears exactly once would certify nothing (a new test can
 * always call fetch without it) and would red on a rename or a reformat. So
 * this looks for the actual live surface: a third-party host inside a `fetch(`
 * call, and the vendor entry points that reach one internally.
 *
 * Both test runners drop `*.live.test.*` unless `WEBJS_REQUIRE_NETWORK=1`, so
 * a file on the allowlist below genuinely cannot run in a required check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Files allowed to reach a third party, each with what it asserts and why it
 * has to be live. Shaped like `scripts/run-bun-tests.js`'s DENYLIST on
 * purpose: a reason per entry, so adding one is a decision somebody wrote down
 * rather than a guard somebody silenced.
 *
 * Every entry MUST be a `*.live.test.*` path, which is what the runners key on.
 */
const LIVE_CALLERS = [
  {
    file: 'packages/server/test/vendor/jspm-cdn.live.test.js',
    why: 'the two things an offline double cannot vouch for: that our merged output equals '
      + "jspm's own unified graph (#446), and that jspm still fails a WHOLE batch permanently "
      + 'when one install is unresolvable, which the entire fallback ladder in vendor.js assumes.',
  },
  {
    file: 'test/vendor-cli/vendor-pin.live.test.mjs',
    why: 'one real run of the command a user actually types, so `webjs vendor pin` does not '
      + 'become a thing that is only ever exercised against a fixture.',
  },
];

/** Third-party hosts no required check may depend on. */
const LIVE_HOSTS = ['api.jspm.io', 'ga.jspm.io', 'registry.npmjs.org'];

/**
 * Vendor entry points that reach a live host internally, so naming one is as
 * live as calling fetch. Each is allowed inside a `withMockedFetch` or
 * `withJspmDouble` body, which is how the offline suites use them.
 */
const LIVE_ENTRY_POINTS = ['pinAll', 'updatePinned', 'auditPinned', 'findOutdated'];

const LIVE_MARKER = '.live.test.';

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

const files = [];
walk(join(ROOT, 'test'), files);
for (const pkg of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
  if (!pkg.isDirectory()) continue;
  walk(join(ROOT, 'packages', pkg.name, 'test'), files);
  // packages/editors/* and packages/wrappers/* nest one level deeper.
  for (const sub of readdirSync(join(ROOT, 'packages', pkg.name), { withFileTypes: true })) {
    if (sub.isDirectory()) walk(join(ROOT, 'packages', pkg.name, sub.name, 'test'), files);
  }
}

const rel = (f) => f.slice(ROOT.length + 1).split(sep).join('/');
// This file names every host and entry point it polices, so it would match its
// own rule. Excluded by exact path rather than by a heuristic, since a fuzzy
// self-exclusion is the kind of hole that lets a real caller through too.
const SELF = 'test/repo-health/live-cdn-callers.test.mjs';

/**
 * Strip block and line comments, so a host named in a rationale is not read as
 * a call. Crude on purpose: it only has to be good enough to avoid false
 * positives on prose, and a missed strip fails LOUD rather than silent.
 * @param {string} src
 */
function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Whether a file installs a `fetch` it owns, which is what makes naming a live
 * host in it harmless. `e2e-vendor-stub.test.mjs` is the shape this exists for:
 * it POSTs to api.jspm.io on purpose, having replaced `globalThis.fetch` with a
 * sentinel first, so it exercises the real request shape without a packet
 * leaving the machine.
 *
 * Deliberately file-level rather than per-call. A per-call scope check needs a
 * parser, and this version cannot be quietly defeated by moving a call one
 * block outward. The tradeoff is real and worth stating: a file that mocks
 * fetch in one test and reaches the network in another passes. Accepted,
 * because the failure this guard exists to prevent is a whole file nobody
 * realised was live, not one call inside a file that is otherwise careful.
 *
 * @param {string} src
 */
function controlsFetch(src) {
  return /withJspmDouble|withMockedFetch|globalThis\.fetch\s*=/.test(src);
}

test('every allowlisted live caller is a *.live.test.* file that exists', () => {
  for (const entry of LIVE_CALLERS) {
    assert.ok(entry.file.includes(LIVE_MARKER),
      `${entry.file} is allowlisted as live but the runners only skip *.live.test.* files`);
    assert.ok(files.some((f) => rel(f) === entry.file),
      `${entry.file} is allowlisted but no such test file exists`);
    assert.ok(entry.why.length > 40, `${entry.file} needs a real reason, not a placeholder`);
  }
});

test('a live third-party host is only fetched from an allowlisted file', () => {
  const allowed = new Set(LIVE_CALLERS.map((e) => e.file));
  /** @type {string[]} */
  const offenders = [];
  for (const file of files) {
    const path = rel(file);
    if (path === SELF || allowed.has(path)) continue;
    const raw = readFileSync(file, 'utf8');
    if (controlsFetch(raw)) continue;
    const src = withoutComments(raw);
    // A host inside a fetch call. Anything else (a string fed to a mock, an
    // expected url in an assertion, an importmap fixture) is inert, and the
    // suite is full of those on purpose.
    for (const m of src.matchAll(/\bfetch\s*\(([^)]*)/g)) {
      const host = LIVE_HOSTS.find((h) => m[1].includes(h));
      if (host) offenders.push(`${path}: fetch(... ${host} ...)`);
    }
  }
  assert.deepEqual(offenders, [],
    'these reach a third party from a file a required check runs; move them into a '
    + '*.live.test.* file and allowlist it, or resolve through test/fixtures/jspm-double.mjs');
});

test('a vendor entry point that reaches the network is called inside a double or a mock', () => {
  const allowed = new Set(LIVE_CALLERS.map((e) => e.file));
  /** @type {string[]} */
  const offenders = [];
  for (const file of files) {
    const path = rel(file);
    if (path === SELF || allowed.has(path)) continue;
    const src = readFileSync(file, 'utf8');
    const uses = LIVE_ENTRY_POINTS.filter((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(withoutComments(src)));
    if (!uses.length) continue;
    if (!controlsFetch(src)) {
      offenders.push(`${path}: calls ${uses.join(', ')} with no double or mock in the file`);
    }
  }
  assert.deepEqual(offenders, [],
    'these call a vendor entry point that resolves through a third party, without controlling '
    + 'fetch; wrap them in withJspmDouble from test/fixtures/jspm-double.mjs');
});

test('both runners drop live files unless the network is explicitly required', () => {
  // The policy above is only worth anything because the runners enforce it, so
  // assert the enforcement rather than trusting it. A refactor that renames
  // the marker or drops the filter reds here.
  for (const runner of ['scripts/run-node-tests.js', 'scripts/run-bun-tests.js']) {
    const src = readFileSync(join(ROOT, runner), 'utf8');
    assert.match(src, /WEBJS_REQUIRE_NETWORK/, `${runner} must honour the opt-in`);
    assert.match(src, /\.live\.test\./, `${runner} must filter on the live marker`);
  }
});
