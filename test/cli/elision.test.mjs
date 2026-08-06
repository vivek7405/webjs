/**
 * Tests for `webjs elision` (#1308): the elision-verdict printer and its
 * app-level differential.
 *
 * Two layers, the same split `routes.test.mjs` uses:
 *   - `analyzeAppElision(appDir)` against tmp fixture apps, so the verdict is
 *     asserted without spawning anything.
 *   - The CLI integration: spawn the binary and assert the human report, the
 *     `--json` contract (which MUST equal the direct call, since the MCP
 *     `list_elision` tool returns the same object), and every `--verify` exit
 *     path INCLUDING the vacuous one, because a verification command that can
 *     pass while comparing nothing is worse than no command at all.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..');
const CLI = resolve(REPO, 'packages', 'cli', 'bin', 'webjs.js');

const { analyzeAppElision } = await import('@webjsdev/server');

const cleanup = [];
after(() => { for (const d of cleanup) rmSync(d, { recursive: true, force: true }); });

function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'elision-cli-'));
  cleanup.push(dir);
  return dir;
}

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/**
 * `--verify` boots two REAL request handlers over the fixture, so unlike the
 * report path the fixture has to resolve `@webjsdev/core` from its own tree.
 * A tmp dir outside the repo resolves nothing, so link the repo's modules in.
 */
function linkFramework(dir) {
  symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'dir');
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI, 'elision', ...args], { cwd, encoding: 'utf8' });
}

const DISPLAY_ONLY = `
import { WebComponent, html } from '@webjsdev/core';
export class Badge extends WebComponent {
  render() { return html\`<span>verified</span>\`; }
}
Badge.register('my-badge');
`;

const INTERACTIVE = `
import { WebComponent, html } from '@webjsdev/core';
export class Counter extends WebComponent {
  render() { return html\`<button @click=\${() => {}}>+</button>\`; }
}
Counter.register('my-counter');
`;

/** One elided component, one shipped, one inert page, one import-only page. */
function fixtureApp() {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'fx', type: 'module' }));
  write(dir, 'components/badge.js', DISPLAY_ONLY);
  write(dir, 'components/counter.js', INTERACTIVE);
  write(dir, 'app/about/page.js', "import { html } from '@webjsdev/core';\nimport '../../components/badge.js';\nexport default () => html`<my-badge></my-badge>`;");
  write(dir, 'app/page.js', "import { html } from '@webjsdev/core';\nimport '../components/counter.js';\nexport default () => html`<my-counter></my-counter>`;");
  linkFramework(dir);
  return dir;
}

// ---------------------------------------------------------------------------
// The analysis, direct.
// ---------------------------------------------------------------------------

test('analyzeAppElision reports both verdicts and both route classes', async () => {
  const r = await analyzeAppElision(fixtureApp());
  assert.equal(r.analysed, true);
  assert.deepEqual(
    r.components.map((c) => [c.file, c.verdict]),
    [['components/badge.js', 'elided'], ['components/counter.js', 'shipped']],
  );
  assert.deepEqual(
    r.routeModules.map((m) => [m.file, m.verdict]),
    [['app/about/page.js', 'inert'], ['app/page.js', 'import-only']],
  );
});

// ---------------------------------------------------------------------------
// CLI: the report.
// ---------------------------------------------------------------------------

test('webjs elision --json equals the direct analyzeAppElision call', async () => {
  const dir = fixtureApp();
  const r = runCli(dir, ['--json']);
  assert.equal(r.status, 0, r.stderr);
  // The byte-identity contract: the MCP `list_elision` tool returns this same
  // object, so the two surfaces can never disagree about an app.
  assert.deepEqual(JSON.parse(r.stdout), JSON.parse(JSON.stringify(await analyzeAppElision(dir))));
});

test('webjs elision names the elided component, the ship reason, and the route classes', () => {
  const r = runCli(fixtureApp(), []);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Elided components/);
  assert.match(r.stdout, /components\/badge\.js\s+my-badge/);
  assert.match(r.stdout, /Shipped components/);
  assert.match(r.stdout, /components\/counter\.js.*own: template has an @event binding/);
  assert.match(r.stdout, /inert\s+app\/about\/page\.js/);
  assert.match(r.stdout, /import-only\s+app\/page\.js\s+emits components\/counter\.js/);
});

test('webjs elision lists an orphan under its own heading', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'fx', type: 'module' }));
  write(dir, 'components/dyn.js', "import { WebComponent, html } from '@webjsdev/core';\nconst TAG = 'dyn-' + 'badge';\nexport class DynBadge extends WebComponent {\n  render() { return html`<span>x</span>`; }\n}\nDynBadge.register(TAG);");
  write(dir, 'app/page.js', "import { html } from '@webjsdev/core';\nimport '../components/dyn.js';\nexport default () => html`<p>hi</p>`;");
  const r = runCli(dir, []);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Orphan components/);
  assert.match(r.stdout, /DynBadge in components\/dyn\.js/);
  assert.match(r.stdout, /static interactive = true. cannot rescue/);
});

test('webjs elision names WHY it analysed nothing', () => {
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'fx', type: 'module' }));
  assert.match(runCli(dir, []).stdout, /no app\/ directory/);

  const off = fixtureApp();
  write(off, 'package.json', JSON.stringify({ name: 'fx', type: 'module', webjs: { elide: false } }));
  assert.match(runCli(off, []).stdout, /elision is disabled/);
});

// ---------------------------------------------------------------------------
// CLI: --verify.
// ---------------------------------------------------------------------------

