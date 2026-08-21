---
name: pr-review
description: Review a GitHub pull request the way a human reviewer would, entirely inline, and post the review through the GitHub review API as ONE review object, a summary plus line-anchored comments that highlight the code to fix and carry suggestion blocks where a concrete replacement is obvious. Trigger whenever the user asks to review a PR ("review the PR", "review #123", "look over this pull request", "review the branch/changes" when the branch has an open PR). The reviewer ONLY reviews. It never fixes findings, never waits on or reports CI, never resolves threads, and never delegates to a subagent or another agent.
when_to_use: |
  Examples that should trigger this skill:
    "review the PR"
    "review #1453"
    "can you review this pull request"
    "review my changes" (when the branch has an open PR)
    "look over the diff for bugs" (when the diff is a PR)
  Do NOT trigger for: fixing review findings (that is normal branch work,
  a separate task from the review), responding to someone else's review
  comments, merging, or reviewing a local uncommitted diff with no PR
  (review that inline and report the findings in the conversation).
---

# Review a pull request (inline, posted via the GitHub API)

Review a PR like a human reviewer who happens to use the GitHub API
instead of the dashboard. Same output a person would produce on
github.com: one submitted review carrying a summary and inline comments
anchored to the exact lines, with GitHub suggestion blocks where the fix
is concrete enough to spell out.

This skill is agent-agnostic on purpose. Everything below is plain `gh`
CLI (or raw REST with any HTTP client and a token), no harness-specific
tools, so it works the same from any agent or harness that can run shell
commands.

## The contract (read first, all four are hard rules)

1. **Inline.** The agent that received the ask performs the review
   itself, in the same session. Never spawn a reviewer subagent, a
   fleet, or a background task for it, and never run a multi-round
   review cycle. One read over the whole diff, one posted review, done.
2. **Review only.** The reviewer never fixes what it finds: no commits,
   no pushes, no code edits, no resolving of threads. Findings are the
   deliverable. Fixing them is separate work for whoever owns the
   branch, on a separate ask.
3. **No CI.** Never wait on, read, or report CI or check status. Checks
   are the merge gate's business, not the reviewer's, and a review that
   stalls on a pending check has failed its one job of being fast
   feedback on the code.
4. **Read-only on git.** Reviewing needs no checkout. Do not run any
   git command that changes branch, HEAD, the index, or the working
   tree (`checkout`, `switch`, `reset`, `restore`, `stash`, `merge`,
   `rebase`, `clean`). Read-only inspection (`git log`, `git show`,
   `git diff`, `git status`, `git blame`) is fine.

## Steps

### 1. Resolve the PR

An explicit `#N` wins. Otherwise resolve the current branch's open PR
over REST (owner/repo from the git remote):

```sh
BRANCH=$(git branch --show-current)
gh api "repos/<owner>/<repo>/pulls?head=<owner>:$BRANCH&state=open" \
  --jq '.[0].number'
```

If nothing resolves, ask the user which PR they mean rather than
guessing.

### 2. Fetch what a reviewer reads

All over REST (in repos that budget GraphQL, these cost nothing there):

```sh
gh api repos/<owner>/<repo>/pulls/<N> \
  --jq '.title, .body, .head.sha, .head.repo.full_name, .user.login'
gh api repos/<owner>/<repo>/pulls/<N> -H "Accept: application/vnd.github.diff"
```

Then read every touched file in its PR-head state, not just the hunks,
so each edit is judged in context. Read locally if the branch happens to
be checked out, else through the contents API:

```sh
gh api "repos/<head-repo>/contents/<path>?ref=<head-sha>" --jq .content | base64 -d
```

Address the HEAD repo at the HEAD sha, not the base repo at a branch
name. A fork PR's branch does not exist in the base repo, so a
branch-name ref there 404s, and a sha pins every read to the exact
commit the review is posted against. Both values come from the first
call (`.head.repo.full_name`, `.head.sha`); on a same-repo PR the head
repo IS `<owner>/<repo>`, so one form covers both cases.

Capture `head.sha` from the first call for `commit_id` too.

### 3. Review the whole diff, yourself

Judge the change against what it claims to do (title + body) and the
project's own stated rules (root `AGENTS.md`, `CONVENTIONS.md`,
per-package variants, when present). Correctness first: wrong behavior,
broken edge cases, a test that cannot observe the defect it claims to
cover, security problems, a doc stating something the code does not do.
Problems, not style nits, and no checklist narrowing: read the diff and
report whatever is actually wrong. A finding states the problem the way
a reviewer flags it, not the fix baked in as if already applied.

### 4. Compose ONE review object

The summary plus every inline comment go in a single review, which is
what makes GitHub render them as a grouped unit with the
"reviewed these changes" trail. Shape:

```json
{
  "commit_id": "<head-sha>",
  "event": "COMMENT",
  "body": "<summary: the overall take, findings that could not be line-anchored, or a short note that it is clean>",
  "comments": [
    { "path": "src/x.js", "line": 42, "side": "RIGHT",
      "body": "<the problem on this line>" },
    { "path": "src/y.js", "start_line": 10, "start_side": "RIGHT",
      "line": 14, "side": "RIGHT",
      "body": "<a multi-line finding, highlighting the whole range>" }
  ]
}
```

- **Highlight a range** with `start_line` + `line` (both `side: RIGHT`
  for added code, `LEFT` for deleted). A single-line comment omits
  `start_line`.
- **Suggest the fix** where a concrete, self-contained replacement
  exists, using a GitHub suggestion block in the comment body. The
  block replaces EXACTLY the commented line range, so it must contain
  the full replacement for those lines, correctly indented:

  ````markdown
  This drops id 0 too. Strict-compare against null instead:

  ```suggestion
  if (id !== null) {
  ```
  ````

  The user can then apply it with one click. Suggest only on lines the
  diff adds or keeps (`side: RIGHT`), never on pure deletions, and skip
  the suggestion when the real fix is bigger than the commented range;
  state the problem and sketch the fix in prose instead.
- Every `line` must be part of the PR diff (a changed line or nearby
  hunk context), or the API rejects the whole review. A finding on an
  untouched line goes path-level into the summary body.
- Build the JSON with a real serializer (`jq -n`, python), never by
  interpolating into a shell string, which mangles quotes and code
  spans.

**Verdict.** `event: "COMMENT"` on a PR you (the account posting)
authored, since GitHub forbids `APPROVE` / `REQUEST_CHANGES` on your
own PR, and that is the common case when the agent reviews the account
owner's work. On someone else's PR, pick the honest verdict:
`APPROVE`, `COMMENT`, or `REQUEST_CHANGES`.

**Voice.** First person, plain, the way a person reviews code. Terse
inline findings, a summary that may go broad (what the change does
well, the one thing that matters). No AI or agent framing, no process
narration, no machinery tells (test counts, check status).

### 5. Post it and report back

```sh
gh api -X POST repos/<owner>/<repo>/pulls/<N>/reviews --input review.json
```

A clean review still posts: a short summary saying it is clean, with no
inline comments. Then tell the user the outcome in one or two
sentences, with the review's URL and the finding count. Stop there. No
fixing, no thread resolution, no follow-up issues, no re-review unless
they ask again.
