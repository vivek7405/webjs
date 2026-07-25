// Agent-knowledge coverage gate (tier-2, un-skippable CI enforcement).
//
// This keeps the surfaces that counter agents' WRONG PRIORS honest, which is
// where agents actually fail: the symptom-keyed troubleshooting page and the
// muscle-memory gotcha docs. Two things are gated:
//
//   1. Every LIVE `webjs check` RULE is explained in an agent-facing surface
//      (the troubleshooting page or a gotcha doc, matched by rule name) OR
//      exempted with a reason in knowledge-coverage.json. A new rule that ships
//      with no "here is the symptom and the fix" turns CI red.
//   2. Every AGENTS.md heading the MCP `init` primer sources (DERIVED from the
//      `sectionByHeading(agents, /.../)` calls in packages/mcp/src/mcp-docs.js)
//      still matches a heading in AGENTS.md, so a rename cannot silently empty
//      the primer.
//
// The reconcile core is pure; failure modes are proven with synthetic inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from '../../packages/server/src/check.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(__dirname, 'knowledge-coverage.json'), 'utf8'));

const EXPLAIN_SURFACES = [
  'website/app/docs/troubleshooting/page.ts',
  '.agents/skills/webjs/references/muscle-memory-gotchas.md',
].map((p) => join(REPO, p));
const AGENTS_MD = join(REPO, 'AGENTS.md');
const MCP_DOCS = join(REPO, 'packages', 'mcp', 'src', 'mcp-docs.js');

/** True when the rule name appears as a whole token in any explanation surface. */
function ruleIsExplained(name) {
  const re = new RegExp(`\\b${name.replace(/[-]/g, '\\-')}\\b`);
  return EXPLAIN_SURFACES.some((f) => {
    try { return re.test(readFileSync(f, 'utf8')); } catch { return false; }
  });
}

/**
 * Pure reconciliation of check rules against the explanation surfaces + exempt
 * map. Returns error strings; empty means covered. `explained` is injectable so
 * synthetic cases need no fs.
 */
export function reconcileRules(liveRules, exempt, explained) {
  const errors = [];
  const exemptNames = new Set(Object.keys(exempt));
  const live = new Set(liveRules);

  for (const name of liveRules) {
    const isExplained = explained(name);
    const isExempt = exemptNames.has(name);
    if (!isExplained && !isExempt) {
      errors.push(
        `check rule "${name}" is neither explained (in the troubleshooting page or a gotcha doc) ` +
        `nor exempted in test/knowledge/knowledge-coverage.json. Add a symptom-keyed entry that ` +
        `names the rule, or an exemption with a reason.`,
      );
    }
  }
  // Stale exemption: a name exempted that is no longer a live rule.
  for (const name of exemptNames) {
    if (!live.has(name)) errors.push(`stale exemption "${name}": no longer a webjs check rule, remove it from knowledge-coverage.json.`);
    else if (typeof exempt[name] !== 'string' || !exempt[name].trim()) errors.push(`exemption "${name}" needs a non-empty reason.`);
  }
  return errors;
}

/**
 * Derive the AGENTS.md heading regexes the MCP init primer sources, straight
 * from the mcp-docs.js source, so a NEW sourced anchor is auto-checked.
 */
export function deriveInitAnchors(mcpDocsSrc) {
  return [...mcpDocsSrc.matchAll(/sectionByHeading\(\s*agents\s*,\s*(\/[^/]+\/[a-z]*)\)/g)].map((m) => m[1]);
}
function regexFromLiteral(lit) {
  const m = lit.match(/^\/(.*)\/([a-z]*)$/);
  return new RegExp(m[1], m[2]);
}

const liveRules = RULES.map((r) => r.name);

test('every webjs check rule is explained in an agent-facing surface or exempted', () => {
  const errors = reconcileRules(liveRules, MANIFEST.checkRulesExempt, ruleIsExplained);
  const explained = liveRules.filter(ruleIsExplained).length;
  console.log(`[knowledge-coverage] ${liveRules.length} check rules: ${explained} explained, ${Object.keys(MANIFEST.checkRulesExempt).length} exempted.`);
  assert.deepEqual(errors, [], `check-rule knowledge gaps:\n  - ${errors.join('\n  - ')}`);
});

test('the AGENTS.md headings the MCP init primer sources still exist', () => {
  const anchors = deriveInitAnchors(readFileSync(MCP_DOCS, 'utf8'));
  assert.ok(anchors.length >= 2, `expected to derive the MCP init anchors from mcp-docs.js, got ${anchors.length}`);
  const agents = readFileSync(AGENTS_MD, 'utf8');
  console.log(`[knowledge-coverage] MCP init sources ${anchors.length} AGENTS.md anchors: ${anchors.join(', ')}`);
  for (const lit of anchors) {
    assert.ok(regexFromLiteral(lit).test(agents), `MCP init sources ${lit} from AGENTS.md, but no heading matches it (a rename would silently empty the init primer).`);
  }
});

// --- counterfactuals: prove each failure mode fires ---

test('reconcileRules FAILS on a new unexplained, unexempted rule', () => {
  const errors = reconcileRules(['brand-new-rule'], {}, () => false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /check rule "brand-new-rule" is neither explained/);
});

test('reconcileRules FAILS on a stale exemption', () => {
  const errors = reconcileRules([], { 'gone-rule': 'reason' }, () => false);
  assert.ok(errors.some((e) => /stale exemption "gone-rule"/.test(e)), errors.join('\n'));
});

test('reconcileRules FAILS on an empty exemption reason', () => {
  const errors = reconcileRules(['x'], { x: '  ' }, () => false);
  assert.ok(errors.some((e) => /needs a non-empty reason/.test(e)), errors.join('\n'));
});

test('reconcileRules passes an explained rule with no exemption', () => {
  const errors = reconcileRules(['real-rule'], {}, (n) => n === 'real-rule');
  assert.deepEqual(errors, []);
});

test('deriveInitAnchors extracts the sectionByHeading regexes', () => {
  const anchors = deriveInitAnchors("const a = sectionByHeading(agents, /^##\\s+Execution model/im);\nconst b = sectionByHeading(agents, /^##\\s+Invariants/im);");
  assert.deepEqual(anchors, ['/^##\\s+Execution model/im', '/^##\\s+Invariants/im']);
});

test('a renamed init anchor is caught (counterfactual)', () => {
  const anchors = deriveInitAnchors(readFileSync(MCP_DOCS, 'utf8'));
  const agentsWithRenamedHeading = readFileSync(AGENTS_MD, 'utf8').replace(/^##\s+Invariants.*$/m, '## Rules and guarantees');
  const stillMatches = anchors.every((lit) => regexFromLiteral(lit).test(agentsWithRenamedHeading));
  assert.equal(stillMatches, false, 'renaming the Invariants heading should break at least one derived anchor');
});
