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
- **Knowledge layer**: an `init` mental-model primer (which also names the docs
  corpus it is serving, and warns when this server's copy looks stale against
  the app's), a `docs` retrieval tool, MCP `resources` (the skill references +
  `SKILL.md` + `AGENTS.md` as `webjs-docs://*`), and `prompts` (the recipes as
  guided workflows).
- **`source` tool**: reads the framework's own no-build source from
  `node_modules/@webjsdev/*/src` (read-only, traversal-guarded).
- **`ui` tool**: the `@webjsdev/ui` kit inventory (no args) or one component's
  helper signatures, paste-ready structural example, a11y header, and deps (pass
  `name`). Kit-scoped (not `appDir`-scoped); shares one projector with
  `webjsui view`.

## Which docs you get

The corpus is resolved in three rungs, highest first:

1. `<appDir>/node_modules/@webjsdev/mcp/resources`, the app's own installed copy.
2. `<pkg>/resources`, this server's bundled snapshot, so `npx @webjsdev/mcp` is
   self-contained.
3. The live repo-root docs, in a monorepo checkout.

The app's copy wins because it is version-matched to the framework you are
editing, and so is the only corpus that can be correct about that app. This
matters most for a GLOBAL install (`npm i -g` / `bun add -g`), which otherwise
keeps serving the docs it was published with forever, contradicting the copy
sitting in your own `node_modules`. That is a real incident, not a hypothetical:
a server published one day before the client router stopped needing an explicit
`import '@webjsdev/core/client-router'` kept teaching that import for months, and
an agent following it wrote dead imports into three layouts, each of which the
elision analyser then correctly refused to strip.

`appDir` is a per-call argument, so the corpus follows it. `resources/list` and
`resources/read` carry no `appDir` in the MCP protocol and resolve from the
server's working directory, which is what a `tools/call` with no `appDir`
defaults to, so in the ordinary case every surface reads one corpus.

`init` names the corpus it served on its first line, and prepends a warning when
the app's installed `@webjsdev/mcp` is strictly newer than the running server's:

```
Warning: this MCP server is @webjsdev/mcp@0.1.4, but this app has @webjsdev/mcp@0.1.12.
The server's own docs and tools may be stale. Update the global install with
npm i -g @webjsdev/mcp@latest, or bun add -g @webjsdev/mcp.
Docs corpus: @webjsdev/mcp@0.1.12, copied from webjsdev/webjs e5806e2 on 2026-08-08.
```

It warns rather than refusing to answer. By the time it fires the corpus rungs
have already pointed at the app's own docs, so the text below it is right; what
the warning is for is telling you to update the global install so the TOOLS
match too. Equal versions, an older app, and an unreadable app manifest are all
silent.

## The build stamp

The bundle is a snapshot frozen at publish time, so a published tarball keeps
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
