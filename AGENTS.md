# AGENTS.md for WebJs

This file is the contract for **AI agents** (and humans) editing a WebJs app.
It describes file conventions, the public API, invariants to preserve, and
recipes for common tasks. Keep it in sync whenever behaviour changes.

**Detail docs**, loaded when relevant. They don't auto-load. This file stays
lean on purpose; anything marked "see the skill" has the full reference there.

The full reference is the skill at `.agents/skills/webjs/SKILL.md`, which routes
to these `references/`:

| Reference | Topic |
|---|---|
| `references/routing-and-pages.md` | Pages, layouts, dynamic routes, route handlers, metadata, redirects, 404s |
| `references/components.md` | Writing components: what a component owns, reactive props, signals, lifecycle, light vs shadow DOM, inherited members not to shadow |
| `references/data-and-actions.md` | Server actions, mutations, queries, validation, the `ActionResult` envelope, Drizzle surface, where server-derived types live |
| `references/auth-and-sessions.md` | Sessions, login flows, route protection, `forbidden()` / `unauthorized()` |
| `references/styling.md` | Tailwind, light-DOM tag-prefix rule, tokens, fixed headers, no-reflow layout |
| `references/client-router-and-streaming.md` | Client router, prefetch, frames, view transitions, Suspense streaming |
| `references/optimistic-ui.md` | Optimistic UI for a user-facing mutation |
| `references/typescript.md` | TypeScript at runtime, erasable syntax, full-stack types, the derive-the-type rule (never `unknown` / `any`) |
| `references/testing.md` | Unit, browser, e2e tests, the `handle()` harness, Bun parity |
| `references/built-ins.md` | Auth, caching, env vars, rate limit, file storage, the `webjs` config block |
| `references/runtime.md` | Node vs Bun, running the app, deploying, runtime-specific differences |
| `references/service-worker.md` | Offline support, an asset cache, the opt-in service worker |
| `references/muscle-memory-gotchas.md` | **READ FIRST** when writing components or routes. Next.js / Lit patterns that break WebJs, with the webjs-shaped fix for each |

Repo-root `framework-dev.md` covers monorepo dev (only when editing WebJs
itself): commands, repo-health git config, changelog flow, dev error overlay.

---

## AI-driven development: guardrails for all agents

**WebJs is AI-first. These rules apply to ALL agents (Claude, Cursor, Copilot, Antigravity, Gemini, opencode) through a SINGLE cross-agent source the scaffold ships**: `AGENTS.md` (the open standard Cursor / opencode / Antigravity / the Copilot coding agent read natively) plus the skill at `.agents/skills/webjs/` and the workflow rules at `.agents/rules/workflow.md`. Tools that do not read `AGENTS.md` natively get a THIN bridge pointing at it (`CLAUDE.md` for Claude Code, `GEMINI.md` for Gemini CLI, `.github/copilot-instructions.md` for Copilot in VS Code), never a duplicated rule set. Claude Code additionally ships the protective enforcement hooks (`.claude/`, `.hooks/pre-commit`).

### Before starting ANY work: verify and sync the branch

1. Work NEVER happens in the primary checkout. Cut the task's worktree first: `git worktree add -b <prefix>/<task-slug> ../<repo>-<task-slug> origin/main`, and do ALL work there.
2. Verify the branch matches the task. Don't mix unrelated work.
3. Sync with parent: `git fetch origin && git log HEAD..origin/main --oneline`. If there are upstream commits, `git rebase origin/main` first.

Claude Code enforces step 1 via `.claude/hooks/require-worktree-for-edits.sh` (blocks tracked-file edits in a primary checkout; test `test/hooks/require-worktree-for-edits.test.mjs`, escape hatch `WEBJS_NO_WORKTREE_GATE=1`). Other agents check manually.

### One task per git worktree, ALWAYS

WebJs is worked by MULTIPLE agents at once, and "no other agent is active right now" is unverifiable mid-task (another session can start any minute), so the worktree rule is unconditional. If more than one agent (or more than one in-flight task) shares ONE working checkout, they collide: a `git checkout` in one moves `HEAD` under the other, so the next commit lands on the WRONG branch. This has happened (a `chore: release` commit landed on an unrelated `feat/` branch, with a contaminated changelog). So give each task its own worktree:

```sh
git worktree add -b <prefix>/<slug> ../<repo>-<slug> origin/main
cd ../<repo>-<slug>          # do ALL work for the task here
# ... commit + push from this worktree; after merge: git worktree remove ../<repo>-<slug>
```

