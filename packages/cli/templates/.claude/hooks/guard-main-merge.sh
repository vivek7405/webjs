#!/bin/bash
#
# guard-main-merge.sh — Claude Code PreToolUse hook
#
# Intercepts Bash tool calls and routes any command that looks like a merge
# or push to main through interactive user approval. This prevents AI agents
# from accidentally merging or pushing to main without explicit consent.
#
# Decision matrix:
#   `git merge ...`              → ask (catches merge into any branch)
#   `git push ... main ...`      → ask (catches push origin main, push HEAD:main, etc.)
#   anything else                → allow
#
# Shipped by default with every webjs app via `webjs create`.
# Wired in via .claude/settings.json under hooks.PreToolUse.

# Read the tool input from stdin (JSON shape: { tool_input: { command: ... }, ... })
COMMAND=$(jq -r '.tool_input.command // empty' < /dev/stdin)

# Empty command — let it pass.
if [ -z "$COMMAND" ]; then
  exit 0
fi

# Normalize whitespace so multi-line / heredoc commands match the same way.
NORMALIZED=$(printf '%s' "$COMMAND" | tr -s '[:space:]' ' ')

ask_with_reason() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

# Catch `git merge` anywhere in the command.
if [[ "$NORMALIZED" == *"git merge"* ]]; then
  ask_with_reason "guard-main-merge: this command contains 'git merge'. Every merge requires your explicit approval. After merging, should the source branch be DELETED or KEPT? Approve to proceed (then tell the agent your preference)."
fi

# Catch `git push` targeting main.
if [[ "$NORMALIZED" == *"git push"* ]] && [[ "$NORMALIZED" == *"main"* ]]; then
  ask_with_reason "guard-main-merge: this command looks like 'git push' targeting main. Approve to proceed."
fi

# Everything else passes through.
exit 0
