// Guards the pre-merge review cycle across the two files that carry it: the
// webjs-start-work skill (the normative rules) and the skill-routing hook
// (the injected review directive, which once kept an OLD exit condition
// after the skill had moved on, steering standalone reviews back into a
// shape the skill no longer described).
//
// These are static assertions over committed text on purpose: the cycle is
// prose executed by agents, so the counterfactual for "the cycle silently
// reverted" is the text no longer carrying its load-bearing anchors. Each
// assertion fails if its hunk is reverted or typo-drifted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const skill = readFileSync(resolve(repo, '.claude/skills/webjs-start-work/SKILL.md'), 'utf8');
const hook = readFileSync(resolve(repo, '.claude/hooks/route-skills.sh'), 'utf8');

test('the skill prescribes ONE reviewer, never a fleet', () => {
  // Round 1 is a single reviewer over the whole diff, with no path-based
  // tier choice deciding its shape.
  assert.match(skill, /Round 1: ONE fresh reviewer over the WHOLE diff/);
  assert.match(skill, /No scout, no parallel lenses, no jury, no per-diff tier choice/);
  // Later rounds narrow the QUESTION to the fixes, not the evidence.
  assert.match(skill, /Every later round is delta-scoped: ONE fresh reviewer whose QUESTION is the previous round's fix commits/);
  // The final whole-diff pass is what a clean delta round buys, and it is
  // the reason a clean round is not by itself the end.
  assert.match(skill, /buys the FINAL review: ONE fresh reviewer over the WHOLE diff again/);
  assert.match(skill, /A clean delta round is not the end of the cycle/);
  // The final review's findings end in a fix plus ONE delta check of that
  // fix, which does not re-open the cycle.
  assert.match(skill, /ONE delta-scoped reviewer checks those fix commits alone/);
  assert.match(skill, /does not re-open the loop and never re-runs the final review/);
  // Two consecutive breaking fix-checks stop the cycle rather than looping.
  assert.match(skill, /a change still breaking after two is signal about the change/);
  // A clean round 1 skips the delta rounds but still gets the final review.
  assert.match(skill, /the minimum is two reviews/);
});

test('the skill pins every reviewer to Opus, async, and worktree-isolated', () => {
  assert.match(skill, /`model: "opus"` \(Opus 5, always, no other model at any point in the cycle\)/);
  assert.match(skill, /`run_in_background: true`/);
  assert.match(skill, /`isolation: "worktree"`/);
  assert.match(skill, /`subagent_type: "general-purpose"`/);
  // No reviewer anywhere in the skill is pinned to another model family.
  assert.ok(!/fable/i.test(skill), 'a reviewer was pinned back to fable');
});

test('the minor / must-fix call is by surface, not by importance', () => {
  assert.match(skill, /The judgment rule: minor or must-fix/);
  // The three must-fix surfaces, including the tautological-test case that
  // an importance test would wrongly eject.
  assert.match(skill, /ability to OBSERVE the defect it claims to cover/);
  assert.match(skill, /factual claim about runtime behavior in docs/);
  assert.match(skill, /Judge by SURFACE, never by importance/);
  // Doubt resolves toward keeping the cycle open.
  assert.match(skill, /When a finding could go either way, it is must-fix/);
  // A must-fix finding buys a round whether it was fixed OR rejected, since
  // a rejection is the reviewer's own unadjudicated judgment.
  assert.match(skill, /a REJECTED must-fix finding buys the next round exactly like a fixed one does/);
});

test('the removed machinery stays removed, with the reason recorded', () => {
  // The paragraph that tells a future reader the omissions were deliberate.
  assert.match(skill, /Do not restore what this shape replaced/);
  assert.match(skill, /The termination those mechanisms bought is now structural/);
  // The fleet workflow itself is gone from the repo.
  assert.ok(!existsSync(resolve(repo, '.claude/workflows/deep-review.js')), 'the deep-review fleet workflow is back');
  // None of the removed mechanisms may re-enter as live rules. The
  // do-not-restore paragraph names them once each, so a second mention is
  // the signal that one came back.
  for (const [label, re] of [
    ['the substantive/prose tier gate', /substantive/gi],
    ['the round budget', /round budget/gi],
    ['the file-polling watchdog', /watchdog/gi],
  ]) {
    const hits = (skill.match(re) || []).length;
    assert.ok(hits <= 1, `${label} reappears in the skill (${hits} mentions; only the do-not-restore paragraph may name it)`);
  }
});

test('the cycle keeps the guarantees the trim was not allowed to touch', () => {
  // A fix is never the end: the delta round after a fix is what the whole
  // cycle exists to force.
  assert.match(skill, /A fix is never the end of the cycle/);
  // A dead or non-reviewing spawn is not a round, and an inline pass is
  // never a substitute for one.
  assert.match(skill, /A failed spawn means the round did not happen/);
  assert.match(skill, /A reviewer that returns without reviewing is also a failed round/);
  assert.match(skill, /NEVER downgrade to an inline self-review/);
  // The literal sentinels the cycle reads a reviewer's answer by.
  assert.match(skill, /say exactly `CLEAN` on its own line and stop/);
  assert.match(skill, /say exactly `BLOCKED` on its own line/);
  // Working-tree safety: isolation, the read-only git prohibition, and the
  // per-spawn repo-health check that catches a leaked worktree.
  assert.match(skill, /Working-tree safety \(non-negotiable\)/);
  assert.match(skill, /You are a READ-ONLY reviewer/);
  assert.match(skill, /After EACH spawn resolves, before acting on findings, run a one-line repo-health check/);
  // Reviewers stay starved of prior review context.
  assert.match(skill, /NEVER feed them prior PR comments or reviews/);
  // The three dispositions and the deferral ledger survive.
  assert.match(skill, /the cycle NEVER files a follow-up issue on its own/);
  assert.match(skill, /final summary review on the PR also carries a deferral ledger/);
  assert.match(skill, /END WITH A DIRECT QUESTION/);
});

test('the routed review directive states the same cycle as the skill', () => {
  // The directive must not describe a fleet or a tiered round 1.
  assert.ok(!/deep-review/.test(hook), 'route-skills.sh still routes round 1 to the deep-review fleet');
  assert.ok(!/round budget|OVER BUDGET/i.test(hook), 'route-skills.sh reverted to the round budget');
  // The shape, in lockstep with the skill.
  assert.match(hook, /ONE fresh reviewer over the whole diff, never a fleet/);
  assert.match(hook, /each later round is delta-scoped/);
  assert.match(hook, /buys a FINAL review over the whole diff again/);
  assert.match(hook, /model opus \(Opus 5, never fable\)/);
  assert.match(hook, /isolation worktree/);
  // The judgment rule, including its fail-open direction.
  assert.match(hook, /MINOR or MUST-FIX by SURFACE, never by importance/);
  assert.match(hook, /when it could go either way it is must-fix/);
  assert.match(hook, /ONE delta check of that fix alone, which ends the cycle/);
  assert.match(hook, /Never report done off a round that found something must-fix/);
  // The code-review skill's own findings are input to the cycle, not a
  // round of it.
  assert.match(hook, /auxiliary input, not as a round of it/);
});
