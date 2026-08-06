/**
 * The ONLY tests in this repo that talk to the real jspm CDN (#1150).
 *
 * `scripts/run-node-tests.js` and `scripts/run-bun-tests.js` both skip any
 * `*.live.test.*` file unless `WEBJS_REQUIRE_NETWORK=1`, so nothing here runs
 * in the required `Unit + integration` CI job. That is the point: a jspm
 * outage used to red pull requests that had nothing to do with vendoring, and
 * PR #1149, a five-file documentation change, is what finally made the case.
 * Everything else in the vendor suites resolves through
 * `test/fixtures/jspm-double.mjs`.
 *
 * Deleting the live coverage instead was never the goal. The vendor resolver's
 * whole job is to talk to jspm, and a double can only ever return what this
 * repo already believes about the API. So these two assertions stay real, and
 * `.github/workflows/vendor-cdn.yml` runs them nightly with
 * `WEBJS_REQUIRE_NETWORK=1`, and surfaces any skip as a warning annotation, so
 * a permanently skipping test is visible rather than indistinguishable from a
 * passing one.
 *
 * Upstream trouble skips rather than reds, judged at the transport: a throw, a
 * 5xx, or a 429 is jspm having a bad moment. A 4xx does not skip, because by
 * then a ground-truth call has just succeeded against the same fixture, so
 * upstream is demonstrably healthy and a 4xx means OUR request is malformed.
 * That distinction is #1219's, and it is the reason this file can be run
 * nightly without becoming a source of false alarms.
 *
 * That only holds if the skip is REACHABLE where the file runs. It briefly was
 * not: `WEBJS_REQUIRE_NETWORK` both selected these files and promoted every
 * skip to a failure, and the nightly always sets it, so the transport
 * distinction had no effect anywhere automated and a single 503 at 04:20 UTC
 * would have filed a bug issue. The two concerns are separate variables now.
 * `WEBJS_REQUIRE_NETWORK` selects the files and lifts the deny;
 * `WEBJS_FAIL_ON_SKIP` promotes a skip, and the nightly does NOT set it. The
 * nightly instead reports skips as a warning annotation, so a permanently
 * skipping test is visible without waking anyone for an outage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { jspmGenerate, clearVendorCache } from '../../src/vendor.js';

/** The body vendor.js posts, so a ground-truth call is comparable to ours. */
const GENERATE_BODY = (install) => JSON.stringify({
  install, flattenScope: true, env: ['browser', 'production', 'module'], provider: 'jspm.io',
});

/**
 * Build a loud skip for one fixture.
 *
 * Loud on purpose: a silent skip is how a real regression hides, so the reason
 * and the fixture are always named, and the nightly turns any skip into a
 * warning annotation.
 *
 * `WEBJS_FAIL_ON_SKIP` promotes it to a failure. Deliberately NOT the same
 * variable that selects this file, and deliberately not set by the nightly:
 * upstream being down is not a regression, and a job that reds on it is a job
 * whose reds get ignored. Set it by hand when you want to know that the check
 * genuinely ran.
 *
 * @param {import('node:test').TestContext} t
 * @param {string} fixture
 */
function skipper(t, fixture) {
  return (reason) => {
    const first = String(reason).split('\n')[0];
    if (process.env.WEBJS_FAIL_ON_SKIP) {
      assert.fail(`live jspm check could not run (${fixture}): ${first}`);
    }
    console.warn(`[jspm-cdn.live] SKIP ${fixture} (${first})`);
    t.skip('jspm.io was not in a state that can answer this comparison');
  };
}

