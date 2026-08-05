# Framework development (editing WebJs itself)

Read this only when editing the WebJs monorepo (this repo), not a scaffolded app. The repo is buildless: `packages/` is plain `.js` with JSDoc (never add `.ts` there); TypeScript is fine in `examples/`, `docs/`, `website/`. Each in-repo app (`website/`, which serves the docs at `/docs`, `examples/blog/`, `packages/ui/packages/website/`, plus the tiny redirect-only `docs/` host) is run from its OWN dir via `npm run dev` / `npm start`; as of #550 a bare `webjs dev` / `webjs start` is equivalent (each app's per-environment orchestration, the Tailwind watcher, `webjs db migrate`, the registry copy, moved into its `webjs.dev` / `webjs.start` tasks config, which `webjs dev`/`start` run). The sections below cover the repo-health git config, the changelog flow, and the dev error overlay.

---

### Deploying the in-repo apps (Docker image + readiness gate)

The four in-repo apps (`website`, which serves the documentation at `/docs` and the component gallery at `/ui`, the redirect-only `docs` host, `examples/blog`, and the redirect-only `packages/ui/packages/website` host) deploy from ONE image built by the root `Dockerfile`, each run as a separate service with its own `PORT` (compose sets it locally, the platform injects it in prod). `compose.yaml` is local parity for that setup; the platform never reads it.

The readiness gate is the same `/__webjs/ready` endpoint the framework ships and documents (503 until fully warm, then 200, see the deployment docs page). Two seams carry it, because no single file configures every platform:

- **Docker / compose / most Docker-based hosts:** the root `Dockerfile` `HEALTHCHECK` (PORT-driven, dependency-free `node -e fetch`) makes the image self-gate. This mirrors `packages/cli/templates/Dockerfile`, the pattern the scaffold ships to users.
- **Railway:** it IGNORES the Docker `HEALTHCHECK` and only honours its own `healthcheckPath`. `railway.json` declares `healthcheckPath: /__webjs/ready`, but a service only applies it if it is wired to read `railway.json` (config-as-code) AND built via the Dockerfile builder. A service left on the RAILPACK builder with no config-file path ignores `railway.json` entirely, so its `healthcheckPath` is null and deploys serve a cold-start window. Wire each service to `railway.json` rather than setting `healthcheckPath` by hand in the dashboard (dashboard values drift from the repo).

Net: edit the `HEALTHCHECK` for the Docker contract, keep `railway.json` for the Railway contract, and never hand-set deploy config in a platform dashboard.

---

### CDN cache: purged automatically after each deploy

`webjs.dev` sits behind Cloudflare, and the site's static assets (`/public/tailwind.css`, the brand SVGs) are served with `cache-control: public, max-age=14400` at STABLE urls. Without an eviction the edge therefore keeps serving the PREVIOUS copy for up to four hours after a deploy. That shipped two visible regressions in one day (a pre-redesign stylesheet after #1179, then the un-fixed logo marks after #1185), and staleness is per-asset rather than all-or-nothing, so the site can look half-updated.

`.github/workflows/purge-cdn.yml` handles this on every push to `main`. It does NOT purge immediately: a Railway build takes minutes, so an immediate purge would evict the cache while the origin still served the old bytes and the next visitor would repopulate the edge with exactly those. Instead the job asks Railway's GraphQL API for the deployment whose `meta.commitHash` matches the pushed sha and reads its real status, then issues a zone-wide `purge_everything` only on `SUCCESS`.

It is a SEPARATE workflow rather than a step in `release.yml` on purpose: `release.yml` fires only on pushes touching `changelog/**` (an npm package release), while the site redeploys on ordinary merges. None of the four website merges on 2026-07-30 touched `changelog/`, so a purge living there would have fired for none of them.

