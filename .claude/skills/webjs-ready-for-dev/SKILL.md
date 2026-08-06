---
name: webjs-ready-for-dev
description: Use this skill when the user asks to get one or more tracked issues ready for development. Trigger phrases include "get #1253, #1264 ready for development", "ready these issues for dev", "prep #1265 for development", "make these todos implementation-ready", "write the implementation plans for these issues", "scope these issues out", or any ask whose deliverable is a verified implementation plan written INTO an existing issue body rather than shipped code. The skill runs one autonomous background agent per issue, in parallel, each of which verifies the issue's claims against the current codebase, settles every open design call, rewrites the issue body into a cold-start-ready plan, and moves the card to the Ready column on the project board.
when_to_use: |
  Examples that should trigger this skill:
    "get #1253, #1258 and #1264 ready for development"
    "ready these issues for dev: 1261, 1263"
    "prep #1265 for development"
    "make those todos implementation-ready"
    "write implementation plans for the low risk issues"
    "scope out #1269 so an agent can pick it up"
  Do NOT trigger for: filing a NEW issue (webjs-file-issue), starting the
  implementation of an issue that is already planned (webjs-start-work),
  listing what is open (webjs-list-todos), or a research writeup with no
  implementation to follow (webjs-research-record).
---

# Get tracked issues ready for development

"Ready for development" is a definition of done for PLANNING, not for code. An
issue is ready when a cold AI agent, with zero access to the conversation that
produced it, can implement it end to end without a discovery phase and without
asking a single question.

This skill takes a list of issue numbers and, for each one in parallel, spawns
a fully autonomous background agent that verifies the issue against the current
codebase, settles every open call, rewrites the issue body into a complete plan,
and moves the card to **Ready** on the project board.

Nothing here writes code. The deliverable is the issue body.

## Inputs

- **Issue numbers.** Parse them from the prompt (`#1253`, `1253`, "the low risk
  ones we listed"). If the user names a set from an earlier turn, use that set.
- **Nothing else is required.** The skill is autonomous by design: it never asks
  the user to settle a design question, because settling those questions IS the
  work. Every call is decided from industry standard practice, the prior art in
  the sibling framework clones, and the repo's own conventions, and the plan
  records what settled it.

## Steps

### 1. Read the board and the issue bodies

```sh
gh project item-list 1 --owner webjsdev --format json --limit 20000
gh issue view <N> --repo webjsdev/webjs --comments
```

Most WebJs issues already carry a partial `## Implementation plan` written when
they were filed. That is a starting point, not a finished plan. The agent's job
is to VERIFY it against the current code, complete every decision it left open,
and expand it to step level.

### 2. Pre-flight conflict analysis (do this before spawning anything)

The whole point of running the batch in parallel is that the resulting PRs land
independently. So before spawning, map each issue to the files it will touch and
look for overlap.

- **Disjoint file surfaces.** Spawn together. This is the common case.
- **Two issues touching the same file in different regions.** Spawn together, but
  tell EACH agent about the other in a LANDMINE line, naming the other issue and
  the shared file, and instruct it to keep its diff confined so the two merge
  cleanly.
- **Two issues touching the same function, or one whose output the other consumes.**
  Do not spawn both. Plan the upstream one now and tell the user the downstream
  one is queued behind it. A plan written against code another in-flight PR is
  about to rewrite is stale the day it lands.

Say the conflict map out loud in the final report, so the user can see which
PRs are safe to run at once afterwards.

### 3. Spawn one background agent per issue, in ONE message

Use the Agent tool, `subagent_type: general-purpose`, `run_in_background: true`,
one call per issue, all in a single message so they run concurrently. Name each
agent `plan-<issue-number>`.

**Do NOT use worktree isolation.** These agents are read-only on the repo and
several of them need to run a real repro against the installed dependency tree,
which a fresh worktree does not have. Read-only discipline is enforced by the
prompt instead (see the hard constraints in the template below), and it matters:
the agents share the primary checkout, so a stray `git checkout` in any one of
them would move HEAD under all the others.

### 4. The agent prompt template

Every agent prompt is built from this template. Fill the placeholders and add a
per-issue **specific ground to cover** block naming the real files, functions,
prior incidents, and the questions that must be settled. That block is what makes
the difference between a plan and a restatement, so ground it by actually reading
the issue and grepping the code first.

````text
You are producing a complete IMPLEMENTATION PLAN for GitHub issue #<N> in the
WebJs framework monorepo at <repo path>, and writing it into the issue body. You
are FULLY AUTONOMOUS: never ask a question, settle every open call yourself using
industry standard practice and prior art, and state what settled each decision.

ISSUE: #<N> "<title>" (webjsdev/webjs). Start with
`gh issue view <N> --repo webjsdev/webjs --comments`.

SPECIFIC GROUND TO COVER
<the per-issue block: real paths and line anchors to verify, the decisions that
must be settled with the constraint that decides each one, the prior art to
consult by clone path, the measurement or repro to run, the cross-issue
landmines, the test layers and doc surfaces in play>

HARD CONSTRAINTS
- READ-ONLY on the repo. Do NOT create, edit, or delete any file inside the repo.
  Do NOT run any git command that mutates state (no checkout/switch/add/commit/
  stash/branch/worktree/rebase/merge/restore/clean). `git log`, `git show`,
  `git blame`, read-only `git diff` are fine. Other agents share this working
  tree, so moving HEAD would corrupt their work.
- Do NOT run `npm install`/`npm ci` or anything that writes `package-lock.json`.
- Scratch files and repro scripts go ONLY in <scratchpad>. Running a read-only
  node script or an existing test command to verify a repro is encouraged.
- Do NOT open a PR, branch, comment, or new issue, and do not change labels,
  assignees, or status. Your ONLY mutation is `gh issue edit`.

DELIVERABLE
Rewrite the ENTIRE issue body so a cold AI agent with zero access to this
conversation can implement it end to end with no discovery phase. Write it to
<scratchpad>/issue-<N>-body.md and apply it with:
  gh issue edit <N> --repo webjsdev/webjs --body-file <scratchpad>/issue-<N>-body.md
Never pass `--body "..."`, because backticks and `$` get shell-expanded and
silently eat whatever they contained.

BODY SHAPE (exact section order)
## Problem  (keep the existing statement's substance; verify every claim and line
anchor against current code, correct anything stale and note the correction)
## Design / approach  (the settled decision, why it is right, alternatives
considered and REJECTED with reasons, prior art cited by file path)
## Implementation plan  (ordered concrete steps; each names the exact file,
function and current line anchor, quotes the code as it exists today, and shows
how it should read after. No "consider" or "maybe": every call decided)
## Tests  (every applicable layer by file path, existing file to extend or new
file with its exact path following sibling naming; the counterfactual that fails
when the change is reverted; state which layers do NOT apply and why)
## Docs  (every doc surface by path with what changes on each; if none applies,
say so and name the `WEBJS_NO_DOC_GATE=1` escape hatch with justification)
## Acceptance criteria  (checkbox list of observable results)
## Out of scope  (what the implementer must NOT widen into)

