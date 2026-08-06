/**
 * The offline jspm double (#1150), tested on its own.
 *
 * `test/fixtures/jspm-double.mjs` is what keeps a jspm outage from redding the
 * required CI job, and it is the kind of thing that can rot silently: a double
 * that answers the wrong shape makes the vendor tests pass for the wrong
 * reason, which is strictly worse than the live dependency it replaced. So the
 * contract it owes `packages/server/src/vendor.js` is pinned here, in the same
 * spirit as `e2e-vendor-stub.test.mjs` pins #1229's fixture.
 *
 * Three properties carry most of the weight.
 *
 * The URL SHAPE. `pinAll` recovers a flattened transitive's version by locating
 * `<name>@<version>` inside the resolved url (`derivePinParts`), and derives a
 * `--download` filename from it. A double that dropped the version, or that
 * collapsed a subpath into the package name, would make `pinAll` report a
 * failure that looks like a product bug.
 *
 * The WHOLE-BATCH 401. Real jspm fails the entire call when any one install is
 * unresolvable, and `jspmGenerate`'s per-install probing exists only because of
 * that. A double that answered a partial map would leave the probing untested.
 * The premise itself is re-checked against the real API by
 * `packages/server/test/vendor/jspm-cdn.live.test.js`.
 *
 * The REFUSAL. Every fetch caller in vendor.js catches, so an unserved request
 * cannot be signalled by throwing: it would be indistinguishable from the CDN
 * being down, and would quietly weaken whatever test hit it. It is recorded
 * instead, and `withJspmDouble` fails the test on any recorded entry.
 *
 * This file installs no global fetch of its own and calls the double directly,
 * so it is network-free by construction rather than by discipline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { jspmDouble } from '../fixtures/jspm-double.mjs';
import { packageName, packageVersion, subpath, importKey } from '../fixtures/install-spec.mjs';

const GENERATE = 'https://api.jspm.io/generate';

/** The body `vendor.js` posts, so the double is exercised through its real shape. */
const generate = (double, install) => double(GENERATE, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    install, flattenScope: true, env: ['browser', 'production', 'module'], provider: 'jspm.io',
  }),
});

test('an install string yields its package name, version, and subpath', () => {
  // All four shapes jspm accepts, each in bare and scoped form. The version is
  // OPTIONAL, so the unversioned-with-subpath rows are the ones that catch a
  // parser assuming a subpath always rides behind a version. They are also the
  // rows the `install.replace(/@[^@]*$/, '')` shortcut gets wrong, which is
  // why this parse is shared rather than rewritten per fixture.
  const cases = [
    ['dayjs', 'dayjs', '', ''],
    ['dayjs@1.11.21', 'dayjs', '1.11.21', ''],
    ['dayjs/plugin/utc', 'dayjs', '', '/plugin/utc'],
    ['dayjs@1.11.21/plugin/utc', 'dayjs', '1.11.21', '/plugin/utc'],
    ['@scope/pkg', '@scope/pkg', '', ''],
    ['@scope/pkg@1.0.0', '@scope/pkg', '1.0.0', ''],
    ['@scope/pkg/sub', '@scope/pkg', '', '/sub'],
    ['@scope/pkg@1.0.0/sub', '@scope/pkg', '1.0.0', '/sub'],
  ];
  for (const [install, name, version, sub] of cases) {
    assert.equal(packageName(install), name, `name of ${install}`);
    assert.equal(packageVersion(install), version, `version of ${install}`);
    assert.equal(subpath(install), sub, `subpath of ${install}`);
    assert.equal(importKey(install), `${name}${sub}`, `import key of ${install}`);
  }
});

test('a generate call answers a map keyed the way the browser looks entries up', async () => {
  const double = jspmDouble();
  const res = await generate(double, ['picocolors@1.1.1', '@scope/pkg@2.0.0/sub']);
  assert.equal(res.status, 200);
  const { map } = await res.json();

  // Keyed on name + subpath and never on the version, because that is what
  // appears in source: `import x from '@scope/pkg/sub'`.
  assert.deepEqual(Object.keys(map.imports).sort(), ['@scope/pkg/sub', 'picocolors']);
  assert.equal(map.imports['picocolors'], 'https://ga.jspm.io/npm:picocolors@1.1.1/double.js');
  assert.equal(map.imports['@scope/pkg/sub'], 'https://ga.jspm.io/npm:@scope/pkg@2.0.0/sub/double.js');
  assert.equal(double.unexpected.length, 0);
});

