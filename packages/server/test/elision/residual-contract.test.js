/**
 * The documented elision RESIDUALS, and the one case that looks like a
 * residual but is not (#1308).
 *
 * `packages/server/AGENTS.md` invariant 7 and the skill's
 * `references/components.md` both promise that `static interactive = true`
 * rescues the interactivity static analysis cannot see. Until now that promise
 * was prose: nothing asserted any residual, so a change in either direction
 * (the analyser learning to see one, or the escape hatch quietly ceasing to
 * work) was invisible. Every residual the docs name gets a case here, paired
 * with its rescue, and the LAST test in this file enforces that link
 * mechanically: it fails when a surface that enumerates the residuals stops
 * naming one. Without it the claim would be an assertion about my own
 * diligence, which is exactly how a residual got documented without a case.
 *
 * These tests build a REAL app on disk and drive `buildModuleGraph` +
 * `scanComponents` + `analyzeElision`, rather than the faked-graph helper the
 * sibling route-elision tests use. That is load-bearing for residual (b),
 * which is precisely about a file that is NOT in the module graph: against a
 * faked graph the assertion would be vacuous.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildModuleGraph } from '../../src/module-graph.js';
import { scanComponents, findOrphanComponents } from '../../src/component-scanner.js';
import { analyzeElision } from '../../src/component-elision.js';

/** A display-only badge: static markup, no events, no props, no hooks, light DOM. */
const badge = (extra = '') => `
import { WebComponent, html } from '@webjsdev/core';
export class Badge extends WebComponent {
  ${extra}
  render() { return html\`<span class="badge">verified</span>\`; }
}
Badge.register('my-badge');
`;

/** The same badge with a COMPUTED registration tag (invariant 3 forbids this). */
const badgeComputedRegistration = (extra = '') => `
import { WebComponent, html } from '@webjsdev/core';
const TAG = 'my-' + 'badge';
export class Badge extends WebComponent {
  ${extra}
  render() { return html\`<span class="badge">verified</span>\`; }
}
Badge.register(TAG);
`;

/**
 * An interactive component, as a template literal rather than a plain string.
 * The scanner-fuzz corpus sweep reads every file under `test/elision`.
 * `redactStringsAndTemplates` keeps a plain-string body VERBATIM, so the
 * embedded html-template BACKTICK survives into the mask, `matchClosingBrace`
 * returns -1, and the class-body extractor yields 0 bodies against 1
 * name-window match. That internal count assert THROWS, the corpus test's
 * try/catch pushes the throw into `misses`, and `misses` is asserted, so the
 * suite FAILS. A bare over-match would be fine (that direction is explicitly
 * accepted); this is a count mismatch, which is not the same thing. Verified
 * both by reverting a fixture and by an independent check.
 */
const INTERACTIVE_COUNTER = `
import { WebComponent, html } from '@webjsdev/core';
export class Counter extends WebComponent {
  render() { return html\`<button @click=\${() => {}}>+</button>\`; }
}
Counter.register('my-counter');
`;

const PAGE = `
import { html } from '@webjsdev/core';
import '../components/badge.js';
export default () => html\`<my-badge></my-badge>\`;
`;

/**
 * Write a throwaway app, run the real pipeline over it, and return the verdict
 * plus the absolute paths the assertions key on.
 * @param {{ badgeSrc: string, observerSrc?: string, css?: string }} spec
 */
