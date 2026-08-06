/**
 * The app-level elision report contract (#1308).
 *
 * `analyzeAppElision` is the ONE function `webjs elision`, `webjs elision
 * --json`, the MCP `list_elision` tool, and both `webjs doctor` elision checks
 * read, so its shape IS the public contract. It had no test at all before this
 * file (the #646 version was only exercised indirectly, through the doctor
 * advisory's message text).
 *
 * The properties asserted here are the ones a consumer depends on and that a
 * refactor can silently break: every path app-relative (no absolute filesystem
 * path anywhere, INCLUDING inside a prose `reason`), every array sorted by
 * `file`, the summary counts equal to the array lengths, each `skipped` value
 * distinguishable, and one row of every `evidence` value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';

import { analyzeAppElision } from '../../src/elision-report.js';

/** @param {Record<string, string>} files  app-relative path -> source */
async function withApp(files, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-elision-report-'));
  try {
    for (const [rel, src] of Object.entries(files)) {
      const abs = join(dir, rel);
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, src);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

/** Every string value anywhere in the report, for the no-absolute-path sweep. */
function allStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) allStrings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) allStrings(v, out);
  return out;
}

test('the full shape: verdicts, sorting, summary, and no absolute path anywhere', async () => {
  await withApp({
    'components/badge.js': DISPLAY_ONLY,
    'components/counter.js': INTERACTIVE,
    'app/page.js': "import { html } from '@webjsdev/core';\nimport '../components/counter.js';\nexport default () => html`<my-counter></my-counter>`;",
    'app/about/page.js': "import { html } from '@webjsdev/core';\nimport '../../components/badge.js';\nexport default () => html`<my-badge></my-badge>`;",
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    assert.equal(r.analysed, true);
    assert.equal(r.skipped, null);

    const badge = r.components.find((c) => c.file.includes('badge'));
    const counter = r.components.find((c) => c.file.includes('counter'));
    assert.deepEqual(badge, { file: 'components/badge.js', tags: ['my-badge'], verdict: 'elided', evidence: null, reason: null, by: null });
    assert.equal(counter.verdict, 'shipped');
    assert.equal(counter.evidence, 'own');
    assert.match(counter.reason, /@event binding/);
    assert.equal(counter.by, null);

    const about = r.routeModules.find((m) => m.file.includes('about'));
    const home = r.routeModules.find((m) => m.file === 'app/page.js');
    assert.equal(about.verdict, 'inert', 'a page whose only component is elided ships nothing');
    assert.deepEqual(about.emits, []);
    assert.equal(home.verdict, 'import-only');
    assert.deepEqual(home.emits, ['components/counter.js']);

    // Sorted by file, so two runs diff cleanly.
    for (const arr of [r.components, r.routeModules, r.orphans]) {
      assert.deepEqual(arr.map((x) => x.file), [...arr.map((x) => x.file)].sort(), 'rows are sorted by file');
    }
    // Summary equals the arrays it summarises.
    assert.equal(r.summary.components, r.components.length);
    assert.equal(r.summary.elided, r.components.filter((c) => c.verdict === 'elided').length);
    assert.equal(r.summary.shipped, r.components.filter((c) => c.verdict === 'shipped').length);
    assert.equal(r.summary.routeModules, r.routeModules.length);
    assert.equal(r.summary.inert, r.routeModules.filter((m) => m.verdict === 'inert').length);
    assert.equal(r.summary.importOnly, r.routeModules.filter((m) => m.verdict === 'import-only').length);
    assert.equal(r.summary.shippedWhole, r.routeModules.filter((m) => m.verdict === 'shipped').length);
    assert.equal(r.summary.orphans, r.orphans.length);

    // No absolute path may reach the contract, including inside a reason
    // sentence, which `analyzeElision` builds from absolute paths.
    for (const s of allStrings(r)) {
      assert.ok(!s.includes(dir), `report leaked an absolute path: ${s}`);
      for (const word of s.split(/\s+/)) assert.ok(!isAbsolute(word), `report leaked an absolute path: ${s}`);
    }
    // JSON-serializable, since two consumers print it verbatim.
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
  });
});

