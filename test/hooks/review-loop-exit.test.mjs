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
  assert.match(skill, /No fleet, no lenses, no jury, no per-diff tier choice/);
  // Later rounds narrow the QUESTION to the fixes, not the evidence.
  assert.match(skill, /Each later round is delta-scoped: ONE fresh reviewer whose QUESTION is the previous round's fix commits/);
  // The final whole-diff pass is what a clean delta round buys, and it is
  // the reason a clean round is not by itself the end.
  assert.match(skill, /buys the FINAL review: ONE fresh reviewer over the WHOLE diff again/);
  assert.match(skill, /Either way a clean round is not the end of the cycle/);
  // The final review's findings end in a fix plus ONE delta check of that
  // fix, which does not re-open the cycle.
  assert.match(skill, /Its fixes get ONE delta-scoped check of those fix commits alone/);
  assert.match(skill, /The cycle ends when nothing must-fix is left OPEN/);
  assert.match(skill, /The final review is never re-run and the delta rounds are never re-entered/);
  // A fix-check that finds something gets ONE more of the same shape, then
  // the cycle stops unfinished rather than looping.
  assert.match(skill, /ONE more check of the same shape, and if that one does too, stop and report the PR unfinished/);
  // A clean round 1 skips the delta rounds but still gets the final review.
  assert.match(skill, /every PR gets at least two reviews/);
});

test('the skill pins every reviewer to Opus, async, and worktree-isolated', () => {
  assert.match(skill, /`model: "opus"` \(Opus 5, always, no other model anywhere in the cycle\)/);
  assert.match(skill, /`run_in_background: true`/);
  assert.match(skill, /`isolation: "worktree"`/);
  assert.match(skill, /`subagent_type: "general-purpose"`/);
  // No reviewer anywhere in the skill is pinned to another model family.
  assert.ok(!/fable/i.test(skill), 'a reviewer was pinned back to fable');
});

test('the minor / must-fix call is by surface, not by importance', () => {
  assert.match(skill, /\*\*Minor or must-fix\.\*\*/);
  // The three must-fix surfaces, including the tautological-test case that
  // an importance test would wrongly eject.
  assert.match(skill, /ability to OBSERVE the defect it claims to cover/);
  assert.match(skill, /factual claim about runtime behavior in docs/);
  assert.match(skill, /Judge by SURFACE, never by importance/);
  // Doubt resolves toward keeping the cycle open.
  assert.match(skill, /When it could go either way, it is must-fix/);
  // Only a FIX buys a round. A rejection produces no fix commits, so a
  // round would re-pose the same question over an unchanged head to a
  // reviewer that is never told what was already handled, which is how the
  // pre-final loop lost its bound when the round budget went. The refuter
  // is what adjudicates a rejection, and it terminates in one spawn.
  assert.match(skill, /\*\*Only a FIX buys another round\*\*/);
  assert.match(skill, /A rejection buys one REFUTER instead, a deferral buys nothing/);
  assert.match(skill, /what a rejection buys instead of a whole round, and it terminates: one spawn per rejection, never a refuter of a refuter/);
  // A refuter has two verdicts and the cycle must define both, or a finding
  // whose rejection was contradicted ends with no disposition at all.
  assert.match(skill, /answers `STANDS` has contradicted your rejection, so the rejection does not hold/);
  // The two uses fail in opposite directions when no refuter can be spawned.
  assert.match(skill, /on the pre-action gate, act on the finding as real/);
  assert.match(skill, /keep the rejection but record it as UNREFUTED/);
});

test('the removed machinery stays removed, with the reason recorded', () => {
  // The paragraph that tells a future reader the omissions were deliberate.
  assert.match(skill, /Do not restore what this replaced/);
  assert.match(skill, /All of it is gone on purpose: termination is structural now/);
  // The fleet workflow itself is gone from the repo.
  assert.ok(!existsSync(resolve(repo, '.claude/workflows/deep-review.js')), 'the deep-review fleet workflow is back');
  // None of the removed mechanisms may re-enter, as a rule or as vocabulary.
  // The do-not-restore paragraph describes them WITHOUT these words ("two
  // tiers", "a 5-round budget", "poll a file"), so the expected count is
  // zero and any occurrence is a re-introduction rather than a mention.
  for (const [label, re] of [
    ['the substantive/prose tier vocabulary', /substantive/i],
    ['the round budget', /round budget|over budget/i],
    ['the polling watchdog', /watchdog/i],
  ]) {
    assert.ok(!re.test(skill), `${label} is back in the skill`);
  }
});