**A fresh worktree has NO `node_modules`** (git worktrees do not copy it), so running an app from one (`webjs dev` / `webjs start`, the test runner, a scaffolded app) fails to resolve `@webjsdev/*` until you install or link it. `webjs doctor` warns for this exact case (#954) and `webjs dev` / `webjs start` print the cause + remedy instead of a raw `ERR_MODULE_NOT_FOUND`.

Fix it with **`npm run worktree:link`** from inside the worktree (or a full `npm install` there, which is correct but slow and duplicates a large tree per worktree). **Do NOT hand-symlink only the root `node_modules`.** That is the obvious move and it produces a worktree that looks set up and then fails dozens of tests for reasons that point nowhere near the real cause. Three things beyond the root tree are needed, and the script handles all three:

- **Every NESTED `node_modules`, not just the root.** npm hoists what it can, but a workspace whose range conflicts with the hoisted copy keeps its own nested tree. `packages/server` is the live example: the root carries `ws@7` (hoisted for another dependent) while `packages/server` declares `^8.20.0` and keeps `ws@8` nested. Link only the root and `WebSocketServer`, a ws@8-only named export, resolves up to ws@7 and throws at module load. That single miss failed hundreds of assertions across the server, integration, and smoke suites, none of them naming ws.
- **`packages/core/dist`**, which is built rather than committed, so a fresh worktree has none and every test importing the built bundle fails to resolve it.
- **`examples/blog`'s seeded SQLite database.** `db/dev.db` is gitignored, so a worktree has none, and an empty `posts` table fails three blog tests plus their enclosing progressive-enhancement suite with nothing in the output naming the database (#1323). The script runs the blog's `db:migrate` then `db:seed` when the `posts` table is missing or empty, which takes about two and a half seconds and is a no-op once there are rows. A file-existence check would not do, because `webjs dev` and `webjs start` both run `webjs db migrate` as a before-step and leave the file there with no rows. Seeding failures WARN and never fail the link. Skip it with `WEBJS_NO_WORKTREE_SEED=1`.

The script discovers the `node_modules` set from the primary checkout rather than hardcoding a list (it changes whenever a package gains a nested tree), never overwrites an existing path, and never creates a dangling link, so it is safe to re-run and safe in a worktree where you already ran a real `npm install`. The seed step keeps the same contract: it only ever applies pending migrations and inserts demo rows that are not there, so a database with rows in it is left untouched.

**Know what this does NOT give you.** The worktree then runs the PRIMARY checkout's framework source through every bare `@webjsdev/*` specifier, because `<primary>/node_modules/@webjsdev/core` is a relative symlink into `<primary>/packages/core` and resolving through the linked root lands there. Relative imports (`../../../src/x.js`) and the browser suite, which web-test-runner serves from the worktree, do use the worktree's own files. So linking makes the suite RUNNABLE, not self-testing: if you are editing `packages/core/src` or `packages/server/src` and need a bare-specifier consumer to exercise YOUR copy, run a real `npm install` in the worktree, or repoint the individual `@webjsdev/<pkg>` entries at it. CI always builds from the branch, so it is unaffected either way.

Note the `webjs doctor` / `webjs dev` remedy message still suggests the root-only symlink. That advice is correct for a scaffolded APP worktree, which has no nested trees and no built `dist/`, and wrong only for this monorepo.

Git enforces one-branch-per-worktree, so separate worktrees make the collision impossible. There is NO lone-agent exception: every task cuts a worktree, and the primary checkout stays an untouched mirror of main (tracked-file edits there are hook-blocked). The repo's `.hooks/pre-commit` additionally BLOCKS a published-library (`core`/`server`/`cli`/`mcp`/`ui`/`intellisense`) version bump on any non-`chore/release-*` branch, the canonical wrong-branch-release symptom.

**Cleanup is automatic after a merge.** The `.claude/hooks/cleanup-merged-worktree.sh` PostToolUse hook fires after any `gh pr merge` and removes each linked worktree whose branch is merged AND whose tree is clean, so a merged branch's worktree never leaks (accumulated stale worktrees are exactly what it prevents). It is conservative: it KEEPS anything with uncommitted changes, an unmerged branch, or the worktree you ran the merge from (you cannot remove your current directory, so `cd` out and `git worktree remove` it yourself), and never touches the primary checkout. Disable with `WEBJS_NO_WORKTREE_CLEANUP=1`. Test: `test/hooks/cleanup-merged-worktree.test.mjs`.

### Skills are routed deterministically, never skipped

A Skill is model-invoked, so it fires only when the model judges a match. The `.claude/hooks/route-skills.sh` `UserPromptSubmit` hook makes routing deterministic: it keyword-matches each prompt against every skill's documented triggers and injects a directive to invoke the matched skill before other work. Check the available skills and invoke a matching one before starting. The skills themselves are committed under `.claude/skills/` (alongside the hooks), so a fresh clone has both the router and the skills it routes to (no machine-local dependency). Tests in `test/hooks/route-skills.test.mjs`, which also asserts every skill the hook references is committed in-repo.

### Talking to GitHub: `gh api` over REST, never the porcelain

GitHub scores two independent budgets, and `gh` routes to them in a way the command names hide. **Most `gh` porcelain commands issue `POST /graphql`**, whose 5000/hour budget is scored in **points** rather than requests, so one query walking a large connection can cost hundreds. Sessions here exhaust it routinely, and when it is gone the project board becomes unreachable and two PostToolUse hooks fail silently. The REST budget (`gh api <path>`, 5000 requests/hour) sits idle meanwhile.

Convert these, which is the whole high-volume surface. Reads: `gh issue view` / `gh issue list` / `gh pr view` / `gh pr list` / `gh pr diff` / `gh pr status` / `gh search issues` / `gh label list`. Writes: `gh issue create` / `gh issue edit` / `gh issue close` / `gh issue comment`. The writes are lower volume, but a task whose whole deliverable is a write is blocked outright once the budget is gone.

So: **go through `gh api` over REST, and reserve GraphQL for the two things only it can do**, Projects V2 (which has no REST API) and `resolveReviewThread`.

**Leave these on the porcelain**, even though they do route to GraphQL. `gh pr merge`, because two PostToolUse hooks detect a merge by matching that literal string. `gh pr create`, which resolves base and head from local git state. And `gh pr checks`, which is the merge gate: it folds check-runs and legacy commit statuses into one verdict, and the obvious REST replacement reports a green PR as pending, so a miss there lets a red build onto `main`. All three run once per PR, so converting them buys nothing and risks a lot.

Do NOT extend either list by assuming a command family routes one way. `gh label create` looks like it belongs beside `gh label list` and does not, since it issues a plain `POST /repos/{owner}/{repo}/labels`, so it needs no conversion. Measure with `GH_DEBUG=api` first.

The full substitution table, the traps in each replacement, and the reasoning behind every exception live in **`.claude/gh-budget.md`**. That file is the single source; skills and hooks link to it rather than restating it, because an earlier copy inside one skill drifted from the rule it stated.

### Autonomous mode (sandbox / bypass permissions)

When interactive approval is disabled, never block on questions. Auto-decide: cut the task's worktree from `origin/main` (auto-create `<prefix>/<task-slug>` per the label scheme); auto-rebase if the parent moved; auto-merge when ready; **delete** feature/fix branches after merge but **keep** long-lived ones (dev, staging, release/*); auto-generate meaningful commit messages; fix failing tests / convention violations rather than asking. Autonomous mode is MORE disciplined, not less, with the same quality bar.

### Code workflow (mandatory)

Every code change MUST include, automatically:

1. **Tests, every applicable layer (not just unit).** Ship the tests that prove the change across EVERY layer it touches: **unit** (`packages/*/test/**`, `test/**`, including the counterfactual that fails when reverted), **browser** (`*/test/**/browser/*` via `npm run test:browser`, for hydration / DOM / slots / client router / custom-element upgrade), **e2e** (`test/e2e/*.test.mjs` via `WEBJS_E2E=1`, including network probes / navigation / streaming), and **smoke** (`test/examples/*/smoke/*`). A unit test is NECESSARY BUT NOT SUFFICIENT for any client-router / component / browser-facing change (the headline behaviour is a browser/e2e assertion). **Bun parity is part of the task, not an afterthought:** WebJs runs on Node 24+ AND Bun (#508), so a change to a runtime-sensitive surface (the serializer, the node:http vs `Bun.serve` listener + request path, SSR / action / CSRF dispatch, streams, `node:crypto`, the TS stripper, auth / session / cors) MUST be proven on Bun (`node scripts/run-bun-tests.js` + the touched `test/bun/*.mjs` under `bun`) AND ship an added/updated `test/bun/<feature>.mjs` cross-runtime assertion. `npm test` does NOT run browser, e2e, or Bun; run them yourself and report the result. Never report work done with failing or missing tests. See `references/testing.md`. Enforced by `.claude/hooks/require-tests-with-src.sh` (the scaffold variant WARNS unless `WEBJS_TEST_GATE=block`) and `.claude/hooks/require-bun-parity-with-runtime-src.sh` (BLOCKS a commit that stages runtime-sensitive source with no `test/bun/**` test; escape hatch `WEBJS_BUN_VERIFIED=1`).
2. **Documentation, part of the definition of done (not optional).** A task is NOT done until EVERY doc surface its change touches is in sync: `AGENTS.md` + the skill at `.agents/skills/webjs/` (SKILL.md + references/) for new API surface, `CONVENTIONS.md` (and per-package `AGENTS.md`) for new conventions, the docs site (`website/app/docs/<topic>`), the marketing `website/`, the scaffold templates (`packages/cli/templates/` per-agent rule files), and `README.md` for a headline capability. Updating `AGENTS.md` alone reproduces the #488 gap (docs site left stale). Invoke the `webjs-doc-sync` skill to sync every applicable surface. Enforced by `.claude/hooks/require-docs-with-src.sh`, which BLOCKS a commit that stages public `packages/*/src` source with no doc surface alongside it (a genuinely internal refactor / CI / release / perf change with no behaviour change bypasses with `WEBJS_NO_DOC_GATE=1`).
3. **Scaffold + skill sync (when a feature changes what apps should do).** The scaffold `webjs create` emits is a gallery index home + a root layout + db wiring, a densely-commented feature gallery (`packages/cli/templates/gallery/**`, single-concept demos under `app/features/` plus the `app/examples/todo` app, shipped in every UI template) and the api backend-features showcase (`packages/cli/lib/api-gallery.js`), plus the one cross-agent skill at `packages/cli/templates/.agents/skills/webjs/` (SKILL.md + references). So when a WebJs feature is added or changed, ask: does the generator (`packages/cli/lib/{create,api-gallery}.js`), a gallery demo (`packages/cli/templates/gallery/`), or the agent skill (`.agents/skills/webjs/SKILL.md` + its `references/`) need to move so a freshly scaffolded app and the skill teach the new reality? Verify by generating an app and running `generate + boot + webjs check` (the generators emit strings, so an escaping bug only shows in a freshly generated app). See `framework-dev.md`.
4. **Convention validation.** Run `webjs check` and fix violations. Run it from INSIDE an app, never from the repo root: the root is a workspace, not an app, so the command refuses there with exit 1 rather than reporting the cross-app collisions no single runtime ever sees (#1301). In this repo that means `( cd examples/blog && npx webjs check )` and `( cd website && npx webjs check )`. Run `webjs doctor` too when you touched an in-repo app (`examples/blog`, `website`): the required `conventions` CI job runs it over both, and it fails on a hard toolchain check or on whatever that app's `webjs.doctor.gate` marks `error` (today `UNMARKED_ASSET_LINKS` in `website` and `examples/blog`), so a clean `webjs check` alone is not enough to predict that job (#1257).

### Git workflow (mandatory)

Always work on a feature branch; commit + push freely there. The only gate is merging into main (needs user approval unless in bypass mode).

1. **Feature branch first;** never edit on main; never push to main.
2. **Commit per logical unit** (one feature, fix, rename, doc rewrite) as soon as it is complete and tests pass (`webjs test`); 5+ unstaged files across concerns means you waited too long. Push after each commit.
3. **Meaningful commit messages** (imperative, under 72 chars, body explains *why*). **No AI attribution** (no `Co-Authored-By: Claude`, `Generated by AI`).
4. **PRs via `gh`, always.** "merge to main" is ALWAYS `gh pr create`, confirm, `gh pr merge`, never a local `git merge` + push.
5. **Never merge without permission.** Ask exactly "Ready to merge `<branch>` into `<target>`? After merging, should `<branch>` be deleted or kept?" and wait for both answers.

---

## Working in the WebJs framework repo itself

When editing the framework monorepo (this repo, not a scaffolded app): **`packages/` is plain `.js` with JSDoc. Never add `.ts` files there** (the framework ships buildless). TypeScript is fine in `examples/`, `docs/`, `website/`.

See `framework-dev.md` for monorepo commands, workspace layout, per-feature update checklists, the worktree-safe git config, the per-package auto-generated changelog flow, and the dev error overlay.

---

## What WebJs is

An **AI-first, web-components-first** framework inspired by NextJs, Lit, and Rails. The component runtime API matches lit (reactive properties, the lit lifecycle hooks, ReactiveControllers, the `lit-html` directive set, `html` / `css` templates) so lit training data transfers directly, but WebJs ships its own no-build implementation under `packages/core/src/`. Reactive properties are the one deliberate divergence (invariant 10): instead of lit's `@property()` decorator or a `static properties` block, WebJs declares them through the declare-free base-class factory `extends WebComponent({ count: Number })`.

- **No build step.** Source files are served as native ES modules. JSDoc `.js` is default; `.ts` / `.mts` is stripped through a pluggable stripper (#508): Node 24+'s built-in `module.stripTypeScriptTypes`, or `amaro` on Bun (byte-identical, position-preserving) (invariant 10 + `references/typescript.md`). **Runs on Node 24+ or Bun** (run a Bun app with `bun --bun run dev` / `start`); the early `assertNodeVersion()` preflight enforces the Node floor and admits Bun. On Bun, `startServer` selects a native `Bun.serve` listener shell instead of the node:http one (skipping the compat bridge for ~1.9x more req/s on the listening path, at near-complete feature parity, the one node-only gap being 103 Early Hints since `Bun.serve` has no informational-response API), via a runtime-neutral seam that also sets up future `Deno.serve` / embedded adapters. Edge runtimes (no filesystem) are a separate, later target. See `references/runtime.md` for the Node vs Bun command + difference reference.
- **SSR + CSR by default.** Pages are server-rendered HTML; components render light DOM by default, shadow DOM opt-in via `static shadow = true` with DSD SSR.
- **Progressive enhancement is the default architecture.** Pages and components are SSR'd; with JS off, content reads, `<a>` navigates, `<form>` server actions submit, display-only elements render. JS is opt-in *per interactive behaviour* (`@click`, a reactive property assignment, a signal mutation). Never write a first paint that depends on hydration; never use `fetch` + JS where a `<form action=${importedAction}>` would do.
- **Display-only components are elided from the browser.** A component with no interactivity signal renders identical HTML with or without its JS, so the framework strips its import (and any vendor reachable only through it, importmap entry included) from the served source. Automatic, conservative, verified differentially. Inspect the verdict with `webjs elision` (per module, with the evidence behind every ship) and prove it for your own app with `webjs elision --verify`. Disable with `"webjs": { "elide": false }` or `WEBJS_ELIDE=0`. See `references/components.md`.
- **Server actions with rich types.** A `*.server.{js,ts}` file with `'use server'` exports functions importable from the client (the import is rewritten to a typed RPC stub); the wire round-trips `Date` / `Map` / `Set` / `BigInt` / `Error` / typed arrays / `Blob` / `File` / `FormData` / Symbols / cycles. The source is never served to the browser (invariant 1).
- **Only files reachable from a browser-bound entry are servable.** The dev server walks the import graph from every page / layout / error / loading / not-found / component file (lazily on first request, re-derived after each `fs.watch` rebuild); that Set is the authorisation gate, so anything no client code imports returns 404. The walk follows static `import` / `export … from` AND string-literal dynamic `import('./x.ts')` edges (#751), so a lazily-imported app module is servable (it is NOT eagerly preloaded, since a dynamic import is lazy by intent). A computed `import(expr)` cannot be resolved statically and 404s with a dev hint.
- **Sensible defaults, overridable.** Memory store in dev, Redis when configured. Built-in auth, sessions, caching, rate limiting, file storage (all pluggable). Tailwind is the default styling. See `references/built-ins.md`.

---

## Execution model (read this to avoid the RSC mental model)

WebJs has **no server/client component split.** There is no RSC render tree, no Flight protocol, no "use client" / "use server" component boundary.

**Pages, layouts, and components are isomorphic modules** (same source both sides), but hydrate differently:

- **Components hydrate.** The module loads in the browser, registers the custom element, the browser upgrades the SSR'd tag, and `render()` / lifecycle / `@event` / signals run client-side. Per-element, islands-style. **All interactivity lives here.**
- **Pages and layouts do NOT hydrate.** Their function runs only on the server to produce HTML and is never re-invoked in the browser. So a page/layout cannot be interactive in its own markup (an `@click` in a page template is dropped at SSR; a signal read in a page body never re-renders). For interactivity, render a component's tag.

A page/layout module still **loads** in the browser for its top-level side effects: registering imported components (so their tags upgrade). The client router is automatic and needs no import: it auto-enables when `@webjsdev/core` loads in the browser (the bundle every component pulls), so any page that ships a component gets client navigation for free (#620). That load is also how its imports reach the client (`import dayjs` at the top of a page fetches dayjs when the module loads, not via hydration). An inert page/layout is dead weight, which is exactly when elision drops it. A page/layout that is non-inert ONLY because it imports interactive components is **import-only** (#605): since it never hydrates, the boot emits its component modules directly and drops the page/layout module, so the browser fetches just the interactive leaves (it still ships whole when it has its own client side effect: a `client-router` import, a module-scope call, or a self-registering bare import). The verdict is path-aware (#963): client work reachable only THROUGH a shipping component (a module-scope signal bus the component imports, the invariant-5 idiom) does not pin the page, because the emitted component carries it; only a component-free path to client work ships the page whole.

- importing a client-effecting NON-component util. A helper that touches a client global or self-executes drags the whole page in. Put client-only behaviour inside a component; put server-only work in `.server.{js,ts}` (it never reaches the client closure); and if a util MIXES a pure helper with client-global code (the `cn.ts` shape, #619), split the client part into its own module so the pure helper does not pin every importer. Note: if a page imports a client-effecting utility (like `cn.ts` which accesses client globals), the page module is marked as client-effecting and will be browser-shipped. When this happens, importing any bare server-only utility (like `*.server.ts` queries) inside that page will trigger a `no-server-import-in-browser-module` check violation. To fix this, convert the query to a `'use server'` action or fetch it through a route handler.

Self-check: `page.ts` / `layout.ts` should NOT appear in the network tab or the boot `<script type="module">`; if one does, something in its closure does client work and is not a component.

`route.{js,ts}` is the one routing file that is NOT isomorphic: a server-only HTTP handler (named `GET` / `POST` exports), the WebJs equivalent of a Next route handler. It never ships to the client.

**`.server.{js,ts}` is the one server boundary, an RPC + source-protection mechanism, NOT an RSC component.** With `'use server'` exports are RPC-callable (the browser import becomes a stub POSTing to `/__webjs/action/<hash>/<fn>`); without it the file is a server-only utility whose browser import **throws at module load** (the DB driver, secrets, `node:*`, hashing). Consequence: **never import a no-`'use server'` util directly into a page, layout, or component** (it works at SSR but the client stub crashes on load); use it inside `'use server'` actions, `route.{js,ts}`, or `middleware`, and reach it from a page by importing a `'use server'` action (whose RPC stub loads safely client-side). This boundary, not a component annotation, is how a dependency is kept off the client (a date library used only during SSR belongs in `lib/format.server.ts`). See `references/components.md`.

---

## Framework source: where to find it

Plain JS with JSDoc lives in `node_modules/@webjsdev/` (`core/`, `server/`, `cli/`, `mcp/`, `intellisense/`, `ui/`); what you read is what runs. Starting points: SSR `@webjsdev/server/src/ssr.js`, client hydration `@webjsdev/core/src/render-client.js`, client router `@webjsdev/core/src/router-client.js`, convention rules `@webjsdev/server/src/check.js`. For UI debugging use the Playwright MCP server; for live introspection the scaffold wires the read-only `@webjsdev/mcp` server (`npx @webjsdev/mcp`, also reachable as `webjs mcp`): `list_routes`, `list_actions`, `list_components`, `list_elision` (what the browser never downloads, and why each shipped module ships), `check`, `ui` (the `@webjsdev/ui` kit inventory + a component's helpers / paste-ready example / a11y header), plus a knowledge layer (docs / recipes / framework source). That knowledge layer reads the docs corpus installed in the app itself when there is one, so it is version-matched to the framework you are editing rather than to whenever the server was published, and `init` names the corpus it served and warns when a global install looks stale against the app.

---

## App layout (cannot be renamed)

```
app/                        ROUTING ONLY (thin adapters importing from modules/; no helpers/constants here)
  layout.js                 root layout, wraps every page
  page.js                   /
  error.js                  nested error boundary
  not-found.js              404 page (root or nested <segment>/not-found.js, nearest wins)
  forbidden.js              403 boundary for forbidden() (nested, nearest wins)
  unauthorized.js           401 boundary for unauthorized() (nested, nearest wins)
  global-error.js           root-only app-wide error boundary (renders its own <html>)
  global-not-found.js       root-only 404 for an unmatched-anywhere URL
  <segment>/page.js         /<segment>
  [param]/page.js           dynamic route (`params.param`)
  [...rest]/ [[...rest]]/   catch-all / optional catch-all
  (group)/…                 route group (folder NOT in URL, still scopes layout/error)
  _private/…                private folder (ignored by the router)
  <path>/route.js           HTTP handler at /<path>
  <segment>/middleware.js   per-segment middleware
  <segment>/loading.js      auto Suspense boundary
middleware.js               root middleware (every request; .ts/.mts/.mjs too)
readiness.js                optional /__webjs/ready check (return false/throw = 503)
env.js                      optional boot-time env validation (schema or validator fn; fails fast)
instrumentation.js          optional boot-time hook (register(); wire APM via setOnError, #848)
instrumentation-client.js   optional client boot hook (runs first, before app modules, #848)
sitemap.js robots.js manifest.js icon.js opengraph-image.js twitter-image.js apple-icon.js   metadata routes
lib/                        app-wide code (lib/*.server.js infra, lib/utils/ browser-safe helpers)
modules/<feature>/          feature-scoped: actions/ (mutations), queries/ (reads), components/, utils/, types.js
components/*.js             SHARED presentational primitives
public/*                    static assets, served at /public/<name> (favicon, sw.js, offline.html serve at root)
db/*.server.{js,ts}         data layer (Drizzle: schema, columns, connection)
```

Every file is a plain ES module.

### Imports: prefer the `#` root alias over deep relatives (#555)

App-internal imports use the **`#` path alias** instead of deep `../../../`
relatives: `import { db } from '#db/connection.server.ts'`, `import { Button }
from '#components/ui/button.ts'`, `#lib/...`, `#modules/...`. It is Node's native
`package.json "imports"` field (the scaffold ships the single catch-all `"#*":
"./*"`, so any top-level folder is aliased with no config change), resolved at
runtime by Node 24+ AND Bun with **no build step and no tsconfig `paths`**. The
sigil is `#` (not `@`) and there is **no slash after it** (`#lib/...`, not
`#/lib/...`): a `#/`-prefixed key does not resolve on Bun. The WebJs server
expands the same map for the import graph / auth gate / elision / browser
importmap, so a `#`-aliased `.server.ts` still trips the server-only boundary.
A same-directory import stays relative (`./sibling.ts`); only deep relatives
become `#`. The alias addresses a top-level SUBDIRECTORY (`#lib/...`,
`#components/...`); a bare root-level file (`./env.ts`) is imported relatively
(the browser importmap scope is per-directory, so a `#`-imported root file has
no browser mapping in dev). Opt out anywhere by writing a plain relative import.

---

## Public API of `@webjsdev/core`

```js
import { html, css, WebComponent, prop, render } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';
```

The bare `@webjsdev/core` specifier resolves to a BROWSER bundle dropping server-only modules (`render-server.js`, `setCspNonceProvider`, `setAssetUrlProvider`); `renderToString` / `renderToStream` live at `@webjsdev/core/server` for Node-side consumers.

| Export | Purpose |
|---|---|
| `html` / `css` | Tagged template literals. `css` goes in `static styles`. |
| `WebComponent` | Base class for interactive components. Called as `WebComponent({ ... })` it returns a typed base declaring reactive properties. |
| `prop(type?, opts?)` | Declares one reactive property inside the `WebComponent({ ... })` factory with options (`reflect`, `state`, `attribute`, `default`, `converter`, `hasChanged`) and a narrowable TS type (`prop<Student>(Object)`). |
| `register(tag, C)` | Tag binding. Auto-called by `Class.register('tag')`. |
| `render(v, el)` | Client-side render into a DOM element. |
| `renderToString` | Server-side async render to HTML with DSD (from `/server`). |
| `notFound()` / `redirect(url[, status])` | Throw to return 404, or a redirect. No-status default is convention-picked at the catching site: 302 for a GET page-render gate, 307 (method-preserving) for a server-action redirect. Override with `redirect(url, 308)` or `redirect(url, { status })`. **NEVER** throw `redirect()` inside API route handlers (`route.ts`), as they must return a standard `Response.redirect(url, 303)` response object instead. |
| `forbidden()` / `unauthorized()` | Throw to return 403 / 401 (#848, Next 15/16 parity). Renders the nearest `forbidden.{js,ts}` / `unauthorized.{js,ts}` boundary (innermost wins), else a default page, from a page/layout render OR a form-bound server action (the no-JS write path). `forbidden()` for an authenticated user lacking permission, `unauthorized()` for a request that is not authenticated. Same control-flow-throw model as `notFound()`: NOT for a `route.ts` handler, and inside a `'use server'` RPC action return an `ActionResult` for an auth failure instead (a raw throw there is a generic 500, like `notFound()`/`redirect()`). |
| `Suspense({fallback, children})` | Page/region-level streaming boundary (a value in a hole). `repeat` keyed-list directive is also re-exported. |
| `<webjs-suspense .fallback=${html\`…\`}>` | Component-level streaming boundary element (#471): wraps one or more components, flushes `.fallback` on the first byte, streams the resolved content in (concurrently across boundaries, progressively on soft nav). The renderer-recognized opt-in for SLOW async-render data. |
| `asset(path)` | Content-hash a `public/` asset url so a deploy cannot serve stale bytes: `href=${asset('/public/app.css')}` emits `?v=<hash>` and is served `immutable` for a year (#1194). Prod-only, `public/` paths only. Use it in a PAGE, LAYOUT, or metadata route, not inside a component that ships: hydration re-renders on the client where there is no resolver, so the hashed url is swapped for the bare path and the asset is fetched twice. Call it inside the render function, since a module-scope call is a side effect that ships the module. Mark only files that change with a DEPLOY (the hash is memoized for the process lifetime). Opt-in on purpose: do NOT mark a `rel=preload` hint whose asset is fetched by CSS `url()`, or the preload can never match. |
| `connectWS(url, handlers)` / `richFetch<T>` | Client WebSocket (auto-reconnect, queued sends); content-negotiated rich-type fetch. |
| `navigate(url, opts?)` / `revalidate(url?)` | Programmatic client-router nav; evict the BROWSER snapshot cache. |
| `optimistic(signal, value, action)` / `optimistic(host, { source, update })` | Imperative: set `signal` immediately, run `action`, roll back on error. Declarative (preferred): queue optimistic updates with auto-release via `.add(payload, promise?)`. See `references/client-router-and-streaming.md`. |
| `renderStream(payload)` / `WebjsFrame` | `<webjs-stream>` element-level updates (#248); `<webjs-frame>` partial-swap regions (#253). See `references/client-router-and-streaming.md`. |
| `Metadata` / `PageProps<R>` / `LayoutProps<R>` / `RouteHandlerContext<R>` / `WebjsConfig` (type-only) | Types for metadata, page/layout/route args (`R` narrows `params` against the `webjs types` route union), and the `webjs` config block. See `references/routing-and-pages.md` + `references/built-ins.md`. |

### Directives, from `@webjsdev/core/directives`

lit-html parity: `repeat` (keyed lists), `unsafeHTML(str)` (trusted raw HTML, **NEVER with user input**), `live`, `keyed`, `guard`, `templateContent`, `ref` + `createRef`, `cache`, `until`, `asyncAppend` / `asyncReplace`, and `watch(signal)` (fine-grained DOM swap). Prefer `Task` over `until` for component async data; `Suspense` for page-level streaming. Everything else (`classMap`, `styleMap`, `ifDefined`, `when`, `choose`, `map`, `join`, `range`) uses native JS. Context lives in `@webjsdev/core/context`, `Task` / `TaskStatus` in `@webjsdev/core/task`.

### `html` expression prefixes

`<div>${x}</div>` text child; `class=${x}` attribute (escaped); `action=${importedAction}` on a `<form>` or `formaction=${importedAction}` on a submitter binds a server action (#1155, #1207, #1307: the function-valued attribute holes where the attribute is omitted/rewritten and a `__webjs_action` identity is emitted, plus `formmethod` / `formenctype` on a bound submitter so it needs no bound form around it; submitters must be actual submit controls and cannot carry their own `name`, `value`, `form`, or static `formaction` attributes; a quoted `action="${fn}"` / `formaction="${fn}"` or `action=${fn}` on un-supported tags is a render error, since stringifying a function would leak a server action's source); `@click=${fn}` event listener (client-only, drops at SSR); `.value=${v}` DOM property (round-trips through SSR on custom elements via `data-webjs-prop-*`, drops on native elements); `?disabled=${b}` boolean attribute. Event/property/boolean holes **must be unquoted** (invariant 4). Every hole is identical server and client except `@event`, `.prop` on native elements, and a **nullish-or-`false` plain-attribute hole**: the client REMOVES the attribute for `null` / `undefined` / `false`, while the server stringifies, emitting `attr=""` for nullish and `attr="false"` for `false`. So the two renderers disagree, and there is no "omit this attribute" hole value at all. `false` is the subtler half: `aria-expanded=${false}` serves `aria-expanded="false"` and hydrates to no attribute, and for a tri-state ARIA attribute those are NOT the same thing, so `?attr=${bool}` is not a substitute either. To omit an attribute conditionally, BRANCH the template (`cond ? html\`<div a=${v}>\` : html\`<div>\``) rather than passing a nullish value, and use `?attr=${bool}` for a genuine boolean attribute. This matters for ARIA in particular, where an empty `aria-labelledby` is an IDREF list resolving to nothing and an `aria-checked=""` is an attribute the role may not even allow.

---

## `WebComponent` essentials

```ts
// Reactive properties are declared in the base-class factory (declare-free)
class MyThing extends WebComponent({
  count: prop(Number, { reflect: true })
}) {
  static shadow = false;     // default light DOM; true = scoped shadow DOM
  static lazy = false;       // true = load module on viewport entry
  static styles = css`…`;

  constructor() {
    super();
    this.count = 0;          // Fully typed, no declare!
  }

  render() { return html`…`; }
}
MyThing.register('my-thing');
```

**Signals are the default state primitive.** Import `signal` / `computed` from `@webjsdev/core`, read with `signal.get()` inside `render()`, and the built-in `SignalWatcher` re-renders on change. Module-scope signals share state across components and survive navigations; instance signals (constructor) are component-local.

**Reactive properties ride HTML attributes, reflect to them, or arrive via SSR hydration.** They are declared ONLY by passing the property shape into the base-class factory `WebComponent({ ... })`. There is no `static properties` block and no `declare` line. The bare form takes a type constructor (`count: Number`, `label: String`, `open: Boolean`); the `prop()` helper carries options (`count: prop(Number, { reflect: true })`, `name: prop(String, { attribute: 'show-close-button' })`, internal state `prop({ state: true })` with no type), and narrows the TS type (`student: prop<Student>(Object)`, `mode: prop<'a' | 'b'>(String, { reflect: true })`). The types flow automatically to `this.<prop>`. Set defaults in the constructor after `super()` (a declarative `default` option also exists for lit-parity, a function default running per instance for a fresh object / array, but the constructor is the recommended way). NEVER use a class-field declaration OR initializer (e.g., `count = 0` or `todos!: Todo[]`), which compiles to define an own property on the instance and clobbers the reactive accessor (caught by `reactive-props-no-class-field`). Declaring your own `static properties` THROWS at runtime and is flagged by `no-static-properties`. Declare an array-typed prop with the `Array` constructor, not `Object` (`items: prop<Tag[]>(Array)`): the two share one JSON converter so neither crashes, but `Array` states the prop's shape and `array-prop-uses-array-type` flags the `Object` form. Property options: `type` (default `String`), `reflect`, `state`, `hasChanged`, `converter`, `default`, `attribute`. A `converter.fromAttribute` runs on BOTH attribute readers (the SSR one and the client one) through one shared implementation, ahead of type coercion, so it executes server-side and must not touch browser globals, and a throw from it is not caught on either side. A `reflect: true` property whose value has no attribute representation REMOVES its attribute and warns rather than writing one, which covers a function (or an array carrying one, whose source would otherwise ship to every visitor) and a JSON-typed value `JSON.stringify` cannot serialize (a cycle, a `BigInt`, a throwing `toJSON`); a value merely CARRYING a function still reflects whole, since `JSON.stringify` drops it to `null` without losing the rest.

**Lifecycle (lit-aligned), in order:** `shouldUpdate`, `willUpdate`, controllers' `hostUpdate()`, `update` (calls `render()` + commits), controllers' `hostUpdated()`, `firstUpdated`, `updated`, `updateComplete`, each receiving a `changedProperties` Map. **SSR runs only the constructor, attribute application, the pre-render hooks (`willUpdate` / `hostUpdate`), `reflect: true` reflection, and `render()`; it does NOT call `connectedCallback`, `firstUpdated`, `updated`, or any browser-only hook.** So defaults for first paint go in the constructor; browser-only data (localStorage, viewport, `navigator.*`) goes in `connectedCallback` writing a signal; server-known data arrives via the page function. Never ship a placeholder first paint that fetches in `connectedCallback`. A browser-only global in the constructor/`render()` throws at SSR (flagged by `no-browser-globals-in-render`; attribute methods and `closest()` are shimmed).

**Async render (`async render()`), bare-await data fetch (#469).** A component may write `async render() { const u = await getUser(this.id); return html\`<h3>${u.name}</h3>\`; }`. Writing `await` makes the function async by JS rule, and every render path awaits a promise-returning `render()` automatically (no flag). This co-locates the fetch in the leaf component (no prop-drilling). The model is decoupled into three separate concerns. (1) **SSR always blocks**, so the resolved DATA is in the first paint with no fallback markup (PE-safe, JS-off reads it). (2) **The client re-fetch default is stale-while-revalidate**: when a prop / dependency change re-runs `async render()`, the current content stays until the new render resolves (no blank, no flash). (3) **`renderFallback()` is the OPTIONAL re-fetch loading UI**, a prop-aware method shown ONLY during a client re-fetch, NEVER on the first paint, and it does NOT trigger SSR streaming. **Errors are isolated per component by default** (no user code): a thrown `await getData()` renders a component-scoped error state while siblings render, and `renderError()` optionally customizes it (dev surfaces the message, prod stays silent). `getData()` is already isomorphic (a `'use server'` action is the real function during SSR and an RPC stub on the client), so the same line works both sides. Use `async render()` for request-time-known SERVER data that should be in the first paint; keep `Task` / signals for genuinely client-only data (a `Task` shows its pending state at SSR, losing first-paint data). A **bare** async-render component (an `async render()` with no other client signal, light DOM) is **elided** like any display-only component (#474): its SSR'd HTML is the complete output, so the framework drops the module AND the redundant on-hydration re-fetch. It SHIPS only when it also carries an independent signal (an `@event`, a non-`state` reactive prop, a signal / reactive import, a lifecycle hook including `renderFallback()`, the dynamic slot READ surface (`slotchange` / `assignedNodes` / `assignedElements` / `assignedSlot`; merely RENDERING a `<slot>` does not ship, since the SSR output carries the placed children), `static shadow = true`, `static interactive = true`, cross-module observation, or a transitively-reachable interactive child). Two carve-outs always ship: `static shadow = true` (Declarative Shadow DOM attaches only during HTML parsing, so a streamed or soft-navigated shadow component needs its module to re-run `attachShadow`) and `static interactive = true` (the explicit author override that forces a ship when the analyser cannot see a component's interactivity statically: an OBSERVER that computes the tag it waits for, a `:defined` rule in an external stylesheet outside the module graph, or a consumer reaching the element through a string selector; a component's OWN registration tag must be a literal per invariant 3, and a computed one is invisible to the scanner, so it gets no verdict and the override cannot rescue it). **For SLOW data where blocking the first byte hurts, wrap the region in `<webjs-suspense .fallback=${html\`…\`}>` to STREAM it** (the fallback flushes on the first byte, the data streams in; multiple boundaries fetch concurrently). This is the only way to show a first-paint fallback, a deliberate choice for slow regions, and it streams progressively on soft navigation too. A throwing component inside a boundary is isolated (renders its error state, siblings stream). **The on-hydration re-fetch is itself eliminated by SSR action seeding (#472):** each `'use server'` action result invoked during a (non-streamed) SSR render is serialized into the page, and the generated RPC stub reads that seed on its first client call, so a shipping async component does NOT re-issue the RPC on hydration (a later refetch / arg-change still goes to the network). Keyed by action-hash + fn + serialized args, consume-once, fail-open (a miss degrades to a normal RPC). A hit returns the value the SSR render that produced THIS page computed for exactly that key, so it cannot disagree with the HTML on screen (a page navigation evicts whatever the outgoing page left unconsumed, in the DOM and in the store, so a departed render's value can never be served); on an HTML-cached page (#241) the seed rides inside the cached bytes and is as fresh as they are. The one shape where a hit can differ from the paint is an action returning a DIFFERENT result for the SAME arguments twice in one render (the seed carries the last, the first component painted the first), which dev warns about once per action function. Captured via a transparent server-side `'use server'` facade (no source transform, no build step; the browser source tab and on-disk files are unchanged), default on, opt out with `"webjs": { "seed": false }` or `WEBJS_SEED=0`. **A miss is otherwise invisible, so dev makes it observable (#1309):** every dev page response carries `X-Webjs-Seed` (`off` / `html-cache` / `collected=<m>, emitted=<n>` / `collected=<m>, emitted=0, streamed`), folded into the access-log line as a `seed` field, and the browser logs ONE warning per page view when a hydration call missed AND the cause is provable (a streamed page, a serializer drop, or seeds present but unmatched), staying silent otherwise, including on a page that emitted no seeds, where a miss is not evidence of a defect because a mutation / `Task` / `connectedCallback` call routes through the same lookup and could never be seeded. `seedStats()` from `@webjsdev/core` exposes the counters. Nothing reaches production: the client's dev gate is a server-stamped `data-webjs-dev` marker on the seed block, never `process.env.NODE_ENV`, which esbuild folds to a constant in the built core bundle. See `references/data-and-actions.md`.

**Light DOM (default) vs Shadow DOM.** Light DOM applies global CSS and Tailwind directly (default; for Tailwind/global CSS + simple composition). Shadow DOM (`static shadow = true`) is for `static styles` scoped CSS and third-party isolation; `<slot>` works in either. **Light-DOM slots ARE the native DOM slot API (#1021, full shadow parity):** `<slot>` works identically in light and shadow DOM, so post-mount native writes are LIVE (`appendChild`, `insertBefore`, `removeChild`, `el.remove()`, `innerHTML`, `el.slot=` flips, `HTMLSlotElement.assign()`) and the reads (`assignedNodes` / `assignedElements` / `{flatten}` / `assignedSlot` / `slotchange`, with native async-coalesced timing) match. Flip `static shadow` and nothing else changes; there is NO WebJs-specific slot API. The one write that does NOT flip is `assign()`: the light-DOM version is an extension (element-bound overlay alongside name matching), while native shadow `assign()` needs `slotAssignment: 'manual'`, which WebJs does not set, so avoid `assign()` in a component meant to flip modes. A FORWARDED slot (a template forwarding `<slot>` into a nested component) projects its content on the client and through hydration (#1023): the renderer stamps each slot with its template owner (`SLOT_OWNER`, carried across SSR as `data-wj-slot-owner`) so it routes to the OUTER host that rendered it, and a layout's `${children}` inside a slotted shell keeps its named slots in sync across a soft-nav swap (#1024, the swap resyncs every own slot of the enclosing host). Four inherent gaps, all a consequence of light DOM having no shadow boundary: structural host reads (`host.children` / the `innerHTML` getter show the rendered template, not the authored children, so read slotted content with `assignedNodes()`), `assignedChild.parentNode` is the `<slot>`, `::slotted()` CSS (style slotted content with normal selectors / Tailwind), and initial-projection lifecycle timing (`firstUpdated` sees the `<slot>` element with EMPTY `assignedNodes()`, the projection lands one microtask later; read assigned content from `slotchange` or after a microtask). Live writes need the component's JS on the page, so a display-only slotted wrapper elides (its writes are inert like anything elided; force a ship with `static interactive = true` for an imperative consumer the analyser cannot see). A light-DOM component authoring custom CSS MUST prefix every class selector with its tag name (invariant 7); prefer Tailwind. **Light-DOM component hosts default to `display: block`**: a custom element is `display: inline` in plain CSS, so the framework marks every LIGHT-DOM host `data-wj-host` and injects one head rule in a low-priority cascade layer, `@layer webjs-host { :where([data-wj-host]) { display: block } }`, so a container component does not collapse; the layer keeps it overridable by any author style INCLUDING Tailwind utilities (`class="flex"`/`grid`/`hidden` win, because their layer is ordered after `webjs-host`), a `[hidden]` carve-out keeps `?hidden` working, and an inline light component opts out with `my-tag { display: inline }`. **Shadow-DOM hosts are NOT marked** (a document rule would override the shadow tree's `:host`), so a shadow component sets its host display via `:host { display: block }` in `static styles` (respected because the host is unmarked; set it for a shadow block container). See the even-grid / no-reflow layout recipes in `references/styling.md`. **Never interpolate into a component's `<style>` or `<script>` body** (`html\`<style>${css}</style>\``): the server emits it but the client drops the raw-text hole, so it paints at SSR then wipes to empty on hydrate. Use `static styles` or Tailwind instead (flagged by `no-interpolation-in-raw-text-element`). A page/layout, which never hydrates, may interpolate a `css` result into `<style>`. Install the `webjs` VSCode extension (`packages/editors/vscode`, VS Marketplace + Open VSX; also covers Cursor / Antigravity / Windsurf) or `webjs.nvim` (`packages/editors/nvim`, via lazy.nvim) for template highlighting + editor intelligence with no Lit plugin, or add the standalone `@webjsdev/intellisense` to `tsconfig.json` `plugins` manually (JetBrains). Full deep-dive in `references/components.md` + `references/muscle-memory-gotchas.md`.

---

## File conventions: the essentials

### Pages (`app/**/page.{js,ts}`)

- Default export is a possibly-async function receiving `{ params, searchParams, url, actionData }`. Runs **only on the server**. Throw `notFound()` / `redirect(url)` to short-circuit. `params` / `searchParams` are awaitable AND synchronously readable (`params.id` and `await params` both work, Next 15/16 parity, #848).
- Named exports: `metadata` (static), `generateMetadata(ctx)` (async, takes precedence). Type both with `Metadata`. See `references/routing-and-pages.md`.
- Optional `export const revalidate` (seconds) opts into the server HTML response cache (#241). SAFETY: only on a page identical for every visitor (no `cookies()` / session / per-user data); keyed by the request origin plus the URL, with no per-user keying. See `references/built-ins.md`.
- A page has NO `action` export. The no-JS write path is a `<form action=${importedAction}>` binding a `'use server'` action (#1155): a non-GET submission to the page's own URL is dispatched to the action the hidden `__webjs_action` field names, returning an `ActionResult`. Success is a `303` (PRG); failure re-renders the SAME page at `422` with the result on `ctx.actionData`; a submission binding nothing is a `405`. See `references/data-and-actions.md`.
- Page modules also load on the client so imported components register; keep top-level imports browser-safe. **Server-only code goes only in `.server.{js,ts}`, `route.ts`, or `middleware.ts`. Never in pages, layouts, or components.**

### Layouts (`app/**/layout.{js,ts}`)

Default export receives `{ children, params, searchParams, url }`, must embed `children`, nests by folder, and `metadata` merges (deepest wins). The framework auto-emits `<!doctype><html lang="en"><head></head><body>`; only the **root layout** (`app/layout.{js,ts}` exactly) MAY write its own shell (the framework splices in importmap, modulepreload, title, meta). Non-root layouts and pages MUST NOT (the `shell-in-non-root-layout` rule).

### Error / loading / metadata routes

`error.{js,ts}` default-exports `({ error, ...ctx }) => TemplateResult` (catches sibling-page / deeper render errors, innermost wins, prod sends only `error.message`). `loading.{js,ts}` wraps the sibling page in `Suspense` with an immediately-flushed fallback. `forbidden.{js,ts}` / `unauthorized.{js,ts}` render the nearest 403 / 401 boundary for a thrown `forbidden()` / `unauthorized()` (#848). Two **root-only** boundaries (`app/` root exactly): `global-error.{js,ts}` is the app-wide catch-all tried after the nested `error` boundaries are exhausted, and it renders its **own** `<!doctype><html><body>` document (returned verbatim, since a root-layout failure is when it fires). Because it is returned verbatim (no framework `<head>` splice), it ships **no importmap or boot script**, so keep it **static HTML with no components/hydration** (a last-resort page must not depend on the module system that may have just failed); under an opt-in CSP, an inline `<script>` in it must carry the nonce via `cspNonce()` (an inline `<style>` needs one only if you tighten `style-src`, since the default allows inline style outright). `global-not-found.{js,ts}` renders for an unmatched-anywhere URL when no `not-found` matches. `not-found` is nearest-wins from the throwing page's chain (#848 fixed the prior root-only behavior). Metadata routes (`sitemap`, `robots`, `manifest`, `icon`, `apple-icon`, `opengraph-image`, `twitter-image`) live at app root or static segments only and default-export a possibly-async function; `sitemap(entries)` / `sitemapIndex(sitemaps)` from `@webjsdev/server` serialize spec-valid XML.

### Route handlers (`app/**/route.{js,ts}`)

Named async exports per method (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`), each `(Request, { params }) => Response | value` (value auto-JSONs). A folder cannot have both `page.js` and `route.js`. Export `WS(ws, req, { params })` from the same file for a WebSocket endpoint (in dev re-imported per connection; shared state on `globalThis`). See `references/client-router-and-streaming.md`.

### Middleware (`middleware.{js,ts}`)

Optional top-level + per-segment. Default export `async (req, next) => Response`. Return a Response to short-circuit, or call `next()` then post-process. Per-segment applies to its subtree, outermost to innermost. The root file sits beside `app/` and may be `middleware.ts` / `.js` / `.mts` / `.mjs` (`.ts` wins if more than one exists).

### Env validation (`env.{js,ts}`)

Optional app-root file default-exporting a **schema object** (env-var names to a type `string` / `number` / `boolean` / `url` / `enum` or options object with `optional` / `default` / `minLength` / `pattern` / `values`) OR a **validator function** `(env) => void` (throw to fail boot). Runs at boot after `.env` loads, writes coerced values + defaults back to `process.env`, fails fast naming EVERY bad var. Opt-in.

### Server actions (`**/*.server.{js,ts}` + `'use server'`)

| File | `'use server'`? | What it is |
|---|---|---|
| `*.server.ts` | yes | **Server action.** Source-protected AND RPC-callable; client imports become stubs POSTing to `/__webjs/action/<hash>/<fn>`. The same `<hash>/<fn>` identity is what a bound `<form action=${fn}>` submits, so one action is reachable over RPC AND as a plain HTML form post to the page's own url. |
| `*.server.ts` | no | **Server-only utility.** Source-protected; browser imports get a throw-at-load stub. |
| Plain `.ts` | yes | **Lint violation** (`use-server-needs-extension`). Rename to add `.server.`. |
| Plain `.ts` | no | Browser-safe; standard. |

The server-only-utility row (`.server.ts`, no `'use server'`) is a runtime trap: its browser stub throws at module load, so a page / layout / component that ends up SHIPPING to the browser and transitively imports one crashes the moment the module loads, while `webjs typecheck` and the rest of `webjs check` pass. `webjs check`'s `no-server-import-in-browser-module` rule catches this statically by reusing the build's elision verdict (it only flags modules that genuinely ship; a display-only page the framework elides is fine, because the framework strips its server import). A `'use server'` action is exempt: its browser stub is a working RPC, which is the intended way to call the server from a shipping module. A TYPE-ONLY `import type { Row } from './x.server.ts'` is exempt too, because the TypeScript stripper erases it before it can reach the browser, so sharing a derived row type from a `.server.ts` into a shipping component is safe and is not flagged (#805).

Server actions export named async functions whose args + returns round-trip through the serializer. **Importing from a client component IS the API** (rewritten to an RPC stub; never hand-write `fetch()`). **REST over HTTP is a `route.ts`** that imports and calls the action (optionally via the `route(action, opts?)` adapter from `@webjsdev/server`, which merges query + route params + JSON body into one input object and JSON-responds). **Input validation (#245)** is declared via the `export const validate` config export (read on the RPC boundary); a `route()` endpoint passes the same validator as its `{ validate }` option. The framework only CALLS the validator (ships no validation library) and reads its return (`{ success: true, data? }` runs the action, `{ success: false, fieldErrors }` returns a `422` without running the body, a THROW is a sanitized error, any other value is transformed input). The validator stays server-side and receives the action's first argument. Full reference in `references/data-and-actions.md`.

**HTTP-verb actions via config exports (#488).** A `'use server'` action declares its HTTP semantics through RESERVED sibling exports the framework reads statically, the same way a page declares `export const revalidate`: `export const method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'` (absent = POST, so existing actions are unchanged), `export const cache = 60` (seconds, or `{ maxAge, swr, public }`, default `private`, where `swr` appends `stale-while-revalidate=<swr>` seconds so an expired response is still served instantly while the browser revalidates it in the background; **`public: true` SHARES the response across users keyed only by URL + args, so use it ONLY for data identical for every visitor, never for a session / per-user read, the same safety rule as a page's `export const revalidate`**), `export const tags = (id) => [\`user:${id}\`]` (a GET's cache tags), `export const invalidates = (id) => [...]` (a mutation's tags to evict), `export const validate = (input) => ...` (the boundary validator), and `export const middleware = [mw1, mw2]` (#490: per-action middleware, each `async (ctx, next) => result`; a middleware short-circuits by returning an `ActionResult` instead of calling `next()`, and accumulates context the action reads via `actionContext()` from `@webjsdev/server`, no signature change). The declared middleware runs automatically on the RPC boundary. On the `route.ts` boundary it applies when the `route()` adapter is given the action's MODULE NAMESPACE (`import * as postActions from '...'; export const POST = route(postActions)`), which reads the declared `middleware` + `validate`; the bare-function form (importing just the function, `import { createPost }` then `route(createPost)`) runs only what you pass in `route(fn, { middleware })`, because a function reference cannot reach its sibling config exports (#876). The function stays a plain `export async function`; **one function per file** (a configured file with more than one callable function is a `webjs check` error). The call site never changes (`await getUser(7)`); the verb only changes the transport: a **GET** rides args in the URL (`?a=`, with a POST fallback over a 4KB cap), is CSRF-exempt, and carries a weak ETag (answering `If-None-Match` with a 304); with a `cache` export it also carries `Cache-Control` + `X-Webjs-Tags`, and without one it is `no-store` (caching is opted into by `cache`, never granted by the verb); a **mutation** (POST/PUT/PATCH/DELETE) sends the rich body (DELETE rides the URL), is CSRF-protected, and on completion (the action did not throw) evicts its `invalidates` tags from the server `cache()` (`revalidateTags`) and reports them via `X-Webjs-Invalidate` so the client browser-cache coordinator revalidates a later read. A mismatched request method is a `405` + `Allow`. Why WebJs needs this and Next does not: WebJs has no RSC server/client split, so reads and writes both flow through the one action mechanism (Next's reads are Server Component fetches, so its actions stay POST-only). `validate` is a BOUNDARY concern (the RPC endpoint and a `route.ts`), not a direct server-to-server call. A public REST endpoint is a `route.ts` that imports and calls the action (optionally via the `route()` adapter). **Cancellation (#492):** an action reads the request's `AbortSignal` via `actionSignal()` (from `@webjsdev/server`) to stop work on a client disconnect / abort (a never-aborting signal outside an action keeps the line safe server-to-server); on the client, a superseded `async render()` automatically ABORTS the previous render's in-flight action fetch (not just drops it), via a per-render `AbortController` the stub binds each fetch to. **Streaming results (#489):** an action that RETURNS a `ReadableStream` / async iterable / async generator (any verb) streams its chunks over the single RPC response instead of buffering; the call site does `for await (const chunk of await streamTokens(8))` and each rich-serialized chunk arrives as it is yielded (back-pressure respected, the source generator cancelled on a client disconnect / superseded render). Detection is purely on the return value (no config export); a streamed result is never cached / ETagged / seeded (a mutation still emits `X-Webjs-Invalidate`). A mid-stream throw surfaces as an error from the iterable (the HTTP status is already 200), the author message in prod.

### RPC + REST endpoint security

Action RPC CSRF is an **Origin / `Sec-Fetch-Site` check** (the Remix 3 / Go 1.25 model), NOT a token cookie: a state-changing verb passes only when `Sec-Fetch-Site` is `same-origin` / `none`, or (older browsers, no `Sec-Fetch-Site`) the `Origin` host matches the request host, or the source is in `webjs.allowedOrigins`; otherwise 403. **No `Set-Cookie` rides the SSR HTML**, which is why a page that opts into a public `Cache-Control` (via `metadata.cacheControl`, e.g. on a root layout for a whole visitor-identical app) is CDN-edge-cacheable. A safe GET action is CSRF-exempt. **Prod action errors are sanitized to a GENERIC message plus a short `digest`** (#749): a thrown action never returns its raw message to the client (a DB-driver message, an internal IP, an fs path are not author-controlled), the full error is logged server-side keyed by that digest, and the streaming error frame is sanitized the same way; `redirect()` / `notFound()` control-flow throws pass through, and a user-facing message belongs on the `ActionResult` `{ success: false, error }` envelope, not on a throw. A `route.ts` REST endpoint (hand-written or via the `route()` adapter) is NOT covered by this check: authenticate every mutating endpoint, use `validate`, log without secrets, rate-limit. For CORS use the `cors()` middleware from `@webjsdev/server`; **`credentials: true` REQUIRES an explicit origin allowlist, never `'*'`.** See `references/client-router-and-streaming.md`.

### Components (`components/*.{js,ts}`)

One custom element per file; call `Class.register('tag')` at module top level. Styling via `static styles` (shadow) or Tailwind classes, not inline `style="…"`.

---

## Modules architecture (preferred for non-trivial apps)

- **`modules/<feature>/actions/*.server.{js,ts}`** mutations, **`queries/*.server.{js,ts}`** reads (one function per file), **`components/*.{js,ts}`** feature-owned components (shared UI in top-level `components/`), **`utils/*.{js,ts}`** pure helpers (no `'use server'`, no DB), **`types.{js,ts}`** typedefs.
- **`lib/`** cross-cutting: `lib/*.server.{js,ts}` server-only infra (session, hashing; the DB connection lives in `db/connection.server.ts`), `lib/utils/*` browser-safe helpers, `lib/*.ts` app-wide values.

### The `ActionResult<T>` envelope

```ts
type ActionResult<T> =
  | { success: true, data?: T, redirect?: string }  // redirect MUST be a same-site local path
  | { success: false, error?: string, fieldErrors?: Record<string, string>,
      values?: Record<string, string>, status?: number };
```

`fieldErrors` / `values` / `redirect` are additive. **Failure detection is robust:** a result is a FAILURE when `result.success === false`, OR `result.fieldErrors` is present, OR `result.error` is present and `result.success !== true`. **`result.redirect` must be a same-site local path** (a single leading `/`); other values are ignored (open-redirect guard), so throw `redirect(absoluteUrl)` for a real external redirect.

**Rules:** routes stay thin (extract >~20 lines into a module action); client components import server modules via the normal path; server-only imports reach the client only through `.server.{js,ts}`; one module, one feature. See `references/data-and-actions.md`.

---

## Types: derive them, never `unknown` or `any`

**Full-stack type safety is the point of the `.server.{js,ts}` boundary, so an app that types its boundaries `unknown` or `any` gives up WebJs's central guarantee for nothing.** There is no build step and no code generation between the two sides: a client component importing a server action resolves to the action's real signature at type-check time, so the type is already there to be used. Nothing enforces this (both are valid TypeScript, so `tsc` and `webjs check` pass either way), which is exactly why it is written down.

Derive the type at every boundary: a DB row from the schema (`typeof todos.$inferSelect`, carried into a shipping component with `import type`), an action's input from a named `interface` and its result from `ActionResult<T>`, a page from `PageProps<'/blog/[slug]'>`, a layout from `LayoutProps`, a route handler's second argument from `RouteHandlerContext`, an href from the generated `Route` union (`npx webjsdev types`), a reactive property from `prop<Student>(Object)`.

`unknown` is right for a payload nothing has vouched for yet, narrowed on the next line (a `route.ts` `await req.json()`, an action's `export const validate`, a `catch` binding), and for a value headed for an `html` template hole (a hole renders a string, a number, a `TemplateResult`, or an array of those, so `TemplateResult` alone is too narrow). Everywhere else it is a missing type, not a safe one: `unknown` surviving into a return type, a component prop, a layout's `children`, or an action signature is the shape to fix. The template-hole case covers a parameter of YOUR OWN helper, never a value the framework already types. `any` has no carve-out at all. Full ladder, with the end-to-end example, in `references/typescript.md`.

---

## Styling: Tailwind-first

**Tailwind is the strong default for pages AND light-DOM components.** The lit reflex to scope CSS in a shadow root with `static styles` is the habit to resist in light DOM. When a class bundle repeats, extract it into a `lib/utils/ui.ts` helper returning an `` html`...` `` fragment (SSR-time), NOT a CSS class (no `@apply`). Reserve raw CSS for what utilities cannot express (design tokens / `@theme`, `@property` + `@keyframes`, scrollbar, `prefers-reduced-motion`, complex `color-mix()` / gradients); in light DOM the tag-prefix invariant (#7) still holds, and shadow-DOM components legitimately use `static styles = css\`\``. **Pin a header with `position: fixed`, never `position: sticky`** (a sticky header flickers on iOS WebKit during a client-router nav, #610, because the preserved header plus the scroll-to-top trips a WebKit sticky-repaint bug that the GPU-promotion hacks do NOT fix, so reserve the header height on the content with a `--header-height` offset). See `references/styling.md`.

---

## Client navigation: automatic, nothing to opt into

The router auto-enables when `@webjsdev/core` loads (any page with a component), so there is nothing to opt INTO. An app that wants plain full-page (MPA) navigation can opt OUT app-wide with `{ "webjs": { "clientRouter": false } }` (#629), or per-moment at runtime with `disableClientRouter()`. SSR auto-emits KEYED boundary comment pairs around each layout's children AND the page itself (open `<!--wj:children:<segment>:<route-key>-->`, close `<!--/wj:children:<segment>-->`; the route-key is the resolved path with param values percent-encoded, #1015). The router strictly scans both DOMs (any truncated, mispaired, or duplicated boundary poisons the scan) and applies a two-tier swap with Next.js remount parity: a changed route-key REPLACES (remounts) at the PARENT of the shallowest changed boundary (the range that contains the changed layout's own markup, exact Next remount scope), an unchanged one MORPHS the deepest shared boundary in place (a searchParams-only nav preserves hydrated component state). A poisoned or disjoint scan degrades to a full page load, never a guessed recovery, so silent DOM corruption is structurally impossible; outer-layout DOM identity is preserved on every soft path. **Every degradation dispatches `webjs:navigation-fallback` on `document` in ALL environments** (detail `{ cause, href, willReload }`, not cancelable), so a full page load on a click is observable in production rather than silent (#1114). Form submissions ride the same pipeline (`data-no-router` opts out). Wire bytes are minimized via the `X-Webjs-Have` header (`segment:route-key` entries, so a dynamic layout held for OTHER params is re-rendered rather than short-circuited; the server returns only the divergent fragment, served `private` so a shared cache can never store the reduced body and serve it to a full-page navigation, and additionally marked `Vary: X-Webjs-Have` for caches that honour it (#1140; `Vary` alone was not enough, since Cloudflare honours only `Accept-Encoding`)); scroll is restored on back/forward. **The link-prefetch cache is ANCHOR-VALIDATED** (#1114): a reduced fragment begins at the boundary the server short-circuited on, and on consume the router checks that boundary is still live with the same route-key. A root-anchored fragment therefore survives an unrelated navigation (still a cache hit), while one anchored deeper is discarded once that layout is gone, because applying it would share no boundary with the live DOM and force a full page load. The router also never prefetches the page it is already on (#1106): that request can never serve a later navigation and only occupies a capped cache slot. A non-GET `<form>` that BINDS a server action (`action=${fn}`) is the no-JS write-path (with JS the router posts the same body to the same url and applies the response in place: a `422` swaps without reload, a `303` is followed via fetch). **The router ENCODES that body per the declared `enctype`** (#1307), resolved with native precedence (a submitter's `formenctype` over the form's, decided on PRESENCE rather than on the value being non-empty, #1322: a `formenctype=""` or `formmethod=""` overrides the form and then falls to its OWN invalid-value default, urlencoded and GET respectively, while `formtarget=""` is a plain string reflection with no enumerated states, so it overrides the form and means the current browsing context): `multipart/form-data` sends `FormData`, and `application/x-www-form-urlencoded`, the HTML default and therefore what a plain `<form method="post">` means, sends `URLSearchParams` (a `File` serializes as its name, as the platform does). It previously built `FormData` for everything, so an ordinary POST form sent a urlencoded body with JS off and a multipart body with JS on. A `text/plain` POST is the one encoding the server cannot parse, so the router declines it and lets the browser submit natively, which keeps both paths doing the same thing. A failed navigation recovers in place (a cancelable `webjs:navigation-error` event, else a minimal in-place alert), never a destructive full reload.

The advanced client-router surface is in `references/client-router-and-streaming.md`: **link prefetch** (on by default, device-adaptive default: `intent` on a hover pointer, `viewport` (dwell-gated, cancel-on-scroll-out) on touch, per-link `data-prefetch` override), **`<webjs-frame>`** partial-swap regions, **View Transitions** (opt-in via `<meta name="view-transition" content="same-origin">`, where the router checks that exact `content` value and a bare tag enables nothing, plus `data-webjs-permanent` to persist a live element), **stream actions** (`<webjs-stream>` element-level updates, #248), and the **opt-in nav-loading indicator** (`<html data-webjs-nav-progress>` exposes a `data-navigating` attribute during a nav so you can style a CSS-only progress affordance, off by default because toggling a root attribute re-resolves `oklch()` tokens to a one-frame repaint flash on iOS WebKit, #610). Production benefits from HTTP/2 at the edge; `npm run start` speaks plain HTTP/1.1 (put a reverse proxy in front for TLS + HTTP/2).

---

## Mutations: default to optimistic UI

**Use `optimistic()` from `@webjsdev/core` for every user-facing mutation** (create, update, delete, like, toggle, reorder) where the client can predict the result. The UI should feel instant; roll back automatically on failure.

### Preferred: declarative API

```ts
import { WebComponent, prop, optimistic, html } from '@webjsdev/core';
import { createTodo } from '#modules/todos/actions/create-todo.server.ts';

class TodoList extends WebComponent({
  todos: prop<Todo[]>(Array),
}) {
  private optimisticTodos = optimistic(this, {
    source: () => this.todos,
    // KEEP THIS REDUCER PURE. `.value` re-folds every queued update on EVERY
    // read, so a `crypto.randomUUID()` here would mint a NEW id per render and
    // a keyed list would tear the pending row down on each update. Mint the
    // temp id in the handler and carry it in the payload.
    update: (state, add: { tempId: string; title: string }) => [
      ...state,
      // `createdAt` is rebuilt per read too, tolerable only because nothing
      // keys on it. Put it in the payload as well if anything does.
      { id: add.tempId, title: add.title, completed: false, createdAt: new Date(), pending: true },
    ],
  });

  async handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const title = new FormData(e.target as HTMLFormElement).get('title') as string;
    if (!title) return;
    (e.target as HTMLFormElement).reset();

    // Minted ONCE here, not in the reducer. No cast needed: `Todo['id']` is a
    // string (a uuid primary key). Against an auto-increment integer id, model
    // the temp row instead of casting.
    const tempId = crypto.randomUUID();
    const promise = createTodo({ title });
    this.optimisticTodos.add({ tempId, title }, promise);

    const result = await promise;
    if (result.success && result.data) {
      // The optimistic row is never written to `this.todos`: the overlay holds
      // only the payload and `update` rebuilds the row on each `.value` read,
      // so this prop holds only confirmed rows. Append the server's row,
      // matching the order the `update` reducer used.
      this.todos = [...this.todos, result.data];
    }
  }

  render() {
    return html`<ul>${this.optimisticTodos.value.map(todo => html`
      <li class=${todo.pending ? 'opacity-50' : ''}>${todo.title}</li>
    `)}</ul>`;
  }
}
TodoList.register('todo-list');
```

`.add(payload, promise)` auto-releases when the promise settles (resolve or reject). No try-catch, no manual rollback, no reconciling a temp id against the real one.

**Keep `update` pure.** `.value` re-folds the whole queue on every read, so the reducer runs again on each render rather than once per `.add()`, and anything it mints is minted per render. Mint a temp id in the handler and pass it in the payload, as above. A `crypto.randomUUID()` inside the reducer hands the pending row a fresh id every read, which breaks `repeat()` keying and anything else treating that id as stable.

### Simple flips: imperative API

For boolean toggles where the value itself is the mutation:

```ts
import { signal, optimistic } from '@webjsdev/core';
import { likePost } from '#actions/like-post.server.ts';

const liked = signal(false);
// in an @click handler:
const result = await optimistic(liked, true, () => likePost(postId));
```

### When to skip optimistic UI

- The result is unpredictable (AI-generated content, server-computed values the client cannot guess).
- The mutation has side effects the user must wait for (payment processing, email sending, OAuth).
- The action validates against data that may have changed server-side (unique constraints, race conditions).
- The mutation is destructive and irreversible with no undo (confirm-first UX is better).

### When optimistic UI is appropriate

- Todo items, comments, posts, likes, follows, toggles, reorders, renames, status changes.
- Any mutation where the client can construct the expected result from the input.
- CRUD operations where the server returns the same shape the client already has.

**Never write manual try-catch / cache-and-restore / temp-ID reconciliation** when `optimistic()` covers the pattern. See `references/client-router-and-streaming.md` for the full reference and `references/data-and-actions.md` for complete examples.

---

## Invariants (for both humans and agents)

> Hit one of these as a runtime error? The [Troubleshooting page](https://webjs.dev/docs/troubleshooting) is keyed by symptom (the throw-at-load server import, the backtick-in-template 500, the TypeScript strip failure, the SSR browser-global crash, the missing-frame swap) and maps each back to the invariant and the `webjs check` rule below.

1. **Server-only code goes in `.server.{js,ts}` files, `route.ts` handlers, or `middleware.ts`. Never in pages, layouts, or components.** The `.server.{js,ts}` extension is the path-level boundary (the file router refuses to serve the source); a `'use server'` directive additionally makes exports RPC-callable, else the file is a server-only utility whose browser import is a throw-at-load stub. Importing a DB driver (`pg`), `node:*`, or any server-only dep from a component or an `app/**` page / layout / loading / error / not-found file crashes the browser at module load.
2. **Every `*.server.{js,ts}` file with `'use server'` exports must be `async` functions returning serializer-safe values.** Args and results round-trip via webjs's wire. Files without `'use server'` (server-only utilities) can export anything, including singletons.
3. **Custom element tag names must contain a hyphen** (HTML spec). Pass the tag to `Class.register('tag-name')`, not a static field. Any short-string quote works: `'tag-name'`, `"tag-name"`, or `` `tag-name` `` (single-line, no interpolation).
4. **Event (`@`), property (`.`), boolean (`?`) holes in `html` must be unquoted**, e.g. `@click=${fn}`, never `@click="${fn}"`.
5. **Signals are the default state primitive.** Import `signal` / `computed` from `@webjsdev/core` and read via `signal.get()` inside `render()`; the built-in SignalWatcher tracks the reads and re-renders. Module-scope signals share state across components; instance-scope signals (constructor) are component-local. The factory `WebComponent({ ... })` is reserved for values riding an HTML attribute, reflected to one, or arriving via `.prop=${value}` SSR hydration. For fine-grained DOM swap use `${watch(signal)}` from `@webjsdev/core/directives`.
6. **Page and layout default exports must be functions.** They return a value (usually `TemplateResult`). They do not call `render()` themselves.
7. **Light-DOM components with custom CSS MUST prefix every class selector with their tag name.** Tailwind utilities are unique by construction, so prefer them.
8. **Non-root layouts and pages MUST NOT** write `<!doctype>` / `<html>` / `<head>` / `<body>`. Only the root layout may.
9. **No backtick characters inside `html\`...\`` template bodies**, even inside CSS / HTML comments. A nested backtick closes the literal at JS-parse time and 500s in prod.
10. **TypeScript must be erasable.** Set `compilerOptions.erasableSyntaxOnly: true`. No `enum`, no value `namespace`, no constructor parameter properties, no legacy decorators with `emitDecoratorMetadata`, no `import = require`. Types are stripped via Node 24+'s `module.stripTypeScriptTypes` (buildless, no bundler fallback); non-erasable syntax 500s at strip time. Enforced by `erasable-typescript-only` (tsconfig flag) and `no-non-erasable-typescript` (source scan). See `references/typescript.md`.

11. **No em-dashes (U+2014), no hyphen or semicolon used as pause-punctuation in prose, and no colon attached to a code-shaped LHS.** Banned as a pause: U+2014, a space-surrounded hyphen between words, a space-surrounded semicolon between words. Banned colon attachments: a colon-then-prose after `xyz()`, a `<my-tag>`, an `[expr]` subscript, or a `<code>foo()</code>` definition list (rephrase verb-led). Prefer a period, comma, a colon on a plain-noun LHS, parentheses, or a restructure. Plain hyphens stay fine in compound words, flags, filenames, ranges, and semicolons and colons stay fine inside code / TS / CSS and inside JSON SYNTAX. A JSON or front-matter `description`, `title`, or `displayName` VALUE is prose, not code, and is scanned like any other prose. The same hook also enforces brand casing with one simple rule: `WebJs` is a proper noun, so write it capitalized wherever it NAMES the project in prose, at a sentence start AND mid-sentence (`WebJs ships`, `Most WebJs apps`, `the WebJs serializer`). It stays lowercase `webjs` ONLY as a literal code token: a `webjs <subcommand>` CLI command (`webjs dev`, `webjs db migrate`), a `webjs.dev` domain, an `@webjsdev` package, a `"webjs"` config key, a `WEBJS_*` env var, the `webjsdev/webjs` org path, or anything inside a `` `code` `` span or fenced block. If you mean the literal config key or command in prose, wrap it in backticks. Enforced via `.claude/hooks/block-prose-punctuation.sh`, which scans only NEW content (you can still edit an existing line to fix a glyph or casing).

12. **A form that writes binds its action: `<form action=${importedAction}>`, and a form whose buttons run different actions binds each on its submitter, `<button formaction=${importedAction}>`** (#1155, #1207, #1307). Those are the two shapes the renderer reads, and every near-miss throws rather than producing a form that posts nowhere. The submitter identity rides the pressed button's own `name`/`value` pair (the one channel a browser submits for that button alone), so no `formaction` url is emitted, both entries reach the server, and the dispatcher takes the LAST `__webjs_action` in DOM order, which is the submitter's whenever one was pressed. **Refused on a form:** a quoted `action="${fn}"`, `action=${fn}` on any tag other than `<form>`, `method="get"` or an enctype the server cannot parse, a `.method` / `.enctype` / `.encoding` PROPERTY binding (a `.prop` drops at SSR and applies in the browser, so the form would submit differently with JS than without), a second `action` hole, a plain `action="/url"` alongside the bound hole (SSR keeps it and the client drops it), a whitespace-padded `method=" post "` (an enumerated attribute is matched against exact keywords, so a padded value falls to the invalid-value default and submits as a GET), and a function that is not a `'use server'` export. **Refused on a submitter:** a control that is not a submit control, an `<input type="image">` (it submits `name.x` / `name.y` coordinates, so the identity never arrives), an `<input type="submit">` (the identity has to occupy its `value`, which on that control is also its visible label, so it would render captioned with the action id and could never be labelled; a `<button>` has no such conflict), a submitter carrying its own `name`, `value`, `form`, or static `formaction`, a `.prop` spelling of any of those (`.name` / `.value` / `.formAction` / `.formMethod` / `.formEnctype` all REFLECT on a submitter, so the write is dropped at SSR and lands in the attribute in the browser), and a second `formaction` hole. **Refused on a BOUND submitter, as a same-element contradiction:** its own `formmethod` other than post, an unparseable `formenctype` such as `text/plain`, and `formmethod="dialog"` (which dismisses a `<dialog>` instead of submitting, so the bound action could never run). A PLAIN submitter's own `formmethod` / `formenctype` is NOT refused: native HTML says the submitter's override wins, the author typed it deliberately, and the form's action simply does not run, so the renderer honours it and the dev-time client guard reports at submit time when a submission holds an identity it cannot deliver. A plain `formaction="/url"` likewise retargets away from the bound action and is the author's business. WebJs supplies `method` and `enctype` (and, on a bound submitter, `formmethod` and `formenctype`) only where your template supplies neither, judged from the TEMPLATE rather than the rendered element: `?method=${false}` emits nothing so it is supplied, while `method=${null}` emits `method=""` and is refused. An `encoding=` attribute is inert in HTML (only the `.encoding` PROPERTY aliases `enctype`), so both renderers ignore it. A page has no `action` export, so a bare `<form method="post">` is a `405`. **A bound submitter is SELF-SUFFICIENT and asks nothing of the form around it** (#1307). The renderer supplies submission attributes at the level where the action is BOUND, and never overrides what you wrote at that same level: a bound `<form>` gains `method="post"` plus `enctype`, and a bound `<button>` gains `formmethod="post"` plus `formenctype` ON THE BUTTON, which is what React does for a function `formAction`. So a per-button action works inside a bound form, an unbound form, a `method="get"` form, or a form with no method at all. That is why the refusal list above contains no rule about a submitter's NEIGHBOURS: the renderer refuses only a SAME-ELEMENT contradiction, which has no correct fallback, and never a cross-element rule, which always has one (whatever native HTML would do). It also removed a question neither renderer could answer honestly, since a COMPONENT renders its own template in a separate pass with no view of the host page and the client may reconcile a submitter whose form is not in the tree yet. One consequence: no `formaction` url is emitted (an empty one is a conformance error), so the submission targets whatever the FORM targets, and a form declaring `action="/x"` sends its buttons there. The action still runs if `/x` is a PAGE route, since the identity travels in the body; against a `route.ts` or another origin the identity is ignored and nothing runs, which the dev-time client guard reports at submit time.

---

## Scaffolding

Two scaffolds exist (do not invent template names): `webjs create <name>` (full-stack: layout, page, components, modules, Drizzle+SQLite, plus a browsable feature gallery), and `webjs create <name> --template api` (backend-only routes + modules + Drizzle, no SSR). Auth is one of the full-stack gallery cards (login + a signed session + a real protected route), so a full-stack app already carries a promotable auth baseline (this replaced the former `--template saas`). The `--db sqlite|postgres` flag (default sqlite) picks the dialect; the schema/queries/actions are identical across dialects (see #563). The `--runtime node|bun` flag (default node, #541) is ORTHOGONAL to the template and re-flavors either for Bun (`bun --bun` dev/start scripts so the SERVER runs on Bun, `bun.lock`, a pure `oven/bun:1` Dockerfile (#595; safe since cli@0.10.20's npx-free `webjs db migrate` (#570) needs no Node in the image) + bun-install CI, bun-command agent docs; the test/db/check tooling stays on Node); `bun create webjs <name>` auto-detects it. Pick from the request: default (full-stack) for any product with UI (todo, blog, dashboard, marketplace, social, e-commerce, a SaaS with accounts/login), `api` for an HTTP/JSON API with no UI; default to full-stack when ambiguous.

The `<name>` must be a valid package name (letters, digits, and the separators `-`, `.`, `_`, starting with a letter or a digit, at most 214 characters, and not `node_modules` or `favicon.ico`, which npm reserves). It becomes the app directory, the generated `package.json` `name`, AND a value the scaffold writes into generated source, so anything else is rejected before a single file is written (#1066). Uppercase is fine (`webjs create MyApp` works), since the scaffold's manifest is private and never published, and the Postgres `DATABASE_URL` the scaffold emits uses a lowercased, separator-folded form of the name (`MyApp` gets `myapp`) so it matches what an unquoted `CREATE DATABASE` produces.

Rules: **always scaffold via `webjs create`** (never hand-roll). **Default to a real database (Drizzle + SQLite); NEVER use JSON files, in-memory arrays, or localStorage for persistence.** Update `db/schema.server.ts` to real models FIRST, then `webjs db generate` + `webjs db migrate`, then build pages/actions/queries. **The scaffold ships a gallery index home, a neutral-palette root layout, db wiring, and a densely-commented feature gallery** (single-concept demos under `app/features/` plus the `app/examples/todo` app, with logic in `modules/`), alongside the one cross-agent skill at `.agents/skills/webjs/` (a routing `SKILL.md` + on-demand `references/`) that teaches how to build. Treat the gallery as browsable reference: read the demos to learn the idioms, then build the app the user asked for by growing the scaffold (add routes under `app/`, components under `components/`, features under `modules/<feature>/`, keep server-only code behind `.server.ts`) and prune the demos the app does not use (delete the `app/features/<x>` route AND its `modules/<x>`). Give a UI app its own palette by setting the token values in `app/layout.ts`. There is no design gate and no placeholder gate: taste is the agent's job, not the checker's. Docs at https://webjs.dev/docs.

---

## CLI reference

```sh
webjs dev    [--port N] [--no-hot] # dev server with live reload (node --watch on Node, bun --hot on Bun). --no-hot runs in-process. Runs webjs.dev.before + webjs.dev.parallel (#550)
webjs start  [--port N]            # prod server; source IS the runtime, plain HTTP/1.1 (reverse-proxy for TLS + HTTP/2). Runs webjs.start.before first (#550)
webjs test   [--server] [--browser] [--watch]
webjs check  [--rules] [--json]    # correctness validator (report-only, no autofix); --json for an agent loop
webjs routes [--json] [--table] [--no-headers]   # print the route table (path / owner file / methods, #975). Default tree; --json is byte-identical to the MCP list_routes tool; --no-headers drops the --table header for piping
webjs elision [--json] [--verify] [--routes <paths>]  # the elision verdict (#1308): every component module as elided or shipped (a shipped one naming the EVIDENCE that forced it and the module that did the forcing), every page/layout as inert / import-only / ships-whole, and every orphan class that gets no verdict at all (either no registration call, or a computed tag; the scanner matches only a literal one). --json is byte-identical to the MCP list_elision tool. --verify renders every static page route with elision on and off and diffs the observable SSR bytes (the framework's own differential guard, pointed at your app): exit 0 on parity, non-zero on a divergence OR on a corpus where nothing could be compared. It proves elision did not change the bytes you SERVE, NOT post-hydration behaviour (a wrongly dropped module is a dead click, not different bytes), so run your browser/e2e suite twice under WEBJS_ELIDE=1 / WEBJS_ELIDE=0 for that half. Dynamic routes are skipped by name; --routes adds real paths
webjs mcp                          # read-only MCP: routes, actions (RPC hashes), components, elision (what the browser drops, and why each shipped module ships), check, ui kit
webjs doctor [--json] [--strict]   # project-health checklist (incl. a framework-resolve check that warns when @webjsdev/core can't be resolved from the app dir, the fresh-worktree-without-node_modules trap #954; a page/layout elision advisory PLUS the component-elision verdict, which warns only on an orphan (#1308); a warning when a route module writes a `<link rel="stylesheet">` without `asset()`, #1095); non-zero exit on a hard fail OR on a check the app gated `error`. --json emits `{ results, summary }` (results is the DoctorResult[], each carrying a stable code + its effective severity; summary counts pass/warn/fail/off), plus a third `configErrors` key on the one path where a rejected `webjs.doctor` config stops any check running; --strict additionally fails on every REMAINING warning (#975). Per-check severity is CONFIG, not a flag: `webjs.doctor.gate` maps a code to `off` / `warn` / `error` so CI gates a chosen subset (#1257)
webjs types                        # generate .webjs/routes.d.ts (typed Route union + per-route params, #258)
webjs version                      # print the installed @webjsdev/cli version (also: webjs --version / -v, #975)
webjs help   [command]             # full usage banner, or per-command usage + Options + Examples (e.g. webjs help routes, #975). Flag forms: webjs --help / -h (banner), webjs <command> --help / -h (that command). typecheck/db/ui --help forward to their wrapped tool; an unknown topic exits 1
webjs typecheck [tsc args...]      # the project's own tsc --noEmit
webjs create <name> [--template api]
webjs db <generate|migrate|push|studio|seed>   # wraps drizzle-kit (+ runs db/seed.server.ts)
webjs ui init | add <names...> | list | view <name>
webjs vendor pin|unpin|list|audit|outdated|update [--from PROVIDER]   # importmap pinning, .webjs/vendor/importmap.json
```

`--from PROVIDER` accepts `jspm` (default), `jsdelivr`, `unpkg`, `skypack` and is persisted in the pin file. `PORT` is honoured when `--port` is absent; `webjs dev` emits `routes.d.ts` automatically. Running this repo's own apps (`website/`, which serves the docs and the UI gallery, and `examples/blog/`): `cd` in and use **its** `npm run dev` / `npm start`; as of #550 a bare `webjs dev` / `webjs start` is equivalent (the per-app orchestration moved into the `webjs.dev` / `webjs.start` tasks config, which the primitive runs), so the npm scripts are now just thin aliases.

---

## Environment, server config, caching, observability

- **Env vars.** `process.env.X` reads are server-only; `WEBJS_PUBLIC_`-prefixed names are exposed in the browser via an inline `<script>` (no build); `NODE_ENV` is defined both sides. See `references/built-ins.md`.
- **The `package.json` `"webjs"` block.** Security headers (on by default, per-path `webjs.headers` overrides), CSP (opt-in nonce, `webjs.csp`), declarative `webjs.redirects` (#254), `webjs.trailingSlash` (#255), `webjs.basePath` (#256), ingress caps (`maxBodyBytes` / `maxMultipartBytes` / server timeouts), and dev/start task orchestration (`webjs.dev.before` / `webjs.dev.parallel` / `webjs.dev.regenerate` / `webjs.start.before`, #550 + #967, the orchestration `webjs dev`/`start` run so they match `npm run dev`/`start`; `regenerate` recompiles a stale served build output like `public/tailwind.css` ON REQUEST in dev, replacing a fragile `--watch`), and the doctor severity gate (`webjs.doctor.gate`, #1257, mapping a stable doctor code to `off` / `warn` / `error` so CI fails on a chosen subset of project-health checks instead of on every warning). Type it with `WebjsConfig` + the JSON Schema. See `references/built-ins.md`.
- **Caching + file storage** (`references/built-ins.md`). HTTP `Cache-Control`, the `cache()` query helper + `revalidateTag`, the server HTML response cache (`export const revalidate` + `revalidatePath`, #241), content-hash asset URLs (`?v=`, #243), conditional GET (ETag, #240), and `FileStore` + `diskStore` (streaming, traversal-safe, signed URLs, S3-pluggable, #247).
- **Observability** (`references/built-ins.md`). Access log, `requestId()` + `X-Request-Id`, the `onError` APM hook, `GET /__webjs/version` (#239).

---

## Conventions and webjs check: two surfaces, split by nature

Every app ships the **conventions** as prose, in `.agents/skills/webjs/SKILL.md` (how to build) and `.agents/rules/workflow.md` (git, tests, review). These are guidance a reasonable project could do differently (modules layout, action placement, one-function-per-file, testing, styling, git workflow), followed by judgment, not tool-enforced.

**`webjs check` is a separate, narrower tool: correctness checks only.** Every rule catches code that is wrong to ship (a crash, a security leak, a reactive prop that silently stops re-rendering, a build/type-strip failure). They run unconditionally with no per-project disabling. The dividing line: could a sensible app legitimately want this to pass? If yes it is a convention (prose), if no it is a check (the tool). `webjs check --rules` lists them.

So: read the skill and follow its conventions by judgment; run `webjs check` and fix every violation (correctness bugs, not style).

---

## Recipes: the essentials

The full set lives in `references/data-and-actions.md`. The most common patterns:

### Add a page

```ts
// app/about/page.ts
import { html } from '@webjsdev/core';
export default function About() {
  return html`<h1>About</h1>`;
}
```

### Add a dynamic route

```ts
// app/users/[id]/page.ts
export default async function User({ params }: { params: { id: string } }) {
  const user = await fetchUser(params.id);  // via server action, NEVER import DB directly
  return html`<h1>${user.name}</h1>`;
}
```

### Add a form (the no-JS write path)

```ts
// modules/feedback/actions/submit-feedback.server.ts
'use server';
export async function submitFeedback(formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  if (!email.includes('@')) {
    return { success: false, fieldErrors: { email: 'Enter a valid email' }, values: { email } };
  }
  return { success: true, redirect: '/feedback/thanks' };
}

// app/feedback/page.ts
import { html } from '@webjsdev/core';
import { submitFeedback } from '#modules/feedback/actions/submit-feedback.server.ts';
export default function Feedback({ actionData }: { actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> } }) {
  return html`
    <form action=${submitFeedback}>
      <input name="email" value=${actionData?.values?.email || ''}>
      ${actionData?.fieldErrors?.email ? html`<p>${actionData.fieldErrors.email}</p>` : ''}
      <button>Send</button>
    </form>
  `;
}
```

Binding the action is the whole wiring: no `method`, no `enctype`, no adapter. Works with JS off; with JS the client router applies the 422 in place and follows the 303.

### Add a server action

```ts
// modules/users/actions/update-profile.server.ts
'use server';
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { users } from '#db/schema.server.ts';
export async function updateProfile(input: { name: string }) {
  const name = String(input?.name || '').trim();
  if (!name) return { success: false, error: 'name required', status: 400 };
  const [row] = await db.update(users).set({ name }).where(eq(users.id, me.id)).returning();
  return { success: true, data: row };
}
```

Call it from a client component via a normal import (rewritten to an RPC stub). A component is one custom element per file (`class X extends WebComponent { render() { return html\`…\`; } }` then `X.register('x-tag')`). Full recipes, including the no-JS bound form, are in `references/data-and-actions.md`.

---

## Deliberately deferred

Not in v1. Do not implement as part of other tasks:

- **Bundling and per-route code splitting.** WebJs is **no-build** (the Rails 7 + importmap model); prod perf comes from HTTP/2 multiplex + `<link rel="modulepreload">` hints, not concatenation. **Do not propose a bundler or `webjs build`.**
- **Vite-grade HMR with state preservation.** Custom elements only `define` once, so full reload is necessary; data reloads are near-instant via `fs.watch` to SSE.
- **React Server Components Flight.** Server actions + `Suspense` streaming cover the need.
- **Edge-runtime bundling / full portability** (deployment guidance lives in the docs site at `/docs/deployment`), **i18n, image optimization** (layer libraries on top).