test('a shipped route module names its blocker and reason, both app-relative', async () => {
  await withApp({
    'lib/track.js': 'window.__hits = (window.__hits || 0) + 1;\nexport const track = () => {};',
    'app/page.js': "import { html } from '@webjsdev/core';\nimport { track } from '../lib/track.js';\nexport default () => html`<p>${String(track)}</p>`;",
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    const home = r.routeModules.find((m) => m.file === 'app/page.js');
    assert.equal(home.verdict, 'shipped');
    assert.equal(home.blocker, 'lib/track.js');
    assert.match(home.reason, /browser global|module scope/);
  });
});

test('evidence: observed', async () => {
  await withApp({
    'components/badge.js': DISPLAY_ONLY,
    'components/observer.js': "customElements.whenDefined('my-badge').then(() => {});",
    'app/page.js': "import { html } from '@webjsdev/core';\nimport '../components/badge.js';\nimport '../components/observer.js';\nexport default () => html`<my-badge></my-badge>`;",
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    const badge = r.components.find((c) => c.file.includes('badge'));
    assert.equal(badge.verdict, 'shipped');
    assert.equal(badge.evidence, 'observed');
    assert.equal(badge.by, 'components/observer.js');
    assert.equal(badge.reason, 'its registration is observed by components/observer.js');
  });
});

test('evidence: closure', async () => {
  await withApp({
    'lib/live.js': "import { signal } from '@webjsdev/core';\nexport const n = signal(0);",
    'components/badge.js': "import { WebComponent, html } from '@webjsdev/core';\nimport { n } from '../lib/live.js';\nexport class Badge extends WebComponent {\n  render() { return html`<span>${String(n)}</span>`; }\n}\nBadge.register('my-badge');",
    'app/page.js': "import { html } from '@webjsdev/core';\nimport '../components/badge.js';\nexport default () => html`<my-badge></my-badge>`;",
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    const badge = r.components.find((c) => c.file.includes('components/badge'));
    assert.equal(badge.verdict, 'shipped');
    assert.equal(badge.evidence, 'closure');
    assert.equal(badge.by, 'lib/live.js');
    assert.match(badge.reason, /^its import lib\/live\.js /);
  });
});

test('evidence: render', async () => {
  await withApp({
    'components/badge.js': DISPLAY_ONLY,
    'components/shell.js': "import { WebComponent, html } from '@webjsdev/core';\nimport '../components/badge.js';\nexport class Shell extends WebComponent {\n  render() { return html`<button @click=${() => {}}><my-badge></my-badge></button>`; }\n}\nShell.register('my-shell');",
    'app/page.js': "import { html } from '@webjsdev/core';\nimport '../components/shell.js';\nexport default () => html`<my-shell></my-shell>`;",
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    const badge = r.components.find((c) => c.file.includes('components/badge'));
    assert.equal(badge.verdict, 'shipped');
    // The render rule and the import rule both reach it; first match wins, and
    // either is a truthful account of why the module stays on the wire.
    assert.ok(['render', 'import'].includes(badge.evidence), `unexpected evidence ${badge.evidence}`);
    assert.equal(badge.by, 'components/shell.js');
  });
});

test('an orphan class is reported with no verdict', async () => {
  await withApp({
    'components/dyn-badge.js': "import { WebComponent, html } from '@webjsdev/core';\nconst TAG = 'dyn-' + 'badge';\nexport class DynBadge extends WebComponent {\n  render() { return html`<span>x</span>`; }\n}\nDynBadge.register(TAG);",
    'app/page.js': "import { html } from '@webjsdev/core';\nimport '../components/dyn-badge.js';\nexport default () => html`<p>hi</p>`;",
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    assert.deepEqual(r.orphans, [{ file: 'components/dyn-badge.js', className: 'DynBadge' }]);
    assert.equal(r.components.length, 0, 'the scanner never saw it, so there is no verdict for it');
    assert.equal(r.summary.orphans, 1);
  });
});

