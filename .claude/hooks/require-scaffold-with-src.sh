#!/usr/bin/env bash
#
# PreToolUse hook: BLOCK a `git commit` that changes framework FEATURE
# source but stages NO scaffold surface. The scaffold is webjs's PRIMARY
# teaching surface for AI agents: an agent learns the framework by reading
# the generated gallery/showcase and its comments, then builds the real app
# by adapting them. So when a webjs FEATURE is added or changed, the scaffold
# that teaches it must move too, exactly as the docs must (this is the
# scaffold twin of require-docs-with-src.sh).
#
# It fires on every commit, decides from the STAGED diff (not model
# judgement), and BLOCKS (exit 2) when framework-feature source is staged
# with no scaffold surface in the same commit.
#
# What a hook CANNOT do: know WHETHER a given change actually needs a
# scaffold demo (a bug fix, an internal perf change, or a tweak to an
# already-demoed feature may not), nor tell a real demo from a doc bullet.
# So it enforces only the FLOOR (a feature-source commit must stage SOME
# scaffold surface OR consciously opt out) and points at the
# webjs-scaffold-sync skill for the per-surface walk and the mandatory
# generate-boot-check.
#
# The TIER-2 teeth live in CI, not here: test/scaffolds/gallery-coverage.test.js
# reconciles the live framework surface (@webjsdev/core + @webjsdev/server exports
# AND the routing convention files the router parses) against
# test/scaffolds/gallery-coverage.json and FAILS when a new one is neither
# demonstrated by the scaffold nor consciously exempted. That is the un-skippable
# gate (the analogue of a test that must exist AND pass); this hook is the fast
# commit-time reminder in front of it.
#
# Scope: only fires on `git commit` Bash calls. Inspects the STAGED diff,
# so `git add` choices drive it.
#
# Trigger (feature source that MAY need a scaffold update): the runtime +
# CLI packages' src, packages/(core|server|cli)/src/**. Editor plugins, the
# MCP, and intellisense do not shape the scaffold, so they are excluded.
#
# Satisfying surface: either of the scaffold's TWO primary teaching surfaces.
# (1) the scaffold itself, packages/cli/templates/** (the template files +
# per-agent rule files) OR packages/cli/lib/** (the generators); and (2) the
# agent skill at the repo-root .agents/skills/webjs/** (SKILL.md + references/),
# which is bundled into every scaffold at prepack and is the DURABLE teacher:
# `gallery:clear` removes the gallery, so the skill is the only teaching surface
# that survives, and a feature it does not teach is lost the moment an agent
# clears the gallery. So a feature-source commit must move the gallery OR the
# skill (per-surface judgment on whether BOTH are needed is the skill's manual
# walk + the CI coverage gate).
#
# Allowed (exit 0): commits touching no feature src; commits that stage a
# scaffold surface alongside the source; and a change that genuinely needs
# no scaffold update (a bug fix, an internal refactor, a tweak to an
# already-demoed feature) via WEBJS_NO_SCAFFOLD_GATE=1.
#
# Rule: AGENTS.md "Code workflow" (Scaffold) + the webjs-scaffold-sync skill.

set -euo pipefail

if [ "${WEBJS_NO_SCAFFOLD_GATE:-}" = "1" ]; then
  exit 0
fi

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then exit 0; fi

# Match `git commit` as a whole word (a real commit, not git commit-tree).
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]-])git commit([^[:alnum:]-]|$)'; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then exit 0; fi

staged=$(git diff --cached --name-only 2>/dev/null || true)
if [ -z "$staged" ]; then exit 0; fi

# Framework FEATURE source: the runtime + CLI packages' src. A change here is
# the kind that MAY need the scaffold that teaches it to move too.
src_touched=$(printf '%s\n' "$staged" | grep -E '^packages/(core|server|cli)/src/' || true)
if [ -z "$src_touched" ]; then exit 0; fi

# Any scaffold teaching surface staged in the same commit? Either the scaffold
# templates/generators, or the canonical repo-root gallery/ app (the gallery is
# runnable but disposable via gallery:clear, and prepack bundles it into the CLI
# tarball), OR the agent skill at .agents/skills/webjs/ (the durable teacher
# bundled into every scaffold, the only surface that survives gallery:clear).
scaffold_staged=$(printf '%s\n' "$staged" | grep -E '^packages/cli/(templates|lib)/|^gallery/|^\.agents/skills/webjs/' || true)
if [ -n "$scaffold_staged" ]; then exit 0; fi

cat >&2 <<'EOF'
BLOCKED: this commit changes framework-feature source but stages no scaffold.

Staged source under packages/(core|server|cli)/src/** with no scaffold
surface in the same commit. The scaffold is webjs's PRIMARY teaching surface
for AI agents (they learn the framework by reading the generated
gallery/showcase, then build the real app by adapting it), so a task is NOT
done until the scaffold that teaches the changed feature is in sync too.

If this added or changed a WebJs FEATURE an agent should learn from the
scaffold (a new export/API, an html hole, a lifecycle hook, a server-action
capability, a config key, a CLI behaviour), invoke the `webjs-scaffold-sync`
skill, then `git add` the teaching surface(s) and commit again:
  `.agents/skills/webjs/`                  the DURABLE teacher (SKILL.md + references/),
                                          survives `gallery:clear` so it MUST teach the feature
  gallery/                                a UI feature-gallery demo (runnable, disposable).
                                          The canonical root app; prepack bundles it into the CLI
  packages/cli/lib/api-gallery.js         an api backend-showcase endpoint
  packages/cli/lib/{create,saas-template}.js  the generators (home, theme, schema, wiring)
  packages/cli/templates/ (AGENTS/CONVENTIONS/.cursorrules/...)  scaffold rules in lockstep
  test/scaffolds/**                       the scaffold assertions for the above
A feature usually needs BOTH: a gallery demo (learn by running) AND skill
coverage (the pattern that survives the clear). The skill walks every surface
AND runs the mandatory generate + boot + `webjs check` verification (the
generators emit strings, so escaping bugs only show in a freshly generated app).

Change that genuinely needs no scaffold update (a bug fix, an internal
refactor, a tweak to an already-demoed feature)? Re-run with
WEBJS_NO_SCAFFOLD_GATE=1.

Hook: .claude/hooks/require-scaffold-with-src.sh
EOF
exit 2