test('the minted url keeps name@version parseable, which pinAll depends on', async () => {
  // `derivePinParts` locates `<bare>@<version>` in the resolved url to recover
  // a transitive's version. Assert that literally, since a url shape that only
  // LOOKS jspm-ish would pass every other test here and fail inside pinAll.
  const double = jspmDouble();
  const { map } = await (await generate(double, ['@codemirror/view@6.39.0/dist/index.js'])).json();
  const url = map.imports['@codemirror/view/dist/index.js'];
  const match = new RegExp('(?:^|[^a-zA-Z0-9_.-])@codemirror/view@([^/]+)').exec(url);
  assert.ok(match, `derivePinParts must be able to read a version out of ${url}`);
  assert.equal(match[1], '6.39.0');
});

test('the /double.js tail is what proves a resolve did not go to the network', async () => {
  // Real jspm never emits this, so it is the only part of the url a wiring
  // assertion can key on. `vendor-cli.test.mjs` asserts it for exactly that.
  const double = jspmDouble();
  const { map } = await (await generate(double, ['picocolors@1.1.1'])).json();
  assert.match(map.imports.picocolors, /\/double\.js$/);
});

test('one unresolvable install fails the WHOLE batch, not just its own entry', async () => {
  const bad = 'nope-xyz@9.9.9';
  const double = jspmDouble({ unresolvable: [bad] });

  const mixed = await generate(double, ['picocolors@1.1.1', bad]);
  assert.equal(mixed.status, 401, 'a batch carrying an unresolvable install must fail entirely');
  assert.equal((await mixed.json()).error, 'Error: Not Found');

  // And the resolvable one still succeeds when probed alone, which is the half
  // that makes jspmGenerate's per-install fallback able to recover anything.
  const alone = await generate(double, ['picocolors@1.1.1']);
  assert.equal(alone.status, 200);
  assert.equal(double.unexpected.length, 0);
});

test('a forced transient status is distinguishable from a permanent one', async () => {
  // vendor.js treats >= 500 and 429 as transient and retries per package;
  // everything else drops the install. The double has to be able to produce
  // both sides or the transient branch cannot be tested at all.
  for (const status of [503, 429]) {
    const double = jspmDouble({ status });
    const res = await generate(double, ['picocolors@1.1.1']);
    assert.equal(res.status, status);
  }
});

test('a minted bundle url serves bytes with a JavaScript content type', async () => {
  // downloadBundle and fetchIntegrity both GET the resolved url, one to write
  // it to disk and one to hash it, so an answer with no body would make every
  // integrity assertion vacuous.
  const double = jspmDouble({ bundle: 'export default 1;\n' });
  const { map } = await (await generate(double, ['picocolors@1.1.1'])).json();
  const res = await double(map.imports.picocolors);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/javascript');
  assert.equal(await res.text(), 'export default 1;\n');
  assert.equal(double.unexpected.length, 0);
});

test('a jspm url the double never minted is RECORDED, not passed through', async () => {
  const double = jspmDouble();
  const res = await double('https://ga.jspm.io/npm:never-minted@1.0.0/index.js');
  assert.equal(res.status, 599, 'the double must answer rather than reach the network');
  assert.equal(double.unexpected.length, 1);
  assert.match(double.unexpected[0], /never-minted/);
});

test('registry.npmjs.org is owned too, so an audit or update call cannot slip out', async () => {
  const double = jspmDouble();
  await double('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', { method: 'POST' });
  assert.equal(double.unexpected.length, 1);
  assert.match(double.unexpected[0], /registry\.npmjs\.org/);
});

test('a body the double cannot read is refused, never answered with an empty map', async () => {
  // The silent failure this fixture exists to remove: an absent importmap
  // entry is an unresolved bare specifier that kills a page's whole module
  // graph, so answering `{}` would be worse than answering nothing.
  for (const init of [
    { method: 'POST' },
    { method: 'POST', body: new Uint8Array([1, 2, 3]) },
    { method: 'POST', body: '{ not json' },
    { method: 'POST', body: JSON.stringify({ install: [] }) },
  ]) {
    const double = jspmDouble();
    const res = await double(GENERATE, init);
    assert.equal(res.status, 400, `expected a refusal for ${JSON.stringify(init.body ?? null)}`);
    assert.equal(double.unexpected.length, 1);
  }
});

test('generateCalls counts only generate calls, and counts them live', async () => {
  // It is a getter over a growing array. Assigning it with Object.assign would
  // snapshot the empty value at construction, which silently turns every
  // round-trip assertion in the vendor suite into `0 === 0`. That is not
  // hypothetical; it happened while building this.
  const double = jspmDouble();
  assert.equal(double.generateCalls.length, 0);
  const { map } = await (await generate(double, ['picocolors@1.1.1'])).json();
  assert.equal(double.generateCalls.length, 1);
  await double(map.imports.picocolors);
  assert.equal(double.generateCalls.length, 1, 'a bundle GET is not a generate call');
  assert.equal(double.calls.length, 2, 'but it is still a call');
});
