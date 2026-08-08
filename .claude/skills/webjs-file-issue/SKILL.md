---
name: webjs-file-issue
description: Use this skill when the user asks to file a new task, create an issue, or track new work on the webjsdev/webjs project. Trigger phrases include "file a task for X", "create an issue for Y", "track this as a todo", "add this to the todo list", "open an issue about Z", "make this an issue", "file a bug for ...", "add a new task", or any natural-language ask to create new tracked work in the webjs project at https://github.com/orgs/webjsdev/projects/1. The skill grounds the body in the real codebase first (concrete file paths, landmines, invariants, test and doc surfaces, since the implementer is an AI agent working cold), creates the GitHub issue, adds it to the project board, and reports the new issue number.
when_to_use: |
  Examples that should trigger this skill:
    "file a task for adding dark mode"
    "create an issue for the streaming bug"
    "track this as a todo: refactor the rate limiter"
    "open an issue about the broken sitemap"
    "add a new task to investigate the SSR race"
    "make this an issue"
  Do NOT trigger for: starting work on an existing issue (webjs-start-work), listing what's open (webjs-list-todos), or asks that are clearly about closing/editing an existing issue.
---

# File a new issue on the webjs project board

The webjsdev/webjs project tracks new work through GitHub issues added to the project board at https://github.com/orgs/webjsdev/projects/1. This skill captures a fresh task as an issue, files it, and adds it to the board so it appears in the Todo column.

## Inputs

