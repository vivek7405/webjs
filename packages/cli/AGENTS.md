# AGENTS.md for @webjsdev/cli

The webjs **command-line interface** (`webjs dev` / `start` / `test`
/ `check` / `create` / `db`) plus the scaffold templates shipped
into every new app.

Framework-wide rules (workflow, JSDoc-in-`packages/`, no-build,
commit conventions, autonomous-mode behaviour, scaffold rules) live
in the **framework root [`../../AGENTS.md`](../../AGENTS.md)** and
apply here. Read that first.

This file only covers what's specific to `@webjsdev/cli`.

## Module map

```
bin/
  webjs.js               CLI entry: argv dispatch for every command.
                         The exact-three template list (full-stack/api/saas)
                         is enforced here; --template validation rejects
                         anything else with a guidance message.
lib/
  node-preflight.js      Inline, DEPENDENCY-FREE Node-version guard (#238).
                         `checkNodeInline(current, engines)` + `nodeInlineMessage`.
                         The bin runs it BEFORE any `import @webjsdev/server`,
                         because importing the server links dev.js (Node 24+
                         builtins) and would itself link-fail on old Node. So the
                         primary guard depends only on `process.versions.node`.
                         Tests: `test/node-preflight/`.
  (MCP moved out)        The MCP server (`webjs mcp` + the `check --json` JSON
                         projector) was EXTRACTED into the standalone
                         `@webjsdev/mcp` package (#415). `webjs mcp` now
                         delegates to its `runMcpServer`, and `check --json`
                         imports `projectCheck` from `@webjsdev/mcp/check-report`
                         (so the CLI flag and the MCP `check` tool stay
                         byte-identical). `@webjsdev/mcp` is a `dependencies`
                         entry. See `packages/mcp/AGENTS.md` for the full surface
                         (tools, resources, prompts, the source tool, the docs
                         bundling). Agents register the server via
                         `npx @webjsdev/mcp`.
  doctor.js              `webjs doctor` project-health checks (#266).
                         `runDoctorChecks(appDir, opts?)` is PURE (reads files +
                         optionally the network, never exits / prints) so each
                         check is unit-testable. `opts.nodeVersion` overrides the
                         running Node, `opts.vendor` injects the pin-freshness
                         `{ hasVendorPin, findOutdated }` pair (offline tests).
                         The bin renders + owns the non-zero exit on a hard fail.
                         Tests: `test/cli/doctor.test.mjs`.
  port.js                Port resolution for `webjs dev` / `start` (#447).
                         `loadAppEnv(appDir)` loads `<appDir>/.env` into
                         `process.env` (same guard + shell-wins semantics as the
                         server's own load); `resolvePort(portFlag, env?)` is the
                         PURE resolver with precedence `--port` > `PORT` (real env
                         or `.env`) > 8080. The bin calls `loadAppEnv` BEFORE
                         `resolvePort` so a `.env` PORT is in `process.env` at
                         resolution time; the server loads `.env` too but too late
                         to affect the port the CLI computes. Tests: `test/port/`.
  dev-supervisor.js      `webjs dev` reload-supervisor planner (#514). PURE
                         `planDevSupervisor({ isBun, argv, noHot, exists })`
                         returns the spawn decision: `bun --hot` on Bun (Bun
                         ignores the dev `?t=` cache-bust, so `node --watch`
                         would leave a server-module edit stale), `node --watch`
                         + the existing `--watch-path` set on Node, or `inline`
                         (run in-process) when `--no-hot` is passed. Kept pure so
                         the branch logic is unit-testable without spawning a
                         process; the bin owns the actual spawn + the
                         `__WEBJS_DEV_CHILD` re-entry. Tests: `test/dev-supervisor/`
                         (unit) + `test/bun/dev-hot-reload.mjs` (cross-runtime).
  resolve-bin.js         Resolve a dependency's bin from the app's node_modules
                         (#570). `resolveBin(cwd, pkgName, binName)` so `webjs db`
                         / `webjs test --browser` spawn the tool with
                         `process.execPath` (the current runtime) instead of
                         `npx` (absent in a pure oven/bun image). drizzle-kit /
                         @web/test-runner block `./bin` + `./package.json` in
                         `exports`, so it resolves the `.` main entry, walks to
                         the package root, and reads the `bin` field. Tests:
                         `test/resolve-bin/`.
  create.js              `webjs create <name>` scaffold logic. Copies
                         `templates/` into the new app, writes
                         package.json + tsconfig + Drizzle db layer,
                         template-specific app/ files, prints the
                         post-scaffold guidance for AI agents. Resolves
                         the `--runtime node|bun` axis (#541, default node,
                         bun auto-detected from the invoking PM) and
                         branches the package.json scripts /
                         lockfile + applies the
                         runtime-rewrite transforms to the copied deploy +
                         agent-config files when bun.
  api-gallery.js         Backend-features showcase for --template api:
                         JSON/HTTP endpoints under app/api/features/ (the
                         api counterpart of the UI gallery). Auth is a
                         full-stack GALLERY card now (templates/gallery/
                         {app/features/auth,modules/auth}), not a template.
  runtime-rewrite.js     Pure transforms (#541) that DERIVE the bun-mode
                         variant of each canonical node template:
                         `bunifyProse` (npm->bun command forms in markdown),
                         `bunifyDockerfile` (a pure `oven/bun:1` base + bun
                         install + `bun --bun run start` CMD + bun -e
                         healthcheck, #595; safe since cli@0.10.20's npx-free
                         `webjs db migrate` (#570) needs no Node in the image),
                         `bunifyCompose` (compose healthcheck -> bun -e), and
                         `bunifyCi` (adds setup-bun
                         next to setup-node, bun install, plain `bun run`). Only
                         the dev/start SCRIPTS force `--bun`; the test/db/check
                         tooling stays on Node (webjs test spawns `node --test`).
                         No parallel bun template, so no drift. compose.yaml is
                         not transformed (it inherits the Dockerfile CMD). Tests:
                         `test/runtime-rewrite/`.
templates/               Verbatim files copied into every new app.
                         {{APP_NAME}} placeholder is substituted at
                         copy time. The AGENTS.md / CLAUDE.md /
                         CONVENTIONS.md / .cursorrules / .agents/rules/workflow.md
                         / .github/copilot-instructions.md / .editorconfig
                         / .env.example / .claude.json / .claude/hooks/
                         all live here. AGENTS.md ALSO gets a template-specific
                         {{PLAYBOOK}} injection: create.js substitutes the
                         full-stack or api build playbook from
                         templates/partials/agents-playbook-{fullstack,api}.md
                         (the shared meta-rules stay in AGENTS.md, so the two
                         stay single-sourced). The partials are NOT copied as
                         app files.
README.md                npm-facing package readme.
```

