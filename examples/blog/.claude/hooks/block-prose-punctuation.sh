#!/usr/bin/env bash
#
# PreToolUse hook: block prose-punctuation patterns the webjs convention bans.
#
# Catches four classes of new content in tool calls:
#
#   1. U+2014 em-dash, anywhere.
#   2. Space-hyphen-space " - " in PROSE contexts (comment lines, markdown
#      lines, headings, blockquotes, a JSON "description" / "title" /
#      "displayName" string value, and a column-0 YAML front-matter
#      description: / title: / displayName: line). Math expressions in code like
#      `Math.abs(a - b)` or `arr.length - 1` are NOT flagged.
#   3. Space-semicolon-space " ; " in the same PROSE contexts as rule 2.
#      JS / CSS statement terminators (`;\n`) are NOT flagged.
#   4. Code-shaped left-hand side immediately followed by a colon and prose:
#        - `<code>foo()</code>:` (markdown code-LHS in docs)
#        - `<my-tag>:` (custom-element tag with hyphen)
#        - Inline comment `// foo(): description`
#
# Why this exists: see AGENTS.md "Invariants", item 11. These patterns
# confuse AI agents that try to parse the prose as TypeScript / shorthand-
# method / object-literal syntax, and trip humans reading API docs.
#
# Covers two tool-call paths:
#   * Write / Edit / MultiEdit / NotebookEdit. The hook inspects the NEW
#     content fields of the tool payload. Existing glyphs in old_string
#     are not flagged: you can still Edit a line that contains one to
#     remove it.
#   * Bash. The hook inspects the command string, which catches commit
#     messages (`git commit -m "..."`), heredocs, echo / printf, and any
#     other prose typed at the shell.

set -euo pipefail

payload=$(cat)