test('the cycle keeps the guarantees the trim was not allowed to touch', () => {
  // A fix is never the end: the delta round after a fix is what the whole
  // cycle exists to force.
  assert.match(skill, /A fix changes the branch, so the changed branch needs its own round/);
  // The pre-fix wording said "Fixing (or rejecting) a must-fix finding
  // changes the branch", which both restates the reversed rule and is not
  // true of a rejection. It must not survive anywhere in the file.
  assert.ok(!/Fixing \(or rejecting\)/.test(skill), 'the reversed rejection-buys-a-round rule is back');
  // A dead or non-reviewing spawn is not a round, and an inline pass is
  // never a substitute for one.
  assert.match(skill, /A dead spawn is not a round/);
  // The blind wait is bounded SHORT and never kills. Whether there is a
  // mid-flight signal at all depends on what the spawn's output file is,
  // which is why the rule probes it rather than assuming.
  assert.match(skill, /Check in about every 2 minutes, and NEVER kill on the timer/);
  assert.match(skill, /What decides is GROWTH, never elapsed time/);
  // The liveness probe is byte growth on the transcript, never its words,
  // and the file may be either a live transcript or a static stub.
  assert.match(skill, /if the byte count is rising it is working, so leave it alone however long it has run/);
  // A stub is flat from the start, so re-spawning on flatness would kill
  // every healthy stub-backed reviewer and replace it with another one.
  assert.match(skill, /Flatness is a signal ONLY where the file is a live transcript/);
  assert.match(skill, /never re-spawn a stub-backed one on flatness/);
  // The liveness sentence must not claim the harness status is the ONLY
  // signal while the check-in rule reads byte growth as one.
  assert.match(skill, /Only two things are evidence a reviewer is alive/);
  assert.match(skill, /Never read the transcript.s contents/);
  assert.match(skill, /A reviewer that returns without reviewing is also not a round/);
  assert.match(skill, /NEVER substitute an inline self-review/);
  // The literal sentinels the cycle reads a reviewer's answer by.
  assert.match(skill, /say exactly `CLEAN` on its own line and stop/);
  assert.match(skill, /say exactly `BLOCKED` on its own line/);
  // The template must not keep offering the no-fix-commit delta round that
  // cycle step 3 replaced with the final review, since following it re-opens
  // the unbounded path.
  assert.ok(!/delta round following a round with no fix commits/.test(skill), 'the removed no-fix delta round is back in the prompt template');
  // Working-tree safety: isolation, the read-only git prohibition, and the
  // per-spawn repo-health check that catches a leaked worktree.
  assert.match(skill, /\*\*Working-tree safety\.\*\*/);
  assert.match(skill, /You are a READ-ONLY reviewer/);
  assert.match(skill, /After EACH spawn resolves, before acting on findings, check the repo/);
  // Reviewers stay starved of prior review context.
  assert.match(skill, /NEVER prior PR comments or reviews/);
  // The prompt sets the scope and nothing else. A defect-class checklist
  // narrows the reviewer to what the author already suspects, which is the
  // bias a fresh reviewer exists to escape.
  assert.match(skill, /\*\*Do not tell it what to look for\.\*\*/);
  assert.match(skill, /no list of defect classes, no "specifically check for X and Y"/);
  assert.match(skill, /The question for this round is a SCOPE, not a checklist/);
  // The three dispositions and the deferral ledger survive.
  assert.match(skill, /the cycle never files a follow-up issue on its own/);
  assert.match(skill, /final summary review also carries a deferral ledger/);
  assert.match(skill, /END WITH A DIRECT QUESTION/);
});

test('the routed review directive states the same cycle as the skill', () => {
  // The directive must not describe a fleet or a tiered round 1.
  assert.ok(!/deep-review/.test(hook), 'route-skills.sh still routes round 1 to the deep-review fleet');
  assert.ok(!/round budget|OVER BUDGET/i.test(hook), 'route-skills.sh reverted to the round budget');
  // The shape, in lockstep with the skill.
  assert.match(hook, /ONE fresh reviewer over the whole diff, never a fleet/);
  assert.match(hook, /each later round is delta-scoped/);
  assert.match(hook, /the first round that produces no fixes, whether it found nothing must-fix or everything it found was rejected or deferred, buys a FINAL review over the whole diff again/);
  assert.match(hook, /model opus \(Opus 5, never fable\)/);
  assert.match(hook, /isolation worktree/);
  // The judgment rule, including its fail-open direction.
  assert.match(hook, /MINOR or MUST-FIX by SURFACE, never by importance/);
  assert.match(hook, /when it could go either way it is must-fix/);
  assert.match(hook, /ONE delta check of that fix alone/);
  assert.match(hook, /Never report the PR ready off a round that found something must-fix/);
  // The directive must resolve the fix-check case the SAME way the skill
  // does, and must not both end the cycle and forbid reporting it.
  assert.match(hook, /the cycle ends when that check finds nothing must-fix/);
  assert.match(hook, /one more check of the same shape, and only if that one also finds something must-fix do you stop and report the PR unfinished/);
  assert.match(hook, /Only a FIX buys another round/);
  // The code-review skill's own findings are input to the cycle, not a
  // round of it.
  assert.match(hook, /auxiliary input, not as a round of it/);
});
