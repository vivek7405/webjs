/**
 * No required check may FAIL because a third party is down (#1150).
 *
 * The required `Unit + integration` job used to resolve vendors against the
 * live jspm CDN, so a jspm outage redded pull requests that had nothing to do
 * with vendoring. PR #1149, a five-file documentation change, is what finally
 * made the case: it failed on the `#448` gitignore-healing test and passed on a
 * re-run of the identical commit.
 *
 * Two mechanisms enforce that, and this file asserts both.
 *
 * The RUNTIME DENY (`test/fixtures/deny-live-hosts.mjs`) is loaded by both test
 * runners and answers 503 for jspm.io and registry.npmjs.org. That covers every
 * caller, including the app-boot tests that reach jspm transitively through
 * `resolveVendorImports` with no `fetch(` anywhere in their own source.
 *
 * The FILENAME RULE keeps the genuinely-live tests out of a normal run: both
 * runners skip `*.live.test.*` unless `WEBJS_REQUIRE_NETWORK=1`, which is the
 * same switch that lifts the deny.
 *
 * This file used to hold a static scan instead, and three review rounds found
 * three different ways it went blind. `deny-live-hosts.mjs` carries that
 * history and the reason a fourth heuristic was not the answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { denyLiveHosts, DENIED_HOSTS } from '../fixtures/deny-live-hosts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The files allowed to reach a third party, each with what it asserts and why
 * it has to be live. Shaped like `scripts/run-bun-tests.js`'s DENYLIST on
 * purpose: a reason per entry, so adding one is a decision somebody wrote down
 * rather than a guard somebody silenced.
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

test('the deny answers every third-party host and passes everything else through', async () => {
  /** @type {string[]} */
  const passedThrough = [];
  /** @type {string[]} */
  const denied = [];
  const fetch = denyLiveHosts(
    async (input) => { passedThrough.push(String(input)); return new Response('real', { status: 200 }); },
    (url) => denied.push(url),
  );

  for (const host of DENIED_HOSTS) {
    const res = await fetch(`https://${host}/whatever`, { method: 'POST' });
    assert.equal(res.status, 503, `${host} must be denied`);
    // 503 rather than a throw, because every fetch caller in vendor.js catches:
    // a rejection would be swallowed, while a 503 is the shape those call sites
    // already classify as transient, so resolution degrades exactly as it does
    // during a real outage.
    assert.match((await res.json()).error, new RegExp(host));
  }
  assert.equal(denied.length, DENIED_HOSTS.length, 'each denial is reported');
  assert.deepEqual(passedThrough, [], 'nothing reached the real fetch');

  // Anything else is untouched, including a same-origin app request, which is
  // what the app-boot tests spend their time doing.
  const ok = await fetch('http://localhost:3000/');
  assert.equal(ok.status, 200);
  assert.deepEqual(passedThrough, ['http://localhost:3000/']);
});

test('the deny recognises a URL object and a Request, not only a string', async () => {
  // vendor.js passes strings, but a caller elsewhere may not, and a deny that
  // only matched strings would be silently partial.
  const fetch = denyLiveHosts(async () => new Response('real', { status: 200 }));
  assert.equal((await fetch(new URL('https://api.jspm.io/generate'))).status, 503);
  assert.equal((await fetch(new Request('https://ga.jspm.io/npm:x@1/i.js'))).status, 503);
  assert.equal((await fetch(new URL('http://localhost:3000/'))).status, 200);
});

test('both runners install the deny and skip live files, unless the network is required', () => {
  // The policy is only worth anything because the runners enforce it, so assert
  // the wiring rather than trusting it. A refactor that drops either half reds
  // here.
  for (const runner of ['scripts/run-node-tests.js', 'scripts/run-bun-tests.js']) {
    const src = readFileSync(join(ROOT, runner), 'utf8');
    assert.match(src, /WEBJS_REQUIRE_NETWORK/, `${runner} must honour the opt-in`);
    assert.match(src, /\.live\.test\./, `${runner} must filter on the live marker`);
    assert.match(src, /deny-live-hosts/, `${runner} must install the third-party deny`);
    assert.match(src, /const denyArgs = wantsNetwork/, `${runner} must lift the deny when the network is required`);
  }
});

test('every allowlisted live caller is a *.live.test.* file that exists', () => {
  for (const entry of LIVE_CALLERS) {
    assert.ok(entry.file.includes(LIVE_MARKER),
      `${entry.file} is allowlisted as live but the runners only skip *.live.test.* files`);
    assert.ok(files.some((f) => rel(f) === entry.file),
      `${entry.file} is allowlisted but no such test file exists`);
    assert.ok(entry.why.length > 40, `${entry.file} needs a real reason, not a placeholder`);
  }
});

test('a *.live.test.* file exists for every allowlisted caller and no others', () => {
  // The reverse direction. A live file added without an allowlist entry is a
  // test that reaches a third party with nobody having written down why.
  const onDisk = files.filter((f) => rel(f).includes(LIVE_MARKER)).map(rel).sort();
  assert.deepEqual(onDisk, LIVE_CALLERS.map((e) => e.file).sort());
});
