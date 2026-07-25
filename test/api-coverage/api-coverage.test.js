// API docs + test coverage gate (tier-2, un-skippable CI enforcement).
//
// Types are already gated (test/types/dts-export-coverage.test.mjs: every export
// is typed) and demos are gated (the scaffold gate). This adds the two remaining
// coverage dimensions for the public API surface:
//
//   1. DOCS coverage: every agent-facing @webjsdev/core + @webjsdev/server export
//      is mentioned in a doc (AGENTS.md, the skill references, or the docs site).
//   2. TEST coverage: every agent-facing export is referenced by a test file.
//
// "Agent-facing" = NOT classified `internal:` in the scaffold manifest
// (test/scaffolds/gallery-coverage.json), which is the single source of truth for
// what is framework plumbing vs an API an app author writes. So an export marked
// internal there is automatically exempt here too; this file only carries the few
// extra exemptions (aliases documented/tested under a canonical name).
//
// A new public export that ships undocumented or untested turns CI red. The
// corpus checks are word-boundary greps (a rare new name with zero doc/test
// mention is the signal; common names trivially pass because they are everywhere).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as core from '@webjsdev/core';
import * as server from '@webjsdev/server';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const SCAFFOLD_MANIFEST = JSON.parse(readFileSync(join(REPO, 'test', 'scaffolds', 'gallery-coverage.json'), 'utf8'));
const EXEMPT = JSON.parse(readFileSync(join(__dirname, 'api-coverage.json'), 'utf8'));

function isInternal(name, section) {
  const e = (SCAFFOLD_MANIFEST[section] || {})[name];
  return !!(e && typeof e.exempt === 'string' && e.exempt.startsWith('internal:'));
}

function readAll(dir, exts, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const f = join(dir, e.name);
    // Exclude the coverage gate's OWN files so an export name hardcoded in a
    // counterfactual (e.g. 'html', 'signal') does not self-satisfy the corpus.
    if (f.includes(`${sep}knowledge${sep}`) || f.includes(`${sep}api-coverage${sep}`)) continue;
    if (e.isDirectory()) readAll(f, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) { try { out.push(readFileSync(f, 'utf8')); } catch { /* skip */ } }
  }
  return out;
}

// Corpora: built once.
const DOCS = [readFileSync(join(REPO, 'AGENTS.md'), 'utf8')]
  .concat(readAll(join(REPO, '.agents', 'skills', 'webjs'), ['.md'], []))
  // The docs site lives in the marketing app now (#1098): webjs.dev/docs.
  .concat(readAll(join(REPO, 'website', 'app', 'docs'), ['.ts'], []))
  .join('\n');
const TESTS = readAll(join(REPO, 'test'), ['.js', '.mjs', '.ts'], [])
  .concat(readAll(join(REPO, 'packages', 'core', 'test'), ['.js', '.mjs'], []))
  .concat(readAll(join(REPO, 'packages', 'server', 'test'), ['.js', '.mjs'], []))
  .join('\n');

// A whole-word match on the export name. This is a deliberately LIGHTWEIGHT
// signal: it reliably catches a NEW export that appears nowhere in docs/tests
// (the case the gate exists for), but it does NOT prove depth of coverage, and a
// common-English-word export name (`cache`, `html`, `json`, `route`, `session`,
// `headers`, `stream`, `render`) trivially passes because the word saturates the
// corpora. Strengthening to an import-from-@webjsdev match was tried and rejected:
// ~55 agent-facing exports are exercised transitively, via subpath imports, or in
// the browser-test suite this corpus omits, so it produced a large false-positive
// exempt list with no real gain. Depth of coverage is a code-review concern, the
// same as with the scaffold gate's demo pointers.
const hasWord = (corpus, name) => new RegExp(`\\b${name}\\b`).test(corpus);

/**
 * Pure reconciliation. For each live export not internal and not exempt, require
 * `present(name)` to be true. Returns error strings.
 */
