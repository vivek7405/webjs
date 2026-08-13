#!/usr/bin/env bash
#
# PreToolUse hook: block a `git commit` that changes RUNTIME-SENSITIVE
# framework source without staging a `test/bun/**` cross-runtime test.
#
# Why: webjs runs on Node 24+ AND Bun (#508). The surfaces where the two
# runtimes diverge (the serializer, the node:http vs Bun.serve listener +
# request path, SSR + the action / CSRF dispatch, streams, node:crypto,
# the TS stripper, auth / session / cors cookies) MUST be proven on Bun,
# not just Node. Bun parity kept slipping to an afterthought because the
# only nudge was a soft, non-blocking reminder that also missed the
# request path. This makes it a deterministic gate, matching the
# require-tests-with-src.sh / require-docs-with-src.sh model (block +
# named env escape hatch).
#
# What the hook does NOT do: run Bun (it is static file analysis). It only
# requires that a `test/bun/**` script be staged alongside the change, OR
# that the author acknowledge an existing Bun script already covers it.
# Actually RUNNING the Bun matrix (`node scripts/run-bun-tests.js` plus the
# touched `test/bun/*.mjs` under `bun`) stays the author's job, prompted
# by the block message and reaffirmed in the self-review step.
#
# Blocks (exit 2) when ALL hold:
#   1. the staged diff changes runtime-sensitive `packages/*/src` source, AND
#   2. no `test/bun/**` file is staged, AND
#   3. WEBJS_BUN_VERIFIED is not set to 1.
#
# Allowed (exit 0): a commit with no runtime-sensitive source; a commit
# that stages a test/bun file alongside; WEBJS_BUN_VERIFIED=1 (the author
# ran the Bun matrix and an existing test/bun script covers it); and
# `git commit --no-verify` (git's own bypass).
#
# Rule: AGENTS.md "Code workflow (mandatory)" cross-runtime parity (#508).

set -euo pipefail

if [ "${WEBJS_BUN_VERIFIED:-}" = "1" ]; then
  exit 0
fi

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)
if [ -z "$cmd" ]; then exit 0; fi

# Word-match `git commit` (the char after `commit` must not be a letter,
# digit, or hyphen) so sibling subcommands (commit-graph, commit-tree)
# do not trip it.
if ! printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]-])git commit([^[:alnum:]-]|$)'; then
  exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then exit 0; fi

staged=$(git diff --cached --name-only 2>/dev/null || true)
if [ -z "$staged" ]; then exit 0; fi

# Runtime-sensitive surfaces: the request / listener / serialization paths
# where Node and Bun can diverge. Kept in sync with the reminder regex in
# require-tests-with-src.sh. Scoped to published-package source.
src_runtime=$(printf '%s\n' "$staged" \
  | grep -E '^packages/([^/]+/src|editors/[^/]+/src|cli/lib)/' \
  | grep -E 'serialize|/json\.js|file-storage|listener|ts-strip|action|render-server|/ssr[./]|conditional-get|websocket|node-version|csrf|/auth\.js|/session\.js|/cors\.js|crypto|compression|body-limit|/dev[./]|stream' \
  || true)
if [ -z "$src_runtime" ]; then exit 0; fi

bun_staged=$(printf '%s\n' "$staged" | grep -E '(^|/)test/bun/' || true)
if [ -n "$bun_staged" ]; then exit 0; fi

list=$(printf '%s' "$src_runtime" | tr '\n' ' ')
cat >&2 <<EOF
BLOCKED: this commit changes runtime-sensitive source but stages no test/bun test.

Changed: $list

webjs runs on Node 24+ AND Bun (#508). These surfaces (the serializer, the
node:http vs Bun.serve listener + request path, SSR / action / CSRF dispatch,
streams, node:crypto, the TS stripper, auth / session / cors) are where the
two runtimes diverge, so a change here is NOT done until it is proven on Bun.

Do BOTH:
  1. Run the Bun matrix and report it green:
       node scripts/run-bun-tests.js        # needs bun on PATH
       bun test/bun/<the relevant script>.mjs
  2. Add or update a test/bun/<feature>.mjs cross-runtime assertion for the
     surface you changed (and \`git add\` it), so the parity is covered going
     forward. See .agents/skills/webjs/references/testing.md.

Already covered by an existing test/bun script that you ran under Bun and that
needs no change? Re-run with WEBJS_BUN_VERIFIED=1 to acknowledge it.

Hook: .claude/hooks/require-bun-parity-with-runtime-src.sh
EOF
exit 2
