# The GitHub API budget: which `gh` command to reach for

**This is the single source for the rule. Skills and hooks LINK here; they do not
restate it.** An earlier copy of this doctrine lived inside one skill only, and
that skill then violated its own rule a hundred lines above where the rule was
written. Restating is how that happened, so do not restate it.

## The one fact that drives everything

GitHub scores two independent budgets, and `gh` routes to them in a way that is
not obvious from the command name.

| Budget | Size | Scored in | Who spends it |
|---|---|---|---|
| GraphQL | 5000 / hour | **points**, roughly `ceil(nodes/100)` per query | every `gh` porcelain command, and all of Projects V2 |
| REST core | 5000 / hour | requests | `gh api <path>` |
| REST search | 30 / minute | requests | `gh api search/...` |

Points are the trap. One query that walks a large connection can cost hundreds
of points, so a handful of careless calls exhausts the hour while the request
COUNT still looks tiny.

**Every `gh` porcelain command below issues `POST /graphql` and nothing else**,
verified with `GH_DEBUG=api`:

`gh issue view` `gh issue list` `gh pr view` `gh pr list` `gh pr diff`
`gh pr checks` `gh pr status` `gh search issues`

That is essentially the whole read surface an agent uses. Left alone, an agent
session spends its entire GitHub budget on the small expensive pool and never
touches the large cheap one.

## The rule

**Reserve GraphQL for the two things only GraphQL can do. Everything else is
`gh api` over REST.**

Only these genuinely require GraphQL:

1. **Projects V2**, which has no REST API at all (the board, its fields, its
   item status).
2. **`resolveReviewThread`**, since REST cannot resolve a review thread.

## Substitutions

| Instead of | Use |
|---|---|
| `gh issue view N --json ...` | `gh api repos/{owner}/{repo}/issues/N` |
| `gh issue view N --comments` | `gh api "repos/{owner}/{repo}/issues/N/comments?per_page=100"` |
| `gh issue list --state open` | `gh api "repos/{owner}/{repo}/issues?state=open&per_page=100"` |
| `gh issue list --label X` | `gh api "repos/{owner}/{repo}/issues?labels=X&state=all&per_page=100"` |
| `gh pr view N --json ...` | `gh api repos/{owner}/{repo}/pulls/N` |
| `gh pr list --state merged --head BR` | `gh api "repos/{owner}/{repo}/pulls?state=closed&head={owner}:BR"` then filter `merged_at != null` |
| `gh pr diff N` | `gh api repos/{owner}/{repo}/pulls/N -H "Accept: application/vnd.github.diff"` |
| `gh search issues ...` | `gh api "search/issues?q=..."` |
| `gh issue create` | `gh api -X POST repos/{owner}/{repo}/issues --input body.json` |

`{owner}` and `{repo}` expand from the current repository, in the path AND in a
query string, and resolve to nothing when there is no remote, so a call in a
test harness fails closed rather than erroring.

## Three commands that deliberately stay on GraphQL

These run ONCE per PR, so their cost is noise, and each has a specific reason
that outweighs it. Do not "finish the job" by converting them.

**`gh pr merge`.** Two PostToolUse hooks detect a merge by matching the literal
string `gh pr merge` in the command. Rewriting it to `gh api -X PUT .../merge`
silently stops both firing, so merged worktrees leak and the global CLI is never
updated. If it ever has to change, the regexes in
`.claude/hooks/cleanup-merged-worktree.sh` and
`.claude/hooks/release-global-update.sh` change in the same commit.

**`gh pr create`.** The porcelain resolves the base, head, and repo from local
git state. The REST equivalent needs all three passed explicitly and is easy to
get subtly wrong.

**`gh pr checks`.** This one is the merge gate, and it merges check-runs AND
legacy commit statuses into a single verdict. A hand-rolled replacement has to
read `commits/<sha>/check-runs` and `commits/<sha>/status` and combine them, and
would have to keep doing so correctly forever. The combined-status endpoint also
reports `state: "pending"` when a commit has NO statuses at all, which on this
repo (10 check-runs, 0 statuses, measured) makes the obvious one-call version
report a fully green PR as pending. A cheap call on a path where a miss lets a
red build onto `main` is not worth optimizing.

## Four traps in the REST replacements

1. **`GET /repos/{o}/{r}/issues` returns pull requests too.** On this repo that
   is 4 PRs mixed into 24 open "issues". Filter with
   `select(has("pull_request") | not)` or you will report PRs as issues.
2. **REST paginates at 30 by default.** Pass `per_page=100`, and `--paginate`
   where completeness matters. This is the REST-side echo of the
   `--limit 20000` trap and truncates just as silently.
3. **A `gh` on PATH may print a banner to STDOUT.** A wrapper that announces
   itself before exec'ing the real binary (a mise shim does this) puts that text
   inside every `$(gh ...)` capture. In a script, ask for ONE scalar with `--jq`
   and take the last line, rather than capturing JSON and parsing it. JSON with
   a line in front of it does not parse at all, so this fails loudly in tests
   and silently in a hook.

   **The banner is emitted INCONSISTENTLY**, only when the wrapper re-resolves
   its tool, so it is present on one call and absent on the next within a single
   session. Never strip it by POSITION. `tail -n +2` on multi-line output
   silently deletes the first real line whenever the banner did not appear, and
   on an issue-body round trip that means the body comes back a line short with
   no error anywhere. Strip it by PATTERN (`sed '1{/^mise /d}'`) or, better,
   avoid the problem: send bodies with `--input <file>` and read them back to a
   file, so no multi-line payload ever rides a shell capture.
4. **`gh api rate_limit` is free.** It does not consume budget, so a step about
   to do heavy board work can check first and degrade or report honestly rather
   than failing mid-run.

## Projects V2, the part that must stay on GraphQL

The board is the one legitimate GraphQL consumer, so spend its points well.

**Never dump the whole board to answer a question about ONE issue.** Measured on
2026-08-08, against this board:

| Call | Cost |
|---|---|
| `gh project item-list 1 --owner webjsdev --limit 20000` | **631 points** |
| the single-issue node lookup below | **1 point** |

That is 13% of the hourly budget for one dump, and the skills used to call it
two to four times per invocation. Reach the item id from the ISSUE node instead.
It aliases, so a whole batch still costs one request, and the result is stable
enough to cache for the session:

```sh
gh api graphql -f query='query($n:Int!){repository(owner:"webjsdev",name:"webjs"){
  issue(number:$n){projectItems(first:5){nodes{id project{number}
  fieldValueByName(name:"Status"){...on ProjectV2ItemFieldSingleSelectValue{name}}}}}}}' -F n=<N>
```

**Never call the full-board dump in a loop.** One whole-board read is legitimate,
in `webjs-list-todos`, which renders every card. Even there, select only the
fields being rendered rather than `fieldValues(first:100)`.

**Do not re-resolve the static ids.** The project id, the Status field id, and
its option ids never change. They live in `.claude/gh-ids.env`; source that file
instead of spending three GraphQL round trips per run rediscovering constants.
Refresh it with the command written at the top of that file if the board schema
ever changes.

**Keep polling off GraphQL entirely.** Waiting on background work means repeated
reads, and those belong on the REST issues endpoint.
