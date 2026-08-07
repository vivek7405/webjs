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
  // Later rounds narrow the QUESTION to the fixes, not the evidence. The
  // fast default allows exactly one such round; the escalated cycle chains
  // them. Both phrasings must keep saying the question is the fix commits.
  assert.match(skill, /delta-scoped reviewer whose QUESTION is those fix commits alone/);
  assert.match(skill, /each later round is delta-scoped to the previous round's fix commits/);
  // Structure alone cannot bound a chain where every fix produces the next
  // round's finding, which is the case the deleted budget was written for.
  assert.match(skill, /\*\*A delta chain that keeps producing fixes stops after the FIFTH DELTA ROUND\*\*/);
  // The stop needs a reporting shape of its own: the reporting section
  // covers only the converged path.
  assert.match(skill, /If the FIFTH delta round still produces fixes/);
  // What makes this stop unfinished is unreviewed fixes, not open findings,
  // which is the opposite of its sibling stop and the thing a report copied
  // from that sibling gets wrong.
  assert.match(skill, /but that its FIXES are on the branch unreviewed, so say exactly that/);
  // And the do-not-restore paragraph must admit the cap came back rather
  // than claiming termination is entirely structural.
  assert.match(skill, /The one exception to the removals is the round cap, which came back in a narrower form/);
  // The final whole-diff pass is what a clean delta round buys, and it is
  // the reason a clean round is not by itself the end.
  assert.match(skill, /buys the FINAL review: ONE fresh reviewer over the WHOLE diff again/);
  assert.match(skill, /Either way a clean round is not the end of the THOROUGH cycle/);
  // The final review's findings end in a fix plus ONE delta check of that
  // fix, which does not re-open the cycle.
  assert.match(skill, /Its fixes get ONE delta-scoped check of those fix commits alone/);
  assert.match(skill, /The cycle ends when nothing must-fix is left OPEN/);
  // The same two words for the same disposition in every rule that names
  // it, since "refuted or deferred" silently dropped the unrefutable
  // rejection the refuter-unavailable rule creates.
  assert.match(skill, /every must-fix finding it raised was rejected or deferred/);
  assert.match(skill, /The final review is never re-run and the delta rounds are never re-entered/);
  // A fix-check that finds something gets ONE more of the same shape, then
  // the cycle stops unfinished rather than looping.
  assert.match(skill, /ONE more check of the same shape, and if that one does too, stop and report the PR unfinished/);
  // NOTE: a clean round 1 no longer buys the final review unconditionally.
  // That floor is now bought by the escalation ladder, which the FAST
  // default test below owns; asserting it here too would contradict it.
});

test('the skill pins every reviewer to Opus, async, and worktree-isolated', () => {
  assert.match(skill, /`model: "opus"` \(Opus 5, always, no other model anywhere in the cycle\)/);
  assert.match(skill, /`run_in_background: true`/);
  assert.match(skill, /`isolation: "worktree"`/);
  assert.match(skill, /`subagent_type: "general-purpose"`/);
  // No reviewer anywhere in the skill is pinned to another model family.
  assert.ok(!/fable/i.test(skill), 'a reviewer was pinned back to fable');
});

