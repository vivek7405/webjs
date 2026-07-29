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
  // The bounded prose pass and its non-round status.
  assert.match(skill, /never counts toward the round total or the two-round minimum/);
  // The re-tag license is asymmetric and downgrades are auditable.
  assert.match(skill, /DOWNGRADE to prose is treated like a rejection/);
  assert.match(skill, /recorded on the finding's thread/);
  // The two-round minimum survives a prose-only round 1, in step 4 AND in
  // the round-1 bullet that restates the exit.
  assert.match(skill, /whether clean or prose-only, still gets the delta-shaped pass/);
  assert.match(skill, /still gets the delta-shaped pass the two-round minimum requires before the prose pass/);
  // An untagged list is still a valid round (round counting stays sane).
  assert.match(skill, /untagged findings treated as substantive per the gate/);
  // An unproducible prose-pass reviewer is BLOCKED, not converged, and the
  // failure taxonomy covers the prose pass explicitly.
  assert.match(skill, /prose-pass reviewer that cannot be produced at all ends the loop BLOCKED/);
  assert.match(skill, /or the prose-pass reviewer, cannot be produced/);
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
  assert.match(hook, /prose pass/);
  assert.match(hook, /found something substantive/);
  // The tagless-reviewer clause stays in lockstep with the skill's gate:
  // orchestrator-classified, doubt to substantive, prose recorded.
  assert.match(hook, /recorded like a downgrade/);
  // The directive and the skill prescribe the SAME round-1 reviewer: the
  // deep-review workflow, with code-review findings as auxiliary input.
  assert.match(hook, /round 1 is the deep-review workflow/);
  assert.match(hook, /auxiliary input/);
  // Self-classification is scoped to the code-review skill's own findings;
  // untagged findings from tag-capable reviewers stay substantive.
  assert.match(hook, /from the code-review skill itself/);
  assert.match(hook, /any tag-capable reviewer is simply treated as substantive/);
});
