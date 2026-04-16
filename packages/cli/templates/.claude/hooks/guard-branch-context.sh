#!/bin/bash
#
# guard-branch-context.sh — Claude Code PreToolUse hook
#
# Fires before Edit and Write tool calls. If the current branch is `main`
# (or `master`), asks the user for confirmation before allowing file edits.
# This prevents the agent from coding on main when it should be on a
# feature branch.
#
# Decision matrix:
#   current branch is main/master  → ask ("You're on main. Create a branch?")
#   current branch is anything else → allow
#
# Wired in via .claude/settings.json under hooks.PreToolUse.

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
  jq -n --arg reason "guard-branch-context: You are on the '$BRANCH' branch. Per project conventions, code changes should go on a feature branch (e.g., feature/<name> or fix/<name>). Create a new branch before editing, or approve to continue on '$BRANCH'." '{
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
