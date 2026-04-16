#!/bin/bash
#
# guard-branch-context.sh — Claude Code PreToolUse hook
#
# Fires before Edit and Write tool calls. If the current branch is `main`
# or `master`, asks the user for confirmation before allowing file edits.
#
# Respects bypass/dangerous mode — user has opted into full autonomy.

# Read the tool input from stdin
INPUT=$(cat /dev/stdin)

# Respect bypass/dangerous mode
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  BYPASS=$(jq -r '.skipDangerousModePermissionPrompt // false' "$SETTINGS" 2>/dev/null)
  if [ "$BYPASS" = "true" ]; then
    exit 0
  fi
fi

# Check if we're in a git repo
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

# Get current branch
BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")

if [ -z "$BRANCH" ]; then
  exit 0
fi

# If on main or master, ask before allowing edits
if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  jq -n --arg reason "guard-branch-context: You are on the '$BRANCH' branch. Create a feature branch before editing (e.g., git checkout -b feature/<name>). Approve to continue on '$BRANCH'." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

# Not on main — allow
exit 0
