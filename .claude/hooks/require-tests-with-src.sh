#!/usr/bin/env bash
#
# PreToolUse hook: block a `git commit` that changes framework source
# without touching any test, and reject commits that look like they strip
# tests to slip past the gate. Deterministic floor for the project rule
# "every code change ships with tests" (AGENTS.md "Definition of done").
#
# What a hook CANNOT do: know which test LAYER a change needs (unit vs
# browser vs e2e is a judgement call). So it enforces the floor (a real
# test change must accompany source) and, for client/browser-facing
# source, injects a reminder naming the layers to cover. The substantive
# check (do the tests exercise the behaviour, are they green, were any
# silently removed) stays the reviewer/test-audit step in AGENTS.md.
#
# Scope: only fires on `git commit` Bash calls. Inspects the STAGED diff
# (what the commit records), so `git add` choices drive it.
#
# Blocks (exit 2) when EITHER:
#   1. The staged diff modifies `packages/*/src/**` but stages no test
#      file (`**/test/**`, `*.test.*`, or `*.spec.*`), OR
#   2. The staged test files have a net-negative line count while source
#      also changes (a signal tests were trimmed to pass), unless
#      WEBJS_ALLOW_TEST_REMOVAL=1 marks an intentional test refactor.
#
# Allowed (exit 0): commits touching no `packages/*/src/**`; commits that
# stage tests alongside source; and WEBJS_NO_TEST_GATE=1 for a genuine
# one-off. (`git commit --no-verify` also skips it, but the messages name
# the env escape hatches since this is a PreToolUse hook, not git's own.)
#
# Rule: AGENTS.md "Definition of done" plus the test-audit reviewer step.

set -euo pipefail

if [ "${WEBJS_NO_TEST_GATE:-}" = "1" ]; then
  exit 0
fi

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then exit 0; fi

# Match `git commit` as a whole word: the char after `commit` must not be
# a letter, digit, or hyphen, so a real commit (followed by a space, end,
# newline, `;`, `&`, etc.) trips the gate while sibling subcommands
# (git commit-graph, git commit-tree) do not.
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]-])git commit([^[:alnum:]-]|$)'; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then exit 0; fi

staged=$(git diff --cached --name-only 2>/dev/null || true)
if [ -z "$staged" ]; then exit 0; fi

# Framework source lives under each package's src/, EXCEPT the CLI, which
# keeps its logic in packages/cli/lib/. Grouped packages live one level
# deeper (packages/editors/<pkg>/src, e.g. intellisense, vscode after #402).
# Gate all so a change is not a blind spot.
src_touched=$(printf '%s\n' "$staged" | grep -E '^packages/([^/]+/src|editors/[^/]+/src|cli/lib)/' || true)
if [ -z "$src_touched" ]; then exit 0; fi

test_staged=$(printf '%s\n' "$staged" | grep -E '(^|/)test/|\.test\.[mc]?[jt]sx?$|\.spec\.[mc]?[jt]sx?$' || true)

if [ -z "$test_staged" ]; then
  cat >&2 <<'EOF'
BLOCKED: this commit changes framework source but stages no test.

Staged source under packages/*/src/** with no accompanying test file.
Every code change ships with tests (AGENTS.md "Definition of done"). Add
or update the test that proves the new behaviour, then `git add` it.

Walk the layers the change can affect, do NOT stop at unit:
  unit:    packages/*/test/** , test/**
  browser: */test/**/browser/*   (hydration, client render, DOM, router)
  e2e:     test/e2e/*.test.mjs    (full stack, network probes, navigation)
  smoke:   test/examples/*/smoke/*   (example apps still serve)
  bun:     node scripts/run-bun-tests.js + test/bun/*.mjs   (cross-runtime;
           required for serializer / listener / streams / crypto / node:* changes)

For a client-router / component / browser-facing change a unit test is
necessary but NOT sufficient. Add the browser and/or e2e coverage that
asserts the real behaviour (for example a network probe that a fetch did
or did not happen).

Genuine non-code commit (pure docs, release bump) that needs no test?
Re-run with WEBJS_NO_TEST_GATE=1.

Hook: .claude/hooks/require-tests-with-src.sh
EOF
  exit 2
fi

if [ "${WEBJS_ALLOW_TEST_REMOVAL:-}" != "1" ]; then
  nums=$(git diff --cached --numstat -- \
    '**/test/**' '*.test.*' '*.spec.*' 'test/**' 2>/dev/null || true)
  if [ -n "$nums" ]; then
    added=$(printf '%s\n' "$nums" | awk '{a+=$1} END{print a+0}')
    deleted=$(printf '%s\n' "$nums" | awk '{d+=$2} END{print d+0}')
    if [ "$deleted" -gt "$added" ]; then
      cat >&2 <<EOF
BLOCKED: this commit removes more test lines than it adds (+$added / -$deleted).

A net reduction in tests alongside a source change is the signature of
tests trimmed to pass. If this is a real test refactor or files moving,
re-run with WEBJS_ALLOW_TEST_REMOVAL=1. Otherwise add the coverage back.

Hook: .claude/hooks/require-tests-with-src.sh
EOF
      exit 2
    fi
  fi
fi

# Accumulate non-blocking layer reminders, then emit ONE additionalContext (two
# jq objects would be invalid hook output).
reminder=""

client_facing=$(printf '%s\n' "$src_touched" | grep -E 'router-client|render-client|component[./]|slot[./]|lazy-loader|websocket-client|client-router|directives' || true)
if [ -n "$client_facing" ]; then
  list=$(printf '%s' "$client_facing" | tr '\n' ' ')
  reminder="${reminder}Client/browser-facing source changed ($list). A unit test alone is not sufficient; confirm browser and/or e2e coverage (network probes, navigation, hydration) asserts the real behaviour. "
fi

# Runtime-sensitive source: webjs runs on Node 24+ AND Bun (#508), and these
# surfaces are where the two runtimes diverge (the serializer's Blob/File/FormData
# identity, the node:http vs Bun.serve listener shells, node stream/fs error
# propagation, the TS stripper's error shape, JSC vs V8 error messages). A change
# here MUST be proven on Bun, not just Node. The Bun matrix is a separate runner.
# Kept in sync with require-bun-parity-with-runtime-src.sh (the BLOCKING gate);
# this is the matching non-blocking nudge, widened to the request path (csrf /
# actions / ssr / dev handler / auth / session / cors), which diverges on Bun too.
runtime_sensitive=$(printf '%s\n' "$src_touched" | grep -E 'serialize|/json\.js|file-storage|listener|ts-strip|action|render-server|/ssr[./]|conditional-get|websocket|node-version|csrf|/auth\.js|/session\.js|/cors\.js|crypto|compression|body-limit|/dev[./]|stream' || true)
if [ -n "$runtime_sensitive" ]; then
  rlist=$(printf '%s' "$runtime_sensitive" | tr '\n' ' ')
  reminder="${reminder}Runtime-sensitive source changed ($rlist). webjs runs on Node AND Bun: run \`node scripts/run-bun-tests.js\` (needs bun installed) plus the test/bun/*.mjs scripts under Bun, and treat any divergence as a real framework bug to fix (not a skip). Add a test/bun/<feature>.mjs cross-runtime script for a new listener/serializer/streaming surface. See .agents/skills/webjs/references/testing.md. "
fi

if [ -n "$reminder" ]; then
  jq -n --arg ctx "Reminder: ${reminder}Run a test-audit review before declaring the PR ready." '{
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: $ctx }
  }'
fi
exit 0
