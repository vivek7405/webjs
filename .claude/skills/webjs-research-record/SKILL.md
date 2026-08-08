---
name: webjs-research-record
description: Use this skill to record a research, design, or decision investigation on the webjsdev/webjs project. A research/design record is a CLOSED GitHub issue labeled `research` (the durable writeup lives in the issue body plus comments), never a file in the framework's reference docs (the skill at `.agents/skills/webjs/`) and never a comment buried on an unrelated PR. Trigger phrases include "research whether X", "investigate X", "evaluate X vs Y", "compare A and B and decide", "design record for Z", "decision record", "write up the design", "spike X", or any natural-language ask whose deliverable is a writeup of a comparison, options, or a decision rather than shipped code.
when_to_use: |
  Examples that should trigger this skill:
    "research whether we should switch the default ORM"
    "investigate the SSR partial-nav approach and write it up"
    "evaluate Drizzle vs Prisma and record the decision"
    "spike path-alias imports and capture the findings"
    "this is a design record, where should it go"
    "write up the design for the streaming protocol"
  Use this the moment a task's deliverable is a writeup (a comparison, an options analysis, a design or decision record) with no code diff. The implementation that follows is separate tracked work filed via webjs-file-issue.
  Do NOT trigger for: filing an actionable feature/bug task (webjs-file-issue), starting work on an existing issue (webjs-start-work), or a change that ships a real code diff (that is a normal PR).
---

# Record a research / design investigation as a closed `research` issue

The framework's reference docs (the skill at `.agents/skills/webjs/`) exist ONLY to teach AI agents how to USE WebJs. They are NOT a home for research write-ups, design records, or decision histories. Polluting them rots their purpose. So a research/design/decision investigation is recorded as a **GitHub issue**, labeled `research`, with the full writeup in the body plus deep-dive comments, then **CLOSED** to keep the record.

## The two mistakes this skill prevents

