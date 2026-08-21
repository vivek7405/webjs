#!/usr/bin/env bash
#
# Claude Code Stop hook.
#
# The commit-per-logical-unit rule (CLAUDE.md + AGENTS.md "Git workflow") is
# easy for an agent to defer to "the end", and then the end arrives with the
# whole feature done and ZERO commits, which is the worst outcome: git history,
# the user's revert and cherry-pick safety net, is empty. The PostToolUse
# `nudge-uncommitted.sh` reminds DURING work but is only a soft context nudge an
# agent can ignore. This Stop hook is the backstop at the END of a turn: if you
# try to finish with a pile of uncommitted work on a feature branch, it blocks
# the stop once and tells you to commit the completed unit first.
#
# Loop-safe: when `stop_hook_active` is already true (this hook fired and the
# agent is continuing because of it), it does NOT block again, so it nags at
# most once per stop and can never trap the agent in a loop.
#
# Skipped on main/master (you must not commit there anyway) and outside a git
# work tree. Threshold via WEBJS_COMMIT_STOP_THRESHOLD (default 2). Disable
# entirely with WEBJS_NO_COMMIT_STOP=1.

set -uo pipefail

payload=$(cat 2>/dev/null || true)

if [ "${WEBJS_NO_COMMIT_STOP:-}" = "1" ]; then exit 0; fi

# Loop guard: if we already blocked once this stop-cycle, let the agent stop.
active=$(printf '%s' "$payload" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)
if [ "$active" = "true" ]; then exit 0; fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then exit 0; fi

branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ -z "$branch" ] || [ "$branch" = "main" ] || [ "$branch" = "master" ]; then exit 0; fi

threshold="${WEBJS_COMMIT_STOP_THRESHOLD:-2}"

# Count real changes: tracked modifications + staged + untracked, minus the
# noise the agent should never commit (node_modules, the sqlite db, caches).
changed=$(git status --porcelain 2>/dev/null \
  | grep -vE '(^|/)(node_modules|\.webjs)(/|$)|dev\.db($|-journal)' \
  | grep -c . || true)

if [ -z "$changed" ] || [ "$changed" -lt "$threshold" ]; then exit 0; fi

reason="You are ending the turn with ${changed} uncommitted changes on '${branch}'. This project OVERRIDES Claude Code's never-commit default: commit per logical unit (see CLAUDE.md and AGENTS.md \"Git workflow\"). Before you stop, group the completed work into a meaningful commit ('git add' the related files, 'git commit' with an imperative subject under 72 chars) and push. If the work is genuinely mid-change and not yet a coherent unit, commit what IS complete, or explain in your final message why it cannot be committed yet. To relax this backstop set WEBJS_COMMIT_STOP_THRESHOLD, or disable it with WEBJS_NO_COMMIT_STOP=1."

jq -n --arg r "$reason" '{decision: "block", reason: $r}' 2>/dev/null \
  || printf '{"decision":"block","reason":%s}\n' "$(printf '%s' "$reason" | jq -Rs . 2>/dev/null || echo '""')"

exit 0
