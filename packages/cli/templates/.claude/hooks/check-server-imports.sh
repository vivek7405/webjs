#!/usr/bin/env bash
#
# PreToolUse hook (scaffolded by `webjs create`): WARN, at write time, when an
# Edit/Write to a browser-facing app module (a page / layout / component under
# app/ or components/ or modules/, NOT a `.server.*` file) adds an import of a
# server-only `.server.{ts,js}` utility (a `.server.*` file with NO `'use server'`
# directive). In the browser that import resolves to a throw-at-load stub, so the
# module crashes the moment it loads. This is the #804 first-pass iteration loop:
# `webjs check`'s `no-server-import-in-browser-module` catches it AFTER the file
# lands; this hook surfaces it BEFORE, so the agent never writes the wrong shape.
#
# WARN, not block (the convention-vs-check principle in this app's AGENTS.md):
# `webjs check` is the authoritative gate, and a pre-edit static peek cannot see
# the full elision verdict, so a hard block could false-positive on a display-only
# page the framework would elide. So this emits a loud reminder and allows the
# edit. Set WEBJS_SERVER_IMPORT_GATE=block to hard-block instead; set
# WEBJS_NO_SERVER_IMPORT_GATE=1 to skip.
#
# A `'use server'` action import is fine (it becomes a working RPC stub), and a
# `import type { ... } from './x.server.ts'` is fine (the stripper erases it), so
# both are ignored.

[ "$WEBJS_NO_SERVER_IMPORT_GATE" = "1" ] && exit 0

payload="$(cat)"
node "$(dirname "$0")/check-server-imports.mjs" "$payload"