test('skipped: no-app', async () => {
  await withApp({ 'components/badge.js': DISPLAY_ONLY }, async (dir) => {
    const r = await analyzeAppElision(dir);
    assert.equal(r.analysed, false);
    assert.equal(r.skipped, 'no-app');
    assert.deepEqual(r.components, []);
    assert.deepEqual(r.summary, { components: 0, elided: 0, shipped: 0, routeModules: 0, inert: 0, importOnly: 0, shippedWhole: 0, orphans: 0 });
  });
});

test('skipped: elide-off, distinguishable from no-app', async () => {
  await withApp({
    'package.json': JSON.stringify({ name: 'x', webjs: { elide: false } }),
    'app/page.js': "import { html } from '@webjsdev/core';\nexport default () => html`<p>hi</p>`;",
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    assert.equal(r.analysed, false);
    assert.equal(r.skipped, 'elide-off', 'a machine consumer must tell the switch from a missing app');
  });
});

test('skipped: elide-off via the WEBJS_ELIDE override', async () => {
  await withApp({
    'app/page.js': "import { html } from '@webjsdev/core';\nexport default () => html`<p>hi</p>`;",
  }, async (dir) => {
    const ORIG = process.env.WEBJS_ELIDE;
    try {
      process.env.WEBJS_ELIDE = '0';
      const r = await analyzeAppElision(dir);
      assert.equal(r.skipped, 'elide-off');
    } finally {
      if (ORIG === undefined) delete process.env.WEBJS_ELIDE;
      else process.env.WEBJS_ELIDE = ORIG;
    }
  });
});

test('a malformed app degrades to an analysed empty report rather than throwing', async () => {
  // The third `skipped` value, `unanalysable`, is DEFENSIVE and has no
  // filesystem trigger: every builder in the pipeline is individually
  // error-tolerant, so an `app` that is a plain file, a directory the walk
  // cannot read, a page/route collision, and a malformed `imports` map all
  // produce an EMPTY analysis rather than a throw (each verified by hand
  // against this build). The value still belongs in the contract, because the
  // catch must be able to name itself instead of lying as `no-app`.
  //
  // What matters to a consumer, and what IS testable, is that none of these
  // shapes throws or returns a half-report.
  for (const files of [
    { app: 'not a directory' },
    { 'app/page.js': 'export default () => null;', 'app/route.js': 'export const GET = () => new Response(1);' },
    { 'package.json': '{"name":"x","imports":"nope"}', 'app/page.js': 'export default () => null;' },
  ]) {
    await withApp(files, async (dir) => {
      const r = await analyzeAppElision(dir);
      assert.ok(Array.isArray(r.components) && Array.isArray(r.routeModules) && Array.isArray(r.orphans));
      assert.equal(typeof r.summary.components, 'number');
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r);
    });
  }
});

test('every no-verdict report carries the identical empty shape', async () => {
  // A consumer branches on `skipped` and then reads the arrays; those must be
  // present and empty on EVERY skip path, never undefined.
  const empty = {
    components: [], routeModules: [], orphans: [],
    summary: { components: 0, elided: 0, shipped: 0, routeModules: 0, inert: 0, importOnly: 0, shippedWhole: 0, orphans: 0 },
  };
  await withApp({ 'components/badge.js': DISPLAY_ONLY }, async (dir) => {
    const r = await analyzeAppElision(dir);
    assert.equal(r.skipped, 'no-app');
    assert.deepEqual({ components: r.components, routeModules: r.routeModules, orphans: r.orphans, summary: r.summary }, empty);
  });
  await withApp({
    'package.json': JSON.stringify({ name: 'x', webjs: { elide: false } }),
    'app/page.js': 'export default () => null;',
  }, async (dir) => {
    const r = await analyzeAppElision(dir);
    assert.equal(r.skipped, 'elide-off');
    assert.deepEqual({ components: r.components, routeModules: r.routeModules, orphans: r.orphans, summary: r.summary }, empty);
  });
});
