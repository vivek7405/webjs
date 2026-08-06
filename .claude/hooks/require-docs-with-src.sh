#!/usr/bin/env bash
#
# PreToolUse hook: BLOCK a `git commit` that changes public-facing
# framework source but stages NO documentation surface. In webjs,
# documentation is part of the definition of done, not an afterthought:
# the docs app PLUS every monorepo markdown surface (AGENTS.md / CLAUDE.md /
# CONVENTIONS.md, the skill at .agents/skills/webjs/, README, the docs site,
# the marketing website, the scaffold templates' per-agent rule files). The recurring
# failure was updating ONE surface (or none) and shipping the rest stale,
# so the docs drift behind the framework. HTTP-verb server actions (#488)
# shipped with AGENTS.md updated but the docs site untouched.
#
# This is the doc twin of require-tests-with-src.sh: it fires on every
# commit, decides from the STAGED diff (not model judgement), and BLOCKS
# (exit 2) when source is staged with no doc surface in the same commit.
# Earlier this hook only reminded; it now gates, because a reminder was
# routinely missed and docs shipped stale.
#
# What a hook CANNOT do: know WHICH surfaces a change needs (that is the
# webjs-doc-sync skill's job). So it enforces the floor (a public-source
# commit must stage SOME doc surface) and points at the skill for the
# substantive, per-surface sync.
#
# Scope: only fires on `git commit` Bash calls. Inspects the STAGED diff,
# so `git add` choices drive it.
#
# Allowed (exit 0): commits touching no public src; commits that stage a
# doc surface alongside source; and a genuinely internal change (refactor,
# CI, release, perf with no behaviour change) via WEBJS_NO_DOC_GATE=1.
# (`git commit --no-verify` skips git's own hooks, not this one, so the
# message names the env escape hatch.)
#
# Rule: AGENTS.md "Code workflow" item 2 (Documentation) + the
# webjs-doc-sync skill.

set -euo pipefail

# WEBJS_NO_DOC_REMINDER kept for back-compat with the pre-gate name.
if [ "${WEBJS_NO_DOC_GATE:-}" = "1" ] || [ "${WEBJS_NO_DOC_REMINDER:-}" = "1" ]; then
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

# Public-facing framework source: each runtime package's src/ and the CLI
# lib/. A change here is the kind that MAY change a documented surface.
src_touched=$(printf '%s\n' "$staged" | grep -E '^packages/([^/]+/src|editors/[^/]+/src|cli/lib)/' || true)
if [ -z "$src_touched" ]; then exit 0; fi

# Any documentation surface staged in the same commit? The curated set of
# real doc surfaces: AGENTS / CLAUDE / CONVENTIONS / README markdown at any
# depth (root, per-package, per-example), the skill at .agents/skills/webjs/,
# the marketing website (which carries the docs site at website/app/docs/),
# and the scaffold templates. NOT every *.md, so a stray note cannot be
# staged to slip the gate.
#
# `^docs/` is deliberately absent. That path used to BE the docs site until
# #1098 moved it under website/, then carried a redirect-only host until that
# became a Cloudflare rule. Nothing lives there now, and the docs site is
# reached through `^website/` above.
doc_staged=$(printf '%s\n' "$staged" | grep -E \
  '(^|/)(AGENTS|CLAUDE|CONVENTIONS|README)\.md$|^\.agents/skills/webjs/|^website/|^packages/cli/templates/' || true)
if [ -n "$doc_staged" ]; then exit 0; fi

cat >&2 <<'EOF'
BLOCKED: this commit changes framework source but stages no documentation.

Staged source under packages/*/src/** (or cli/lib) with no doc surface in
the same commit. In webjs, documentation is part of the definition of done:
a task is NOT done until every surface its change touches is in sync.

If this changed a PUBLIC or AGENT-FACING surface (an export, a CLI flag, a
package.json webjs.* key, an html hole, a lifecycle hook, a convention, or
the behaviour of an already-documented feature), invoke the webjs-doc-sync
skill, then `git add` EVERY applicable surface and commit again:
  AGENTS.md + .agents/skills/webjs/      agent reference (SKILL.md + references/)
  website/app/docs/<topic>               the docs site (served at webjs.dev/docs)
  README.md                              if a headline capability
  website/                               marketing copy, if headline
  packages/cli/templates/                scaffold per-agent rule files
  CONVENTIONS.md / per-package AGENTS.md if a convention changed
Updating AGENTS.md alone reproduces the #488 gap (docs site left stale).

Genuinely internal change (refactor, CI, release, perf with no behaviour
change) that needs no doc edit? Re-run with WEBJS_NO_DOC_GATE=1.

Hook: .claude/hooks/require-docs-with-src.sh
EOF
exit 2