PROJECT RULES YOU MUST OBEY IN YOUR OWN PROSE AND ENCODE IN THE PLAN
- Read `<repo path>/AGENTS.md` first (it is the contract) and `framework-dev.md`
  for monorepo specifics.
- Invariant 11 prose rules: NO em-dashes (U+2014), no space-surrounded hyphen or
  semicolon used as a pause between words, no colon attached to a code-shaped
  left-hand side. Write `WebJs` capitalized wherever it names the project in
  prose; lowercase `webjs` ONLY as a literal code token inside backticks.
- `packages/` is plain `.js` with JSDoc. Never propose adding a `.ts` file there.
- Tests are required at every applicable layer (unit, browser, e2e, smoke), and
  Bun parity under `test/bun/**` is mandatory for a runtime-sensitive surface
  (the serializer, the listener and request path, SSR/action/CSRF dispatch,
  streams, `node:crypto`, the TS stripper, auth/session/cors).
- WebJs has no users yet: prefer a clean change over a back-compat shim.
- Do not propose filing follow-up issues. Fold small same-file tweaks into the
  same PR; note anything genuinely separate under Out of scope.
- Prior art clones live beside the repo at `~/Documents/Projects/frameworks/`
  (next.js, remix, remix-v2, rails, turbo, lit, astro, svelte, solid, qwik, vite,
  tanstack-router, shadcn, tailwindcss). Consult the relevant one before settling
  a design question and cite the file you read.
- Note the current HEAD commit (`git log -1 --format=%h`) in the body so the line
  anchors are dated.

When finished, report: the decisions you settled, any measurement you took,
anything stale you found in the existing body, and confirmation the
`gh issue edit` applied.
````

### 5. Verify each plan and move the card to Ready

**Poll the issue body over REST, never GraphQL.** An agent reporting success is
not proof, so confirm the body actually changed, and confirm it against the
section contract rather than by eye. `gh issue view --json` goes through GraphQL,
which is the budget this skill has to protect (see "GraphQL budget" below), while
the issues REST endpoint does not:

```sh
gh api repos/webjsdev/webjs/issues/<N> --jq '.body' \
  | grep -cE '^## (Problem|Design / approach|Implementation plan|Tests|Docs|Acceptance criteria|Out of scope)$'
```

Seven means the contract is met. Anything less means the agent has not written
yet, or wrote a partial body, and the card stays where it is.

Then move the card. The board carries a **Ready** column between Todo and In
progress. These ids are stable, so hard-code them rather than looking them up:

| Thing | Id |
|---|---|
| Project | `PVT_kwDOERfAXc4BZDhV` |
| Status field | `PVTSSF_lADOERfAXc4BZDhVzhUE7nE` |
| Ready option | `ad471dd5` |

The one thing you must fetch is each issue's project-item id. Fetch them ONCE for
the whole batch, in a single aliased query, and cache the result in the scratchpad:

```sh
gh api graphql -f query='
query {
  r: repository(owner: "webjsdev", name: "webjs") {
    i1253: issue(number: 1253) { projectItems(first: 5) { nodes { id project { number } } } }
    i1264: issue(number: 1264) { projectItems(first: 5) { nodes { id project { number } } } }
  }
}' | jq -r '.data.r | to_entries[]
  | "\(.key|ltrimstr("i"))=\(.value.projectItems.nodes[] | select(.project.number == 1) | .id)"'
```

Then each move is one small mutation against the cached id:

```sh
gh project item-edit --id "$ITEM" \
  --project-id PVT_kwDOERfAXc4BZDhV \
  --field-id PVTSSF_lADOERfAXc4BZDhVzhUE7nE \
  --single-select-option-id ad471dd5
```

Move the card ONLY after the body edit is confirmed. A card in Ready is a promise
that the plan in the body is implementable, so a card moved on a failed edit is
worse than one left in Todo.

### GraphQL budget

The GitHub Projects V2 API is **GraphQL only**, and it rate-limits on a point
budget rather than a request count, so a few careless calls exhaust it for the
session. Two rules keep this skill inside it.

**Never call `gh project item-list 1 --owner webjsdev --limit 20000` in a loop.**
That query paginates every item on the board (well past 500 today) to find one
id. Reach the item id from the ISSUE node instead, as above: it is a single node
lookup, it aliases so a whole batch costs one request, and the result is stable
enough to cache for the session.

**Keep polling off GraphQL entirely.** Waiting on N background agents means
repeated reads, and those belong on the issues REST endpoint
(`gh api repos/webjsdev/webjs/issues/<N>`), which has its own separate budget.
Reserve GraphQL for the two things only it can do: the one batched item-id fetch,
and the per-card status mutation.

### 6. Report

Give the user, per issue: the decisions the agent settled, anything it found
stale in the old body, and the card's new column. Then give the conflict map from
step 2, so they know which of the planned issues can be implemented in parallel.

## What a ready issue looks like

The bar is the cold-start test, applied to the rewritten body: reread it as
though you had never seen the conversation. Could you start work from it alone,
with no clarifying question and without first hunting for where the code lives?

Concrete failure signs, any one of which means the plan is not ready:

- It names an area ("the router", "the prefetch logic") instead of a path.
- It says "consider" or "we could" anywhere a decision belongs.
- It cites a line anchor nobody re-verified against current `HEAD`.
- It lists tests as "add tests" rather than naming the file and the assertion.
- It leaves the doc surfaces unnamed, so the doc gate blocks the implementer at
  commit time with no guidance.

## Failure handling

- **An agent reports it could not settle a call.** That is a prompt failure, not
  a user question. Re-run that one agent with the constraint that decides it
  named explicitly (the invariant, the prior art, or the measurement to take).
- **`gh issue edit` fails.** Usually the body file path or an auth scope. Surface
  the error, keep the drafted body in the scratchpad, and retry.
- **An agent's plan contradicts the issue's existing decision.** Keep the new one
  only if the agent produced EVIDENCE (code that moved, a measurement, prior art).
  A preference is not evidence, and re-litigating a settled call wastes the next
  implementer's time.
- **The issue turns out to be already fixed, or wrong.** Do not close it. Report
  it to the user with what you found and let them decide.

## What this skill does NOT do

- Does not write code, cut a branch, or open a PR. That is `webjs-start-work`,
  run later, once a human picks the issue up.
- Does not file new issues. That is `webjs-file-issue`.
- Does not move a card to In progress or Done. It only moves Todo to Ready.
- Does not close, relabel, or reassign anything.