export function reconcileCoverage(liveNames, internalOf, exemptSet, present, kind) {
  const errors = [];
  for (const name of liveNames) {
    if (internalOf(name)) continue;
    if (exemptSet.has(name)) continue;
    if (!present(name)) {
      errors.push(`${kind} gap: agent-facing export "${name}" is not referenced in the ${kind} corpus; document/test it or exempt it (with a reason) in test/api-coverage/api-coverage.json.`);
    }
  }
  return errors;
}

/**
 * Exemptions that no longer name a live export. Validated against the UNION of
 * all live export names (the exempt manifest is global, not per-surface), so a
 * server-only alias is not flagged stale while auditing the core surface.
 */
export function staleExemptions(exemptNames, allLive) {
  const live = new Set(allLive);
  return [...exemptNames].filter((n) => !live.has(n)).map((n) => `stale exemption "${n}": no longer a live export, remove it from test/api-coverage/api-coverage.json.`);
}

const SURFACES = [
  { label: 'core', names: Object.keys(core), section: 'exports' },
  { label: 'server', names: Object.keys(server), section: 'serverExports' },
];
const ALL_LIVE = [...Object.keys(core), ...Object.keys(server)];

test('every agent-facing export is documented (or exempt)', () => {
  const exempt = new Set(Object.keys(EXEMPT.docsExempt || {}));
  const errors = staleExemptions(exempt, ALL_LIVE);
  for (const s of SURFACES) {
    const e = reconcileCoverage(s.names, (n) => isInternal(n, s.section), exempt, (n) => hasWord(DOCS, n), 'docs');
    const agentFacing = s.names.filter((n) => !isInternal(n, s.section));
    console.log(`[api-coverage] ${s.label}: ${agentFacing.length} agent-facing exports, ${e.length} undocumented.`);
    errors.push(...e);
  }
  assert.deepEqual(errors, [], `docs coverage gaps:\n  - ${errors.join('\n  - ')}`);
});

test('every agent-facing export is referenced by a test (or exempt)', () => {
  const exempt = new Set(Object.keys(EXEMPT.testExempt || {}));
  const errors = staleExemptions(exempt, ALL_LIVE);
  for (const s of SURFACES) {
    const e = reconcileCoverage(s.names, (n) => isInternal(n, s.section), exempt, (n) => hasWord(TESTS, n), 'test');
    const agentFacing = s.names.filter((n) => !isInternal(n, s.section));
    console.log(`[api-coverage] ${s.label}: ${agentFacing.length} agent-facing exports, ${e.length} untested.`);
    errors.push(...e);
  }
  assert.deepEqual(errors, [], `test coverage gaps:\n  - ${errors.join('\n  - ')}`);
});

// --- counterfactuals ---

test('reconcileCoverage FAILS on an undocumented agent-facing export', () => {
  const errors = reconcileCoverage(['newThing'], () => false, new Set(), () => false, 'docs');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /agent-facing export "newThing" is not referenced/);
});

test('reconcileCoverage SKIPS an internal export', () => {
  const errors = reconcileCoverage(['plumbing'], (n) => n === 'plumbing', new Set(), () => false, 'docs');
  assert.deepEqual(errors, []);
});

test('reconcileCoverage SKIPS an exempted export', () => {
  const errors = reconcileCoverage(['aliasFn'], () => false, new Set(['aliasFn']), () => false, 'docs');
  assert.deepEqual(errors, []);
});

test('staleExemptions FAILS on an exemption that is not a live export', () => {
  const errors = staleExemptions(new Set(['gone']), ['html', 'signal']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /stale exemption "gone"/);
});

test('staleExemptions passes a server-only alias while auditing across surfaces', () => {
  // cookieSession is a live server export; it must NOT be flagged stale.
  const errors = staleExemptions(new Set(['cookieSession']), ['html', 'cookieSession']);
  assert.deepEqual(errors, []);
});
