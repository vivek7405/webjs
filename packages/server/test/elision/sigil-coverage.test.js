/**
 * GUARD TEST for the elision analyser's template-sigil + static-field
 * coverage, the sibling of lifecycle-coverage.test.js.
 *
 * lifecycle-coverage introspects WebComponent.prototype and fails if a new
 * method ships without the analyser being taught about it. But two
 * interactivity surfaces are NOT prototype methods or named exports, so that
 * guard cannot see them:
 *
 *   1. Template binding sigils (`@` / `.` / `?`). A new client-behaviour sigil
 *      added to the renderers without teaching the analyser would let it
 *      wrongly elide a component whose only interactivity is that sigil, and
 *      the failure would be silent in production.
 *   2. Interactivity-signal static fields (`static shadow` / `static interactive`).
 *
 * This test makes that drift LOUD. The renderers' sigil set lives in core's
 * BINDING_PREFIXES (single source of truth); the analyser classifies each as a
 * ship signal (SSR_DROPPED_PREFIXES) or an SSR-safe round-trip
 * (ROUND_TRIP_PREFIXES). The partition assertion below fails the moment a sigil
 * is added to BINDING_PREFIXES without being classified, so the fix is forced:
 * decide whether the new sigil ships and add it to the matching analyser list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

/** The closed evidence set the report contract promises (#1308). */
const EVIDENCE = ['own', 'observed', 'closure', 'render', 'import', 'unreadable'];
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { BINDING_PREFIXES } from '../../../core/src/binding-prefixes.js';
import {
  analyzeComponentSource,
  SSR_DROPPED_PREFIXES,
  ROUND_TRIP_PREFIXES,
  INTERACTIVITY_STATIC_FIELDS,
} from '../../src/component-elision.js';

const here = dirname(fileURLToPath(import.meta.url));
const coreSrc = resolve(here, '../../../core/src');
/** The in-repo app that exercises every ship rule (#1308 evidence guard). */
const BLOG = resolve(here, '../../../../examples/blog');

/**
 * Pure partition check, reused so the counterfactual can prove it is sensitive:
 * `dropped` and `roundTrip` must together cover `prefixes` exactly, disjointly.
 */
function partitionGaps(prefixes, dropped, roundTrip) {
  const classified = new Set([...dropped, ...roundTrip]);
  const unclassified = prefixes.filter((p) => !classified.has(p));
  const overlap = dropped.filter((p) => roundTrip.includes(p));
  const stray = [...classified].filter((p) => !prefixes.includes(p));
  return { unclassified, overlap, stray };
}

test('every renderer binding sigil is classified by the analyser (partition)', () => {
  const prefixes = Object.keys(BINDING_PREFIXES);
  const { unclassified, overlap, stray } = partitionGaps(
    prefixes, SSR_DROPPED_PREFIXES, ROUND_TRIP_PREFIXES,
  );
  assert.deepEqual(unclassified, [],
    `binding sigil(s) ${JSON.stringify(unclassified)} are in core's BINDING_PREFIXES `
    + 'but not classified in component-elision.js. Add each to SSR_DROPPED_PREFIXES '
    + '(it drops at SSR / implies client work, so the component must ship) or '
    + 'ROUND_TRIP_PREFIXES (it survives into the served HTML, stays elidable).');
  assert.deepEqual(overlap, [], `sigil(s) ${JSON.stringify(overlap)} are in BOTH lists`);
  assert.deepEqual(stray, [],
    `sigil(s) ${JSON.stringify(stray)} are classified but not a renderer prefix`);
});

test('counterfactual: the partition check fires on an unclassified new sigil', () => {
  // A hypothetical new client-behaviour sigil `&` added to the renderers but
  // NOT classified in the analyser is exactly the silent over-elision this
  // guard exists to catch. Prove the check would red.
  const drifted = partitionGaps(['@', '.', '?', '&'], SSR_DROPPED_PREFIXES, ROUND_TRIP_PREFIXES);
  assert.deepEqual(drifted.unclassified, ['&']);
});

test('an SSR-dropped sigil is honoured as a ship signal', () => {
  for (const p of SSR_DROPPED_PREFIXES) {
    // `@event` is the canonical case; build a minimal display-only component
    // whose ONLY interactivity is a binding with this prefix.
    const src = `class C extends WebComponent({}) {
      render() { return html\`<button ${p}click=\${() => {}}>x</button>\`; }
    }`;
    const { interactive } = analyzeComponentSource(src);
    assert.equal(interactive, true,
      `a component using only the '${p}' binding must ship (it is an SSR-dropped client behaviour)`);
  }
});

test('a round-trip sigil does not force a component to ship', () => {
  for (const p of ROUND_TRIP_PREFIXES) {
    // `.prop` / `?bool` survive into SSR HTML, so they must NOT be ship signals
    // on their own: a component whose only non-render content is such a binding
    // stays elidable. This does not by itself prove ROUND_TRIP membership (the
    // partition test does), but it IS load-bearing against the misclassification
    // it guards: if `.` or `?` were moved into SSR_DROPPED_PREFIXES, the derived
    // EVENT_BINDING_RE would match this binding and flip the verdict to ship,
    // reding this test. Use a custom-element target so `.prop` is the
    // data-webjs-prop round-trip (not a dropped native prop), and a non-`on`
    // name so it is not EVENT_PROP_RE.
    const src = `class C extends WebComponent({}) {
      render() { return html\`<my-badge ${p}label=\${'x'}></my-badge>\`; }
    }`;
    const { interactive } = analyzeComponentSource(src);
    assert.equal(interactive, false,
      `a component using only the '${p}' (round-trip) binding should stay elidable`);
  }
});

