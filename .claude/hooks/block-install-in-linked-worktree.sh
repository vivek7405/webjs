#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash): BLOCK an install command aimed at a directory
# whose `node_modules` is a SYMLINK. In this repo that link points at the
# PRIMARY checkout's tree, so the install acts on a checkout you are not working
# in and the failure surfaces in someone else's session (#1442).
#
# Why a hook rather than a `preinstall` script. Measured on npm 11.19.0 and bun
# 1.3.14, no package-manager lifecycle hook can prevent the damage:
#   npm install  REPLACES the symlink with a real directory before `preinstall`
#                runs, so a guard there never sees a symlink at all
#   npm ci       DELETES the symlink's target, the whole of the primary's
#                node_modules, before `preinstall` runs
#   bun install  runs `preinstall` in time but IGNORES a non-zero exit
# A PreToolUse hook is the only layer that sees the state before the package
# manager starts. `scripts/warn-worktree-install.mjs` covers every other tool by
# reporting rather than blocking.
#
# The predicate runs against the COMMAND's target directory, not just the session
# cwd: the harness resets cwd to the primary checkout between commands, so a real
# install in a worktree arrives as `cd /path/to/worktree && npm ci`.
#
# Contract: exit 0 = allow, exit 2 = block (message on stderr).
# Escape hatch: WEBJS_NO_WORKTREE_INSTALL_GATE=1.

if [ "${WEBJS_NO_WORKTREE_INSTALL_GATE:-0}" = "1" ]; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then exit 0; fi

# Install verbs only. `npm run test`, `npm test`, `npm exec`, `npm ls`, and every
# `npx ...` must pass, so the verb is matched at a word boundary on both sides.
# The second alternation branch is the flags-before-verb form
# (`npm --prefix <dir> install`). Only the two flags that themselves name a
# target directory are admitted there, so this stays targeted rather than
# swallowing an arbitrary token run and matching something like `npm run install`.
VERBS='(npm[[:space:]]+(install|i|ci|add|update|dedupe)|bun[[:space:]]+(install|add|update)|pnpm[[:space:]]+(install|add|update)|yarn[[:space:]]+(install|add)|(npm|pnpm|yarn)[[:space:]]+(--prefix|-C)[[:space:]=]+[^[:space:]&|;]+[[:space:]]+(install|i|ci|add|update|dedupe))'
if ! printf '%s' "$cmd" | grep -Eq "(^|[^[:alnum:]_-])${VERBS}([^[:alnum:]_-]|\$)"; then
  exit 0
fi

# Candidate target directories. An install acts on ONE directory, so the session
# cwd counts only until the command changes out of it: `cd /tmp && npm install`
# targets /tmp, not the worktree this shell happens to sit in. So walk the `cd`
# tokens that appear BEFORE the install verb and let them supersede the cwd, then
# add any directory a package manager is pointed at explicitly.
prefix=$(printf '%s' "$cmd" | sed -E "s/(^|[^[:alnum:]_-])${VERBS}([^[:alnum:]_-]|\$).*//")

eff="$PWD"
resolve_against_eff() {
  local d="$1"
  case "$d" in
    /*) printf '%s' "$d" ;;
    ~*) printf '%s' '' ;;
    *) printf '%s' "$eff/$d" ;;
  esac
}
while IFS= read -r d; do
  [ -n "$d" ] || continue
  d=$(printf '%s' "$d" | tr -d "\"'")
  r=$(resolve_against_eff "$d")
  [ -n "$r" ] && eff="$r"
done < <(printf '%s\n' "$prefix" \
  | grep -oE '(^|[^[:alnum:]_./-])cd[[:space:]]+[^[:space:]&|;]+' \
  | sed -E 's/.*cd[[:space:]]+//')

cands=("$eff")
while IFS= read -r d; do
  [ -n "$d" ] || continue
  d=$(printf '%s' "$d" | tr -d "\"'")
  r=$(resolve_against_eff "$d")
  [ -n "$r" ] && cands+=("$r")
done < <(printf '%s\n' "$cmd" \
  | grep -oE '(^|[[:space:]])(-C|--prefix)[[:space:]=]+[^[:space:]&|;]+' \
  | sed -E 's/.*(-C|--prefix)[[:space:]=]+//')

for cand in "${cands[@]}"; do
  [ -d "$cand" ] || continue
  # The install lands at the package root, which for a subdirectory is the
  # enclosing checkout, so judge the git toplevel too.
  top=$(git -C "$cand" rev-parse --show-toplevel 2>/dev/null || true)
  for dir in "$cand" "$top"; do
    [ -n "$dir" ] || continue
    [ -L "$dir/node_modules" ] || continue
    target=$(cd "$(dirname "$dir/node_modules")" 2>/dev/null && readlink "node_modules" || true)
    owner=$(cd "$dir" 2>/dev/null && cd "$(readlink node_modules)" 2>/dev/null && pwd -P || printf '%s' "${target:-the primary checkout}")
    {
      echo "BLOCKED: this command installs into $dir, whose node_modules is a SYMLINK at $owner."
      echo "An install through that link damages the checkout that OWNS the tree, not this one:"
      echo "  npm ci       DELETES $owner outright, before any lifecycle script can run"
      echo "  bun install  writes packages and .bin entries straight into $owner"
      echo "  npm install  silently REPLACES the link with a real tree, detaching this worktree"
      echo "Safe alternatives:"
      echo "  npm run worktree:link          links a fresh worktree; it never installs"
      echo "  a real install with NO symlink in the way. Run \`rm node_modules\` first (it is"
      echo "  only a link, nothing else is lost), or install in the PRIMARY checkout."
      echo "Escape hatch for a deliberate exception: WEBJS_NO_WORKTREE_INSTALL_GATE=1."
    } >&2
    exit 2
  done
done

exit 0