test('jspm fails the WHOLE batch, permanently, when one install is unresolvable', async (t) => {
  // The premise the entire fallback ladder in jspmGenerate rests on, and the
  // one thing a double cannot vouch for, since the double is built from this
  // very belief. Two properties, both load-bearing:
  //
  //   1. WHOLE batch. A resolvable install alongside an unresolvable one still
  //      fails, which is why jspmGenerate probes each install alone instead of
  //      trusting a partial map. If jspm ever switched to partial-success 200s,
  //      the probing would become dead code and nothing else would notice.
  //   2. PERMANENT, not transient. vendor.js classifies >= 500 and 429 as
  //      transient and retries per package; anything else drops the failing
  //      install. An unknown package landing on the transient side would turn
  //      a pin failure into a retry storm.
  const skip = skipper(t, 'whole-batch 401 premise');
  const installs = ['picocolors@1.1.1', 'this-package-truly-does-not-exist-xyz-789@99.0.0'];

  let res;
  try {
    res = await fetch('https://api.jspm.io/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: GENERATE_BODY(installs),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    skip(`${err.name}: ${err.message}`);
    return;
  }
  // A 5xx or a 429 is upstream having a bad moment rather than an answer about
  // the premise, so it skips like any other transport trouble.
  if (res.status >= 500 || res.status === 429) { skip(`HTTP ${res.status}`); return; }

  assert.ok(!res.ok,
    `jspm answered ${res.status} for a batch containing an unresolvable install; ` +
    'jspmGenerate\'s per-install probing assumes the whole batch fails');
  assert.ok(res.status < 500 && res.status !== 429,
    `an unresolvable install must be a PERMANENT failure, got HTTP ${res.status}`);
});

test('jspmGenerate #446: matches jspm\'s own unified graph (real CDN)', async (t) => {
  // The integration half: our merged output must equal what jspm itself
  // computes for the same install set. The mock above cannot prove this,
  // because a mock only ever returns what this file already believes.
  //
  // The fixture is chosen so the comparison can actually FAIL two distinct
  // ways, since a parity assertion over a set with nothing to disagree about
  // is decoration:
  //
  //   1. Per-package skew. Resolved alone, @codemirror/lint drags in
  //      view@6.41.x; in the unified graph the pinned view@6.39.0 wins. So a
  //      revert of jspmGenerate to the pre-#446 per-package loop makes lint's
  //      isolated call supply the newer view, which wins last-write and diverges
  //      from the ground truth here. Two packages with no shared transitive
  //      (say picocolors + clsx) cannot catch that: their unified graph is
  //      byte-identical to the union of their single-install graphs.
  //   2. A dropped flattenScope. This pair hoists five transitives to top level
  //      (@codemirror/state, crelt, style-mod, w3c-keyname,
  //      @marijn/find-cluster-break). vendor.js sends flattenScope: true so the
  //      browser gets no unresolved bare specifier, and this ground truth sends
  //      it too, so removing it from vendor.js drops those entries from our
  //      imports and reds the deepEqual. Nothing else in the suite covers that
  //      flag: every mock here answers only on `install`, so a mocked assertion
  //      on a transitive key reads a value the mock itself fabricated.
  //
  // lint is pinned at 6.9.5 rather than a version whose view range EXCLUDES
  // 6.39.0 (only 6.9.6 and 6.9.7 do that, and neither resolves on jspm.io, see
  // the mock test above). The incompatible-range case is the mock's job; this
  // one only needs a shared transitive whose resolution differs per strategy.
  const installs = ['@codemirror/view@6.39.0', '@codemirror/lint@6.9.5'];

  const skip = skipper(t, `unified-graph parity: ${installs.join(' + ')}`);

  // Half one, the ground truth. Every failure mode routes to the skip, not
  // just an `error` in a well-formed JSON body: a DNS failure or reset throws
  // out of fetch, a proxy's HTML 502 throws out of .json(), and a hang is cut
  // by the timeout. Without that timeout a wedged api.jspm.io would hold the
  // unit job open until the CI job limit, since node --test applies no
  // per-test deadline of its own. The shipped code guards its own call the
  // same way (JSPM_GENERATE_TIMEOUT_MS in packages/server/src/vendor.js).
  let gt;
  let why = '';
  try {
    const gtResp = await fetch('https://api.jspm.io/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        install: installs, flattenScope: true,
        env: ['browser', 'production', 'module'], provider: 'jspm.io',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    gt = await gtResp.json();
    if (!gtResp.ok) why = `HTTP ${gtResp.status}`;
    else if (gt.error) why = String(gt.error);
    else if (!gt.map?.imports) why = 'response carried no map.imports';
  } catch (err) {
    why = `${err.name}: ${err.message}`;
  }
  if (why) { skip(why); return; }

  // Half two, our own call, watched at the TRANSPORT rather than judged by its
  // return value. jspmGenerate fail-opens, so its output cannot tell the two
  // failure kinds apart: a transient on the unified call returns a NON-empty
  // merge of per-install fragments (skewed to view@6.41.x for this fixture),
  // and an unresolvable set returns {}. Reading the map alone therefore either
  // reds on an upstream blip or skips on a real bug, depending on which shape
  // you test for. Both are wrong.
  //
  // So record what the network actually did. A throw, a 5xx, or a 429 is
  // upstream having a bad moment, and skips. A 4xx does NOT skip: the ground
  // truth just succeeded for this same fixture moments ago, so upstream is
  // demonstrably healthy, and a 4xx now means OUR request is malformed, which
  // is precisely the regression this test exists to catch.
  const realFetch = globalThis.fetch;
  /** @type {string[]} */
  const transient = [];
  globalThis.fetch = async (url, opts) => {
    try {
      const r = await realFetch(url, opts);
      if (r.status >= 500 || r.status === 429) transient.push(`HTTP ${r.status}`);
      return r;
    } catch (err) {
      transient.push(`${err.name}: ${err.message}`);
      throw err;
    }
  };
  let map;
  try {
    clearVendorCache();
    map = await jspmGenerate(installs);
  } finally {
    globalThis.fetch = realFetch;
  }
  if (transient.length) { skip(`jspm.io flaked on our own call (${transient[0]})`); return; }

  assert.deepEqual(map, gt.map.imports,
    'jspmGenerate must equal the single unified graph, not a per-package merge');
});