# Pull every field where prose might land. `// empty` keeps missing
# fields silent; `[]?` keeps array iteration safe when absent.
new_content=$(printf '%s' "$payload" | jq -r '
  (.tool_input.content // empty),
  (.tool_input.new_string // empty),
  (.tool_input.new_source // empty),
  (.tool_input.command // empty),
  (.tool_input.edits[]?.new_string // empty)
' 2>/dev/null || true)

if [ -z "$new_content" ]; then
  exit 0
fi

# Every match below reads from a here-string, never a pipe. `grep -q` exits on
# the first match, which closes a pipe under `printf`, and with `set -o pipefail`
# that SIGPIPE became the pipeline status, so the rule silently skipped on any
# payload past the pipe buffer (measured: 0 of 8 blocks at 128 KB).

# --- 1. U+2014 em-dash --------------------------------------------------
if grep -q $'\xe2\x80\x94' <<< "$new_content"; then
  cat >&2 <<'EOF'
BLOCKED: em-dash (U+2014) detected in this tool call.

webjs bans em-dashes repo-wide. Replace every U+2014 character with
a period, comma, colon (on a plain-noun LHS), parentheses, or
restructured sentence. Do NOT replace it with " - " or " ; " or a
trailing colon on code: those are also banned. See rule 2 / 3 / 4
below for the alternatives.

Rule: AGENTS.md, Invariants section, item 11.
Hook: .claude/hooks/block-prose-punctuation.sh.
EOF
  exit 2
fi

# --- 2. Pause-hyphen " - " in PROSE contexts ----------------------------
# Only flag lines whose context is clearly prose:
#   - Markdown lines starting with `#`, `>`, `*`, plain text outside code
#     fences (heuristic: line has no `=`, `{`, or `(...)` math)
#   - JSDoc / block comment lines starting with `*`
#   - Single-line comments starting with `//`
#
# Math expressions like `Math.abs(a - b)` or `arr.length - 1` are NOT
# flagged because they appear in code lines (not comments) with code
# context. The hook trades some false negatives in prose for zero false
# positives in code-heavy diffs.

block_pause_hyphen=0

# Comment-line " - " pause: line starts with `//` or ` *` (JSDoc/block) or
# `*` (markdown bold-start would have a letter after, distinguishable),
# followed by prose with `\w+ - \w+` pattern. Specifically: catch lines
# like `// foo - bar`, ` * foo - bar`, `* foo - bar`.
if grep -qE '^[[:space:]]*(//|\*)[[:space:]].*[A-Za-z`)>][[:space:]]-[[:space:]][A-Za-z`(<]' <<< "$new_content"; then
  block_pause_hyphen=1
fi

# Markdown heading " - " pause: line starts with `#` followed by prose
# and ` - ` pattern.
if grep -qE '^#{1,6}[[:space:]].*[A-Za-z`)>][[:space:]]-[[:space:]][A-Za-z`(<]' <<< "$new_content"; then
  block_pause_hyphen=1
fi

# Markdown blockquote " - " pause: line starts with `>` followed by prose
# and ` - ` pattern. (Single `>` blockquote, not table.)
if grep -qE '^>[[:space:]].*[A-Za-z`)>][[:space:]]-[[:space:]][A-Za-z`(<]' <<< "$new_content"; then
  block_pause_hyphen=1
fi

# HTML / markdown <p>, <li>, <td> body " - " pause: line contains a
# closing HTML tag from a prose context, then prose-style ` - `.
if grep -qE '<(p|li|td|h[1-6]|strong|em|blockquote)[^>]*>[^<]*[A-Za-z`)>][[:space:]]-[[:space:]][A-Za-z`(<]' <<< "$new_content"; then
  block_pause_hyphen=1
fi

# JSON prose-value " - " pause: a string assignment whose KEY is one of the
# three prose-bearing keys this project's JSON uses. Scoping to the key is what
# keeps this off semver ranges, script commands, urls, paths and globs, every
# one of which lives under a different key. Shape, not file path: the Bash
# payload carries no file_path, so a heredoc writing a manifest is covered too.
if grep -qE '^[[:space:]]*"(description|title|displayName)"[[:space:]]*:[[:space:]]*".*[A-Za-z`)>][[:space:]]-[[:space:]][A-Za-z`(<]' <<< "$new_content"; then
  block_pause_hyphen=1
fi

# YAML front-matter " - " pause, same three keys. Anchored at column 0 with no
# leading whitespace, which is what confines it to document front matter: every
# nested YAML mapping is indented, including the workflow-input `description:`
# values in .github/workflows/release.yml.
if grep -qE '^(description|title|displayName):[[:space:]].*[A-Za-z`)>][[:space:]]-[[:space:]][A-Za-z`(<]' <<< "$new_content"; then
  block_pause_hyphen=1
fi

if [ "$block_pause_hyphen" = "1" ]; then
  cat >&2 <<'EOF'
BLOCKED: pause-hyphen " - " detected in a prose context.

webjs bans plain hyphens used as pause-punctuation in prose. Rewrite
the sentence with a period, comma, colon (on a plain-noun LHS), or
restructured phrasing.

  Bad:  // Foo - bar
  Good: // Foo, with bar
  Good: // Foo. Bar.

  Bad:  <li>Foo - bar.</li>
  Good: <li>Foo, with bar.</li>

  Bad:  "description": "A library - for things"
  Good: "description": "A library for things"

Plain hyphens are still fine in compound words (`AI-first`), CLI
flags (`--http2`), filenames, ranges, and math expressions in code
(`arr.length - 1`, `Math.abs(a - b)`). The hook only flags the
` < word > - < word > ` pause-pattern in prose contexts (comments,
markdown headings, blockquotes, HTML prose tags, and a JSON or
front-matter description / title / displayName value).

Rule: AGENTS.md, Invariants section, item 11.
Hook: .claude/hooks/block-prose-punctuation.sh.
EOF
  exit 2
fi

# --- 3. Pause-semicolon " ; " in PROSE contexts -------------------------
# Same prose-context guard as #2.
block_pause_semicolon=0

if grep -qE '^[[:space:]]*(//|\*)[[:space:]].*[A-Za-z`)][[:space:]];[[:space:]][A-Za-z`(]' <<< "$new_content"; then
  block_pause_semicolon=1
fi

if grep -qE '^#{1,6}[[:space:]].*[A-Za-z`)][[:space:]];[[:space:]][A-Za-z`(]' <<< "$new_content"; then
  block_pause_semicolon=1
fi

if grep -qE '^>[[:space:]].*[A-Za-z`)][[:space:]];[[:space:]][A-Za-z`(]' <<< "$new_content"; then
  block_pause_semicolon=1
fi

if grep -qE '<(p|li|td|h[1-6]|strong|em|blockquote)[^>]*>[^<]*[A-Za-z`)][[:space:]];[[:space:]][A-Za-z`(]' <<< "$new_content"; then
  block_pause_semicolon=1
fi

# JSON prose-value " ; " pause, same three keys as rule 2.
if grep -qE '^[[:space:]]*"(description|title|displayName)"[[:space:]]*:[[:space:]]*".*[A-Za-z`)][[:space:]];[[:space:]][A-Za-z`(]' <<< "$new_content"; then
  block_pause_semicolon=1
fi

# YAML front-matter " ; " pause, column-0 anchored like rule 2.
if grep -qE '^(description|title|displayName):[[:space:]].*[A-Za-z`)][[:space:]];[[:space:]][A-Za-z`(]' <<< "$new_content"; then
  block_pause_semicolon=1
fi

if [ "$block_pause_semicolon" = "1" ]; then
  cat >&2 <<'EOF'
BLOCKED: pause-semicolon " ; " detected in a prose context.

webjs bans semicolons used as pause-punctuation in prose. Rewrite as
two sentences (period) or with a conjunction (", and", ", but", ", so").

  Bad:  // Forms work ; links work too.
  Good: // Forms work. Links work too.
  Good: // Forms work, and links work too.

  Bad:  "description": "Forms work ; links work too."
  Good: "description": "Forms work. Links work too."

Semicolons stay fine inside code (JS statement terminators, CSS
declarations) since those are not flagged. Only the space-surrounded
form is banned, so an ordinary English semicolon is untouched.

Rule: AGENTS.md, Invariants section, item 11.
Hook: .claude/hooks/block-prose-punctuation.sh.
EOF
  exit 2
fi

# --- 4a. <code>foo()</code>: prose ---------------------------------------
# Markdown / HTML definition list with code-call followed by colon and
# lowercase prose. The `)</code>:` shape is unambiguous: this is markdown,
# not code, AND the inner code ends in `()` so the colon visually parses
# as a return-type annotation.
if grep -qE '\)</code>:[[:space:]][a-z]' <<< "$new_content"; then
  cat >&2 <<'EOF'
BLOCKED: code-LHS colon-then-prose detected ("<code>foo()</code>: ...").

webjs bans `<code>foo()</code>: <prose>` because the colon visually
parses as a TypeScript return-type annotation. Rewrite verb-led.

  Bad:  <code>repeat()</code>: keyed list directive
  Good: <code>repeat()</code> is the keyed list directive
  Good: <code>startServer()</code> creates an HTTP(S) server

Rule: AGENTS.md, Invariants section, item 11.
Hook: .claude/hooks/block-prose-punctuation.sh.
EOF
  exit 2
fi

# --- 4b. Custom-element-tag <my-tag>: prose ------------------------------
# HTML reserves hyphenated tag names for custom elements (W3C spec), so
# `<x-y>:` is unambiguous prose, never JSX / TS / CSS.
if grep -qE '<[a-z][a-z0-9]*(-[a-z0-9]+)+([[:space:]][^>]*)?>:[[:space:]][a-z]' <<< "$new_content"; then
  cat >&2 <<'EOF'
BLOCKED: custom-element-tag colon-then-prose detected ("<my-tag>: ...").

webjs bans `<my-tag>: <prose>` in comments and docs. Rewrite verb-led.

  Bad:  // <ui-dialog>: owns open state, focus trap, escape, scroll lock.
  Good: // <ui-dialog> owns open state, focus trap, escape, scroll lock.
  Bad:  // <ui-dialog-content>: the centered panel.
  Good: // <ui-dialog-content> is the centered panel.

Rule: AGENTS.md, Invariants section, item 11.
Hook: .claude/hooks/block-prose-punctuation.sh.
EOF
  exit 2
fi

# --- 4c. Inline / JSDoc comment "foo(): prose" --------------------------
# Match comment-line prefix (`//` or leading `*`) before `\w+(...): ` and
# lowercase prose. Avoids TS return-type annotations because those never
# appear inside comment lines.
if grep -qE '^[[:space:]]*(//|\*)[[:space:]][^(]*[A-Za-z_][A-Za-z0-9_]*\([^)]*\):[[:space:]][a-z]' <<< "$new_content"; then
  cat >&2 <<'EOF'
BLOCKED: comment-line code-LHS colon-then-prose detected ("// foo(): ...").

webjs bans `xyz(): <prose>` inside comments and JSDoc. Rewrite verb-led.

  Bad:  // firstUpdated(): once, on the first render only
  Good: // firstUpdated() runs once, on the first render only
  Bad:  // closest(): null if the click wasn't inside a frame
  Good: // closest() returns null when the click wasn't inside a frame

Rule: AGENTS.md, Invariants section, item 11.
Hook: .claude/hooks/block-prose-punctuation.sh.
EOF
  exit 2
fi

exit 0
