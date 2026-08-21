#!/usr/bin/env bash
#
# PreToolUse hook (scaffolded by `webjs create`): WARN on a `git commit`
# that adds or changes application code without any accompanying test.
#
# webjs is AI-first, and "every change ships with a test" is the right
# default. But it is a CONVENTION, not a correctness check: a sensible
# app can legitimately want a test-less commit (a spike, a vendored
# file, a pure refactor). The convention-vs-check principle in this
# app's AGENTS.md says guidance like this WARNS, it
# does not hard-block by default. So this hook surfaces a loud reminder
# and lets the commit proceed.
#
# What a hook CANNOT do: judge WHICH test layer a change needs (a unit
# test vs a browser/e2e test is a judgement call). So it nudges toward
# the floor (some real test should accompany app code) and reminds you
# to add browser/e2e coverage for interactive surfaces. The actual test
# suite runs in CI (.github/workflows/ci.yml), which is the real gate.
#
# Scope: fires only on `git commit`. Inspects the STAGED diff.
#
# Behavior when the staged diff changes app code (app/, modules/,
# components/, lib/) but stages no test (test/** or *.test.* / *.spec.*):
#   - Default: WARN via additionalContext, then allow the commit (exit 0).
#   - WEBJS_TEST_GATE=block: restore the old hard floor (print BLOCKED,
#     exit 2), for a project that wants the strict gate. Set it in
#     .claude/settings.json env, your shell, or CI.
#   - WEBJS_NO_TEST_GATE=1: skip entirely (no warn, no block), for a
#     genuine non-code commit (docs, config).
#
# Bypass (humans, emergencies): git commit --no-verify.

set -euo pipefail

if [ "${WEBJS_NO_TEST_GATE:-}" = "1" ]; then
  exit 0
fi

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then exit 0; fi
# Match `git commit` as a whole word so sibling subcommands
# (git commit-graph, git commit-tree) and string mentions do not trip it.
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]-])git commit([^[:alnum:]-]|$)'; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then exit 0; fi

staged=$(git diff --cached --name-only 2>/dev/null || true)
if [ -z "$staged" ]; then exit 0; fi

# App code lives under app/, modules/, components/, lib/. A `.server.*`
# file is still app code. Match source extensions only (skip .css, .md).
app_code=$(printf '%s\n' "$staged" \
  | grep -E '^(app|modules|components|lib)/.*\.([mc]?[jt]sx?)$' || true)
if [ -z "$app_code" ]; then exit 0; fi

test_staged=$(printf '%s\n' "$staged" \
  | grep -E '(^|/)test/|\.test\.[mc]?[jt]sx?$|\.spec\.[mc]?[jt]sx?$' || true)

if [ -z "$test_staged" ]; then
  # Hard-mode opt-in: restore the old block when the project asks for it.
  if [ "${WEBJS_TEST_GATE:-}" = "block" ] || [ "${WEBJS_TEST_GATE:-}" = "hard" ]; then
    cat >&2 <<'EOF'
BLOCKED: this commit changes app code but stages no test.

You staged application code (app/, modules/, components/, lib/) with no
accompanying test. Every change ships with a test. Add or update the test
that proves the new behaviour, then `git add` it.

Pick the layer the change needs (a unit test is not always enough):
  - logic / actions / queries / utils  -> a unit test
  - a component, hydration, a server action called from the client, the
    router, anything interactive -> a browser or e2e test that asserts the
    real behaviour in a browser, not just the function in isolation.

See `webjs test` and the testing guide. Genuine non-code commit (docs,
config) that needs no test? Re-run with WEBJS_NO_TEST_GATE=1. Hard mode is
on because WEBJS_TEST_GATE=block is set; unset it to fall back to a warning.

Hook: .claude/hooks/require-tests-with-src.sh
EOF
    exit 2
  fi

  # Default: warn loudly via additionalContext, then allow the commit.
  # A missing test for app code subsumes the interactive-component
  # reminder, so emit this warning alone and skip that reminder below.
  jq -n --arg ctx "Heads up: this commit stages app code (app/, modules/, components/, lib/) with no test. Every change should ship with a test (it is a convention, not a hard gate). Pick the layer the change needs: a unit test for logic/actions/queries/utils, and a browser or e2e test for a component, hydration, the client router, or a server action called from the client. The suite runs in CI regardless. To enforce a hard block locally, set WEBJS_TEST_GATE=block. To silence this for a genuine non-code commit, set WEBJS_NO_TEST_GATE=1." '{
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx }
  }'
  exit 0
fi

# Reminder for interactive surfaces: a unit test alone rarely covers them.
interactive=$(printf '%s\n' "$app_code" | grep -E '^components/|/components/' || true)
if [ -n "$interactive" ]; then
  jq -n --arg ctx "Reminder: this commit changes component code. A unit test alone usually is not enough for an interactive component; add a browser test (webjs test --browser) that asserts the rendered/hydrated behaviour." '{
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx }
  }'
fi
exit 0
