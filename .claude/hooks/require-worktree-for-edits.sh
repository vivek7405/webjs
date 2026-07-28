#!/usr/bin/env bash
# PreToolUse hook (Write|Edit|MultiEdit|NotebookEdit): BLOCK editing a TRACKED
# file that resides in a repo's PRIMARY checkout. Task work always happens in
# a linked worktree (AGENTS.md: one task per git worktree, ALWAYS); the
# primary checkout stays an untouched mirror of main. Untracked and gitignored
# files (session state, scratch, settings.local.json) stay editable.
# The predicate runs against the FILE's directory, never the session cwd: the
# harness resets cwd to the primary checkout between commands while edits
# legitimately target worktree files by absolute path.
# Contract: exit 0 = allow, exit 2 = block (message on stderr).
# Escape hatch: WEBJS_NO_WORKTREE_GATE=1.

if [ "${WEBJS_NO_WORKTREE_GATE:-0}" = "1" ]; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

input=$(cat)
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
if [ -z "$fp" ]; then exit 0; fi

dir=$(dirname "$fp")
if [ ! -d "$dir" ]; then exit 0; fi
if ! git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then exit 0; fi

gd=$(git -C "$dir" rev-parse --git-dir 2>/dev/null) || exit 0
gcd=$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null) || exit 0
# Linked worktree: --git-dir carries /worktrees/<name> and differs from the
# common dir. Only the primary checkout has them equal.
if [ "$gd" != "$gcd" ]; then exit 0; fi

# Untracked or gitignored files are session-local and stay editable.
if ! git -C "$dir" ls-files --error-unmatch -- "$fp" >/dev/null 2>&1; then exit 0; fi

top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || echo "this repo")
{
  echo "BLOCKED: '$fp' is a tracked file in the PRIMARY checkout ($top)."
  echo "Task work always happens in a linked worktree (AGENTS.md: one task per git worktree, ALWAYS):"
  echo "  git worktree add -b <prefix>/<slug> ../<repo>-<slug> origin/main"
  echo "Work there by absolute path; the primary checkout stays on main untouched."
  echo "Escape hatch for a deliberate exception: WEBJS_NO_WORKTREE_GATE=1."
} >&2
exit 2