1. **Do NOT write the record as a file in the framework's reference docs** (no `<topic>-design.md` / `<topic>-research.md` committed under the skill at `.agents/skills/webjs/` or any other doc surface). That was the #548 cleanup.
2. **Do NOT bury the record as a comment on an unrelated PR or issue.** It must be its own labeled `research` issue, or it is not filterable. (This exact mistake happened on #548. The record was first archived as a comment on the cleanup PR #552, then mis-filed as a `research:` PR #559, before the convention settled on a labeled issue at #560.)

## Why an issue, not a PR

A research record has **no code diff**. A PR is a "merge this diff" object, so a research PR needs an empty-commit hack and leaves a dangling branch behind (see the now-deleted branch from #559). An issue is the native home for a writeup with threaded discussion. It is filterable by the `research` label, and it fits the project model where the GitHub Project board backed by issues is the source of truth. Earlier records used closed PRs (#546, #553); the convention going forward is a labeled issue. Do not convert the old PRs unless asked.

## Investigate in parallel

A comparison or options analysis is multi-angle work, and each angle is an independent read: one option's codebase evidence, the prior art, the project's own constraints in AGENTS.md, what the ecosystem does. For a multi-option or multi-angle investigation, spawn one read-only `Explore` agent per option or angle in ONE message, each returning evidence with concrete file paths and citations, then synthesize yourself. Reads fan out; the writeup and its judgment stay with you, because the record's voice and conclusions are the caller's, not an agent vote. A single-question spike needs no fan-out. Nothing here changes WHERE the record lands (the closed `research`-labeled issue below).

## Lifecycle: backlog item then findings in the SAME issue

Research often starts as a planned **backlog item**, an OPEN `research`-labeled issue ("research whether X") sitting in the board's Todo column. When an agent actually does the research, the findings go into **that same issue**, NOT a new PR:

1. The investigation thread (options weighed, dead-ends, reversals) goes in as **comments**.
2. The final conclusion is curated into the **issue body** so a reader gets the answer without scrolling the whole thread.
3. When research concludes, **close** the issue. The question and its answer now live together, filterable by the label.

So there are two entry points, same destination:
- **No issue exists yet** (a record being captured after the fact, or relocated out of the reference docs): create the `research`-labeled issue with the writeup, then close it.
- **A backlog research issue already exists**: append findings to it (comments + curated body), then close it. Do not open a PR.

### The one carve-out where a PR is right

If the research produced **actual code** worth showing (a throwaway spike or prototype), open a **draft PR for that code** and link it from the research issue. The decision write-up still lands in the issue body and comments, and the spike PR is closed (not merged) unless it graduates into real implementation, which is then a separate `webjs-file-issue` task. A pure no-code record never gets a PR.

## Inputs

Extract from the user's request:
- A **title** prefixed `research:` (lowercase), short and descriptive of the question or decision.
- A **body** capturing the full record: the question/problem, the options compared, the decision and its rationale, and any "what shipped vs what was recommended" reversal. If the record is being relocated out of the reference docs, recover the original file content from git history and preserve it verbatim in the body.
- **Deep-dive comments** for threaded detail (key reversals, the motivating bug, cross-references to related issues/PRs).

## Steps

Every call below is REST (`gh api`). The `gh issue *` porcelain goes through
GraphQL, whose point budget is routinely spent here, and writing the record IS
this skill's whole deliverable, so it must not be the thing a spent budget
blocks. See `.claude/gh-budget.md`. Build every body payload with
`jq -n --rawfile` so backticks and `$` in the prose never reach the shell.

1. **Ensure the `research` label exists** (one-time):
   ```sh
   gh api "repos/webjsdev/webjs/labels?per_page=100" --jq '[.[].name] | index("research")'
   # if that prints null:
   gh api -X POST repos/webjsdev/webjs/labels -f name=research -f color=5319e7 \
     -f 'description=Research/design/decision record (no code); filter these to read design history'
   ```
2. **Find or create the issue.** If a backlog `research` issue already exists for this question, use it. Otherwise create one:
   ```sh
   jq -n --rawfile b /tmp/research-record.md \
     '{title:"research: <question or decision>", body:$b, labels:["research"]}' > /tmp/rec.json
   gh api -X POST repos/webjsdev/webjs/issues --input /tmp/rec.json --jq '"\(.number) \(.html_url)"'
   ```
   When appending to an existing backlog issue, also curate the final conclusion into its body so the answer is readable without the whole thread:
   ```sh
   jq -n --rawfile b /tmp/research-record.md '{body:$b}' > /tmp/rec-body.json
   gh api -X PATCH repos/webjsdev/webjs/issues/<n> --input /tmp/rec-body.json --jq .number
   # confirm the label is present (adding one already on the issue is a no-op):
   gh api -X POST repos/webjsdev/webjs/issues/<n>/labels -f 'labels[]=research' --jq '[.[].name]|join(",")'
   ```
3. **Add deep-dive comments** for the threaded detail:
   ```sh
   jq -n --rawfile b /tmp/deep-dive.md '{body:$b}' > /tmp/rec-comment.json
   gh api -X POST repos/webjsdev/webjs/issues/<n>/comments --input /tmp/rec-comment.json --jq .html_url
   ```
4. **Close the issue as completed** (it is a record, not open work):
   ```sh
   gh api -X PATCH repos/webjsdev/webjs/issues/<n> -f state=closed -f state_reason=completed \
     --jq '"\(.state)/\(.state_reason)"'
   ```
5. **Report** the issue number and confirm it carries the `research` label.

## After the record

The actual implementation that the research points to is **separate tracked work**. File it via the **webjs-file-issue** skill as its own actionable issue. Keep the research record (the "why") and the implementation task (the "what to build") as distinct issues so the board reads cleanly.

## Verify

```sh
# All research records, filterable by the label:
gh api "repos/webjsdev/webjs/issues?labels=research&state=all&per_page=100" \
  --jq '.[] | select(has("pull_request") | not) | "#\(.number) \(.title)"'
```

REST rather than `gh issue list`, which goes through GraphQL. See
`.claude/gh-budget.md` for the rule and the full substitution table. The
`pull_request` filter is not optional: the REST issues endpoint returns PRs
alongside issues.
