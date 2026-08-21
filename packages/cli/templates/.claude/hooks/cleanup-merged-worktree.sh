#!/usr/bin/env bash
#
# Claude Code PostToolUse hook (matcher: Bash).
#
# After a `gh pr merge`, sweep the repo's git worktrees and REMOVE the ones
# whose work has already landed, so a merged branch's worktree does not leak.
# Accumulated stale worktrees (a session that merged but never cleaned up, or
# crashed mid-task) are exactly what this closes: the webjs-start-work skill
# already says "after the PR merges, git worktree remove", but as guidance it
# gets skipped, so this makes the cleanup deterministic.
#
# CONSERVATIVE BY DESIGN. A worktree is removed ONLY when ALL hold:
#   * it is a LINKED worktree, not the primary checkout;
#   * it is NOT the current directory (you cannot remove the one you are in);
#   * its branch is not main/master;
#   * its branch is MERGED (an ancestor of the base ref, OR a merged GitHub PR
#     for that head branch, which is how squash-merges are detected);
#   * its working tree is CLEAN apart from untracked node_modules / .webjs.
# Anything with uncommitted or unpushed-looking work is KEPT and reported, so
# the hook can never destroy in-flight work.
#
# It never blocks the tool (always exits 0) and reports what it did back to the
# model via hookSpecificOutput.additionalContext. Disable with
# WEBJS_NO_WORKTREE_CLEANUP=1.
#
# Rule: AGENTS.md "One task per git worktree" + the webjs-start-work skill.

set -uo pipefail

# Read the whole payload first so we always honour the hook contract.
payload=$(cat 2>/dev/null || true)

if [ "${WEBJS_NO_WORKTREE_CLEANUP:-}" = "1" ]; then exit 0; fi

cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then exit 0; fi

# Only act after a `gh pr merge` (whole word, not `gh pr merge-queue` typos etc.).
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]-])gh pr merge([^[:alnum:]-]|$)'; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then exit 0; fi

# The base ref merged branches land on. Prefer origin/main; fall back to a
# local main/master (the test harness has no remote).
base=""
for ref in origin/main origin/master main master; do
  if git rev-parse --verify --quiet "$ref" >/dev/null 2>&1; then base="$ref"; break; fi
done
[ -z "$base" ] && exit 0

here=$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "$PWD")
# The primary worktree is the first entry of `git worktree list`.
primary=$(git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2; exit}')

is_merged() {
  local br="$1"
  # Ancestor of the base ref (fast-forward / rebase merges, and the real
  # merges the test harness makes).
  if git merge-base --is-ancestor "refs/heads/$br" "$base" 2>/dev/null; then return 0; fi
  # A merged GitHub PR for this head branch (squash merges, which are NOT an
  # ancestor of base). Network; skipped when gh is absent or unauthenticated.
  if command -v gh >/dev/null 2>&1; then
    local n
    n=$(gh pr list --state merged --head "$br" --json number --jq '.[0].number' 2>/dev/null || true)
    [ -n "$n" ] && return 0
  fi
  return 1
}

# Clean = nothing in `git status` except untracked node_modules / .webjs caches.
is_clean() {
  local wt="$1" dirty
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null \
    | grep -vE '(^|/)(node_modules|\.webjs)(/|$)' || true)
  [ -z "$dirty" ]
}

removed=()
kept=()

# Parse worktree path + branch pairs.
wt=""
while IFS= read -r line; do
  case "$line" in
    worktree\ *) wt="${line#worktree }" ;;
    branch\ *)
      br="${line#branch refs/heads/}"
      # Skip the primary checkout and main/master lines.
      if [ "$wt" = "$primary" ] || [ "$br" = "main" ] || [ "$br" = "master" ]; then wt=""; continue; fi
      # Never remove the worktree we are currently in.
      if [ "$wt" = "$here" ]; then
        kept+=("$wt (current directory; cd out then \`git worktree remove\`)")
        wt=""; continue
      fi
      if ! is_clean "$wt"; then
        kept+=("$wt (uncommitted changes)"); wt=""; continue
      fi
      if ! is_merged "$br"; then
        kept+=("$wt (branch $br not merged yet)"); wt=""; continue
      fi
      if git worktree remove --force "$wt" >/dev/null 2>&1; then
        removed+=("$wt ($br)")
      else
        kept+=("$wt (git worktree remove failed)")
      fi
      wt="" ;;
    "") wt="" ;;
  esac
done < <(git worktree list --porcelain 2>/dev/null)

git worktree prune >/dev/null 2>&1 || true

# Report nothing if there was nothing to do.
if [ "${#removed[@]}" -eq 0 ] && [ "${#kept[@]}" -eq 0 ]; then exit 0; fi

msg="Worktree cleanup after \`gh pr merge\`:"
for r in "${removed[@]:-}"; do [ -n "$r" ] && msg="$msg"$'\n'"  removed $r (merged, clean)"; done
for k in "${kept[@]:-}"; do [ -n "$k" ] && msg="$msg"$'\n'"  kept $k"; done

jq -n --arg ctx "$msg" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}' 2>/dev/null || true

exit 0
