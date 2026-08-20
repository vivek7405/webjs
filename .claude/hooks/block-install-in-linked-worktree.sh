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
# ## How the matching works, and why it is shaped this way
#
# Recognising a package-manager invocation inside an arbitrary shell command is
# the hard part of this hook, and getting it wrong in either direction is
# expensive: a false NEGATIVE lets the corruption through, and a false POSITIVE
# fires on ordinary commands in a linked worktree, which is the mandated working
# state here, until someone turns the gate off. Four passes of review found a
# defect in each direction, so the matcher is built in explicit stages:
#
#   1. QUOTED SPANS ARE REMOVED FIRST. A manager invocation never has its own
#      name inside quotes, while ordinary commands carry shell metacharacters
#      there constantly. Splitting the raw string instead makes
#      `git commit -m "fix: the link; npm install now blocks"` look like two
#      commands, the second an install.
#   2. The remainder is split on `&&`, `||`, `;`, `|`, `(`, `)` and newlines.
#   3. Each segment is judged by its FIRST token, after leading env assignments
#      and wrappers are stripped. A segment that does not START with a package
#      manager is not an install, whatever else it contains.
#   4. Only inside a manager-led segment are the remaining tokens scanned, and
#      the FIRST one recognised as either an install verb or a known safe verb
#      decides. Anything unrecognised is skipped rather than assumed, so a flag
#      VALUE (`npm -w packages/core install`) does not hide the verb behind it.
#
# Contract: exit 0 = allow, exit 2 = block (message on stderr).
# Escape hatch: WEBJS_NO_WORKTREE_INSTALL_GATE=1.

if [ "${WEBJS_NO_WORKTREE_INSTALL_GATE:-0}" = "1" ]; then exit 0; fi
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then exit 0; fi

# Verbs that WRITE to node_modules. Every manager's documented aliases, because
# a gate `bun i` walks past is worthless and Bun is the manager that writes
# THROUGH the link rather than replacing it. `link`, `rebuild` and `prune` are
# here for the same reason as the remove verbs: they all mutate the tree that
# the symlink points at.
INSTALL_VERBS='install-ci-test|clean-install-test|install-clean|clean-install|install-test|install|isntall|isntal|isnta|isnt|instal|insta|inst|ins|in|i|add|a|ci|cit|sit|it|ic|update|upgrade|udpate|up|dedupe|ddp|uninstall|unlink|un|remove|rm|r|link|ln|rebuild|rb|prune'
# Verbs that do NOT touch node_modules. Listed explicitly so the scan can STOP:
# without them, `npm run test -- --grep add` would keep scanning and hit `add`.
SAFE_VERBS='run|run-script|rum|urn|test|tst|t|start|stop|restart|exec|x|ls|list|la|ll|init|innit|create|publish|pack|version|view|v|info|show|why|ping|config|c|get|set|docs|home|repo|bugs|audit|fund|outdated|prefix|root|bin|whoami|token|team|org|access|star|unstar|search|s|se|find|help|doctor|explain|edit|deprecate|dist-tag|hook|login|logout|adduser|owner|profile|shrinkwrap|unpublish|completion|diff|query|sbom'
# A GLOBAL install writes to the npm prefix, never through the local link, and
# `npm update -g webjsdev` is this repo's documented post-release step.
GLOBAL='(^|[[:space:]])(-g|--global)([[:space:]]|$)'

# STAGE 1: remove quoted spans. See the docblock; this is what keeps a shell
# metacharacter inside a commit message from being read as a command boundary.
scrubbed=$(printf '%s' "$cmd" | sed -e "s/'[^']*'/ /g" -e 's/"[^"]*"/ /g')