## Public commands (see USAGE in `bin/webjs.js`)

| Command | Implementation |
|---|---|
| `webjs dev` | Re-execs itself under the host runtime's hot-reload supervisor, then `startServer({ dev: true })` in the child. The supervisor is runtime-specific (#514, `lib/dev-supervisor.js`): `node --watch` on Node (restart-on-change, fresh ESM cache, plus the dev re-import's `?t=` query); `bun --hot` on Bun (in-place module invalidation, since Bun keys its cache by path and ignores `?t=`, so `node --watch` would leave a server-module edit stale). `--no-hot` opts out and runs the server in-process on either runtime. In the parent (pre-spawn) it runs the configured dev orchestration (#550, `lib/run-tasks.js`): the `webjs.dev.before` steps (one-shot) to completion, then the `webjs.dev.parallel` watchers (e.g. the Tailwind CLI) alongside the server, torn down on exit. So a bare `webjs dev` runs the same before-steps and watchers as `npm run dev`. The scaffold ships `webjs db migrate` as both a `dev.before` and a `start.before` step (#725), so a `db:generate`'d migration is applied on the next boot in dev and prod alike with no manual `db:migrate`; `.env` is loaded before the dev before-steps (same as start), so a Postgres dev migrate sees `DATABASE_URL`. Local binaries (`drizzle-kit`, `tailwindcss`) resolve because the spawn PATH is prepended with the ancestor `node_modules/.bin` dirs, npm-style. **Before dispatching either dev or start**, a directory-relative resolve probe (`checkFrameworkResolves` from `lib/doctor.js`) checks that `@webjsdev/core` resolves from `process.cwd()`; if not (the fresh-git-worktree-without-node_modules trap, #954), it prints the cause + remedy and exits 1 instead of letting a raw `ERR_MODULE_NOT_FOUND` bubble from deep in SSR. A no-op single resolve on the happy path. |
| `webjs start` | `startServer({ dev: false })`, plain HTTP/1.1 (front a reverse proxy for TLS + HTTP/2). Shares the dev framework-resolve preflight above (#954). |
| `webjs test [--server\|--browser]` | Runtime-native test runner (#570): server tests run under `node --test` on Node and `bun test` on Bun (`bun --test` is invalid), dispatched on `process.versions.bun`; browser tests run the app's resolved `@web/test-runner` (`wtr`) bin via `process.execPath` (no `npx`). |
| `webjs check [--rules] [--json]` | `checkConventions()` from `@webjsdev/server/check`. `--rules` lists the checks. `--json` emits the structured violations + a summary count as JSON (via `projectCheck` from `@webjsdev/mcp/check-report`, the same projector the MCP `check` tool uses, #415), so an agent in a loop consumes structured data instead of regex-scraping stdout; the non-zero exit on violations is preserved. Report-only: each violation carries a prose `fix` hint, but there is no `--fix` autofix flag (the rules either rewrite code or rename files, so an automatic codemod is not safe) |
| `webjs routes [--json\|--table] [--no-headers]` | Prints the route table to stdout (#975): every page (path, owner file, dynamic params) and every `route.{js,ts}` handler (path, owner file, HTTP methods). Reuses `buildRouteTable` from `@webjsdev/server` (the ONE walker, shared with `webjs types` + the dev server) and the shared `projectRoutes` projector from `@webjsdev/mcp/routes-report`, so `--json` is byte-identical to the MCP `list_routes` tool (the same split as `check --json` / `check-report.js`). Default is a grouped tree; `--table` is aligned KIND/PATH/METHODS/FILE columns and `--no-headers` drops the header row for piping. Read-only. Tests: `test/cli/routes.test.mjs` |
| `webjs mcp` | Delegates to `runMcpServer()` from the standalone `@webjsdev/mcp` package (#415; full surface in `packages/mcp/AGENTS.md`). A read-only MCP stdio server: INTROSPECTION (`list_routes` / `list_actions` / `list_components` / `check`), KNOWLEDGE (`init` primer, `docs`, `resources`, `prompts`), and a `source` tool. The scaffold's `.claude.json` registers the server directly as `{ "command": "npx", "args": ["@webjsdev/mcp"] }` (mountable in any MCP host, e.g. Cursor `.cursor/mcp.json`); `webjs mcp` stays as a back-compat alias. STDOUT is the JSON-RPC channel (diagnostics go to stderr) |
| `webjs doctor` | `runDoctorChecks()` from `lib/doctor.js`. A project-health checklist over existing signals (Node major, tsconfig `erasableSyntaxOnly`, `.env` drift vs `.env.example`, vendor-pin freshness, the `.gitignore` keeping `.webjs/vendor/` committable (`vendor-gitignore`, moved here from `webjs check` in #461 as a warn since it is a project-config concern, not source correctness), `@webjsdev/*` version coherence, a framework-resolve probe (#954: `checkFrameworkResolves` + the exported `frameworkResolves` helper WARN when `@webjsdev/core` cannot be resolved FROM the app dir via a directory-relative `createRequire` probe, naming the fresh-git-worktree-without-node_modules cause and the fix; silent PASS when it resolves, so a healthy app is untouched), importmap coherence, git pre-commit hook, and a page/layout elision advisory (#646: `checkElisionCarriers` runs `@webjsdev/server`'s `analyzeAppElision` and WARNS, naming the first client-effecting blocker, for each page/layout that ships whole instead of being elided as a carrier; advisory-only, skipped when elision is off or there is no `app/`)). PURE checks render with a `[pass]` / `[warn]` / `[fail]` marker; non-zero exit iff a HARD check fails (Node below the floor, or `erasableSyntaxOnly` missing in an existing tsconfig), so CI can gate. Warns (drift / staleness) never fail the exit. Each `DoctorResult` carries a stable SCREAMING_SNAKE `code` (#975, the `DOCTOR_CODES` map; e.g. `NODE_VERSION`, `TSCONFIG_ERASABLE`, `IMPORTMAP_COHERENCE`) so an agent branches on the failure KIND, not the message text. `--json` emits `{ results, summary }` where `results` is the raw `DoctorResult[]` (each carrying a `code`) and `summary` is `{ pass, warn, fail, strict, ok }` (the same array-under-a-key convention as `check --json`); `--strict` also fails the exit on warnings (not just hard failures), so doctor can gate a fully-clean fix loop. The only network touch (pin freshness, plus the importmap-coherence live resolve) is best-effort: a fetch failure is a warn, never a hard fail. The importmap-coherence check (#450) runs `@webjsdev/server`'s `checkImportmapCoherence` IDENTICALLY over the live importmap AND the vendored `.webjs/vendor/importmap.json`, warning when a pinned package needs a newer version of another pinned package than is pinned (the #446 skew class); it reads dependency metadata from the already-installed node_modules manifests (no network of its own) and degrades to "could not verify" when a manifest is unavailable. An onboarding/setup-verify tool, NOT a scaffold-CI hard gate. Tests: `test/cli/doctor.test.mjs` |
| `webjs types` | `generateRouteTypes()` from `@webjsdev/server`, writes `.webjs/routes.d.ts` (typed `Route` union + per-route params, #258). Also auto-emitted at `webjs dev` startup |
| `webjs typecheck [tsc args]` | Resolves the project's own `typescript/bin/tsc` (via `createRequire` from the app cwd) and spawns it with `--noEmit`, passing extra args through. Exits non-zero on a type error (a CI gate). A clear message + non-zero exit when typescript is not installed (#265). The framework runs the standard compiler, it does not embed one |
| `webjs create <name> [--template …] [--db …] [--runtime node\|bun]` | `scaffoldApp()` from `lib/create.js`. `--runtime bun` (or `bun create webjs`, auto-detected) emits a Bun-flavored app (#541): `dev`/`start` scripts force `bun --bun`, `bun.lock`, a pure `oven/bun:1` Dockerfile + bun-install CI, and bun-command agent docs. Orthogonal to `--template` (invariant 1 stays exactly 3 templates). |
| `webjs db <generate\|migrate\|push\|studio>` | Runs the app's resolved `drizzle-kit` bin via `process.execPath` (no codegen step; `generate` is schema-to-SQL). Resolves the bin from the app's node_modules + spawns it with the current runtime (no `npx`, #570), so it works on Node and Bun, including a Node-less `oven/bun` image. `webjs db seed` runs the app's `db/seed.server.ts` directly. |
| `webjs ui <init\|add\|list\|view\|diff\|info>` | Proxies to `@webjsdev/ui` (see "UI subcommand" below) |
| `webjs version` | Prints the installed `@webjsdev/cli` version (#975, `readCliVersion()` reads the package's own package.json). Also reachable as the top-level `webjs --version` / `-v` flag, handled at the top of `main()` before the Node preflight so it works on an old Node. Tests: `test/cli/help.test.mjs` |
| `webjs help [command]` | Bare: the full USAGE banner. `webjs help <command>` prints that command's usage line, a one-line summary, an **Options** table (each flag + a universal `-h, --help` row, matching the Remix CLI's per-command Options section), and an Examples block from the `HELP` map in `bin/webjs.js` (#975), so an agent reads the exact invocation instead of guessing flags. An unknown help topic prints an error + the banner and **exits 1** (`printCommandHelp` returns false). The `--help` / `-h` FLAG forms are equivalent and handled at the top of `main()` (before the Node preflight, so they work on an old Node): `webjs --help` / `-h` prints the banner; `webjs <command> --help` / `-h` prints that command's help and short-circuits the body. Commands that forward args to an external CLI (`HELP_FLAG_PASSTHROUGH` = `typecheck` to tsc, `db` to drizzle-kit, `ui` to `@webjsdev/ui`) are excluded so the wrapped tool's own `--help` reaches it; an unrecognised command is not intercepted either, so it hits the Unknown-command error (exit 1). Tests: `test/cli/help.test.mjs` |

## UI subcommand: proxies to `@webjsdev/ui`

`@webjsdev/ui` is a **hard dependency** of `@webjsdev/cli` (listed in
`package.json` `dependencies`), so a global `webjs` install always ships
with the AI-first component CLI out of the box, no separate install.

`webjs ui <subcmd> [args...]` is a thin dispatch into `@webjsdev/ui`'s
`run({ argv })` entry. The implementation lives in
[`bin/webjs.js`](./bin/webjs.js) under `case 'ui':`. It resolves
`@webjsdev/ui` via `createRequire` rooted at the CLI's own location first
(the hard-dep path), with a fallback to the user's `cwd` for the rare case
where the user installed `@webjsdev/ui` directly without going through
`@webjsdev/cli`.

The subcommands (`init`, `add`, `list`, `view`, `diff`, `info`) are owned
and documented by `@webjsdev/ui`. See
[`../ui/AGENTS.md`](../ui/AGENTS.md) for the surface. The CLI does not
wrap or transform args; everything after `webjs ui` is forwarded
verbatim.

## Package-specific invariants

1. **Exactly three templates.** `full-stack` (default), `api`, `saas`.
   The `TEMPLATES` array in `bin/webjs.js` is the single source of
   truth, and `scaffoldApp()` re-validates programmatically. Hallucinated
   templates (`blog`, `todo`, `ecommerce`, …) are rejected at the CLI
   with a guidance message. The `--runtime node|bun` axis (#541) is
   ORTHOGONAL to this: it does NOT add a fourth template, it re-flavors
   any of the three. Adding a runtime is a `VALID_RUNTIMES` entry +
   transforms, never a new template.
2. **Scaffold is reference, not the final product.** The scaffold
   output ships an example `app/page.ts` ("Hello from …"), an example
   `User` Drizzle model, an example `theme-toggle` component. AI agents
   asked to build a real app MUST replace those with the actual app.
   The post-scaffold success message in `lib/create.js` prints this
   rule verbatim.
3. **Drizzle + SQLite is wired up for ALL templates.** The `db/` folder
   (`schema.server.ts`, `columns.server.ts`, `connection.server.ts`),
   `npm run db:generate` + `npm run db:migrate`, and the `webjs.dev.before` +
   `webjs.start.before` steps (`webjs db migrate`, run inside `webjs dev` /
   `webjs start`, #550/#725), so a `db:generate`'d migration applies on the
   next boot with no manual `db:migrate`.
   Apps must NEVER use JSON files for persistence. This is a project
   convention (documented in the scaffold's CONVENTIONS.md).
4. **Template files are verbatim copies** with `{{APP_NAME}}` substitution.
   When editing `templates/AGENTS.md`, `templates/CLAUDE.md`,
   `templates/CONVENTIONS.md`, `.cursorrules`, etc., remember they ship
   into every scaffolded app. Write for the audience of an AI agent
   working inside a freshly-scaffolded WebJs project. `templates/AGENTS.md`
   is the one exception to "verbatim": it carries a `{{PLAYBOOK}}` marker
   that `create.js` replaces with the full-stack or api build playbook from
   `templates/partials/agents-playbook-{fullstack,api}.md`, so the api app
   never ships UI-only guidance. Keep the shared meta-rules (required
   context-gathering, strict typing, data) in `AGENTS.md` itself and only
   the template-divergent build steps in the partials.
5. **`templates/CLAUDE.md` uses Claude Code's `@import` syntax**
   (`@AGENTS.md`, `@CONVENTIONS.md`). See https://code.claude.com/docs/en/claude-md.md#import-additional-files

## Tests

Scaffold-template tests for this package live in cross-package
folders under the repo root (they need to boot scaffolded apps):
`test/scaffolds/scaffold-template-validation.test.js`,
`test/scaffolds/scaffold-integration.test.js`,
`test/scaffolds/scaffold-ui-integration.test.js`.

Convention-rule tests live in
`packages/server/test/check/check.test.js` (the rules themselves
ship from `@webjsdev/server`).

End-to-end testing of the actual scaffold output is currently
manual (`webjs create demo && cd demo && webjs dev`, since `webjs create` auto-installs).
See [`references/testing.md`](../../.agents/skills/webjs/references/testing.md)
for the overall layout.

Run `npm test` from the repo root.

---

Framework-wide rules and full API reference:

@../../AGENTS.md
