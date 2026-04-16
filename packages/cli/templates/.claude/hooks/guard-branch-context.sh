#!/bin/bash
#
# guard-branch-context.sh — Claude Code PreToolUse hook
#
# Rules:
#   - On main/master → ask (agent should create a feature branch first)
#   - On any other branch → allow (feature branches are free to edit)
#   - Bypass mode → allow everything

INPUT=$(cat /dev/stdin)

# Bypass mode — full autonomy
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  BYPASS=$(jq -r '.skipDangerousModePermissionPrompt // false' "$SETTINGS" 2>/dev/null)
  if [ "$BYPASS" = "true" ]; then
    exit 0
  fi
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  exit 0
fi

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
[ -z "$BRANCH" ] && exit 0

if [ "$BRANCH" = "main" ] || [ "$BRANCH" = "master" ]; then
  jq -n --arg reason "You are on '$BRANCH'. Create a feature branch first (git checkout -b feature/<name>), or approve to edit on '$BRANCH'." '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

exit 0
