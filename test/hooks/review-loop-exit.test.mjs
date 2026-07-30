// Guards the review loop's substantive-gate exit (#1171) across the three
// files that carry it: the webjs-start-work skill (the normative rules),
// the deep-review workflow (the tier tag round-1 findings arrive with),
// and the skill-routing hook (the injected review directive, which once
// kept the OLD "until a round is clean" absolute after the skill had moved
// on, steering standalone reviews back into prose relitigation).
//
// These are static assertions over committed text on purpose: the gate is
// prose executed by agents, so the counterfactual for "the gate silently
// reverted" is the text no longer carrying its load-bearing anchors. Each
// assertion fails if its hunk is reverted or typo-drifted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(resolve(here, '../../.claude/skills/webjs-start-work/SKILL.md'), 'utf8');
const workflow = readFileSync(resolve(here, '../../.claude/workflows/deep-review.js'), 'utf8');
const hook = readFileSync(resolve(here, '../../.claude/hooks/route-skills.sh'), 'utf8');

test('the skill carries the substantive gate and its two-tier exit', () => {
  assert.match(skill, /The substantive gate: which findings keep the loop open/);
  // The normative definition bullet, anchored by a phrase unique to it (the
  // shared three-surface wording below also appears in the delta prompt
  // template, so alone it would pass with the definition bullet deleted).
  assert.match(skill, /A finding is `substantive` when it touches any of three surfaces/);
  // The three surfaces appear in BOTH the definition and the delta prompt
  // template, so each shared phrase must occur at least twice.
  for (const phrase of [/ability to OBSERVE the defect it claims to cover/g, /factual claim about runtime behavior in docs/g]) {
    assert.ok((skill.match(phrase) || []).length >= 2, `${phrase} must anchor both the definition and the template`);
  }
  // A number in docs stating runtime behavior is surface three, not prose,
  // in the normative definition AND the delta prompt template.
  assert.ok((skill.match(/a number in docs that states runtime behavior/g) || []).length >= 2, 'docs-number qualifier must anchor both the definition and the template');
  // Fail-open direction for untagged findings from a tag-capable reviewer,
  // and the one tagless-reviewer kind the orchestrator classifies itself.
  assert.match(skill, /arrives UNTAGGED from a reviewer whose result shape carries the tag is treated as substantive/);
  assert.match(skill, /structurally cannot tag/);
  // The exit: the converging round's prose findings apply without a
  // re-review round, and there is no standalone prose pass to relitigate.
  assert.match(skill, /apply that round's prose-tier fixes WITHOUT re-review and stop/);
  assert.match(skill, /converging round's prose-tier findings ARE the sweep/);
  assert.ok(!skill.includes('prose pass'), 'the standalone prose pass must not resurface in the skill');
  // A prose fix that touches a substantive surface still gets its one
  // delta-scoped check (the gate's exception survives the pass removal).
  assert.match(skill, /gets one delta-scoped check of THAT FIX ALONE/);
  // The re-tag license is asymmetric and downgrades are auditable.
  assert.match(skill, /DOWNGRADE to prose is treated like a rejection/);
  assert.match(skill, /recorded on the finding's thread/);
  // Round 1 is tiered by the diff's PATHS (never by judged importance), a
  // mixed diff escalates, and the minimum is one round, so a clean round 1
  // converges without a forced extra pass.
  assert.match(skill, /Round 1's shape is decided by the SURFACES in the PR's diff, a path check/);
  assert.match(skill, /one shipped-source path is enough/);
  assert.match(skill, /The minimum is ONE round/);
  assert.match(skill, /pulls shipped source into a light-tier PR re-runs round 1 at the DEEP tier/);
  // An untagged list is still a valid round (round counting stays sane).
  assert.match(skill, /untagged findings treated as substantive per the gate/);
  // The round budget bounds the loop: 5 substantive rounds, OVER BUDGET is
  // a non-converged exit with its own report, and the failure taxonomy
  // carries it.
  assert.match(skill, /5 substantive rounds, raised only by the user's instruction/);
  assert.match(skill, /ends it as OVER BUDGET/);
  assert.match(skill, /An OVER-BUDGET loop reports the rounds run/);
  assert.match(skill, /round budget \(default 5 substantive rounds, user-raisable per task\) is spent/);
  // Mid-loop fixes carry proof: the red\/green toggle inside the loop-speed
  // bullet, the non-discriminating-test re-run, and claim decay.
  assert.match(skill, /make an older test non-discriminating without failing it/);
  assert.match(skill, /A counterfactual CLAIM decays/);
  assert.match(skill, /true of a commit, not a branch/);
  // The loop never files follow-up issues on its own; deferral is recorded
  // on the PR and filing is the user's call from the report. Deferral can
  // never swallow a finding on the PR's own changed code.
  assert.match(skill, /the loop NEVER files a follow-up issue on its own/);
  assert.match(skill, /awaiting your call on filing/);
  assert.match(skill, /NEVER out of scope, whatever its size/);
  // The final summary review on the PR carries the deferral ledger, and
  // the chat report expands the same ledger instead of a bare name list.
  assert.match(skill, /FINAL summary review on the PR also carries a deferral ledger/);
  assert.match(skill, /expand each deferral right there, mirroring the PR ledger/);
  // The chat report must END by directly asking whether to file follow-ups.
  assert.match(skill, /END WITH A DIRECT QUESTION/);
  assert.match(skill, /silence is never consent/);
});

test('deep-review findings carry a required tier with the gate wording', () => {
  assert.match(workflow, /required: \['file', 'line', 'title', 'detail', 'severity', 'tier'\]/);
  assert.match(workflow, /tier: \{ type: 'string', enum: \['substantive', 'prose'\]/);
  // The finder prompt states the same three-surface definition, including
  // the docs-number qualifier.
  assert.match(workflow, /Tag each finding's tier/);
  assert.match(workflow, /ability to OBSERVE the defect it claims to cover/);
  assert.match(workflow, /a number in docs that states runtime behavior/);
  // The tier is orthogonal to severity, stated so dedup changes stay honest.
  assert.match(workflow, /surface classification, not a severity judgment/);
  // The trimmed defaults hold: 16 agents, at most three dynamic lenses,
  // and whenToUse scopes round 1 to shipped-source diffs.
  assert.match(workflow, /\? Number\(args\.maxAgents\) : 16/);
  assert.match(workflow, /maxItems: 3/);
  assert.match(workflow, /ZERO to three ADDITIONAL review lenses/);
  assert.match(workflow, /whose diff touches shipped source/);
  // Tier outranks severity everywhere findings compete: the same-line
  // dedup collision, the tier-first sort that drives the CAP slice and
  // the jury-budget walk, and a missing tier fails OPEN (substantive).
  assert.match(workflow, /subst\(f\) && !subst\(prev\)/);
  assert.match(workflow, /const subst = \(f\) => f\.tier !== 'prose'/);
  assert.match(workflow, /Number\(subst\(b\)\) - Number\(subst\(a\)\)/);
  // The CAP tail is returned in unverified, never silently dropped, and
  // its remedy is stated correctly in both the workflow log and (third
  // assertion, against the SKILL file) the skill's round-1 bullet: the
  // cap is fixed, maxAgents cannot recover it.
  assert.match(workflow, /\.\.\.unverified, \.\.\.capDropped/);
  assert.match(workflow, /the cap is fixed, so re-run after fixes/);
  assert.match(skill, /cannot recover a capped finding/);
  // A dead jury slot fails open to CONFIRMED instead of vanishing.
  assert.match(workflow, /verified\[i\] \|\| \{ \.\.\.f, confirmed: true, jury: 0/);
});

test('deep-review.js stays valid in the async workflow context', () => {
  // Workflow scripts run as an async function body (top-level return and
  // await are legal there but not in a plain module, so `node --check`
  // cannot cover this file).
  const body = workflow.replace(/^export /m, '');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  assert.doesNotThrow(() => new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'budget', 'workflow', body));
});

test('the routed review directive states the substantive exit, not the old absolute', () => {
  // The old exit steered standalone reviews into never-terminating prose
  // relitigation; it must not resurface in the injected directive.
  assert.ok(!hook.includes('until a round is clean'), 'route-skills.sh reverted to the pre-#1171 exit');
  assert.match(hook, /nothing SUBSTANTIVE/);
  assert.ok(!hook.includes('prose pass ends it'), 'route-skills.sh reverted to the standalone prose pass');
  assert.match(hook, /prose-tier findings are applied without re-review/);
  assert.match(hook, /found something substantive/);
  // The tagless-reviewer clause stays in lockstep with the skill's gate:
  // orchestrator-classified, doubt to substantive, prose recorded.
  assert.match(hook, /recorded like a downgrade/);
  // The directive and the skill prescribe the SAME tiered round-1 reviewer,
  // with code-review findings as auxiliary input.
  assert.match(hook, /round 1 is the deep-review workflow when the diff touches shipped source/);
  assert.match(hook, /one broad fresh reviewer otherwise/);
  assert.match(hook, /auxiliary input/);
  // Self-classification is scoped to the code-review skill's own findings;
  // untagged findings from tag-capable reviewers stay substantive.
  assert.match(hook, /from the code-review skill itself/);
  assert.match(hook, /any tag-capable reviewer is simply treated as substantive/);
  // The directive states the round budget the skill mandates.
  assert.match(hook, /budget of 5 substantive rounds bounds the whole loop/);
});