The user describes the task in natural language. Extract:
- A short, imperative-mood **title** (under 70 chars; the same shape as a good commit subject).
- A **`dogfood:` title prefix** when the task came from dogfooding, meaning it surfaced while actually building a real app with webjs and hitting a framework gap, an idiomatic-code divergence, or a rough edge (the way #353 and #356 were found). Prefix the title `dogfood:` so the board shows at a glance which issues came from real app-building versus planned framework work. A task that did not come from building an app (a planned feature, a refactor, an internal bug) takes no such prefix. If it is unclear whether the task is dogfood-originated, ask, or look at whether the user was driving a generated/example app when the issue came up.
- A **body** that follows the issue-body convention used in #112 / #113 / #114: short problem statement, design rationale or context, acceptance-criteria checklist, AND an implementation-notes section (see "Issue body convention" below for why this is mandatory).
- A **label** if the type is clear from the description: `enhancement` for new features and improvements, `bug` for something broken, `documentation` for docs work. If unclear, default to `enhancement` (the most common case on this project).

If the user's description is very thin (e.g. "track adding dark mode as a todo"), ask one clarifying question before filing: "Want me to scope this out a bit, or file the placeholder with just the title and you'll fill in details on the issue later?" Either answer is fine; just confirm before creating.

## Steps

1. **Ground the body BEFORE you create anything.** The one exception is a thin placeholder the user explicitly asked for (see Inputs above, and the placeholder note under "Issue body convention"): confirm that with them FIRST, because there is no point grounding a body they opted out of. For every real task this step is not optional, and it is the one that gets skipped.

   The implementer is an AI agent with zero access to this conversation (see "Issue body convention" below for why). So before calling `gh issue create`, actually open the codebase and collect:

   - the concrete **files / functions** the change touches, with real paths and approximate lines, found by `grep` / `Read`, not guessed;
   - the **landmines**: prior incidents (link the issue or PR), non-obvious constraints, anything that will bite someone who was not here;
   - the **invariants** the change must not break, linked to AGENTS.md where relevant;
   - the **test layers and doc surfaces** the change has to touch.

   A few greps now save the implementing agent a cold-start investigation later, and the difference is visible in the filed issue.

   **For an issue touching more than one area, fan the grounding out instead of hunting serially.** The four collections above are independent reads, so spawn parallel READ-ONLY `Explore` agents in ONE message, one per concern (where-to-edit paths; landmines via `git log` and prior-issue search; invariants from AGENTS.md; test and doc surfaces), then synthesize their returns into the Implementation-notes section yourself. Explore agents cannot write, which is the point: nothing edits the repo mid-filing. Inline grounding stays fine for a small single-area issue. Either way the gate is unchanged: a body that fails the cold-start test is unready, however it was researched.

   **Cold-start test, apply it to your own draft before filing.** Reread the body as if you had never seen this conversation. Could you start work from it alone, without asking a single clarifying question and without first having to find where the relevant code lives? If not, it is not ready. Two concrete failure signs: the body names an area ("the router", "the prefetch logic") rather than a path, or it describes the symptom without saying where the fix goes.

   The user should never have to ask for this. If they do, the skill was not followed.

2. **Create the issue AND assign it to vivek7405.** Every WebJs issue is assigned to the owner (vivek7405) at creation so the project board shows ownership at a glance.

   Write the grounded body to a scratch file first, then read it into the
   request with `jq -n --rawfile` so it never passes through the shell at all.
   Do NOT interpolate it into a shell string: an issue body is full of backticks
   and `$` characters, and an unquoted string runs them as command substitution,
   silently eating whatever they contained. This has already bitten this repo:
   a review posted with `gh api -f body=` lost every code reference in it and
   had to be deleted and reposted.

   ```sh
   # write the body to a scratch path first (any disposable location), then
   # build the request with jq so nothing is interpolated into a shell string
   jq -n --rawfile body /tmp/issue-body.md \
     '{title:"dogfood: the router drops the second click", body:$body,
       labels:["bug"], assignees:["vivek7405"]}' > /tmp/issue.json
   gh api -X POST repos/webjsdev/webjs/issues --input /tmp/issue.json \
     --jq '"\(.number) \(.html_url)"'
   ```

   REST rather than `gh issue create`, which goes through GraphQL. This is not
   theoretical: filing #1339 failed on `gh issue create` with
   `API rate limit already exceeded` and went through over REST unchanged. The
   skill that files the work must not be the thing a spent budget blocks. See
   `.claude/gh-budget.md`.

   Building the payload with `jq -n --rawfile` also settles the quoting problem
   the paragraph above describes, since the body never passes through the shell
   at all.

   A file path is used here rather than a heredoc on purpose. A heredoc whose
   `EOF` terminator is indented (which it will be, pasted from any nested
   context like this one) does not terminate: bash swallows the rest of the
   script into the body and still exits 0. That failure has shipped from this
   very section twice. If you do use a heredoc, put the terminator at column 0
   and run the command once to confirm it worked.

   The body follows the shape under "Issue body convention" below: Problem,
   Design / approach, Implementation notes, Acceptance criteria.

   Capture the returned issue URL and number.

3. **Add it to the project board.**

   ```sh
   gh project item-add 1 --owner webjsdev --url <issue-url>
   ```

   The card lands in Todo by default. No need to set Status explicitly.

4. **Report back briefly.** One short message: issue number + title + a link, and confirm it's on the board in Todo. Do not invent next steps; just confirm the artefact exists.

## Issue body convention

**Standing assumption: every issue here is implemented by an AI agent working COLD.** The agent that picks the issue up has ZERO access to the conversation that produced it. So the body is the entire brief, and it MUST carry enough for that agent to implement correctly without re-discovering everything: not just WHAT and WHY, but WHERE (the concrete files / functions / dirs to edit), the LANDMINES (known gotchas, prior incidents, non-obvious constraints), and the INVARIANTS to respect. An issue that reads well to a human who was in the room but leaves an agent guessing the file paths is under-specified. The user should not have to ask for this each time; it is the default.

Match the shape of issues #112 / #113 / #114 (all visible on the board):

```markdown
## Problem

<one or two paragraphs describing what's wrong or what needs adding>

## Design / approach

<the proposed direction, alternatives considered if any, references to prior art>

## Implementation notes (for the implementing agent)

<the WHERE and the LANDMINES, grounded in the actual codebase:>
- Where to edit: the concrete file(s) / function(s) / dir(s), with paths (e.g. `packages/cli/lib/create.js` `scaffoldApp()` around L275). Name the entry points, not just the area.
- Landmines / gotchas: known traps, a prior incident this touches (link the issue/PR), runtime or build constraints, anything non-obvious that will bite an agent who does not know it.
- Invariants to respect: project rules the change must not break (link AGENTS.md items where relevant).
- Tests + docs surfaces the change must touch (which test layer, which markdown / docs-site pages).

## Acceptance criteria

- [ ] <observable result 1>
- [ ] <observable result 2>
- [ ] A counterfactual proves the test actually fires (where applicable)
- [ ] Tests cover the new behaviour, at every layer it touches
- [ ] Docs / AGENTS.md updated if the public surface changed
```

The **Implementation notes** section is mandatory for any scoped issue, precisely because the implementer is an agent with no conversational context. If you find yourself writing it from memory, stop and go back to step 1: paths recalled rather than grepped are the ones that turn out to be stale, and a confidently wrong path costs the implementer more than no path at all.

For a thin placeholder (user just wants the line item tracked, explicitly deferring the detail), skip the Design / Implementation-notes / Acceptance sections; leave a single short paragraph in Problem and mark the issue "needs scoping". Use this ONLY when the user opts into a bare placeholder; the default for a real task is the fully-grounded body above.

## What this skill does NOT do

- Does not start a branch or open a PR. Those happen via `webjs-start-work` once the user is ready to work the item.
- Does not move the card out of Todo. Status changes happen via `webjs-start-work` (Todo to In progress) and the `Closes #N` automation (In progress to Done on merge).
- Does not consult or update internal task trackers or memory.

## Failure handling

- If the create call fails (auth, label missing, network): surface the error and offer to retry with adjusted args.
- If `gh project item-add` fails after the issue was created: report the partial state ("issue #N created but not on board yet") and offer to add it manually. Projects V2 is GraphQL-only, so this is the one step here a spent GraphQL budget can genuinely block; check `gh api rate_limit` (free) and report the reset time rather than leaving the issue silently off the board.
- If the user's description seems to duplicate an existing open issue: search over REST and ask whether to file anyway or use the existing one. Search the ISSUES, not the board: it matches bodies as well as titles, so it is the better dedupe, and it costs nothing from the GraphQL budget.

  ```sh
  gh api "search/issues?q=repo:webjsdev/webjs+is:issue+<keywords>&per_page=10" \
    --jq '.items[] | "#\(.number) [\(.state)] \(.title)"'
  ```