eff="$PWD"
target=""
# STAGE 2: split into segments. `cd` in an earlier segment moves the target the
# way the shell would.
while IFS= read -r seg; do
  seg="${seg#"${seg%%[![:space:]]*}"}"
  [ -z "$seg" ] && continue

  # STAGE 3: strip leading env assignments and benign wrappers, token by token.
  # The assignment test is anchored to the FIRST token: an unanchored
  # `[A-Za-z_]*=*` glob matches the whole segment whenever any LATER token
  # carries an `=`, which silently disabled the gate for `npm install --omit=dev`.
  wrapper_seen=0
  prev_flag=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    first="${seg%%[[:space:]]*}"
    [ -n "$first" ] || break
    strip=0
    case "$first" in
      *=*)
        name="${first%%=*}"
        case "$name" in
          ''|*[!A-Za-z0-9_]*|[0-9]*) ;;
          *) strip=1 ;;
        esac ;;
      sudo|env|time|nice) wrapper_seen=1; prev_flag=0; strip=1 ;;
      npm|bun|pnpm|yarn|yarnpkg) ;;
      -*) [ "$wrapper_seen" = "1" ] && { prev_flag=1; strip=1; } ;;
      *)
        # The VALUE of a wrapper flag (`sudo -u foo`, `nice -n 10`). Deliberately
        # narrow: walking past ARBITRARY tokens after a wrapper re-creates the
        # token-anywhere class one level in, where `bash -c "echo yarn"` reaches
        # the bare-yarn branch. `command`, `exec`, `bash` and `sh` are NOT
        # wrappers for that reason, so `command -v yarn` stays allowed and
        # `bash -c "npm ci"` is an accepted gap rather than a nested-shell parser.
        if [ "$wrapper_seen" = "1" ] && [ "$prev_flag" = "1" ]; then prev_flag=0; strip=1; fi ;;
    esac
    [ "$strip" = "1" ] || break
    rest="${seg#*[[:space:]]}"
    [ "$rest" = "$seg" ] && { seg=""; break; }
    seg="${rest#"${rest%%[![:space:]]*}"}"
  done
  [ -n "$seg" ] || continue

  set -- $seg
  head_tok="$1"

  # `cd` / `pushd` move the effective directory.
  case "$head_tok" in
    cd|pushd)
      shift
      # Skip `--` and any option, so `cd -- <dir>` and `cd -P <dir>` both work.
      while [ $# -gt 0 ]; do
        case "$1" in --) shift; break ;; -*) shift ;; *) break ;; esac
      done
      d="${1:-}"
      case "$d" in
        '') ;;
        '~') eff="$HOME" ;;
        '~/'*) eff="$HOME/${d#'~/'}" ;;
        /*) eff="$d" ;;
        *) eff="$eff/$d" ;;
      esac
      continue ;;
  esac

  # STAGE 4: only a manager-led segment can be an install.
  case "$head_tok" in
    npm|bun|pnpm|yarn|yarnpkg) ;;
    *) continue ;;
  esac
  shift

  # A global install never touches this tree.
  printf '%s' "$seg" | grep -Eq "$GLOBAL" && continue

  verdict=""
  prefix_dir=""
  pending_prefix=0
  while [ $# -gt 0 ]; do
    tok="$1"; shift
    case "$tok" in
      --prefix=*|-C=*) prefix_dir="${tok#*=}"; continue ;;
      --prefix|-C) pending_prefix=1; continue ;;
      -*) continue ;;
    esac
    if [ "$pending_prefix" = "1" ]; then prefix_dir="$tok"; pending_prefix=0; continue; fi
    # The first token recognised either way decides; anything else is a flag
    # value or a package name and is skipped rather than assumed.
    # Do NOT stop at the verb: `--prefix` may still be ahead of us, and
    # `npm install --prefix <worktree>` run from the primary would otherwise be
    # judged against the primary's own real node_modules and allowed. The FIRST
    # verdict wins; later tokens are only mined for the prefix.
    [ -n "$verdict" ] && continue
    if printf '%s' "$tok" | grep -Eq "^(${INSTALL_VERBS})$"; then verdict="install"; continue; fi
    if printf '%s' "$tok" | grep -Eq "^(${SAFE_VERBS})$"; then verdict="safe"; continue; fi
  done

  # A bare `yarn` (only flags, no verb) IS an install in yarn classic.
  if [ -z "$verdict" ]; then
    case "$head_tok" in yarn|yarnpkg) verdict="install" ;; esac
  fi
  [ "$verdict" = "install" ] || continue

  target="$eff"
  if [ -n "$prefix_dir" ]; then
    case "$prefix_dir" in
      '~') target="$HOME" ;;
      '~/'*) target="$HOME/${prefix_dir#'~/'}" ;;
      /*) target="$prefix_dir" ;;
      *) target="$eff/$prefix_dir" ;;
    esac
  fi
  break
done <<EOF
$(printf '%s' "$scrubbed" | tr '&|;()' '\n\n\n\n\n')
EOF

[ -n "$target" ] || exit 0
[ -d "$target" ] || exit 0

# The install lands at the package root, which for a subdirectory is the
# enclosing checkout, so judge the git toplevel too.
top=$(git -C "$target" rev-parse --show-toplevel 2>/dev/null || true)
for dir in "$target" "$top"; do
  [ -n "$dir" ] || continue
  [ -L "$dir/node_modules" ] || continue
  owner=$(cd "$dir" 2>/dev/null && cd "$(readlink node_modules)" 2>/dev/null && pwd -P) || owner="the checkout it points at"
  {
    echo "BLOCKED: this command installs into $dir, whose node_modules is a SYMLINK at $owner."
    echo "An install through that link damages the checkout that OWNS the tree, not this one:"
    echo "  npm ci       DELETES $owner outright, before any lifecycle script can run"
    echo "  bun install  writes packages and .bin entries straight into $owner"
    echo "  npm install  silently REPLACES the link with a real tree, detaching this worktree"
    echo "A remove verb (npm rm, bun remove) deletes from that same owning checkout."
    echo "Safe alternatives:"
    echo "  npm run worktree:link          links a fresh worktree; it never installs"
    echo "  a real install with NO symlink in the way. Run \`rm node_modules\` first (it is"
    echo "  only a link, nothing else is lost), or install in the PRIMARY checkout."
    echo "A GLOBAL install (-g) is not affected by this and is never blocked."
    echo "Escape hatch for a deliberate exception: WEBJS_NO_WORKTREE_INSTALL_GATE=1."
  } >&2
  exit 2
done

exit 0
