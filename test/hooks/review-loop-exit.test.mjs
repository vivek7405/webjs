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
  // The three surfaces, verbatim anchors of the definition.
  assert.match(skill, /ability to OBSERVE the defect it claims to cover/);
  assert.match(skill, /factual claim about runtime behavior in docs/);
  // Fail-open direction for untagged findings.
  assert.match(skill, /arrives UNTAGGED is treated as substantive/);
  // The bounded prose pass and its non-round status.
  assert.match(skill, /never counts toward the round total or the two-round minimum/);
  // The re-tag license is asymmetric and downgrades are auditable.
  assert.match(skill, /DOWNGRADE to prose is treated like a rejection/);
  assert.match(skill, /recorded on the finding's thread/);
  // The two-round minimum survives a prose-only round 1.
  assert.match(skill, /whether clean or prose-only, still gets the delta-shaped pass/);
  // An unproducible prose-pass reviewer is BLOCKED, not converged.
  assert.match(skill, /prose-pass reviewer that cannot be produced at all ends the loop BLOCKED/);
});

test('deep-review findings carry a required tier with the gate wording', () => {
  assert.match(workflow, /required: \['file', 'line', 'title', 'detail', 'severity', 'tier'\]/);
  assert.match(workflow, /tier: \{ type: 'string', enum: \['substantive', 'prose'\]/);
  // The finder prompt states the same three-surface definition.
  assert.match(workflow, /Tag each finding's tier/);
  assert.match(workflow, /ability to OBSERVE the defect it claims to cover/);
  // The tier is orthogonal to severity, stated so dedup changes stay honest.
  assert.match(workflow, /surface classification, not a severity judgment/);
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
});
