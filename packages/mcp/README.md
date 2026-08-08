# @webjsdev/mcp

The webjs **Model Context Protocol server** for AI coding agents. A read-only
MCP server (newline-delimited JSON-RPC 2.0 over stdio) that gives an agent the
live introspection surface plus the framework knowledge layer it needs while
editing a webjs app.

## Run it

Register it with any MCP host (Claude, Cursor, etc.). It runs straight from npm,
no install:

```jsonc
// .claude.json / .cursor/mcp.json
{
  "mcpServers": {
    "webjs": { "command": "npx", "args": ["@webjsdev/mcp"] }
  }
}
```

Every webjs scaffold wires this entry automatically. `webjs mcp` (the CLI
subcommand) delegates to this same server, so both routes run identical code.

## What it exposes

- **Introspection tools** (read-only, scoped to an `appDir`): `list_routes`,
  `list_actions` (RPC endpoints plus the full data contract: HTTP verb, cache
  config, and boolean flags for tags/invalidates/validate/middleware; reserved
  config exports are excluded from the callable-action list), `list_components`,
  `list_elision` (the display-only elision verdict: which component modules the
  browser never downloads, the evidence behind each one that ships, every
  page/layout as inert / import-only / shipped, and any orphan class that gets
  no verdict at all; identical to `webjs elision --json`),
  `check` (the structured `webjs check` violations). Each projects an existing
  `@webjsdev/server` data function and mutates nothing.
- **Knowledge layer**: an `init` mental-model primer, a `docs` retrieval tool,
  MCP `resources` (the skill references + `SKILL.md` + `AGENTS.md` as `webjs-docs://*`),
  and `prompts` (the recipes as guided workflows).
- **`source` tool**: reads the framework's own no-build source from
  `node_modules/@webjsdev/*/src` (read-only, traversal-guarded).
- **`ui` tool**: the `@webjsdev/ui` kit inventory (no args) or one component's
  helper signatures, paste-ready structural example, a11y header, and deps (pass
  `name`). Kit-scoped (not `appDir`-scoped); shares one projector with
  `webjsui view`.

The docs corpus is bundled into the package at `prepack`, so `npx @webjsdev/mcp`
is self-contained; in the monorepo it falls back to the live repo-root docs.

That bundle is a snapshot frozen at publish time, so a published tarball keeps
serving the docs as they read on the day it was cut. `prepack` stamps it with
`resources/corpus.json` so the snapshot can say which docs it holds:

```json
{
  "package": "@webjsdev/mcp",
  "version": "0.1.12",
  "sha": "e5806e2400000000000000000000000000000000",
  "copiedAt": "2026-08-08T09:14:22.031Z"
}
```

`sha` is the full commit the docs were copied from, so it resolves straight to a
GitHub diff. Every field is `null` rather than a plausible-looking default when
it cannot be established, so a consumer can always tell a real answer from no
answer: `sha` when the source tree is not itself a git checkout root, and
`package` / `version` when the manifest cannot be read. None of those fails the
publish. A dev checkout has no bundle and so no stamp.

The SHA is deliberately refused when the tree merely SITS inside some other
checkout, because `git rev-parse` walks up to an ancestor and would otherwise
report an unrelated repository's HEAD as the commit these docs came from. That
answer is a well-formed SHA, so nothing downstream could catch it.

STDOUT is the JSON-RPC channel; every diagnostic goes to stderr.