async function analyseApp(spec) {
  const dir = await mkdtemp(join(tmpdir(), 'webjs-residual-'));
  try {
    await mkdir(join(dir, 'app'), { recursive: true });
    await mkdir(join(dir, 'components'), { recursive: true });
    await writeFile(join(dir, 'components/badge.js'), spec.badgeSrc);
    let page = PAGE;
    if (spec.observerSrc) {
      await writeFile(join(dir, 'components/observer.js'), spec.observerSrc);
      page = page.replace("import '../components/badge.js';", "import '../components/badge.js';\nimport '../components/observer.js';");
    }
    if (spec.css) {
      await mkdir(join(dir, 'public'), { recursive: true });
      await writeFile(join(dir, 'public/app.css'), spec.css);
    }
    await writeFile(join(dir, 'app/page.js'), page);

    const graph = await buildModuleGraph(dir);
    const components = await scanComponents(dir);
    const pageFile = join(dir, 'app/page.js');
    const badgeFile = join(dir, 'components/badge.js');
    const verdict = await analyzeElision(
      components, [pageFile], graph, (f) => import('node:fs/promises').then((m) => m.readFile(f, 'utf8')), dir,
    );
    return { dir, components, verdict, pageFile, badgeFile, orphans: await findOrphanComponents(dir) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Control: observation the analyser CAN see
// ---------------------------------------------------------------------------

test('control: a LITERAL whenDefined observer keeps the badge shipped', async () => {
  const { verdict, badgeFile } = await analyseApp({
    badgeSrc: badge(),
    observerSrc: "customElements.whenDefined('my-badge').then(() => {});",
  });
  assert.ok(!verdict.elidableComponents.has(badgeFile), 'a literally-observed badge must ship');
  assert.equal(verdict.componentVerdicts.get(badgeFile).evidence, 'observed');
});

// ---------------------------------------------------------------------------
// Residual (a): the OBSERVER computes the tag it waits for
// ---------------------------------------------------------------------------

test('residual (a): a COMPUTED whenDefined tag leaves the badge elided', async () => {
  // WHEN_DEFINED_RE reads a literal tag out of the observer's source. A
  // variable does not match, so the observation is invisible and the badge is
  // elided, which means its `register` never runs and the observer's await
  // never settles. Asserted as the documented limitation, so a change in
  // EITHER direction is visible rather than silent.
  const { verdict, badgeFile } = await analyseApp({
    badgeSrc: badge(),
    observerSrc: "const TAG = 'my-' + 'badge';\ncustomElements.whenDefined(TAG).then(() => {});",
  });
  assert.ok(verdict.elidableComponents.has(badgeFile), 'the computed observation is invisible to the analyser');
  const row = verdict.componentVerdicts.get(badgeFile);
  assert.equal(row.shipped, false);
  assert.equal(row.evidence, null, 'an elided component reports no evidence');
  assert.equal(row.reason, null, 'elision is the absence of every signal, so there is no reason to give');
});

test('residual (a) rescue: static interactive = true ships the badge anyway', async () => {
  const { verdict, badgeFile } = await analyseApp({
    badgeSrc: badge('static interactive = true;'),
    observerSrc: "const TAG = 'my-' + 'badge';\ncustomElements.whenDefined(TAG).then(() => {});",
  });
  assert.ok(!verdict.elidableComponents.has(badgeFile), 'the override must force the ship');
  const row = verdict.componentVerdicts.get(badgeFile);
  assert.equal(row.evidence, 'own');
  assert.match(row.reason, /static interactive/);
});

// ---------------------------------------------------------------------------
// Residual (b): a :defined rule in an EXTERNAL stylesheet
// ---------------------------------------------------------------------------

test('residual (b): an external-stylesheet :defined rule leaves the badge elided and the page inert', async () => {
  // TAG_DEFINED_RE only scans graph-reachable MODULE source, and a
  // `public/app.css` is not in the module graph at all, so the rule is
  // invisible. The badge is elided AND the page becomes inert, which drops
  // both modules from the boot entirely.
  const { verdict, badgeFile, pageFile } = await analyseApp({
    badgeSrc: badge(),
    css: 'my-badge:defined { opacity: 1 }',
  });
  assert.ok(verdict.elidableComponents.has(badgeFile), 'an external stylesheet is outside the module graph');
  assert.ok(verdict.inertRouteModules.has(pageFile), 'with its only component elided the page is inert');
});

test('residual (b) rescue: static interactive = true ships the badge and makes the page import-only', async () => {
  const { verdict, badgeFile, pageFile } = await analyseApp({
    badgeSrc: badge('static interactive = true;'),
    css: 'my-badge:defined { opacity: 1 }',
  });
  assert.ok(!verdict.elidableComponents.has(badgeFile), 'the override must force the ship');
  assert.ok(!verdict.inertRouteModules.has(pageFile), 'a shipping component reclassifies the page');
  assert.deepEqual(verdict.importOnlyRouteModules.get(pageFile), [badgeFile]);
});

// ---------------------------------------------------------------------------
// Residual (c): a consumer reaching the element through a STRING SELECTOR
// ---------------------------------------------------------------------------

/** A consumer that finds the element by selector rather than by tag reference. */
const SELECTOR_CONSUMER = `
document.querySelectorAll('my-badge').forEach((el) => el.setAttribute('data-seen', '1'));
`;

test('residual (c): a string-selector consumer leaves the badge elided', async () => {
  // The analyser detects cross-module observation through `whenDefined`,
  // `:defined`, and `instanceof`. A consumer that reaches the element with
  // `document.querySelectorAll('my-badge')` matches none of the three, so the
  // badge is elided, its module never loads, and the consumer finds an
  // un-upgraded element. Asserted as the documented limitation.
  const { verdict, badgeFile } = await analyseApp({
    badgeSrc: badge(),
    observerSrc: SELECTOR_CONSUMER,
  });
  assert.ok(verdict.elidableComponents.has(badgeFile),
    'a string selector is not one of the three observation forms the analyser matches');
});

test('residual (c) rescue: static interactive = true ships the badge anyway', async () => {
  const { verdict, badgeFile } = await analyseApp({
    badgeSrc: badge('static interactive = true;'),
    observerSrc: SELECTOR_CONSUMER,
  });
  assert.ok(!verdict.elidableComponents.has(badgeFile), 'the override must force the ship');
  const row = verdict.componentVerdicts.get(badgeFile);
  assert.equal(row.evidence, 'own');
  assert.match(row.reason, /static interactive/);
});

// ---------------------------------------------------------------------------
// NOT a residual: a computed REGISTRATION tag, which the override cannot reach
// ---------------------------------------------------------------------------

test('a computed Class.register(tag) is invisible to the SCANNER, so it gets no verdict at all', async () => {
  // `scanComponents` requires a literal tag (invariant 3 already does too), so
  // this component never enters the component set. `analyzeComponentSource` is
  // never consulted for it, the page sees only a `register(...)` call (which
  // hasModuleScopeSideEffect explicitly exempts) and is classified INERT, so
  // both modules are dropped and the element silently never registers.
  const { components, verdict, pageFile, badgeFile, orphans } = await analyseApp({
    badgeSrc: badgeComputedRegistration(),
  });
  assert.deepEqual(components, [], 'the scanner sees no component');
  assert.equal(verdict.componentVerdicts.size, 0, 'no component means no verdict to report');
  assert.ok(verdict.inertRouteModules.has(pageFile), 'the page is classified inert');
  assert.deepEqual(orphans, [{ className: 'Badge', file: badgeFile }], 'it surfaces as an ORPHAN instead');
});

test('a computed-tag component still REGISTERS when its importer ships (#1308)', async () => {
  // The two orphan shapes fail differently, and the docs used to claim both
  // "never upgrade". Not so: a computed tag is invisible to the SCANNER, but
  // `Badge.register(TAG)` is ordinary code that runs whenever the module
  // reaches the browser. Here the page ships whole for its own reason, so the
  // page module is emitted AND keeps its import of the component, which means
  // the element does upgrade. What is genuinely lost either way is the
  // verdict, the registry entry, and the preload hint.
  //
  // The inert-page case (the test above) is the one where the claim holds,
  // because the page is dropped and the import goes with it.
  const dir = await mkdtemp(join(tmpdir(), 'webjs-residual-upgrade-'));
  try {
    await mkdir(join(dir, 'app'), { recursive: true });
    await mkdir(join(dir, 'components'), { recursive: true });
    await mkdir(join(dir, 'lib'), { recursive: true });
    await writeFile(join(dir, 'components/badge.js'), badgeComputedRegistration());
    // Client-effecting at module scope, so the PAGE ships whole.
    await writeFile(join(dir, 'lib/track.js'),
      "if (typeof window !== 'undefined') { window.__hits = 1; }\nexport const track = () => {};\n");
    await writeFile(join(dir, 'app/page.js'),
      "import { html } from '@webjsdev/core';\nimport '../components/badge.js';\n" +
      "import { track } from '../lib/track.js';\nexport default () => html`<my-badge></my-badge>${String(track)}`;\n");

    const graph = await buildModuleGraph(dir);
    const components = await scanComponents(dir);
    const pageFile = join(dir, 'app/page.js');
    const verdict = await analyzeElision(
      components, [pageFile], graph, (f) => import('node:fs/promises').then((m) => m.readFile(f, 'utf8')), dir,
    );
    assert.deepEqual(components, [], 'still invisible to the scanner');
    assert.ok(!verdict.inertRouteModules.has(pageFile), 'the page is NOT inert here');
    assert.ok(verdict.shippedRouteModules.has(pageFile),
      'the page ships whole, so its import of the component survives and the registration runs');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an IMPORT-ONLY importer drops the computed-tag orphan, the ordinary case (#1308)', async () => {
  // The third importer verdict, and the one an author actually hits: a page
  // mixing one interactive component with a computed-tag orphan. The orphan is
  // not in `componentFiles`, so it never joins the import-only frontier, and
  // the boot emits only the frontier in the page module's place. The page's
  // import of the orphan goes with the dropped page module, so `register(TAG)`
  // never runs.
  //
  // This is what makes "only when its importer ships WHOLE" the right rule:
  // enumerating the losing verdicts is how import-only got missed.
  const dir = await mkdtemp(join(tmpdir(), 'webjs-residual-importonly-'));
  try {
    await mkdir(join(dir, 'app'), { recursive: true });
    await mkdir(join(dir, 'components'), { recursive: true });
    await writeFile(join(dir, 'components/badge.js'), badgeComputedRegistration());
    await writeFile(join(dir, 'components/counter.js'), INTERACTIVE_COUNTER);
    await writeFile(join(dir, 'app/page.js'),
      "import { html } from '@webjsdev/core';\nimport '../components/counter.js';\n" +
      "import '../components/badge.js';\nexport default () => html`<my-counter></my-counter><my-badge></my-badge>`;\n");

    const graph = await buildModuleGraph(dir);
    const components = await scanComponents(dir);
    const pageFile = join(dir, 'app/page.js');
    const verdict = await analyzeElision(
      components, [pageFile], graph, (f) => import('node:fs/promises').then((m) => m.readFile(f, 'utf8')), dir,
    );
    const emits = verdict.importOnlyRouteModules.get(pageFile);
    assert.ok(emits, 'the page is import-only, not shipped whole');
    assert.deepEqual(emits, [join(dir, 'components/counter.js')],
      'only the real component is emitted; the orphan is not in the frontier, so its import is dropped');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('static interactive = true does NOT rescue a computed registration tag', async () => {
  // The measured finding the docs used to get wrong: the override is a
  // property the ANALYSER reads, and nothing consults the analyser for a
  // component the scanner never saw. Adding it changes nothing.
  const { components, verdict, pageFile, orphans } = await analyseApp({
    badgeSrc: badgeComputedRegistration('static interactive = true;'),
  });
  assert.deepEqual(components, [], 'still invisible to the scanner');
  assert.equal(verdict.componentVerdicts.size, 0, 'still no verdict');
  assert.ok(verdict.inertRouteModules.has(pageFile), 'the page is still inert, so the module is still dropped');
  assert.equal(orphans.length, 1, 'still an orphan');
});

// ---------------------------------------------------------------------------
// The docs-to-behaviour link, enforced rather than promised
// ---------------------------------------------------------------------------

test('every surface that enumerates the residuals names all three', async () => {
  // The residual list is repeated across the framework docs, the agent skill,
  // the docs site, and two hover-doc type declarations, and it drifted
  // repeatedly while this feature was built: a third residual was added and
  // six of eight surfaces were updated, twice, in different combinations.
  //
  // Enumerating them by eye does not work, so this asserts it. Each surface is
  // matched from its OBSERVER clause forward, which is the phrase every copy of
  // the list opens with; the window is wide enough for the bullet-list forms.
  // A surface that stops naming one, or a NEW surface that copies the list and
  // is not added here, is the drift this catches.
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const repo = fileURLToPath(new URL('../../../../', import.meta.url));
  const SURFACES = [
    'AGENTS.md',
    'packages/server/AGENTS.md',
    'packages/server/src/component-elision.js',
    'packages/core/src/component.d.ts',
    '.agents/skills/webjs/references/components.md',
    'website/app/docs/elision/page.ts',
    'website/app/docs/data-fetching/page.ts',
    'website/app/docs/progressive-enhancement/page.ts',
  ];
  const missing = [];
  for (const rel of SURFACES) {
    const flat = (await readFile(repo + rel, 'utf8')).replace(/\s+/g, ' ');
    const at = flat.indexOf('computes the tag it waits for');
    if (at < 0) { missing.push(`${rel}: no residual list found at all`); continue; }
    const win = flat.slice(at, at + 900);
    if (!win.includes('external stylesheet')) missing.push(`${rel}: omits the external-stylesheet residual`);
    if (!/string selector|querySelector/.test(win)) missing.push(`${rel}: omits the string-selector residual`);
  }
  assert.deepEqual(missing, [],
    `these surfaces enumerate the elision residuals but not all three:\n  ${missing.join('\n  ')}`);
});
