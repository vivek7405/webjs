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
# ## It matches a COMMAND, never a token
#
# The command is split on `&&`, `||`, `;`, `|`, `(` and `)`, and each segment is
# judged only by what it STARTS with. Matching the manager token anywhere in the
# line instead is the obvious shortcut and it is badly wrong: it blocks
# `git commit -m "fix: npm install ..."`, `grep -rn "npm ci" AGENTS.md` and
# `git log --grep "npm install"`. Every worktree here is a linked worktree, so
# that fires on ordinary commands constantly, and a gate that cries wolf is a
# gate someone turns off.
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

# Every manager's documented install ALIASES, not just its canonical spelling.
# The gate is worthless if `bun i` walks past it, and Bun is the manager that
# writes THROUGH the symlink into the primary rather than replacing it.
#
# HYPHENATED verbs are spelled out: the trailing word boundary excludes `-`, so
# `install-test` is NOT reached by listing `install`, and the short aliases
# (`it`, `cit`, `sit`) do not cover the long spellings.
#
# The REMOVE verbs are here too. `npm rm <pkg>` in a linked worktree deletes from
# the checkout that owns the tree, the same corruption in the other direction.
NPM_VERBS='install-ci-test|clean-install-test|install-clean|clean-install|install-test|install|isntall|isntal|isnta|isnt|instal|insta|inst|ins|in|i|add|ci|cit|sit|it|ic|update|upgrade|udpate|up|dedupe|ddp|uninstall|unlink|un|remove|rm|r'
BUN_VERBS='install|i|add|a|update|up|remove|rm'
PNPM_VERBS='install|i|add|update|upgrade|up|dedupe|remove|rm|uninstall|un'
YARN_VERBS='install|add|upgrade|up|dedupe|remove'
# `npm --prefix <dir> install` puts flags BEFORE the verb. Only the two flags that
# themselves name a target directory are admitted, so this stays targeted rather
# than swallowing a token run and matching `npm run install`.
SEG_VERBS="^(npm[[:space:]]+(${NPM_VERBS})|bun[[:space:]]+(${BUN_VERBS})|pnpm[[:space:]]+(${PNPM_VERBS})|yarn[[:space:]]+(${YARN_VERBS})|(npm|pnpm|yarn)[[:space:]]+(--prefix|-C)[[:space:]=]+[^[:space:]]+[[:space:]]+(${NPM_VERBS}))([^[:alnum:]_-]|\$)"
# Bare `yarn` IS an install in yarn classic, but only when it is the whole
# command: `yarn test` is not one.
SEG_BARE_YARN='^yarn([[:space:]]+-[^[:space:]]*)*[[:space:]]*$'
# A GLOBAL install writes to the npm prefix, never through the local link, and
# `npm update -g webjsdev` is this repo's documented post-release step.
GLOBAL='(^|[[:space:]])(-g|--global)([[:space:]]|$)'

# Walk the segments in order so a `cd` earlier in the line moves the target the
# way the shell would.
eff="$PWD"
target=""
while IFS= read -r seg; do
  # Quotes are dropped so a quoted command body tokenizes (`bash -c "npm ci"`).
  # This is safe: what keeps `git commit -m "npm ci"` out is the command-position
  # rule below, never the quoting.
  seg=$(printf '%s' "$seg" | tr -d '"'"'"'')
  seg="${seg#"${seg%%[![:space:]]*}"}"
  [ -z "$seg" ] && continue

  # Strip leading env assignments and benign wrappers, so `FOO=1 npm ci`,
  # `sudo npm ci` and `bash -c "npm ci"` are still judged on the manager that
  # follows them.
  #
  # This is done TOKEN BY TOKEN, and the env-assignment test is anchored to the
  # first token alone. An unanchored `[A-Za-z_]*=*` case glob matches the WHOLE
  # segment whenever any LATER token contains `=`, so it ate leading words and
  # `npm install --omit=dev`, `npm ci --loglevel=error` and
  # `npm install --workspace=packages/core` all failed OPEN. Failing open is the
  # one direction that matters here, since the whole point is to stop a write.
  wrapper_seen=0
  prev_flag=0
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    first="${seg%%[[:space:]]*}"
    [ -n "$first" ] || break
    strip=0
    case "$first" in
      *=*)
        # A real env assignment: NAME=..., NAME being a valid shell identifier.
        name="${first%%=*}"
        case "$name" in
          ''|*[!A-Za-z0-9_]*|[0-9]*) ;;
          *) strip=1 ;;
        esac ;;
      sudo|env|time|nice) wrapper_seen=1; prev_flag=0; strip=1 ;;
      npm|bun|pnpm|yarn|yarnpkg) ;;
      -*)
        # A wrapper's OWN flag, e.g. `sudo -u foo npm ci`.
        [ "$wrapper_seen" = "1" ] && { prev_flag=1; strip=1; } ;;
      *)
        # The VALUE of the wrapper flag just stripped, e.g. the `foo` in `-u foo`
        # or the `10` in `nice -n 10`. Deliberately narrow: walking past ARBITRARY
        # tokens after a wrapper re-creates the token-anywhere class one level in,
        # where `bash -c "echo yarn"` would reach the bare-yarn branch and block.
        # `command`, `exec`, `bash` and `sh` are NOT wrappers here for that reason,
        # so `command -v yarn` stays allowed and `bash -c "npm ci"` is a known,
        # accepted gap rather than a parser for nested shells.
        if [ "$wrapper_seen" = "1" ] && [ "$prev_flag" = "1" ]; then prev_flag=0; strip=1; fi ;;
    esac
    [ "$strip" = "1" ] || break
    rest="${seg#*[[:space:]]}"
    [ "$rest" = "$seg" ] && { seg=""; break; }
    seg="${rest#"${rest%%[![:space:]]*}"}"
  done
  [ -n "$seg" ] || continue

  case "$seg" in
    cd|cd\ *)
      d="${seg#cd}"; d="${d#"${d%%[![:space:]]*}"}"; d="${d%% *}"
      d=$(printf '%s' "$d" | tr -d "\"'")
      case "$d" in
        '') ;;
        /*) eff="$d" ;;
        '~'*) ;;
        *) eff="$eff/$d" ;;
      esac
      continue ;;
  esac

  if printf '%s' "$seg" | grep -Eq "$SEG_VERBS" || printf '%s' "$seg" | grep -Eq "$SEG_BARE_YARN"; then
    printf '%s' "$seg" | grep -Eq "$GLOBAL" && continue
    target="$eff"
    # An explicit --prefix / -C on the install itself wins over the cwd.
    p=$(printf '%s' "$seg" | grep -oE '(^|[[:space:]])(-C|--prefix)[[:space:]=]+[^[:space:]]+' | sed -E 's/.*(-C|--prefix)[[:space:]=]+//' | tr -d "\"'" | head -1)
    if [ -n "$p" ]; then
      case "$p" in /*) target="$p" ;; '~'*) ;; *) target="$eff/$p" ;; esac
    fi
    break
  fi
done <<EOF
$(printf '%s' "$cmd" | tr '&|;()' '\n\n\n\n\n')
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
