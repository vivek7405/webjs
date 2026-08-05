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
 * The analysis lives in `test/fixtures/live-caller-scan.mjs` so it can be run
 * against inline fixtures rather than only against whatever the tree happens
 * to contain, which is what the `counterfactual` tests below do. The first
 * version of this guard was file-level and, measured against the pre-PR tree,
 * flagged NEITHER of the two files this change converts: a single
 * `withMockedFetch` anywhere in `vendor.test.js` exempted its live
 * `fetch(api.jspm.io)` and all four of its unwrapped entry points. So the
 * exemption is per call now, and the counterfactual is a real one.
 *
 * Measured against the pre-PR tree, the rewritten scan reports 24 offenders in
 * `vendor.test.js`, starting with the live `fetch('https://api.jspm.io/generate')`.
 *
 * ONE BLIND SPOT, stated rather than papered over: it cannot see a SPAWNED
 * child. `test/vendor-cli/vendor-cli.test.mjs` reaches jspm by running the CLI
 * in another process, so it contains no `fetch(` and no entry-point call, and
 * this scan reports zero for it both before and after the change. What covers
 * that file is the `[jspm-double] armed` assertion inside its own `runCli`,
 * which fires on every spawn and reds all ten of its tests if the preload flag
 * is dropped. A future spawning test needs the same treatment; a static scan
 * of the parent's source cannot give it.
 *
 * Both test runners drop `*.live.test.*` unless `WEBJS_REQUIRE_NETWORK=1`, so
 * a file on the allowlist below genuinely cannot run in a required check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findLiveCallers } from '../fixtures/live-caller-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Files allowed to reach a third party, each with what it asserts and why it
 * has to be live. Shaped like `scripts/run-bun-tests.js`'s DENYLIST on
 * purpose: a reason per entry, so adding one is a decision somebody wrote down
 * rather than a guard somebody silenced.
 *
 * Every entry MUST be a `*.live.test.*` path, which is what the runners key
 * on, with ONE exception recorded below.
 */
const LIVE_CALLERS = [
  {
    file: 'packages/server/test/vendor/jspm-cdn.live.test.js',
    live: true,
    why: 'the two things an offline double cannot vouch for: that our merged output equals '
      + "jspm's own unified graph (#446), and that jspm still fails a WHOLE batch permanently "
      + 'when one install is unresolvable, which the entire fallback ladder in vendor.js assumes.',
  },
  {
    file: 'test/vendor-cli/vendor-pin.live.test.mjs',
    live: true,
    why: 'one real run of the command a user actually types, so `webjs vendor pin` does not '
      + 'become a thing that is only ever exercised against a fixture.',
  },
  {
    file: 'test/repo-health/e2e-vendor-stub.test.mjs',
    live: false,
    why: 'NOT a live caller. It POSTs to api.jspm.io on purpose to exercise the real request '
      + 'shape, having installed a sentinel fetch at module scope BEFORE importing the fixture '
      + 'under test, which is the whole point of that ordering (#1228). The sentinel is a bare '
      + 'assignment outside any call, so a per-call scan cannot see it covering anything.',
  },
];

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

test('every allowlisted LIVE caller is a *.live.test.* file that exists', () => {
  for (const entry of LIVE_CALLERS) {
    assert.ok(files.some((f) => rel(f) === entry.file),
      `${entry.file} is allowlisted but no such test file exists`);
    assert.ok(entry.why.length > 40, `${entry.file} needs a real reason, not a placeholder`);
    if (entry.live) {
      assert.ok(entry.file.includes(LIVE_MARKER),
        `${entry.file} is allowlisted as live but the runners only skip *.live.test.* files`);
    }
  }
});

test('no test outside the allowlist reaches a third party', () => {
  const allowed = new Set(LIVE_CALLERS.map((e) => e.file));
  /** @type {string[]} */
  const offenders = [];
  for (const file of files) {
    const path = rel(file);
    if (allowed.has(path)) continue;
    for (const hit of findLiveCallers(readFileSync(file, 'utf8'))) {
      offenders.push(`${path}:${hit.line} ${hit.kind === 'host' ? `fetch(${hit.what})` : `${hit.what}()`}`);
    }
  }
  assert.deepEqual(offenders, [],
    'these reach a third party from a file a required check runs. Wrap the call in '
    + 'withJspmDouble (test/fixtures/jspm-double.mjs), move it into a *.live.test.* file and '
    + 'allowlist that, or if the call provably returns before dialling, mark the site with a '
    + '`// live-cdn-ok: <reason>` comment.');
});

test('counterfactual: the scan catches the shapes this change converted', () => {
  // The two real regressions, reduced to their essentials. Before this guard
  // was rewritten it reported ZERO offenders for both, because a single
  // `withMockedFetch` elsewhere in the file exempted the whole file.
  const liveFetchBesideAMock = `
    function withMockedFetch(fn, body) { return body(); }
    test('mocked', async () => {
      await withMockedFetch(async () => ({ ok: true }), async () => { await jspmGenerate([]); });
    });
    test('live', async () => {
      const res = await fetch('https://api.jspm.io/generate', { method: 'POST' });
    });
  `;
  const hits = findLiveCallers(liveFetchBesideAMock);
  assert.equal(hits.length, 1, `expected exactly the live call, got ${JSON.stringify(hits)}`);
  assert.equal(hits[0].kind, 'host');
  assert.equal(hits[0].what, 'api.jspm.io');

  const unwrappedEntryBesideAMock = `
    function withMockedFetch(fn, body) { return body(); }
    test('mocked', async () => { await withMockedFetch(m, () => pinAll(dir)); });
    test('live', async () => { const r = await pinAll(dir, { download: true }); });
  `;
  const entryHits = findLiveCallers(unwrappedEntryBesideAMock);
  assert.equal(entryHits.length, 1, `expected exactly the unwrapped call, got ${JSON.stringify(entryHits)}`);
  assert.equal(entryHits[0].what, 'pinAll');
});

test('counterfactual: the scan does not fire on the shapes that are genuinely safe', () => {
  // A host inside an assertion, an expected-url string, or an importmap
  // fixture is inert, and the suite is full of those on purpose.
  assert.deepEqual(findLiveCallers(`
    assert.match(url, /^https:\\/\\/ga\\.jspm\\.io\\/npm:picocolors@/);
    const imports = { dayjs: 'https://ga.jspm.io/npm:dayjs@1.11.20/index.js' };
    // A comment mentioning api.jspm.io and calling fetch('https://api.jspm.io/generate').
  `), []);

  // A call inside a double, and one carrying the explicit marker.
  assert.deepEqual(findLiveCallers(`
    await withJspmDouble({}, async () => { await pinAll(dir); });
    // live-cdn-ok: no bare imports, so it returns before the resolve.
    const r = await pinAll(emptyDir);
  `), []);
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