test('the renderers route binding recognition through BINDING_PREFIXES (no stray literals)', () => {
  // Both renderers must consume the shared set, not re-hardcode a prefix. A
  // future hand-added `prefix === '<sigil>'` branch would bypass the single
  // source of truth and dodge the partition guard, so forbid it.
  // Each renderer is a barrel over a sibling directory, so read the barrel AND
  // every module under it: the import and any stray literal now live in the
  // sub-modules, and scanning only the barrel would make this guard vacuous.
  for (const file of ['render-client.js', 'render-server.js']) {
    const dir = resolve(coreSrc, file.replace(/\.js$/, ''));
    const parts = [resolve(coreSrc, file)];
    if (existsSync(dir)) {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isFile() && e.name.endsWith('.js')) parts.push(resolve(dir, e.name));
      }
    }
    const src = parts.map((p) => readFileSync(p, 'utf8')).join('\n');
    assert.match(src, /binding-prefixes\.js/, `${file} must import the shared BINDING_PREFIXES`);
    for (const p of Object.keys(BINDING_PREFIXES)) {
      const lit = `['"\`]\\${p}['"\`]`;
      // Forbid an `=== '<sigil>'` compare in EITHER operand order (`prefix ===
      // '@'` and the Yoda `'@' === prefix`), so a reintroduced hardcoded branch
      // cannot slip past on operand order.
      const stray = new RegExp(`(===\\s*${lit})|(${lit}\\s*===)`);
      assert.ok(!stray.test(src),
        `${file} hardcodes an \`=== '${p}'\` compare; route it through BINDING_PREFIXES instead`);
    }
  }
});

test('every interactivity static field is honoured as a ship signal with a reason', () => {
  for (const field of INTERACTIVITY_STATIC_FIELDS) {
    const src = `class C extends WebComponent({}) {
      static ${field} = true;
      render() { return html\`<div>x</div>\`; }
    }`;
    const { interactive, reason } = analyzeComponentSource(src);
    assert.equal(interactive, true, `static ${field} = true must force the component to ship`);
    // A field added to INTERACTIVITY_STATIC_FIELDS without a matching
    // STATIC_FIELD_REASONS entry would ship with reason `undefined` (a
    // diagnostics gap). Require a real reason so the registry and the reasons
    // map cannot drift apart.
    assert.equal(typeof reason, 'string', `static ${field} must carry a string reason, got ${reason}`);
    assert.ok(reason.length > 0, `static ${field} reason must be non-empty`);
  }
});

test('the interactivity static-field registry is the known set (change-detector)', () => {
  // A deliberate change-detector: there is no enumerable runtime source for
  // "all static conventions" (unlike prototype methods), so adding a new
  // interactivity static field must be a conscious edit here AND in
  // the skill's references/components.md. If this assertion fails because you added a real
  // convention, update both, then update this expected set.
  assert.deepEqual([...INTERACTIVITY_STATIC_FIELDS].sort(), ['interactive', 'shadow']);
});

test('every shipping component carries the evidence that forced it (#1308)', async () => {
  // The report names WHY each component ships, and that evidence is recorded
  // alongside every `mustShip.add` of a component file rather than derived
  // afterwards. A future rule that adds to `mustShip` without calling
  // `noteShip` would emit `evidence: null` for a real ship, which reads to a
  // consumer as "shipped, no idea why" and is exactly the kind of silent
  // diagnostics gap this file exists to make loud.
  //
  // Asserted over the blog corpus, which exercises every rule (own, observed,
  // closure, render, import) rather than a synthetic fixture that would only
  // cover the rules it was written for.
  const { analyzeAppElision } = await import('../../src/elision-report.js');
  const report = await analyzeAppElision(BLOG);
  assert.ok(report.analysed, 'precondition: the blog corpus is analysable');
  const shipped = report.components.filter((c) => c.verdict === 'shipped');
  assert.ok(shipped.length > 5, `precondition: the corpus ships components (got ${shipped.length})`);
  for (const c of shipped) {
    assert.ok(EVIDENCE.includes(c.evidence),
      `${c.file} ships with evidence ${JSON.stringify(c.evidence)}; every mustShip write must call noteShip with one of ${EVIDENCE.join(' / ')}`);
    assert.equal(typeof c.reason, 'string', `${c.file} ships with no reason string`);
    assert.ok(c.reason.length > 0, `${c.file} ships with an empty reason`);
  }
  // And the rules the corpus actually reaches must be more than one, so this
  // cannot pass by covering only the `own` case.
  assert.ok(new Set(shipped.map((c) => c.evidence)).size > 1, 'the corpus must exercise more than one ship rule');
});
