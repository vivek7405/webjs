#!/usr/bin/env bash
# Guardrail: a webjs custom element must extend the framework's WebComponent
# base class, never raw HTMLElement.
#
# Why: a raw `extends HTMLElement` custom element is invisible to the webjs
# elision analyser (it ships unconditionally, defeats display-only elision, and
# keeps any importing page/layout from being import-only), it bypasses the
# SSR / lifecycle / reactive-prop machinery, and it usually applies its DOM work
# in connectedCallback (client-only), a progressive-enhancement bug.
#
# Scope: fires ONLY when the edited file lives in a webjs project (a package.json
# up the tree depends on @webjsdev/*), so vanilla-JS projects are never touched.
# Exempts framework source (packages/, node_modules/), since the framework
# legitimately defines WebComponent and the SSR-inert <webjs-frame> / -stream /
# -suspense primitives on raw HTMLElement. Honours an explicit escape-hatch
# marker `webjs-allow-htmlelement: <reason>` for the rare native-API case
# WebComponent cannot express (a form-associated element via ElementInternals,
# a customized built-in via `extends HTMLButtonElement`, etc.).
#
# PreToolUse contract: exit 0 = allow, exit 2 = block (message on stderr).
#
# NOTE: No em-dashes, spaces around hyphens as pauses, or semicolons as pauses
# are allowed in comments per project rules.
set -euo pipefail

input=$(cat)
fp=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$fp" ] && exit 0
case "$fp" in
  *.ts|*.tsx|*.js|*.jsx|*.mts|*.mjs) ;;
  *) exit 0 ;;
esac

# The text being written: Write -> .content, Edit -> .new_string, MultiEdit -> .edits[]?.new_string.
content=$(printf '%s' "$input" | jq -r '(.tool_input.content // empty), (.tool_input.new_string // empty), (.tool_input.edits[]?.new_string // empty)')
[ -z "$content" ] && exit 0

# Only a class that extends raw HTMLElement is the target (not `typeof
# HTMLElement` guards, not `instanceof HTMLElement`, not another base).
printf '%s' "$content" \
  | grep -Eq 'class[[:space:]]+[A-Za-z_$][A-Za-z0-9_$]*[[:space:]]+extends[[:space:]]+HTMLElement([[:space:]{]|$)' \
  || exit 0

# Explicit, acknowledged exception.
printf '%s' "$content" | grep -qi 'webjs-allow-htmlelement' && exit 0

# Framework source / installed deps are never app components.
case "$fp" in
  */packages/*|*/node_modules/*|packages/*|node_modules/*) exit 0 ;;
esac

# Webjs context: a package.json up the tree references @webjsdev/* (a webjs app
# or the framework repo). Outside a webjs project this hook is a no-op.
dir=$(CDPATH= cd -- "$(dirname -- "$fp")" 2>/dev/null && pwd || dirname -- "$fp")
is_webjs=0
while [ -n "$dir" ] && [ "$dir" != "/" ]; do
  if [ -f "$dir/package.json" ] && grep -q '@webjsdev/' "$dir/package.json" 2>/dev/null; then
    is_webjs=1
    break
  fi
  dir=$(dirname -- "$dir")
done
[ "$is_webjs" -eq 0 ] && exit 0

cat >&2 <<'MSG'
BLOCKED: a webjs custom element must extend the WebComponent base class, not raw HTMLElement.

  import { WebComponent } from '@webjsdev/core';
  class MyThing extends WebComponent {
    render() { return html`...`; }
  }
  MyThing.register('my-thing');

A display-only element (just host classes / static markup) can set its classes
in the constructor (runs at SSR, so it is progressive-enhancement-safe) and
stays elidable, so it ships zero JS. A raw `extends HTMLElement` element cannot
be elided, defeats import-only routes, and applies its work client-only.

If WebComponent genuinely cannot express this (a rare native-API edge case),
add a marker comment containing `webjs-allow-htmlelement: <reason>` to the file
to acknowledge the exception, and this guardrail will allow it.
MSG
exit 2