Reading the deployment status rather than inferring it is the second design (#1192). The first version watched the origin's `/__webjs/version` `uptime` for a restart, assuming every push to `main` produces a deploy. It does not: Railway marked #1189's own merge commit `SKIPPED` (it touched only `.github` and a `.md`), no restart ever happened, and the job failed after a 15 minute wait. Every docs-only commit would have been a red X, and a job that cries wolf on routine commits stops being read. So the status now decides:

| Deployment status | Action |
|---|---|
| `SUCCESS` | purge |
| `SKIPPED` | no purge, notice. Railway did not deploy, so the origin is unchanged and nothing is stale |
| `FAILED` / `CRASHED` / `REMOVED` | no purge, warning. No new content reached the origin |
| in progress, or no record yet | keep polling |
| nothing terminal within 15 minutes | no purge, warning, run still GREEN. Use the manual run below |

The purge is zone-wide rather than a path list: all four hostnames (`webjs.dev`, `example-blog.webjs.dev`, `docs.webjs.dev`, `ui.webjs.dev`) are proxied inside the one `webjs.dev` zone, so a single call covers them, and a zone purge cannot silently miss an asset the way a hand-maintained list does. Purging evicts only; nothing is deleted.

- **Required secrets**, both REPOSITORY secrets. The job declares no `environment:`, so an environment-scoped secret arrives EMPTY and the step fails on the explicit "not set" branch:
  - `CLOUDFLARE_API_TOKEN`, scoped to **Zone / Cache Purge / Purge** on the `webjs.dev` zone only. Do not reuse a broad account-wide token.
  - `RAILWAY_TOKEN`, a Railway **project** token for this project's `production` environment (narrower than an account token). A project token authenticates with the `Project-Access-Token` header and an account token with `Authorization: Bearer`, so the workflow tries both and keeps whichever answers without a GraphQL error.
- **Manual purge:** run the "Purge CDN" workflow from the Actions tab (`workflow_dispatch`), which skips the deploy wait and purges straight away. Use this if a deploy landed after the wait timed out.
- **Checking staleness by hand:** compare the edge against the origin rather than trusting `cf-cache-status`, since a `HIT` on fresh content is fine and only differing bytes are a problem.

  ```sh
  curl -s https://webjs.up.railway.app/public/tailwind.css -o /tmp/o
  curl -s https://webjs.dev/public/tailwind.css -o /tmp/e
  cmp /tmp/o /tmp/e && echo fresh || echo stale
  ```

The assets that actually caused those incidents no longer depend on this purge. `tailwind.css`, the brand lockups and marks, and the highlight script are marked with `asset()` (#1194) in `website/app/layout.ts`, `website/lib/design/brand.ts`, and `website/app/brand/page.ts` (whose images AND download links are marked, so a designer cannot download the previous drawing while the thumbnail above it shows the new one), so each carries a `?v=<content-hash>` and is served `immutable` for a year. `examples/blog/app/layout.ts` marks its stylesheet for the same reason, since `example-blog.webjs.dev` sits in the same Cloudflare zone. New bytes mean a new url, which no cache can serve stale.

Some urls are deliberately NOT marked, and that is the point of an opt-in helper rather than an automatic rewrite:

- the three **font preloads**, because the real request comes from `@font-face url()` in the compiled stylesheet and CSS `url()` is not rewritten. The preload cache is keyed on the full url, so a versioned hint could never satisfy the unversioned request, and each font would be fetched twice.
- the **favicons**, whose hrefs are parsed literally by the SEO repo-health tests guarding the #1088 size bug, and where fingerprinting buys almost nothing.

The purge workflow therefore STAYS as the safety net for everything still on a stable url (an asset referenced from CSS, a `srcset` candidate, an un-marked path), and it remains the way to clear the edge after a deploy that changes one of those.

---

### Repo health: worktree-safe git config (core.bare / hooksPath)

This repo uses git worktrees (the review subagents spawn throwaway ones under `.claude/worktrees/`). Git's worktree machinery can leave `core.bare=true` in the shared `.git/config`, which is lethal to the main checkout: every git operation that needs a work tree then fails with `fatal: this operation must be run in a work tree`. The shared value is harmless only while the main worktree carries a per-worktree override (`extensions.worktreeConfig=true` plus a `.git/config.worktree` pinning `core.bare=false`).

`scripts/git-worktree-safe.mjs` establishes that override and pins an absolute `core.hooksPath` to `.hooks` on the main worktree, where both survive a shared-config reset (which is what otherwise silently disables the framework `.hooks/pre-commit`). It runs from the root `prepare` script, so every `npm install` self-heals. Two manual entry points:

- `npm run fix:git` heals the config on demand (run it if a git command reports the work-tree error).
- `npm run check:git` asserts the invariant (`core.bare` resolves false, the framework hook is active) and exits non-zero otherwise. The regression test is `test/repo-health/git-worktree-safe.test.mjs`.

Because the pin lives in the main worktree's `config.worktree`, `git worktree add` copies it into each linked worktree, so a commit made inside a throwaway review worktree also runs the framework `.hooks/pre-commit`. That is harmless (the hook only blocks main and auto-generates a changelog on a version bump), and review subagents are read-only so they do not commit; the inheritance is noted here only so the behavior is not surprising.

### Merged worktrees are auto-removed (`cleanup-merged-worktree.sh`)

Per-task worktrees pile up when a session merges its PR but never runs `git worktree remove` (a skipped step, or a crash mid-task). The `.claude/hooks/cleanup-merged-worktree.sh` PostToolUse hook (matcher `Bash`, wired in `.claude/settings.json`) closes that gap: after any `gh pr merge`, it sweeps every linked worktree and removes the ones that are safe to drop, so cleanup is deterministic rather than a thing an agent has to remember.

It is conservative. A worktree is removed ONLY when it is a linked (non-primary) checkout, on a non-`main`/`master` branch, whose branch is MERGED (an ancestor of `origin/main`, OR a merged GitHub PR for that head branch, which is how squash-merges are detected via `gh`) AND whose working tree is clean apart from untracked `node_modules` / `.webjs`. It KEEPS anything dirty, unmerged, the primary checkout, or the worktree the merge was run from (you cannot remove your current directory; `cd` out and remove it manually), reporting each kept/removed worktree back to the model via `hookSpecificOutput`. It never blocks the tool (always exits 0). Escape hatch: `WEBJS_NO_WORKTREE_CLEANUP=1`. Regression test: `test/hooks/cleanup-merged-worktree.test.mjs`.

The fix only repairs the LOCAL checkout. Commits and branches are always safe on GitHub regardless.

---

### Scaffold teaching-coverage gate (`gallery-coverage.test.js`)

The scaffold is webjs's primary teaching surface for AI agents, so a new framework feature must ship a runnable gallery demo, not just a doc bullet. Enforcement is two tiers, mirroring how tests are enforced:

- **Tier 1 (commit floor):** `.claude/hooks/require-scaffold-with-src.sh` blocks a commit that stages `packages/(core|server|cli)/src` with no scaffold surface. It only proves you touched a scaffold file, so a documented-but-undemoed feature can still pass (this is exactly how #848 shipped `forbidden()` / `unauthorized()` with app-tree bullets and no demo).

- **Tier 2 (CI gate):** `test/scaffolds/gallery-coverage.test.js` reconciles the LIVE framework surface against `test/scaffolds/gallery-coverage.json` and FAILS when something new is neither demoed nor exempted. It gates three surfaces: `@webjsdev/core` exports (a `{ demo }` gallery-file pointer), `@webjsdev/server` exports (`{ demoed: true }`, verified by a generated app importing it), and routing convention files (the stems DERIVED from `packages/server/src/router.js`, each demonstrated by a file in a generated app). It runs under `npm test`, so a local `--no-verify` cannot skip it: a new export or convention turns CI red until classified. The `reconcile()` / `reconcileSet()` cores are pure and their failure modes (new name, stale key, missing/over-claimed demo, empty reason) are proven with synthetic inputs alongside the real-surface assertions. The deferred backlog is tracked in #859.

**When you add or rename a `@webjsdev/core` or `@webjsdev/server` export, or add a routing convention file the router parses, update the manifest** the same way you write a test: add a demo pointer / `{ demoed: true }`, or an honest exemption. All three surfaces are gated (the convention stems are derived from `packages/server/src/router.js`, so a new `stem === '...'` branch auto-appears and must be classified).

The scaffold gate is one of a FAMILY of tier-2 coverage gates that keep the framework's agent-facing surfaces from rotting behind a new feature. The others:

- **Knowledge coverage** (`test/knowledge/knowledge-coverage.test.js`): reconciles the live `webjs check` `RULES` against the troubleshooting page + gotcha docs (a new rule must be explained in a symptom-keyed surface or exempted in `knowledge-coverage.json`), and asserts the AGENTS.md headings the MCP `init` primer sources (DERIVED from the `sectionByHeading(agents, /.../)` calls in `packages/mcp/src/mcp-docs.js`) still exist, so a heading rename cannot silently empty the primer.
- **API docs + test coverage** (`test/api-coverage/api-coverage.test.js`): every agent-facing `@webjsdev/core` + `@webjsdev/server` export (NON-internal per the scaffold manifest, the single source of truth) must be referenced in the docs corpus (AGENTS.md + the skill + docs site) AND in a test. A new public export that ships undocumented or untested turns CI red.
- **Types** round out the family and keep the hand-written `.d.ts` overlays (the `@webjsdev/core` and `@webjsdev/server` type surface VSCode / Neovim show) honest from three angles, per published `exports` entry (the overlay `types` for `.` plus every subpath, mapped to its sibling `.js`): `dts-export-coverage.test.mjs` proves every runtime export HAS a declaration (#388, forward direction); `dts-no-phantom-exports.test.mjs` proves the REVERSE, that every VALUE export an overlay declares EXISTS in its NODE runtime sibling, so a type-checking `import { x }` cannot crash with `x` undefined on that surface (#1031). It maps each overlay to its runtime `.js` by SIBLING (`foo.d.ts` overlays `foo.js`), not a `source` field (most entries have none), enforces a per-package entry-count floor, and asserts it still detects a KNOWN phantom on the real package, so a resolution break degrades to a loud failure, never a vacuous pass. The `@webjsdev/core` `.` overlay is DUAL-surface, so it is checked against BOTH runtimes: the Node sibling `index.js` and the browser entry `index-browser.js` (read from the server importmap), the latter allowlisting the three intentional server-only strips (`renderToString` / `renderToStream` / `setCspNonceProvider`) with a positive control that they stay stripped, so a NEW value the overlay declares that the browser bundle drops is caught as a browser phantom (#1035). Third, `complex-export-signatures.test-d.ts` (via the `type-fixtures.test.mjs` runner) pins the signatures of the complex exports (`WebComponent`, `Task`, `ref`, `repeat`, context) positively, because those overlays are deliberately richer than the loose JSDoc and an automatic shape-diff is all false positives on them. A KNOWN-real phantom deferred to a follow-up sits in `KNOWN_PHANTOMS` with its issue link and is deleted when that fix lands. `server-types.test.mjs`, **elision** (`packages/server/test/elision/lifecycle-coverage.test.js`), and **llms.txt** (`test/docs/llms.test.mjs`) complete the family. Each reads its live surface dynamically so it cannot go stale.

---

### The e2e's elision-off server resolves vendors from the repo (#1228)

`test/e2e/e2e.test.mjs`'s `differential elision (#181)` block runs the blog twice and asserts the two builds render identically. The two builds do not have the same network footprint, and that asymmetry is created by elision itself. Elision ON drops `components/vendor-badge.ts`, the blog's only vendor consumer, so `scanBareImports` finds nothing, `api.jspm.io` is never called, `dayjs` never enters the importmap, and the browser never contacts a third party. Elision OFF ships that component, so the same page acquires two live jspm dependencies: a blocking `api.jspm.io/generate` POST on the server's cold first request, and a `https://ga.jspm.io/...` module fetch inside `app/page.ts`'s graph in the browser.

An ES module graph instantiates as a unit, so a failure at either point means `app/page.ts` never evaluates and nothing it imports registers, including components whose own modules fetched fine. The visible symptom is `customElements.define` never running, which reads as an elision defect and is not one. That is what redded this block on and off from 2026-08-02.

So the OFF server boots with `test/e2e/fixtures/stub-jspm.mjs` preloaded, which answers the `api.jspm.io/generate` call from this repo's `node_modules` and points `dayjs` at a `data:` URL carrying those bytes. Stubbing the API call closes both holes at once, because the URL the browser fetches is whatever that map says. The ON server is left alone, since it resolves nothing.

Two things to keep in mind when touching this. The stub serves only the packages listed in its `LOCAL_VENDORS` map and passes everything else through to the real API, so **a vendor added to the blog later needs an entry there.** That failure is not silent: one unserviceable install makes the stub refuse the whole batch, the real API answers, and the block's first test fails naming the CDN url it got instead of a `data:` one. The same test is what catches the wiring itself going away, so do not delete it to make a new vendor pass. And the preload flag is runtime-specific (`--import` on Node, `--preload` on Bun, neither honouring the other, and Bun ignoring `NODE_OPTIONS`), which is why it is passed as argv through `preloadArgs` rather than an env var; the `E2E (blog served on Bun)` CI job is what a Node-only spelling would silently skip.

---

### Changelog: per-package, per-version, auto-generated

WebJs ships per-package per-version changelogs under `changelog/<pkg>/<version>.md`. The model: **a version bump is the trigger**. When any commit on `main` changes the `version` field in `packages/<pkg>/package.json`, the scripts/backfill-changelog.js generator emits a new `changelog/<pkg>/<version>.md` summarising every conventional-commit (`feat:` / `fix:` / `breaking:` / `perf:`) that landed in that package since the prior bump. The website renders the union of all packages' files at `/changelog`.

**How it works for AI agents and humans:**

1. Bump the `version` field in a `packages/<pkg>/package.json` and stage the change. Bumping `@webjsdev/intellisense` additionally requires a re-vendor in the same commit (`node packages/editors/nvim/scripts/vendor-intellisense.mjs`, then `git add -f packages/editors/nvim/vendor`), because webjs.nvim ships a committed copy of that manifest and `packages/editors/nvim/test/vendor-sync.test.mjs` compares it in full.
2. Run `git commit` as usual. The `.hooks/pre-commit` hook detects the staged bump, runs `node scripts/backfill-changelog.js` automatically, stages the resulting `changelog/<pkg>/<version>.md`, and lets the commit proceed. The bump and its release notes land in the same commit.
3. Optionally review and edit the generated file before pushing. The script's body excerpts are the first lines of each commit message; for `breaking` entries especially, add migration notes by hand. Re-runs are idempotent (existing files are never overwritten), so hand-edits survive.
4. Never edit `changelog/<pkg>/<version>.md` for a version that has already been published. Bump the version and edit `changelog/<pkg>/<next>.md` instead.

If the package has zero `feat:` / `fix:` / `breaking:` / `perf:` commits in the range (a release-only bump with no user-facing changes), the script writes nothing and the hook fails the commit. Either add a hand-written entry, downgrade the bump if it was unintentional, or `git commit --no-verify` to bypass.

The whole flow is tool-agnostic: the universal pre-commit hook fires for every `git commit`, regardless of who or what is running it. AI agents using Claude Code, Cursor, Copilot, Aider, etc. all get the same behavior, as do human contributors.

**npm publishes AND GitHub Releases are auto-created from the same files.** The `.github/workflows/release.yml` workflow watches for new `changelog/**.md` files added in a push to `main`. For each new file:

1. `scripts/publish-npm.js` parses the frontmatter, checks `npm view @webjsdev/<pkg>@<version>`; if the version is not yet on the registry, it runs `npm publish --workspace=@webjsdev/<pkg> --access=public`. Idempotent: already-published versions are skipped.
2. `scripts/publish-release.js` composes a tag `<pkg>@<version>` (e.g. `core@0.6.0`), title `@webjsdev/<pkg> <version>`, body (the markdown after frontmatter), then runs `gh release create`. Idempotent: existing release tags are skipped.

npm runs first; if it fails (auth, network, transient registry error), the GitHub Release step is skipped and the workflow fails. After fixing, a re-run picks up where it left off: the npm-side check makes the completed package a no-op and only the missing release lands.

The workflow uses `NPM_TOKEN` (repo secret) and the auto-provisioned `GITHUB_TOKEN`. Free for public repos.

**When `server` or the scaffold consumes a NEW `@webjsdev/core` export, core MUST publish first.** `packages/server/src/dev.js` and `context.js` import core symbols statically (`setAssetUrlProvider`, `setCspNonceProvider`), and `webjs create` emits an app that imports them too. A server published against an older core dies at module load with `does not provide an export named ...`, and a cli published first makes every freshly scaffolded app 500 on every route. Two things force the right order:

1. **Give `changelog/core/<version>.md` the EARLIEST `date:` of the batch.** The publish loop sorts by that timestamp ASC, and the tie-break on equal timestamps is filename DESC, which would publish `server` BEFORE `core`. The loop is `set -e` sequential, so core-first is also the fail-safe order: if core's publish fails, nothing after it ships and no skew can reach the registry.
2. **Bump the declared range in the same release PR.** `packages/server/package.json` still declares `"@webjsdev/core": "^0.7.1"`, which every published core satisfies, so npm cannot catch the skew. Raising it to the version that actually carries the new export makes the resolver enforce the coupling permanently, independent of publish order. The scaffold cannot be range-protected (it installs `@latest`), so it relies on the ordering above.

**Update the global CLI after the publish lands.** The maintainer scaffolds and dogfoods with the globally installed `webjs` CLI, which lags a release until refreshed. So once `release.yml` has published (verify `npm view @webjsdev/cli version` matches the released version), refresh the global CLI on every manager: `npm update -g webjsdev`, `bun add -g webjsdev`, and `mise use -g npm:webjsdev@latest`. Run them AFTER the publish, never at merge time (they pull the LATEST PUBLISHED version). The `mise use` line is the one that actually moves a mise-shimmed `webjs` (a shim on PATH ahead of the npm/bun globals); verify with `mise which webjs`. This is reminded automatically by the `.claude/hooks/release-global-update.sh` PostToolUse hook, which fires when a `chore/release-*` PR merges (escape hatch `WEBJS_NO_RELEASE_GLOBAL_UPDATE=1`, regression test `test/hooks/release-global-update.test.mjs`).

---

## Dev error overlay: rich, pushed live over SSE (dev-only) (#264)

In development, three error sources push a structured error frame to the open tab over the existing live-reload SSE channel (a distinct `webjs-error` event, NOT EventSource's native `error`), and a small dev-only client renders a plain-DOM overlay without a manual reload: an SSR render crash (a page / layout throws, or the no-browser-globals walker trips), a non-erasable-TypeScript strip failure (which breaks only the CLIENT module fetch, so the page still SSRs but hydration is silently dead, the exact gap this closes), and a failed rebuild (previously only logged server-side). The overlay carries the message, the parsed `file:line:column`, a source code frame of the offending line with context, and for a TS strip the no-non-erasable hint surfaced in the UI rather than buried in a JS comment. A successful rebuild clears it (the reload also dismisses any on-screen overlay), and the current frame is replayed to a tab connecting after the breaking edit.

**A render frame is scoped to the URL that produced it (#1047).** A `render` frame carries that url, and the browser half is the single gate deciding whether a frame belongs on the page currently being viewed, so an overlay comes down when the client router navigates away and never goes up for someone else's page. Three consequences worth knowing. A speculative link PREFETCH of a throwing page reports no frame at all, so hovering a link cannot break the page you are looking at (the reported symptom: the frame fans out to every open tab over the shared SSE channel, with no navigation anywhere). A render error in one tab raises nothing in a tab viewing a different page. And a successful render of a url supersedes a retained error for that SAME url, so the replay cannot hand a recovered error to a freshly-connected tab; a good render of an unrelated page deliberately leaves it standing. `ts-strip` and `rebuild` frames carry NO url and are never scoped, because they describe a still-broken build rather than one page, so navigation leaves them alone and only the next successful rebuild clears them. The gate is order-independent: the SSE frame is pushed during the render, before the navigation response is even sent, so a frame for the page being navigated TO is held and rendered once the URL advances. A held frame renders only for the navigation it belongs to, so one that arrived while the tab sat idle is dropped rather than painted on a later visit, when the page may well render fine. An idle-time frame comes from a render this tab did not navigate for (another tab's page, a background fetch of some other url), never from a link prefetch, which reports nothing at all. Mechanism: `renderDevOverlay` + `syncDevOverlayToLocation` + `installDevOverlayNavSync` in `packages/server/src/dev-overlay.js`, wired by the dev reload client to the client router's `webjs:navigate` and `popstate` (a navigation finished) plus `webjs:before-cache` (a navigation STARTED, since the router snapshots the page it is leaving first). `packages/core` is untouched by any of it.

The overlay client uses `textContent` throughout (never `innerHTML`), so the error content cannot inject markup. It is **strictly dev-only**: `reportDevError` early-returns when `!dev`, `/__webjs/reload.js` 404s in prod, and the prod 500 stays terse (only `error.message`, never the stack or a file path), so no source leaks. An embedding host can observe the same frames via the `onDevError` option on `createRequestHandler` / `startServer`. Mechanism: `buildDevErrorFrame` in `packages/server/src/dev-error.js`, `reportDevError` + the SSE push in `packages/server/src/dev.js`, the SSR-catch hook in `packages/server/src/ssr.js`.
