# AGENTS.md for @webjsdev/mcp

The webjs **Model Context Protocol server** (extracted from `@webjsdev/cli` in
#415). A hand-rolled, READ-ONLY MCP stdio server, ZERO runtime dependency
beyond `@webjsdev/server` for its introspection data functions.

Framework-wide rules (workflow, JSDoc-in-`packages/`, no-build, commit
conventions) live in the **framework root [`../../AGENTS.md`](../../AGENTS.md)**
and apply here. Read that first. This file covers only what is specific to
`@webjsdev/mcp`.

## Entry points

- **`npx @webjsdev/mcp`** (`bin/webjs-mcp.js`): the agent-facing server an MCP
  host registers. The scaffold wires it into `.claude.json`.
- **`webjs mcp`** (the CLI subcommand): delegates to `runMcpServer` from this
  package, so the implementation has a single home. Back-compat only.

Both speak newline-delimited JSON-RPC 2.0 over stdio. STDOUT IS THE PROTOCOL
CHANNEL; every diagnostic goes to stderr. A malformed line is answered with a
parse error and never crashes the loop.

## Module map

```
bin/
  webjs-mcp.js           npx entry: reads the package version, runs runMcpServer
                         with the process streams.
src/
  mcp.js                 runMcpServer({ stdin, stdout, stderr, cwd, version,
                         deps?, docsDeps?, sourceDeps? }). The JSON-RPC loop +
                         the tool/resource/prompt dispatch. Handshake:
                         initialize -> serverInfo + capabilities (tools +
                         resources + prompts); notifications/initialized -> no
                         reply; tools/list, tools/call, resources/*, prompts/*.
                         INTROSPECTION tools (read-only, appDir-scoped), each
                         projecting a @webjsdev/server function: list_routes
                         (buildRouteTable, via the shared projectRoutes from
                         routes-report.js), list_actions (buildActionIndex +
                         hashFile, now reports verb/cache/tags/invalidates per
                         #488 and excludes reserved config exports from the
                         callable-action list), list_components (scanComponents),
                         list_elision (analyzeAppElision, #1308: the whole
                         elision verdict, returned VERBATIM because that
                         function already owns the app-level contract, so there
                         is no projector leaf and a drift test asserts it equals
                         `webjs elision --json`; note list_components stays a
                         cheap lexical inventory and must NOT grow an elided
                         flag, which would make it build a module graph),
                         check (checkConventions via projectCheck). Export names
                         are extracted LEXICALLY (extractExportNames /
                         extractRouteMethods / extractActionConfig) so no app
                         module is loaded.
                         The `ui` tool (#983) is KIT-scoped, not appDir-scoped:
                         it projects the shared `@webjsdev/ui/registry/extract`
                         leaf (the kit inventory, or one component's helper
                         signatures + paste-ready @example + a11y header + deps),
                         the SAME leaf `webjsui view` renders. A drift test in
                         mcp.test.mjs asserts the tool output equals that leaf's
                         output.
                         `deps` / `docsDeps` / `sourceDeps` / `uiDeps` are
                         injectable for in-process tests.
  mcp-docs.js            KNOWLEDGE layer (#376): resolveDocsLocation (the app's
                         own installed corpus first, then the server's bundled
                         resources/, then the repo-root skill in dev; also
                         returns corpusPath, null on the dev rung), the init
                         primer (sources the AGENTS.md execution-model +
                         invariants so it cannot drift, and reports which corpus
                         it served plus a warning when the app's @webjsdev/mcp
                         is newer than the server's, #1319), the docs tool,
                         resources (the skill references + SKILL.md + AGENTS.md
                         as webjs-docs://*), and the recipe PROMPTS.
                         compareVersions / readAppMcpVersion back that warning.
  mcp-source.js          SOURCE tool (#378): reads the framework's own no-build
                         source from node_modules/@webjsdev/*/src (read-only,
                         traversal-guarded via realpath, loads no module).
                         resolveFrameworkRoots locates each package by probing
                         the require.resolve node_modules dirs.
  check-report.js        projectCheck(violations) -> { violations, summary }.
                         The shared shape returned by BOTH the MCP `check` tool
                         and `webjs check --json` (the CLI imports it from
                         `@webjsdev/mcp/check-report`), so the two are identical.
  routes-report.js       routePathFromDir(routeDir) + projectRoutes(table,
                         { appDir, readFile, extractRouteMethods }) ->
                         { pages, apis } (#975). The shared route projector
                         returned by BOTH the MCP `list_routes` tool and
                         `webjs routes --json` (the CLI imports it from
                         `@webjsdev/mcp/routes-report`), so the two are identical.
                         A leaf module: the two effectful deps are injected so it
                         needs no `mcp.js` import (no cycle). A drift test asserts
                         `list_routes` output equals `projectRoutes`.
scripts/
  copy-mcp-resources.js  prepack: bundle the repo-root skill (references + SKILL.md) + AGENTS.md
                         into resources/ (in `files`) so npx is self-contained.
                         Also emits resources/corpus.json, the build stamp naming
                         the package, version, commit SHA, and copy time the
                         bundle froze (#1319). Exports bundleDocs(...) (whose
                         `stamp` is optional) + readGitSha(...), which answers
                         only for a checkout ROOT (rev-parse walks up, so a tree
                         nested in an unrelated repo would otherwise stamp that
                         repo's HEAD) and returns null rather than throwing.
                         Every stamp field is null when unknown, never a
                         plausible default, so no answer stays distinguishable
                         from a real one.
  clean-mcp-resources.js postpack: remove the transient resources/ bundle so dev
                         always reads the live repo-root docs. Exports
                         cleanBundle(...).
```

## Invariants

1. **STDOUT is JSON-RPC only.** Never `console.log` in the request path;
   diagnostics go to stderr (`logErr`). A stray stdout write corrupts the
   stream.
2. **Read-only.** Every tool projects an existing `@webjsdev/server` data
   function (or reads source/docs) and mutates nothing. No app module is loaded
   (export names are extracted lexically) so there are no DB-init side effects.
3. **The docs bundle is transient.** `resources/` exists only inside the
   published tarball (prepack writes it, postpack removes it). That covers the
   whole tree, `corpus.json` build stamp included; postpack removes the
   directory recursively, so nothing added to the bundle needs its own cleanup.
   In the monorepo the tree is absent and `resolveDocsLocation` falls back to
   the live repo-root docs, so source stays single. The stamp is build metadata,
   not a doc, which is why it sits beside `AGENTS.md` rather than inside
   `references/`: `catalogue()` lists only `*.md` under the references dir, so a
   stamp there would surface to agents as readable guidance.
4. **The corpus is a pure function of `appDir`.** `resolveDocsLocation` prefers
   the corpus installed in the app being asked about, because that copy is
   version-matched to the framework the agent is editing and the server's own
   snapshot may be years older (#1319). So the docs deps are built per call and
   memoized by `appDir`, never once at boot, which would pin the corpus to the
   launch directory. `resources/list` and `resources/read` carry no `appDir` in
   the MCP protocol, so they resolve from `cwd`, which is what a `tools/call`
   with no `appDir` argument defaults to; the surfaces diverge only when a
   caller deliberately asks about a different app. An injected `opts.docsDeps`
   wins for every `appDir`, which is the seam the tests drive. Because the corpus
   follows `appDir`, `init` and `docs` must ADVERTISE `appDir` in their
   `inputSchema` alongside the introspection tools: a tool that does not declare
   it can never be sent one by a conforming client, which would leave the
   app-corpus rung reachable only from hand-written JSON-RPC.

## Tests

`test/mcp.test.mjs`, `test/mcp-docs.test.mjs`, `test/mcp-source.test.mjs`,
`test/check-report.test.mjs`. `runMcpServer` is driven in-process with injected
deps, so no real server boots. Run `npm test` from the repo root.

---

Framework-wide rules and full API reference:

@../../AGENTS.md