test('webjs elision --verify passes on a static app and prints the post-hydration caveat', () => {
  const r = runCli(fixtureApp(), ['--verify']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 route\(s\) identical with elision on vs off/);
  // The boundary must be stated by the COMMAND, not only by the docs: this is
  // the half of the guarantee --verify cannot see.
  assert.match(r.stdout, /does NOT prove\s+post-hydration behaviour/);
  assert.match(r.stdout, /WEBJS_ELIDE=0 <your e2e command>/);
});

test('webjs elision --verify reports dynamic routes as skipped by name', () => {
  const dir = fixtureApp();
  write(dir, 'app/blog/[slug]/page.js', "import { html } from '@webjsdev/core';\nexport default () => html`<p>post</p>`;");
  const r = runCli(dir, ['--verify']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /skipped \(dynamic: \/blog\/\[slug\]\)/);
});

test('webjs elision --verify exits 1 when NOTHING could be compared (a vacuous pass is a failure)', () => {
  // An app whose only page is dynamic has an empty static corpus. Reporting
  // "identical" over zero routes would be a lie of omission, so this is the
  // one posture a verification command must get right.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'fx', type: 'module' }));
  write(dir, 'app/blog/[slug]/page.js', "import { html } from '@webjsdev/core';\nexport default () => html`<p>post</p>`;");
  linkFramework(dir);
  const r = runCli(dir, ['--verify']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /nothing was compared/);
  assert.match(r.stderr, /--routes/);
});

test('webjs elision --verify --routes adds a path outside the static set', () => {
  const dir = fixtureApp();
  write(dir, 'app/blog/[slug]/page.js', "import { html } from '@webjsdev/core';\nexport default ({ params }) => html`<p>post ${params.slug}</p>`;");
  const r = runCli(dir, ['--verify', '--routes', '/blog/hello']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 route\(s\) identical/, 'the named dynamic path joins the corpus');
});

test('webjs elision --verify FAILS on a --routes path that does not render', () => {
  // A path the author named explicitly is required to render; silently
  // counting it as a skip would let a typo look like a passing run.
  const r = runCli(fixtureApp(), ['--verify', '--routes', '/nope']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /\/nope \(404\): a --routes path must render/);
});

test('webjs elision --verify forces elision ON, so an opted-out app still gets a real comparison', () => {
  // Deleting WEBJS_ELIDE only falls back to `webjs.elide`, so on an app that
  // opts out BOTH handlers would run with elision off, the two renders would be
  // identical by construction, and the command would report the routes
  // "identical with elision on vs off" and exit 0. That is a confident pass on a
  // run where elision was never on, which is worse than the zero-route vacuity
  // the exit code already guards. The env override wins over the config key,
  // which is what makes it the right seam.
  const dir = fixtureApp();
  write(dir, 'package.json', JSON.stringify({ name: 'fx', type: 'module', webjs: { elide: false } }));
  const r = runCli(dir, ['--verify']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /2 route\(s\) identical/);
  assert.match(r.stdout, /Elision dropped [1-9]\d* module\(s\)/,
    'the ON side must really have elided something, or the comparison was two identical renders');
});

test('webjs elision --verify says so when elision dropped nothing', () => {
  // A corpus where every component carries a client-work signal compares two
  // identical renders. That is a true pass and it must not fail, but reading it
  // as proof elision was exercised would be wrong, so the run says which it is.
  // Both the component AND the page must ship: an interactive component alone
  // still leaves the PAGE import-only, and dropping the page module from the
  // boot is itself something elision removed from the wire.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'fx', type: 'module' }));
  write(dir, 'components/counter.js', INTERACTIVE);
  write(dir, 'lib/track.js', "if (typeof window !== 'undefined') { window.__hits = 1; }\nexport const track = () => {};");
  write(dir, 'app/page.js', "import { html } from '@webjsdev/core';\nimport '../components/counter.js';\nimport { track } from '../lib/track.js';\nexport default () => html`<my-counter></my-counter><span>${String(track)}</span>`;");
  linkFramework(dir);
  const r = runCli(dir, ['--verify']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Elision dropped NO modules/);
  assert.match(r.stdout, /nothing on these routes was elidable/);
  // Exit 0 is deliberate. The command's question is whether elision changed the
  // bytes this app serves, and "it dropped nothing" answers that truthfully.
  // That is NOT the zero-route vacuity above, where the question was never
  // asked and the author has a remedy (--routes); failing here would put a
  // permanent red on a legitimate app whose every module ships, with nothing
  // its author could do but delete the command from CI.
});

test('webjs elision --verify FAILS when elision changes the served bytes', () => {
  // The divergence path, driven for real rather than stubbed. The page renders
  // a tag whose module is elided ON and shipped OFF, and the component's SSR
  // output differs between those two states, because it reads the flag itself.
  // That is exactly the class of bug the differential exists to catch: a
  // component whose rendered output is not independent of its own elision.
  const dir = tmpDir();
  write(dir, 'package.json', JSON.stringify({ name: 'fx', type: 'module' }));
  write(dir, 'components/leaky.js', `
import { WebComponent, html } from '@webjsdev/core';
export class Leaky extends WebComponent {
  render() { return html\`<span>\${process.env.WEBJS_ELIDE === '0' ? 'off' : 'on'}</span>\`; }
}
Leaky.register('leaky-badge');
`);
  write(dir, 'app/page.js', "import { html } from '@webjsdev/core';\nimport '../components/leaky.js';\nexport default () => html`<leaky-badge></leaky-badge>`;");
  linkFramework(dir);
  const r = runCli(dir, ['--verify']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /elision changed observable output/);
  assert.match(r.stderr, /diverged out of 1 compared/);
});
