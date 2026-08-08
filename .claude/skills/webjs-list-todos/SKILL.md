---
name: webjs-list-todos
description: Use this skill when the user asks what work is open or pending on the webjsdev/webjs project board. Trigger phrases include "what are the current todo items", "what's pending", "list todos", "what's open", "what should I work on", "show me the open issues", "any open work for webjs", "what's in progress", "what's on the board", or any natural-language query about open items on the webjs project at https://github.com/orgs/webjsdev/projects/1. The skill calls `gh project item-list` and returns a bucketed view (Todo / In progress / Done) so the user sees the current state straight from the source of truth.
when_to_use: |
  Examples that should trigger this skill:
    "what are the current todo items"
    "what's pending"
    "list webjs todos"
    "what should I work on next"
    "show me the open issues"
    "any open work on the webjs board"
    "what's in progress right now"
  Do NOT trigger for: starting work on a specific issue (webjs-start-work handles that), filing a new task (webjs-file-issue handles that), or asking about closed/done items only (those are queryable but not the primary intent of this skill).
---

# List open work on the webjs project board

The webjsdev/webjs project tracks work on the GitHub Project at https://github.com/orgs/webjsdev/projects/1. This skill returns a current snapshot bucketed by Status, queried straight from GitHub. Do NOT consult internal task trackers or memory for this question.

## Steps

1. **Fetch the board state.**

   ```sh
   gh project item-list 1 --owner webjsdev --format json --limit 20000
   ```

   **This is the ONE place a whole-board dump is legitimate**, because this skill
   renders every card. Everywhere else, reach a single card from its issue node
   instead; see `.claude/gh-budget.md`.

   The dump is expensive even so. It paginates the entire board (past 500 items)
   at 100 per page, and the GraphQL budget is scored in points rather than
   requests, so it is worth several hundred points of the hourly 5000. Two rules
   follow, and neither is optional:

   - **Call it ONCE per invocation and reuse the result.** Never in a loop, and
     never a second time to answer a follow-up about one card.
   - **Do not re-run it to check one issue.** If the user asks about a specific
     number after this ran, use the single-node lookup in `.claude/gh-budget.md`.

   `--limit 20000` is load-bearing, not defensive: the default page is 30, so
   without it the board silently truncates and buckets come back wrong.

2. **Bucket by Status** (Todo, In progress, Done) and pretty-print each bucket with issue numbers and titles. If the user explicitly asked for only one bucket (e.g. "what's in progress"), filter accordingly.

3. **Default presentation.** Show Todo and In progress always. Show Done only if the user asks for it, or if both Todo and In progress are empty.

4. **For each item, show:** `#<number>  <title>`. Wrap in markdown so the user can click through.

## Example output shape

```
Todo:
  #112  Elide browser download of display-only component modules
  #113  Ship pre-built dist/ alongside src/ for @webjsdev/core
  #114  Rate-limit defaultKey trusts unverified X-Forwarded-For

In progress:
  (none)
```

If everything is in Done or the board is empty, say so explicitly.

## What this skill does NOT do

- Does not move cards, file new issues, or open PRs. Those are sibling skills (`webjs-start-work`, `webjs-file-issue`).
- Does not show closed issues outside the project board.
- Does not consult `~/.claude/projects/.../memory/` or any internal task tracker.

## Failure handling

- If `gh` returns an auth error: surface it directly to the user and suggest `gh auth refresh -s project`.
- If the project list is empty: report "Project board is empty" instead of fabricating items.
