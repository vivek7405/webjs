#!/bin/bash
#
# Claude Code PostToolUse hook.
#
# After each Edit, Write, MultiEdit, or NotebookEdit, counts
# uncommitted changes in the working tree. When the count
# crosses a threshold (default 4, override with the
# WEBJS_COMMIT_NUDGE_THRESHOLD env var), injects a reminder
# into the model's context via hookSpecificOutput.
#
# Soft nudge. Does NOT block the edit. The goal is to keep
# the agent honest about the "commit per logical unit" rule,
# not to interrupt valid work.
#
# Skipped on main/master and outside a git work tree.

set -e

THRESHOLD="${WEBJS_COMMIT_NUDGE_THRESHOLD:-4}"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  exit 0
fi

# Read stdin so we don't break Claude Code's hook contract.
cat /dev/stdin >/dev/null 2>&1 || true

CHANGED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

if [ -z "$CHANGED" ] || [ "$CHANGED" -lt "$THRESHOLD" ]; then
  exit 0
fi

REASON="You have ${CHANGED} uncommitted changes on '${BRANCH}'. The webjs convention is small, focused commits per logical unit (one feature, one fix, one rename, one doc rewrite). Before continuing with more edits, group the current changes into a meaningful commit. See AGENTS.md \"Git workflow\" for the rule and the rationale. To raise the threshold for this hook in long-running tasks, set WEBJS_COMMIT_NUDGE_THRESHOLD."

jq -n --arg ctx "$REASON" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
