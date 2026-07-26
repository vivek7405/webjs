---
name: webjs-file-issue
description: Use this skill when the user asks to file a new task, create an issue, or track new work on the webjsdev/webjs project. Trigger phrases include "file a task for X", "create an issue for Y", "track this as a todo", "add this to the todo list", "open an issue about Z", "make this an issue", "file a bug for ...", "add a new task", or any natural-language ask to create new tracked work in the webjs project at https://github.com/orgs/webjsdev/projects/1. The skill creates the GitHub issue with an appropriate body, adds it to the project board, and reports the new issue number.
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

1. **Ground the body BEFORE you create anything. This step is not optional and it is the one that gets skipped.**

   The implementer is an AI agent with zero access to this conversation (see "Issue body convention" below for why). So before calling `gh issue create`, actually open the codebase and collect:

   - the concrete **files / functions** the change touches, with real paths and approximate lines, found by `grep` / `Read`, not guessed;
   - the **landmines**: prior incidents (link the issue or PR), non-obvious constraints, anything that will bite someone who was not here;
   - the **invariants** the change must not break, linked to AGENTS.md where relevant;
   - the **test layers and doc surfaces** the change has to touch.

   A few greps now save the implementing agent a cold-start investigation later, and the difference is visible in the filed issue.

   **Cold-start test, apply it to your own draft before filing.** Reread the body as if you had never seen this conversation. Could you start work from it alone, without asking a single clarifying question and without first having to find where the relevant code lives? If not, it is not ready. Two concrete failure signs: the body names an area ("the router", "the prefetch logic") rather than a path, or it describes the symptom without saying where the fix goes.

   The user should never have to ask for this. If they do, the skill was not followed.

2. **Create the issue AND assign it to vivek7405.** Every webjs issue is assigned to the owner (vivek7405) at creation so the project board shows ownership at a glance.

   Pipe the body in through a QUOTED heredoc. Do not pass it as `--body "..."`:
   an issue body is full of backticks and `$` characters, and an unquoted shell
   string runs them as command substitution, silently eating whatever they
   contained. That is a real incident from this repo, not a hypothetical.

   ```sh
   gh issue create --repo webjsdev/webjs \
     --title 'dogfood: the router drops the second click' \
     --label bug \
     --assignee vivek7405 \
     --body-file - <<'EOF'
   ## Problem
   ...the grounded body from step 1...
   EOF
   ```

   The `<<'EOF'` quoting is what makes it safe, and `--body-file -` reads it from
   stdin so there is no temp file to create or clean up. Note `--body <<'EOF'` on
   its own does NOT work: `--body` would consume the next flag as its value.

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

- If `gh issue create` fails (auth, label missing, network): surface the error and offer to retry with adjusted args.
- If `gh project item-add` fails after the issue was created: report the partial state ("issue #N created but not on board yet") and offer to add it manually.
- If the user's description seems to duplicate an existing open issue: search the board first with `gh project item-list 1 --owner webjsdev --format json` and ask whether to file anyway or use the existing one.