test('FAST is the default cycle, and the thorough one is bought by evidence', () => {
  // The owner should never have to ask for a short cycle. A reviewer spawn
  // costs about 10 minutes, so an unconditional second round taxes every PR
  // to cover a miss that mostly matters on a few surfaces.
  assert.match(skill, /\*\*FAST is the default shape\.\*\*/);
  assert.match(skill, /a clean or minor-only round 1 finishes the cycle with ONE review/i);
  // Speed must come from fewer ROUNDS, never from a softer bar inside one.
  // Reclassifying findings as minor is the cheat this forbids.
  assert.match(skill, /Speed is bought by running fewer rounds, NEVER by lowering the bar inside a round/);

  // All three escalation triggers, since dropping any one silently widens
  // the fast path over changes that were meant to get the second read.
  assert.match(skill, /the owner asks for a thorough, full, or deep review/);
  assert.match(skill, /TWO OR MORE must-fix findings/);
  assert.match(skill, /the serializer, SSR or action dispatch, auth or session, the client router, or the elision analyser/);

  // The final review still EXISTS; it is conditional, not deleted.
  assert.match(skill, /buys the FINAL review: ONE fresh reviewer over the WHOLE diff again/);
  // And the five-delta cap survives on the escalated path.
  assert.match(skill, /\*\*A delta chain that keeps producing fixes stops after the FIFTH DELTA ROUND\*\*/);

  // A review finding that is out of scope is reported, not filed.
  assert.match(skill, /\*\*Do not file follow-up issues for what a review turns up\.\*\*/);

  // The do-not-restore note must record WHY the two-review floor went, or
  // the next agent reads the missing final review as a regression to fix.
  assert.match(skill, /Do NOT reinstate an unconditional final review or an unconditional two-review floor/);
  assert.ok(
    !/every PR gets at least two reviews/.test(skill),
    'the unconditional two-review floor is back in the skill',
  );

  // The hook mirrors the skill, so the default must match on both sides.
  assert.match(hook, /defaults to its FAST shape/);
  assert.match(hook, /Escalate to the THOROUGH shape/);
  assert.match(hook, /Do not file follow-up issues for review findings that are out of scope/);
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
  // Under the fast default it is specifically a MUST-FIX fix, since a
  // minor-only round cannot introduce the class of defect a round catches.
  assert.match(skill, /\*\*Only a MUST-FIX fix buys a round, and it buys exactly ONE:\*\*/);
  assert.match(skill, /A rejection buys one REFUTER, a deferral buys nothing/);
  assert.match(skill, /what a rejection buys instead of a whole round, and it terminates: one spawn per rejection, never a refuter of a refuter/);
  // A refuter has two verdicts and the cycle must define both, or a finding
  // whose rejection was contradicted ends with no disposition at all.
  assert.match(skill, /On the post-rejection use only, a refuter that answers `STANDS` has contradicted your rejection/);
  // The pre-action gate has no rejection to overturn, so STANDS means the
  // finding is real, and a final-phase fix cannot buy a round that phase
  // forbids.
  assert.match(skill, /On the pre-action gate there is no rejection yet/);
  assert.match(skill, /on the final review it joins that phase's single fix-check instead/);
  // The two uses fail in opposite directions when no refuter can be spawned.
  assert.match(skill, /on the pre-action gate, act on the finding as real/);
  assert.match(skill, /keep the rejection but record it as UNREFUTED/);
});

test('the removed machinery stays removed, with the reason recorded', () => {
  // The paragraph that tells a future reader the omissions were deliberate.
  assert.match(skill, /Do not restore what this replaced/);
  assert.match(skill, /Almost all of it is gone on purpose: termination is mostly structural now/);
  // The fleet workflow itself is gone from the repo.
  assert.ok(!existsSync(resolve(repo, '.claude/workflows/deep-review.js')), 'the deep-review fleet workflow is back');
  // None of the removed mechanisms may re-enter, as a rule or as vocabulary.
  // The do-not-restore paragraph describes them WITHOUT these words ("two
  // tiers", "a 5-round budget", "poll a file"), so the expected count is
  // zero and any occurrence is a re-introduction rather than a mention.
  for (const [label, re] of [
    ['the substantive/prose tier vocabulary', /substantive[^.]{0,40}(tier|prose)|(tier|prose)[^.]{0,40}substantive/i],
    ['the round budget', /round budget|over budget/i],
    ['the polling watchdog', /watchdog/i],
  ]) {
    assert.ok(!re.test(skill), `${label} is back in the skill`);
  }
});

test('CI is read only at the merge gate, never at the end of the cycle', () => {
  // The third removal in this section, pinned the same way as the fleet and
  // the two-review floor above: the note that records WHY it went, plus the
  // counterfactual that the read itself has not crept back.
  assert.match(skill, /\*\*This is the ONLY place CI is read, on purpose\. Do not add one back to the end of the review cycle\.\*\*/);
  // The cost it accepts must stay stated, or the next reader takes the
  // removal for an oversight and restores the read to "fix" it. It is stated
  // as an open CLASS derived from ci.yml, never a written-down membership.
  // Three attempts at listing it were wrong in both directions (inflated by
  // jobs the local suites do cover, then closed while omitting one they do
  // not), so the instruction not to enumerate is itself load-bearing.
  assert.match(skill, /Every `ci\.yml` job with no counterpart in the deferred local suites/);
  assert.match(skill, /That is a CLASS, not a list/);
  assert.match(skill, /Do NOT write the membership down here/);

  // The four instructions that USED to make the cycle wait on CI. Each is
  // gone, and a revert of the hunk that removed it puts its phrasing back.
  for (const [label, re] of [
    ['the ready-to-merge condition', /suites it deferred have run AND CI has been read green/],
    ['the keep-the-cycle-fast rule', /Never wait on CI between rounds/],
    ['the end-of-cycle batch', /and only now read CI|plus a background CI watch/],
    ['the report preamble', /the deferred suites, and the CI read, report exactly/],
  ]) {
    assert.ok(!re.test(skill), `${label} tells the cycle to read CI again`);
  }

  // The gate the removal leans on has to stay strict, since it is now the
  // only CI checkpoint there is.
  assert.match(skill, /\*\*Merge is gated on green CI, enforced at the branch level, not by trust\.\*\*/);
  assert.match(skill, /\*\*NEVER use `gh pr merge --admin` to bypass a FAILING check\.\*\*/);
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
  // Waiting must not block the turn, which is the whole point of spawning
  // the reviewer in the background, and the optional progress check must
  // never kill on a timer or on a flat file (elapsed time says nothing: a
  // reviewer here runs 5 to 10 minutes while working normally, and a file
  // that never grows may simply be a stub the harness does not write to).
  assert.match(skill, /\*\*Waiting is not blocking\.\*\*/);
  assert.match(skill, /never wait on it with a foreground `sleep`/);
  assert.match(skill, /\*\*A progress check is optional, runs in the BACKGROUND, and never kills\.\*\*/);
  assert.match(skill, /elapsed time never proves a stall/);
  assert.match(skill, /never wire one to a flat file or a timer/);
  // There is no automatic trigger beyond a dead status, so giving up is a
  // deliberate call, and that call is the one place elapsed time legitimately
  // counts. It is scoped to the state with nothing to read, it requires
  // having actually probed, and it stops the reviewer rather than leaving a
  // second one in flight.
  assert.match(skill, /Giving up applies ONLY where there is no growth to see/);
  assert.match(skill, /that judgement is the one place elapsed time legitimately counts/);
  // The give-up clause must not reach the one state that HAS a positive
  // signal, or it contradicts "leave it alone however long it has run".
  assert.match(skill, /A transcript that is still growing is never abandoned, whatever the clock says/);
  // An abandoned reviewer was produced and may still return, so it is not a
  // failed spawn, and its late findings are read rather than discarded.
  // "No growth to see" must mean you looked, or never probing re-authorizes
  // abandoning a reviewer that is in fact working.
  assert.match(skill, /means you PROBED and saw none, never that you did not look/);
  // Giving up stops the reviewer, so no second one is ever left in flight to
  // return late findings the cycle has no phase or review object to absorb.
  assert.match(skill, /Giving up means STOPPING it \(`TaskStop`\) and re-spawning/);
  assert.ok(!/Take whichever returns first as the round/.test(skill), 'the two-reviewers-in-flight case is back');
  // Step 1 must not ban polling outright while the bullet below sanctions a
  // background size probe of the same spawn.
  assert.ok(!/Do not poll it and do not re-read its message/.test(skill), 'step 1 bans the probe the progress check sanctions');
  assert.match(skill, /Do not badger it for results/);
  // And the do-not-restore paragraph must not claim a replacement mechanism
  // richer than what is actually there, which is how a polling watchdog
  // grew back once already.
  assert.match(skill, /the harness completion notification is the signal, with at most an optional background progress check that never kills anything/);
  // The liveness sentence must not claim the harness status is the ONLY
  // signal while the progress check reads byte growth as one.
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
  assert.match(hook, /the cycle ends when nothing must-fix is left open, meaning the check came back with nothing or there was no fix to check because every must-fix finding the final review raised was rejected or deferred/);
  assert.match(hook, /a check that does find something must-fix gets that fixed and one more check of the same shape, and only if that one also finds something must-fix do you stop and report the PR unfinished/);
  assert.match(hook, /Only a FIX buys another round/);
  assert.match(hook, /a delta chain that keeps producing fixes stops after the fifth delta round, unfinished, rather than continuing/);
  // The code-review skill's own findings are input to the cycle, not a
  // round of it.
  assert.match(hook, /auxiliary input, not as a round of it/);
});
