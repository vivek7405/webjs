---
name: webjs-start-work
description: Use this skill when the user asks to start work on a tracked GitHub issue in the webjsdev/webjs project. Trigger phrases include "work on #112", "start work on issue 113", "tackle #114", "begin issue N", "let's work on the dist issue", "pick up #N", or any natural-language reference to starting an open issue on the webjs project board. The skill creates a feature branch off main, moves the project card to "In progress", and sets up the workspace so subsequent commits and the PR have the right shape.
when_to_use: |
  Examples that should trigger this skill:
    "work on #112"
    "start work on issue 113"
    "tackle the dist issue (#113)"
    "pick up #114"
    "let's start work on the rate-limit issue"
    "begin work on the next webjs todo"
  Do NOT trigger for: opening a PR for already-in-progress work, merging, asking what issues are open, or any non-webjs project.
  ALSO invoke this (right after webjs-file-issue) before writing ANY code for
  new work that has no issue yet, even when the user did not name an issue. The
  standing rule is: no code before a tracked issue AND a branch cut from it.
---

# Start work on a webjs GitHub issue

The webjsdev/webjs project tracks work on the GitHub Project board at https://github.com/orgs/webjsdev/projects/1. This skill runs the start-of-work lifecycle whenever the user wants to begin a tracked issue.

## Precondition: the work MUST already have a tracked issue

This skill picks up from an EXISTING issue. Before running any step below, confirm the task has one. It often does NOT: a task that arrives from a conversation, a code-review finding, a dogfood observation, or your own idea has no issue yet, and THAT is the gap this guards.

**If there is no tracked issue for this work, STOP. Do not create a branch, do not write code.** First invoke `webjs-file-issue` to file it and capture the new number, THEN run this skill with that number. Starting code on untracked work is a process failure: the PR ships with no `Closes #N`, the work never appears on the board, and the card never moves to Done. This has happened (a whole feature was implemented and merged before any issue existed, then filed retroactively only after the user noticed).

If you are unsure whether an issue already exists, search before filing:

```sh
gh issue list --repo webjsdev/webjs --search "<keywords>" --state all
gh project item-list 1 --owner webjsdev --format json --limit 20000
```

When in doubt, file it. A duplicate is cheap to close; untracked work is the expensive failure. Only once an issue number exists do you continue to Inputs below.

## Inputs

The user's request typically names an issue by number (e.g. `#112`) or by description (e.g. "the dist issue"). Resolve the number first:

- If the user said `#N` explicitly, use N.
- If they described the issue by topic, run `gh project item-list 1 --owner webjsdev --format json --limit 20000` and match against item titles. If multiple match, ask the user to disambiguate.

## Steps

1. **Verify the issue exists and is open. Assign it to vivek7405 if not already.**

   ```sh
   gh issue view <N> --repo webjsdev/webjs --json title,number,state,labels,assignees
   ```

   If `state` is CLOSED, ask the user whether to reopen it or pick a different one. Otherwise note the title for the branch slug. If `assignees` is empty (an issue filed by drive-by contributor), assign to vivek7405:

   ```sh
   gh issue edit <N> --repo webjsdev/webjs --add-assignee vivek7405
   ```

2. **Confirm the issue is on the project board.**

   ```sh
   gh project item-list 1 --owner webjsdev --format json --limit 20000 --jq ".items[] | select(.content.number == <N>)"
   ```

   If not present, add it: `gh project item-add 1 --owner webjsdev --url https://github.com/webjsdev/webjs/issues/<N>`.

3. **Verify we're on `main` with a clean tree and pull latest.** If the working tree is dirty or already on a feature branch, STOP and ask the user how to proceed. Do not silently abandon their work.

   ```sh
   git status --porcelain    # must be empty
   git branch --show-current # must be main
   git pull origin main
   ```

4. **Create the feature branch AND push it to origin immediately.** Pick the prefix from the issue labels: `enhancement` to `feat/`, `bug` to `fix/`, `documentation` to `docs/`, otherwise `chore/`. Build the slug from the issue title (lowercase, kebab-case, max 30 chars, drop conjunctions). The empty branch goes to GitHub right away so the work survives any local-machine failure even before the first commit.

   ```sh
   git checkout -b <prefix>/<slug>
   git push -u origin <prefix>/<slug>
   ```

   After this step, ALSO push after every subsequent commit (`git push` is cheap and is the safety net against losing work). Do not batch multiple commits before pushing.

5. **Move the project card from Todo to In progress.** Resolve the four IDs and call `item-edit`:

   ```sh
   N=<issue-number>
   PROJECT_ID=$(gh project view 1 --owner webjsdev --format json --jq '.id')
   ITEM_ID=$(gh project item-list 1 --owner webjsdev --format json --limit 20000 --jq ".items[] | select(.content.number == $N) | .id")
   STATUS_FIELD_ID=$(gh project field-list 1 --owner webjsdev --format json --jq '.fields[] | select(.name == "Status") | .id')
   IN_PROGRESS_OPT_ID=$(gh project field-list 1 --owner webjsdev --format json --jq '.fields[] | select(.name == "Status") | .options[] | select(.name == "In progress") | .id')
   gh project item-edit --project-id "$PROJECT_ID" --id "$ITEM_ID" --field-id "$STATUS_FIELD_ID" --single-select-option-id "$IN_PROGRESS_OPT_ID"
   ```

   The `--limit 20000` on `item-list` is load-bearing, not defensive. The board is well past 200 items and the default page is 30, so without it the `select(.content.number == $N)` filter matches nothing for almost every issue, `ITEM_ID` comes back empty, and `item-edit` fails on an empty `--id`. The same truncation makes step 2 report a card as missing when it is already on the board.

6. **Open a DRAFT PR immediately, BEFORE writing any code.** This is the single most important ordering rule and it is NOT optional: the PR is opened at the START of the work, not the end. The whole point of the PR is to be the durable, append-only record of the change AS IT HAPPENS: every per-logical-unit commit lands on it, every design-rationale / decision / follow-up context comment is posted to it the moment that discussion happens, and every self-review round is posted to it. NONE of that is possible if the PR does not exist yet, which is exactly the failure a late `gh pr create` causes. So open it now, empty branch and all (the branch was already pushed in step 4).

   Push one trivial initial commit if the branch has no commits yet (GitHub refuses a PR with no diff between head and base); the cleanest is to defer this step to immediately after the FIRST real commit, but never later than that. Open it as a DRAFT so it is clearly not yet ready to merge:

   ```sh
   gh pr create --repo webjsdev/webjs --base main --head <prefix>/<slug> --draft \
     --assignee vivek7405 \
     --title "<conventional-prefix>: <imperative summary>" \
     --body-file /tmp/pr-body.md
   # write /tmp/pr-body.md first: "Closes #<N>" plus a one-line summary of the
   # intended change. It is a living body, refined as the work lands.
   ```

   The title MUST carry a conventional-commit prefix from the first moment (feat/fix/perf/breaking appear in the changelog; chore/docs/test/refactor do not), because a single-commit PR squashes on the COMMIT subject and a multi-commit PR on the TITLE. Refine the title/body as the change takes shape; the draft is a living document. Capture the issue URL/number for `Closes #<N>` (already in the body).

   From here on, the PR exists, so: commit per logical unit and push after each (the commits stream onto the PR); post design-rationale / decision / follow-up context comments to the PR as those discussions happen (do not hoard them for the end); and run every self-review round ON the PR. The PR is marked **ready for review** (`gh pr ready <N>`) only at the very end, AFTER the Definition of done is satisfied and the self-review loop has converged to a clean round. Opening late and dumping everything at the end is the anti-pattern this step exists to kill.

7. **Report back briefly.** One short message to the user: issue title + number, new branch name, draft PR URL, "project card moved to In progress". Then continue with the actual work the user asked for.

## Definition of done (MUST be satisfied BEFORE marking the draft PR ready for review)

The PR is already open as a draft (step 6). "Done" here means the gate to flip it from draft to **ready for review** (`gh pr ready <N>`), NOT the gate to create it. Everything below must be addressed, and the self-review loop must have converged, before that flip.

**Bun parity is part of the task, not an afterthought.** webjs runs on Node 24+ AND Bun (#508). If the change touches a runtime-sensitive surface (the serializer, the node:http vs `Bun.serve` listener + request path, SSR / action / CSRF dispatch, streams, `node:crypto`, the TS stripper, auth / session / cors), then BEFORE you mark the PR ready you MUST (1) run the Bun matrix and report it green (`node scripts/run-bun-tests.js` plus the touched `test/bun/*.mjs` under `bun`), and (2) add or update a `test/bun/<feature>.mjs` cross-runtime assertion for the surface. This is enforced: `.claude/hooks/require-bun-parity-with-runtime-src.sh` BLOCKS a commit that stages runtime-sensitive source with no `test/bun/**` test (escape hatch `WEBJS_BUN_VERIFIED=1` only when an existing Bun script already covers it AND you ran it). Treat the parity, not just the Node result, as the bar.

Doc drift is the #1 way a framework rots. Documentation MUST stay in sync with code on the same PR that changes the code. Do NOT defer doc work to a follow-up issue, do NOT let the user have to ask. Before marking the draft PR ready for review, walk through every surface below and either update it OR write "N/A because <reason>" in the PR body so the omission is visible.

### Surfaces to consider on EVERY PR

1. **Tests, ALL applicable layers (not just unit).** This is generative, not "write a unit test and move on". The repo has several test layers; for the changed surface, add or update coverage in EVERY layer the change can affect, then RUN that layer. Walk them explicitly:
   - **Unit** (`packages/*/test/**`, `test/**`): pure logic, analysers, helpers. Include counterfactuals (the negative case that proves the check actually fires).

     **Running a counterfactual safely (commit FIRST, revert through git, never sed-toggle source).** A counterfactual proves a test fails when the fix is removed. The safe order is: COMMIT the fix and its test first, THEN temporarily revert ONLY the source guard, run the test (expect red), and restore. Two traps that have bitten this exact flow, both avoidable:
       - **Do NOT `git checkout <file>` to "undo" a counterfactual while the fix is still uncommitted.** `git checkout` restores the file to HEAD, which (pre-commit) has NO fix, so it silently throws the whole fix away, not just the temporary neutering. Commit first; then `git checkout <file>` restores the COMMITTED fix, which is what you want.
       - **Do NOT neuter a guard by `sed`-rewriting the source to a sentinel like `''`.** Shell-quoted escapes land as a literal control byte (a NUL/0x01) inside the file, which renders like a space in an editor but breaks the comparison and makes `grep` treat the file as binary (silent empty matches). Verify any byte-level edit with `od -c` on the changed line and `tr -d '\000' | wc -c` for stray NULs. Prefer the Edit tool (toggle the guard, run, toggle back) or `git stash`/`git stash pop` of the committed source over `sed` for this.
     The clean loop: commit fix+test, run test green, `git stash push -- <source-file>` (or Edit out the guard), run test red, `git stash pop` (or Edit the guard back), run test green again. The test having gone red in the middle is the proof.
   - **Integration** (server-level through `createRequestHandler`, SSR pipeline, scaffolds): behaviour across modules without a browser.
   - **Browser** (`*/test/**/browser/*.test.js`, run via `npm run test:browser` / `wtr`): anything touching hydration, client render, DOM, slots, the client router, custom-element upgrade.
   - **E2E** (`test/e2e/e2e.test.mjs`, run via `WEBJS_E2E=1`): full-stack behaviour observable only in a real browser against the running blog example, including **network probes** (was a module fetched or not), navigation, and streaming.
   - **Smoke** (`test/examples/*/smoke/*`): the example apps still boot and serve their key routes.
   - **Cross-runtime (Bun)** (`node scripts/run-bun-tests.js`, needs `bun` on PATH; the `test/bun/*.mjs` scripts run under both runtimes): webjs runs on **Node 24+ OR Bun** (#508), so a change to runtime-sensitive code MUST be proven on Bun, not just Node. "Runtime-sensitive" = the serializer (Blob/File/FormData/typed arrays), the server request/listener path (the node:http vs `Bun.serve` shells, SSE, WebSocket upgrade, compression, timeouts), streams + `node:fs` (anything using `Readable.fromWeb` / `pipeline` / `createWriteStream`), `node:crypto`, the TS stripper, `AsyncLocalStorage`, or ANY `node:*` API whose behaviour Bun may implement differently. The Bun matrix (`scripts/run-bun-tests.js`) re-runs the `node:test` suite under `bun test` and FAILS on a genuine divergence; a divergence is a REAL bug to fix in the framework (this session found 5: a FormData fresh-identity serializer crash, a `Readable.fromWeb` `put()` hang, the amaro vs Node TS-strip error code, a JSC vs V8 error-message format, a link-unsafe `node:module` named import), not something to skip. Add a `test/bun/<feature>.mjs` cross-runtime assert script (wired into the CI `bun` job) for any new surface that touches the listener / serializer / streaming path. A test that is legitimately Node-only (asserts a node:http internal, the built-in stripper, `module.registerHooks` seeding, the node `ws`-library subsystem) goes on the runner's documented `DENYLIST` with a reason and a note of where the Bun behaviour IS covered; if a file MIXES runtime-agnostic and Node-only tests, SPLIT the Node-only ones into their own file so the rest still runs on Bun. See the skill's `references/testing.md`.

   **Run the slow layers ONCE, at the end. Never inside the review loop.** The layers below cost minutes each (e2e ~4 min, the full Node suite ~5 min, the Bun matrix and the browser suite similar), so running them per review round burns most of a session on repeated work that cannot have changed. The correct order is: fast layers during the loop, slow layers once after the LAST clean round, and only for the layers the change can actually affect. See "Cost discipline in the loop" under the self-review loop below for the full rule.

   Also: **CI runs the browser, e2e (Node AND Bun), Bun-matrix, four-app, Postgres, Docker and Build jobs on every PR**, so a local run is fast feedback, not the gate. Only five of those are REQUIRED by branch protection though, and the Bun ones are not among them (see "Prefer CI over a local slow run" below for the exact list and what it means for Bun parity). Do NOT run a slow suite locally to "confirm" something CI is about to check anyway, unless you need the failure detail sooner than CI can give it.

   The trap: **`npm test` does NOT run the browser, e2e, or Bun layers** (browser needs `wtr`; e2e is gated behind `WEBJS_E2E=1`; the Bun matrix is a separate `node scripts/run-bun-tests.js` and runs only the Node path otherwise). A green `npm test` is necessary but NOT sufficient. If the change can affect client behaviour or the served wire, you MUST run `npm run test:browser` and/or `WEBJS_E2E=1 node --test test/e2e/e2e.test.mjs`; if it touches runtime-sensitive code (above), you MUST run `node scripts/run-bun-tests.js` (with `bun` installed) and the `test/bun/*.mjs` scripts under Bun, then report the result. Reasoning "the unit tests pass" while shipping a change that alters what the browser downloads, OR that diverges on Bun, is the exact failure this rule exists to prevent.

   Acceptance criteria phrased in browser terms ("network probe", "renders without JS", "hydrates", "no console errors") are a hard signal that an e2e or browser test is REQUIRED, not optional. For each layer, either add/update coverage and run it, or write "N/A because <reason>" in the PR body. If a pre-existing test in a layer you ran is already red on `main`, say so explicitly (with proof) rather than letting it look like your regression.
2. **Every markdown file in the repo** that describes the changed surface. The rule is generative, not enumerative. Run `git ls-files '*.md'` and for each path ask: does this file describe behaviour, surface, or invariants this PR changed? If yes, update it on this PR. Common surfaces (non-exhaustive, this list is NOT a substitute for the git query):
   - `AGENTS.md` (framework root + every nested one under `packages/*/`, `docs/`, `website/`, `examples/*/`, `packages/ui/packages/*/`).
   - the skill's `references/*.md` (routing-and-pages, components, data-and-actions, auth-and-sessions, styling, client-router-and-streaming, optimistic-ui, typescript, testing, built-ins, runtime, service-worker, muscle-memory-gotchas), plus repo-root `framework-dev.md`.
   - `packages/*/README.md` (npm-visible for every published package). Update when the public surface, install layout, or expected usage changed.
   - `CHANGELOG.md` (per-package, under `changelog/<pkg>/<version>.md`). Generated automatically by the pre-commit hook on version-bump commits; review and add migration notes for breaking changes. Without a version bump, no changelog entry.
   - `CLAUDE.md` (only if a Claude Code rule is specifically added; framework conventions go in AGENTS.md).
   - `.github/*.md` (issue templates, PR templates, contributing) when a workflow rule shifts.
3. **User-facing docs site** under `website/app/docs/<topic>/page.ts` (these are `.ts` files, not markdown, so they're excluded by the markdown query but they're the canonical user-facing reference). If the change is visible to a user reading the docs site, update the matching topic page. Add a new page if the surface is new and there's no obvious home.
4. **Scaffold templates** under `packages/cli/templates/` and the generators `packages/cli/lib/{create,api-gallery}.js`. Update if the change affects what `webjs create` generates. The scaffold ships a gallery index home + layout + db wiring, a densely-commented feature gallery (`packages/cli/templates/gallery/**`, demos under `app/features/` plus `app/examples/todo`) and the api showcase (`api-gallery.js`), plus one cross-agent skill at `.agents/skills/webjs/` (SKILL.md + references) that the agent grows in place; there are no per-agent rule files. A feature change that agents should know about lands in the skill; a generated-code change lands in the generators, verified with `generate + boot + webjs check`.
5. **The MCP server** (the standalone `@webjsdev/mcp` package, `packages/mcp/src/{mcp,mcp-docs,mcp-source}.js`, extracted from the CLI in #415; `webjs mcp` and `npx @webjsdev/mcp` both run it). The MCP is how AI agents learn and introspect webjs, so it must stay in lockstep with the surfaces it exposes. Update it whenever the change touches what it serves:
   - **Introspection tools** (`list_routes` / `list_actions` / `list_components` / `check`): if you change the route table shape, the action/RPC-hash scheme, component registration, or a `webjs check` rule, update the matching tool projection so the MCP reports reality.
   - **Knowledge layer** (resources + `init` + `docs` + prompts): the resources are the skill at `.agents/skills/webjs/` (SKILL.md + references/) + `AGENTS.md`, so a docs change is picked up automatically (it is bundled at `prepack`). But if you add or rename a skill reference file, ADD A NEW INVARIANT, change the execution model, or add an authoring concept an agent should know, also: (a) confirm the `init` primer still pulls the right `AGENTS.md` sections (it sources the Execution-model + Invariants headings, so a heading rename breaks it), and (b) add a guided-workflow PROMPT for any new common recipe (a new page/route/action/component-shaped task). New recipes without a prompt are a silent gap.
   - **Heuristic:** if your change would make an agent reading only the old MCP output write WRONG webjs code, the MCP is part of your change. Update it on this PR, with a test in `packages/mcp/test/*.test.mjs`, or write "N/A because <reason>" in the PR body.
6. **The editor plugins** (epic #381, now under `packages/editors/` after the #402 reorg; the suite overview that maps all three + the full dev/publish flow is `packages/editors/AGENTS.md`): the all-in-one `webjs` VS Code extension (`packages/editors/vscode`), `webjs.nvim` (`packages/editors/nvim`), and the shared language service `@webjsdev/intellisense` (`packages/editors/intellisense`, renamed from `@webjsdev/ts-plugin` in #416/#420) that BOTH editor plugins bundle. Note `webjs.nvim` is developed here but installed by users from a SEPARATE repo `webjsdev/webjs.nvim` (a git-subtree split of `packages/editors/nvim`), so nvim changes are not live until that split is re-pushed on release (`packages/editors/nvim/PUBLISHING.md`). They are how a developer's editor understands webjs, so they must stay in lockstep with the surfaces they expose. Update them whenever the change touches what they project. Do this automatically when the task demands it; never make the user ask:
   - **The shared language service** (`packages/editors/intellisense/src`): any change to its behaviour (the template parser, tag/attr resolution, completions, diagnostics, hover) flows to EVERY consumer. **This is the single most-missed step, and it reds CI:** both editor plugins **bundle** a copy. The VS Code extension esbuilds it at vsix package time (`packages/editors/vscode/scripts/build.mjs`, picked up automatically), but webjs.nvim ships a COMMITTED verbatim copy that a drift test enforces. So after ANY edit under `packages/editors/intellisense/src/` (even one line) you MUST, before pushing, run `node packages/editors/nvim/scripts/vendor-intellisense.mjs` then `git add -f packages/editors/nvim/vendor` (the copy is under a gitignored `node_modules/`), or the `packages/editors/nvim/test/vendor-sync.test.mjs` drift guard FAILS the "Unit + integration" CI job ("vendored intellisense src is byte-identical ..."). Confirm with `node --test packages/editors/nvim/test/vendor-sync.test.mjs`. The coupling is bidirectional: the nvim copy under `packages/editors/nvim/vendor/node_modules/@webjsdev/intellisense/` is GENERATED, so NEVER hand-edit it when working in the nvim package (edit `intellisense/src` + re-vendor instead); the same drift guard reds CI either way. The scaffold ALSO pins `@webjsdev/intellisense` in app node_modules + tsconfig (intelligence with no editor plugin; tsserver dedupes when both load), so an intellisense version bump is a real publish. (Full flow also in `packages/editors/intellisense/AGENTS.md`.)
   - **Template grammars / injection queries** (`packages/editors/vscode/syntaxes/webjs-{html,css,svg}.json` AND `packages/editors/nvim/queries/{typescript,javascript}/injections.scm`): if you add, rename, or change the recognised tags (`html`/`css`/`svg`) or how `${...}` holes are scoped, update BOTH the VS Code TextMate grammars and the Neovim treesitter queries, plus their tests (`packages/editors/vscode/test/extension.test.mjs` begin-patterns, `packages/editors/nvim/test/selftest.lua` injection assertions).
   - **Snippets + commands** (`packages/editors/vscode/snippets/webjs.json`, `src/extension.js`; webjs.nvim `lua/webjs/` commands): if you add or rename a common recipe or a surfaced command, add/adjust the matching snippet/command (the vscode test cross-checks contributed commands against `registerCommand`).
   - **Publishing on a release.** The VS Code extension publishes to the VS Marketplace + Open VSX (`packages/editors/vscode/PUBLISHING.md`); webjs.nvim is a git subtree split mirrored to `webjsdev/webjs.nvim` (re-run the split + force-push after a change; `packages/editors/nvim/PUBLISHING.md`). Bump `packages/editors/vscode/package.json` `version` when its bundle changes.
   - **Heuristic:** if your change would make an editor highlight wrong, resolve the wrong definition, offer a stale snippet/command, or ship a drifted bundle, the editor plugins are part of your change. Update them on the same PR (with the matching test), re-vendor the nvim copy, or write "N/A because <reason>" in the PR body.
7. **Marketing copy** at `website/app/page.ts`. Update if the change touches positioning or any landing-page claim ("no-build", "AI-first", "web components first", etc.).
8. **Dogfood apps must still build and boot. MANDATORY GATE, run it automatically, never wait to be asked.** The framework ships four in-repo apps that consume it: `examples/blog` (the demo), `website` (the marketing pages plus /docs and /ui), and the redirect-only `docs` and `packages/ui/packages/website` hosts. A framework change that compiles is NOT done until they all still serve. This is a recurring miss: running only the blog e2e and stopping is the exact failure this gate exists to prevent. For ANY change to `packages/core`, `packages/server`, `packages/cli`, the dist build, the importmap, or anything that alters what the browser fetches, you MUST run the full four-app check below before marking the draft PR ready for review and report its result in the PR body. The user should never have to ask "did you check the apps?".

   **The check (copy-paste, runs in seconds):**
   - `examples/blog`: covered by the e2e suite. Run `WEBJS_E2E=1 node --test test/e2e/e2e.test.mjs` (it exercises the blog in a real browser; if `dist/` is built it runs in dist mode, so it covers the production wire too).
   - `website`: boot it through `createRequestHandler` in PROD mode and GET a real route, asserting status < 400. It is the app that serves every HTML surface the project has, the marketing pages plus the documentation at `/docs` (#1098) and the component gallery at `/ui` (#1099), so its routes are where a break shows up. `docs/` and `packages/ui/packages/website/` are redirect-only hosts whose every route is an empty 301: they pass a status check vacuously, so probe their MAPPINGS via `test/docs/docs-host-redirect.test.mjs` and `test/ui/ui-host-redirect.test.mjs` instead of booting them here. Write this harness to a file INSIDE the repo (bare `@webjsdev/*` specifiers only resolve from the repo's `node_modules`, NOT from `/tmp`), run it, delete it:

     ```js
     // ./.boot-check.mjs  (write at repo root, run `node ./.boot-check.mjs`, then rm)
     import { createRequestHandler } from '@webjsdev/server';
     import { resolve } from 'node:path';
     const apps = [
       // /ui/button is the heaviest page: it pulls the mirrored kit component
       // sources, the exact import class a broken preload shows up in.
       { name: 'website', dir: 'website', routes: ['/', '/docs/<a-page-you-touched>', '/ui', '/ui/button'] },
     ];
     let fail = false;
     for (const app of apps) {
       try {
         const h = await createRequestHandler({ appDir: resolve(app.dir), dev: false });
         if (h.warmup) await h.warmup();
         for (const r of app.routes) {
           const resp = await h.handle(new Request('http://localhost' + r));
           const html = resp.status < 400 ? await resp.text() : '';
           // Every modulepreload hint must resolve: a preload pointing at a
           // 404 is a real bug (the preload set must be a subset of the
           // servable set). Probe each same-origin href through the SAME
           // in-process handler (method-agnostic, so no GET-vs-HEAD trap).
           const preloads = [...html.matchAll(/<link[^>]+rel=["']modulepreload["'][^>]*href=["']([^"']+)["']/g)].map((m) => m[1]).filter((h) => h.startsWith('/'));
           const broken = [];
           for (const p of preloads) { const pr = await h.handle(new Request('http://localhost' + p)); if (pr.status >= 400) broken.push(`${p}->${pr.status}`); }
           const ok = resp.status < 400 && broken.length === 0;
           console.log(`${ok ? 'OK  ' : 'FAIL'} ${app.name} ${r} -> ${resp.status}, preloads=${preloads.length}, broken=[${broken.join(', ')}]`);
           if (!ok) fail = true;
         }
       } catch (e) { console.log(`FAIL ${app.name} boot threw: ${String(e.message).split('\n')[0]}`); fail = true; }
     }
     process.exit(fail ? 1 : 0);
     ```

     Add `GET` routes for any page you edited (a 307/308 redirect is a pass; it has no body to inspect). If a change is browser-wire-affecting (dist build, importmap, core exports), also assert the served `<script type="importmap">` reflects the change (e.g. grep the response HTML for the expected URLs), since a 200 alone does not prove the right modules were wired. The harness above also asserts no `modulepreload` hint 404s, which is how the #158 / #159 class of bug (a preload pointing at a server-only or phantom file the auth gate refuses to serve) gets caught automatically. **Auditing a LIVE deployed app instead of an in-process handler? Probe each preload URL with GET, never HEAD: the dev/prod server only serves source files on GET, so a HEAD probe 404s every source URL and makes a healthy app look completely broken.**
   - The scaffold: `webjs create` generates an app whose `package.json` pins `@webjsdev/*: 'latest'` (see `packages/cli/lib/create.js`). If the change alters generated code, agent-config files, or expected scaffold behaviour, update `packages/cli/templates/` AND the generators in `packages/cli/lib/`, then confirm a freshly scaffolded app passes `webjs check` and `webjs test` (the `test/scaffolds/` suite covers this; run it). Even when you believe no scaffold change is needed, grep `packages/cli/templates/` for anything the change renamed or removed (e.g. a dropped dist filename, a changed import path) so a stale template reference does not ship into every new app.

   Report the dogfood result in the PR body (e.g. "Dogfood: blog e2e 50/50; website boots 200 on /, /docs/*, /ui, /ui/button in dist mode with no broken preloads; redirect hosts covered by their mapping tests; scaffold N/A"). "All apps verified" with no evidence is not acceptable.
9. **Version bumps must keep the workspace consistent.** When you bump a `packages/<pkg>/package.json` `version` (which the pre-commit hook turns into a changelog):
   - Every in-repo dependent that pins that package (grep `"@webjsdev/<pkg>"` across all `package.json` files) must have its range updated so the new version still satisfies it. A minor bump (`0.7.x` -> `0.8.0`) falls outside a `^0.7.0` range, so npm stops linking the local workspace and pulls the published copy instead.
   - Regenerate `package-lock.json` (`npm install --package-lock-only`) and commit it. `npm ci` (which CI runs) fails on any lockfile desync, so an unsynced lock is a guaranteed red CI.
   - Prefer a patch bump for a feature/fix when the repo keeps a package in a single minor line (check whether dependents pin `^0.x.0`); reach for a minor bump only when you are also ready to bump every dependent range.
10. **PR body** itself documents the change for reviewers. Include `Closes #<N>`, a short summary, and a test plan checklist.

### How to use the checklist

For each item above, explicitly answer one of:
- **Updated**, with the file path in the commit/PR body.
- **N/A because**, with a one-sentence reason.

The "every markdown file" rule is generative because new markdown files appear over a project's lifetime. A closed enumeration silently excludes them; the git query is the source of truth.

If you find yourself writing "N/A" for every item except tests, that is a smell. Most user-visible code changes touch at least one markdown file and the relevant `website/app/docs/<topic>/page.ts` page.

### Concrete examples from recent PRs

- PR #110 (`fs.watch` + Web Crypto): updated `AGENTS.md` (no-build claim wording), `packages/server/AGENTS.md` (file watcher mention), `website/app/docs/{configuration,deployment,no-build}/page.ts` (chokidar → fs.watch). Tests covered the watcher, the boundary, and the migration.
- PR #111 (module-graph asset gate): updated `AGENTS.md` (new invariant about the gate), `packages/server/AGENTS.md` (gate + guardrail invariants), `website/app/docs/no-build/page.ts` (new "authorisation gate" subsection). Tests covered the gate end-to-end.
- PR #117 (core dist bundles): updated `website/app/docs/no-build/page.ts` (the @webjsdev/core exception note), `packages/core/README.md` (tarball layout), `packages/core/AGENTS.md` (invariant 1 rewording), `packages/server/AGENTS.md` (importmap.js module-map entry).

If a PR ships without ANY of those touches and the change is user-visible, the PR is incomplete; do not mark it ready for review (leave it draft until the surfaces are addressed).

## Anatomy of a complete PR: four things, always

A finished PR is not just a diff. It carries four artifacts, and the PR is considered incomplete until all four exist. Treat this as the standing definition of a complete PR, applied automatically on every one:

1. **A meaningful, conventional-commit-prefixed title.** The title MUST start with a conventional-commit type so the changelog is generated automatically: `feat:` for a new user-facing capability, `fix:` for a bug fix, `perf:` for a performance improvement, `breaking:` (or a `!` like `feat!:`) for a breaking change, and `chore:` / `docs:` / `test:` / `refactor:` for changes that should NOT appear in the changelog. After the prefix, be imperative, specific, what-and-why, under ~72 chars total. Example: `fix: shared rich values round-trip through the RPC serializer`, not `Fix serializer` or the issue number alone.
   **Why this matters (do not skip it):** PRs are squash-merged, so the PR TITLE becomes the squash commit subject on `main`, and `scripts/backfill-changelog.js` (run by the pre-commit hook on a version bump) extracts changelog entries by matching that subject against `^(feat|fix|breaking|perf)(scope)?!?:` and reads the commit BODY (the PR description) for the entry text. A non-prefixed title (e.g. `De-flake the prefetch e2e...`) produces ZERO changelog entries, which forces a hand-written changelog at release time, which is wrong. NEVER hand-write `changelog/<pkg>/<version>.md`: fix the PR title/body instead so the automation produces it. If you ever find yourself about to hand-write a changelog, stop and correct the merged PR titles (or the release's source commits) so they are conventional-commit prefixed.
2. **A meaningful body.** `Closes #<N>` near the top, a summary, what changed and why, the deliberately-excluded decisions, a test plan, and the docs surfaces touched (per the Definition of done above). This is the architectural narrative of the change. Because the squash commit body IS this PR description, write the first paragraph so it reads as the changelog entry text (the generator uses it), then continue with the rest.
3. **Context comments.** The reasoning from the working conversation that the diff and body do not capture, posted on the PR as the discussion happens (see "Capture significant design discussion as PR comments" below). The PR is the durable memory; the chat transcript is not.
4. **Review comments: a summary AND per-code-line comments.** Every review (each self-review round and any manual review) posts a summary review plus an inline comment on each finding's `file:line` (see "Every PR review is posted ON the PR" below).

All four are written in the owner's voice (first person, plain, no AI/agent framing, no machinery tells) and free of AGENTS.md invariant 11 banned glyphs. The sections below specify the mechanics for items 3 and 4.

**Header every standalone comment with a short, meaningful bold heading** so a future reader (human or AI) knows what the comment is and what it is about before reading it. Put the heading on its own first line as bold markdown, blank line, then the body. Write the heading to fit THIS comment, do not pick from a fixed list. A good heading names the kind of comment and its topic, e.g. `**Design rationale: why analysis moved off boot, and what it costs**`, `**Review: lazy-boot model holds, one real bug**`, `**Decision: kept the derived gate over a declared allowlist**`, `**Follow-up: aliased-expose 404 filed as #N**`. A bare category word like `Context` or `Review` is the floor, not the goal; prefer a heading that also says the subject, so a reader scanning the PR's comment list can tell the boot-rationale note from the elision-review note without opening either. **Per-line inline review comments do NOT need a heading** because their `file:line` anchor already classifies them as review; keep those terse. The heading rule is for standalone, top-level comments (the PR body in item 2 is exempt, since it has its own `## Summary` structure).

## Pre-merge self-review loop (MUST run before reporting "ready for merge")

Saying "ready for merge" before the review loop completes is the single biggest source of low-quality PRs. The recurring pattern to AVOID: claim ready-for-merge, the user requests a review, find issues, fix them, claim ready-for-merge again, repeat 4-5 cycles before a review comes back clean. The cure is to run that loop internally BEFORE the first "ready" signal. The user should only hear "ready to merge" after the loop has converged.

### Every PR review is posted ON the PR (summary + per-line comments)

This applies to EVERY review of a PR: each round of the self-review loop below, AND any time the user asks you to "review the PR" manually. A review that lives only in your chat reply is not a review the PR carries. For every review you perform, post BOTH:

1. **A summary review comment** stating what you reviewed and the overall outcome (which surface, what you found, or that it is clean). This is what you leave at the "Finish your review" step.
2. **A per-line inline comment for each finding**, anchored at `file:line` on the diff. Each states the PROBLEM only, the way a reviewer flags it before anyone has fixed it. Do NOT bake the resolution into the finding (ending a finding with "...Fixed." is wrong). The resolution is recorded separately, as a threaded reply, in the programmer half below. Post the won't-fix and false-positive findings as inline comments too, so the concern sits on the exact line; their reply carries the reason they are left as is.

**Both go in ONE review object, via the reviews API, never as plain issue comments.** The summary and all its inline comments are submitted together with a single `POST /pulls/<N>/reviews` (the `--input review.json` call below). That is what makes GitHub render them as a grouped unit: the summary plus a `reviewed these changes - N comments` trail of the per-line comments beneath it. A review observation posted with `gh pr comment` (an issue comment) instead lands as a standalone box with NO trail, visually identical to a general comment, and disconnected from its inline notes. So: review content (summaries AND observations, every round) goes through the reviews API; `gh pr comment` issue comments are reserved for NON-review context (the design-rationale, decision, and follow-up notes from the section further down). Do not scatter review remarks across loose issue comments. If you catch yourself about to `gh pr comment` something that is really a review observation, fold it into the review summary instead. (Note: GitHub's mobile app tints every comment you author a light blue because of the `Author`/`Member` badge; that tint is author-association, NOT a review marker, so it is not a reliable signal. The reliable signal that something is a review is the `reviewed these changes` trail, which only a review object has.)

**Voice: write every PR comment as the repo owner (vivek7405) would write it.** First person, plain, the way a person reviews code. The whole review trail (summary AND inline comments) must read as if the owner typed it, not as a bot reporting a procedure. This is non-negotiable and applies to every PR review, forever, not just the one in front of you.

Hard rules:

- **No AI/agent framing.** Never refer to yourself as an AI or agent, never say "self-review", never number the rounds ("Round 2", "round 3 of the loop"), never say "you requested a manual re-review" or otherwise narrate the review process.
- **No machinery tells.** A human reviewer does NOT mention CI status ("CI is green", "all 5 gates pass"), test counts ("96 tests pass"), or meta-scaffolding ("Went over the X, Y, Z paths. Comments inline."). CI state lives in the checks UI, not in prose; the inline comments are obviously inline. Drop all of it.
- **Inline findings are terse and state the problem, not the fix.** Point at what is wrong on that line, the way a reviewer flags it. "`expose as exp` won't match this, so the route 404s." / "Says it scans on boot, but this is lazy now." / "A same-mtime, same-size recreate could still serve a stale parse, does that need handling?" The fix and won't-fix reasons go in the threaded reply, never in the finding itself.
- **Reference commits as clickable links, not bare SHAs.** GitHub does NOT auto-link a SHA inside a backtick code span, so `` `5fd02dc` `` renders as dead text. Always write a markdown link: `[`5fd02dc`](https://github.com/webjsdev/webjs/commit/5fd02dc)` (the short SHA resolves fine in the URL). Same for any commit referenced in a summary, reply, or context comment, e.g. "Fixed in [`<sha>`](https://github.com/webjsdev/webjs/commit/<sha>).". A reviewer wants to click straight to the diff.
- **The summary may go broad.** Because the per-line comments carry the specifics, the summary is the place for an opinionated, architecture-level take: what the change does well, what you would keep an eye on, the one thing that actually matters. Still first person and plain, just not restricted to pointing at one line. Think of how you would brief a teammate on the PR in three or four sentences.

The test for any comment: if it reads like a person who owns this repo wrote it offhand, it passes. If it reads like a status report or a tool's output, rewrite it.

### Follow the real review flow: reviewer, then programmer, both roles

GitHub's manual flow is: **Start a review**, add inline comments, **Finish your review**, leave a summary, **Submit review**. Then the author **fixes** each comment, **replies in the thread** that it is fixed, and **resolves** the thread. The reviewer and the programmer are the same person here, but that does NOT collapse the two roles into one comment. Reproduce the whole flow over the API every time, both halves.

**Reviewer half (one review object).** Submit the summary plus all inline findings together with a single `POST /pulls/<N>/reviews`. That one call is Start-review + add-comments + Finish + Submit. Findings state the problem, not the fix.

```sh
gh api -X POST repos/webjsdev/webjs/pulls/<N>/reviews --input review.json
# review.json: { "commit_id": "<head-sha>", "event": "COMMENT",
#   "body": "<summary>",
#   "comments": [ { "path": "<file>", "line": <n>, "side": "RIGHT", "body": "<the problem, no fix>" } ] }
```

Use `event: "COMMENT"` (GitHub forbids APPROVE / REQUEST_CHANGES on your own PR). Each inline `line` must be a line that is in the PR diff (a changed or added line), or the API rejects the whole review; if a finding sits on an unchanged line outside the diff, note it path-level in the summary. Verify with `gh api repos/webjsdev/webjs/pulls/<N>/comments`.

**Programmer half (after the review is submitted).** For each finding:

1. **Fix it** on the branch (commit + push), or decide it is a won't-fix.
2. **Reply in the comment's thread** with the resolution. This is the "reply that it is fixed" step, not an edit of the finding:
   ```sh
   gh api -X POST repos/webjsdev/webjs/pulls/<N>/comments/<comment_id>/replies \
     --input reply.json   # reply.json: { "body": "Fixed in [`<sha>`](https://github.com/webjsdev/webjs/commit/<sha>)." }
   ```
3. **Resolve the thread** once it is concluded (fixed, or won't-fix-with-reason). Threads resolve ONLY via GraphQL `resolveReviewThread`; REST cannot do it:
   ```sh
   # list unresolved review-thread node IDs
   gh api graphql -f query='query{repository(owner:"webjsdev",name:"webjs"){pullRequest(number:<N>){reviewThreads(first:50){nodes{id isResolved}}}}}' \
     --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | .id'
   # resolve one
   gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -f t=<threadId>
   ```

**Every round repeats the whole flow.** Each round of the self-review loop, and each manual re-review the user asks for, is a NEW review object: a fresh `POST /pulls/<N>/reviews` carrying that round's summary and findings, followed by fix + reply + resolve for that round's threads. Never append a later round's findings into an earlier round's review, and never edit a prior finding to say it is fixed (reply instead). A round that finds nothing still posts a short summary review saying it is clean, with no inline comments.

Banned prose glyphs (AGENTS.md invariant 11) apply to every comment, reply, and summary body, so keep them clean.

### Capture significant design discussion as PR comments (standing, automatic)

Beyond review findings, proactively record the *reasoning* behind a PR as comments on it, without being asked. The PR is the durable memory a future reader (an AI agent picking the work back up, or the owner months later) consults to understand WHY the code is the way it is. The git diff shows WHAT changed; the conversation that produced it (tradeoffs weighed, alternatives rejected, constraints discovered, "we chose X over Y because Z") is lost unless it is written onto the PR. The chat transcript is not durable PR context; the PR comment is.

**Trigger (automatic, not on request):** whenever a conversation about an open PR produces a non-obvious design decision, a rejected alternative, a tradeoff accepted with eyes open, or context the diff alone does not explain, post it as a PR comment AS THE DISCUSSION HAPPENS. Use `gh pr comment <N> --body-file /tmp/pr-comment.md` for cross-cutting narrative, or an inline `file:line` comment when it pertains to specific code. Same voice as review comments: first person, plain, owner's voice, no AI/agent framing, no machinery tells, no banned glyphs.

**This runs continuously across the PR's whole life, not once.** Because the PR opens as a draft at the START (step 6), there is a place to post from the first commit onward, so keep adding context throughout: when a mid-work investigation changes the approach, when a reviewer finding is resolved a particular way, when an edge case is discovered, when something is deliberately deferred. The acceptance test is concrete: a future AI agent (or the owner) who opens ONLY this PR, with zero access to this chat, should find every non-obvious "why" already written on it. If reconstructing the reasoning would require the chat transcript, a context comment is missing. Do not save it all for a single end-of-work dump; that recreates the exact gap the early-draft-PR rule exists to close.

**What's worth capturing (judgement, not a checklist):** why an approach won over a credible alternative; an experiment tried and reverted, with the reason; a tradeoff accepted knowingly (a cold-start cost, a known-small race window left in, a documented edge case); a constraint or invariant discovered mid-work; anything you would want explained if you returned to the PR with no memory of the conversation. Skip the trivial: routine fixes, mechanical edits, anything the diff already makes obvious. The bar is "would a future agent be missing important context without this", not "log everything". When the PR body already covers a decision, a short comment is fine or skip it; do not duplicate the whole body into a comment.

### Cost discipline in the loop (read before the first round)

A review round is a READING pass, not a test run. The reviewer subagent reads the diff and the files; it does not execute suites. So a round costs seconds of wall clock, and the loop stays cheap **only if you do not attach a slow test run to each round**.

**During the loop, run ONLY the fast layers:**
- the specific unit test files covering the code you touched (`node --test <paths>`), and
- targeted probe scripts when you need to confirm real behaviour rather than infer it.

**Do NOT run, at any point inside the loop:** the e2e suite (`WEBJS_E2E=1 …`, ~4 min), the full Node suite (`node scripts/run-node-tests.js`, ~5 min), the browser suite (`npm run test:browser`), the Bun matrix (`node scripts/run-bun-tests.js`), or the four-app dogfood boot check. A finding fixed in round 2 cannot change what the e2e did in round 1 in any way you could act on before the loop ends, so running them per round is pure repetition.

**After the LAST clean round, run the slow layers exactly once**, and only the ones the change can affect (a pure-prose docs change needs none; a renderer change needs browser and e2e; a listener/serializer change needs Bun). Report those results in the PR body.

**Prefer CI over a local slow run, but know exactly what CI gates.** Only FIVE checks are required by `main` branch protection: `Conventions (webjs check)`, `Unit + integration (node --test)`, `Browser (web-test-runner / Playwright)`, `E2E (Puppeteer against the blog example)`, and `Build (@webjsdev/core dist)`. Those five you can safely leave to CI: push, `gh pr ready <N>`, then `gh pr checks <N>` (add `--watch --interval 30` to block until they settle), and re-run locally only when you need the failure detail sooner.

The other jobs (`Bun runtime smoke + test matrix`, `E2E (blog served on Bun)`, `In-repo app tests`, `Postgres prod-engine round-trip`, `Docker image build`) DO run on every PR but are NOT required, so a red one does not block the merge button. Verify the list rather than trusting this paragraph, since protection changes: `gh api repos/webjsdev/webjs/branches/main/protection --jq '.required_status_checks.contexts'`. Consequence that matters: **Bun parity is not enforced by the merge gate.** When the change touches runtime-sensitive code, read the Bun job's result explicitly (or run it locally) before merging; do not assume a green merge button means Bun passed.

**Never BLOCK on CI between rounds.** Pushing is fire-and-forget: push, then immediately start the next review round while the jobs run. Do NOT sit on `gh pr checks --watch` between rounds, and do NOT pause the loop "until CI comes back". CI takes minutes, a round takes seconds, and a round that finds something means another push anyway, which supersedes the run you were waiting on. Read CI EXACTLY ONCE, after the last clean round, with a plain `gh pr checks <N>` (no `--watch`); only if something is still pending at that point is `--watch` appropriate. Waiting on a CI run that a later commit will invalidate is the same waste as re-running e2e per round.

**Baseline comparisons are worth it once, never repeatedly.** When a suite has pre-existing failures, comparing the failure SET against an `origin/main` worktree is the only way to tell a regression from ambient breakage, and it is worth the one run. Doing it again after each fix is not: re-diff only if a NEW failure name appears.

If you catch yourself starting a multi-minute suite while the loop is still finding things, stop. That is the exact waste this section exists to prevent.

### How the loop works

The draft PR is already open (step 6), so reviews post to it from the first round. Do NOT mark it ready for review or report "ready for merge" yet. Run rounds of self-review until ONE round finds zero new issues. Each round must:

1. **Spawn a fresh general-purpose subagent** (use the Agent tool with `subagent_type: "general-purpose"`). A fresh subagent has no prior context on the decisions you made, so it's less likely to share your blind spots.

   **Working-tree safety (non-negotiable).** Review subagents share THIS session's working directory. A reviewer that runs `git checkout` / `switch` / `reset` / `stash` / `rebase` silently moves the main session's HEAD off the branch (it has happened: a reviewer ran `git checkout main` mid-loop and the local checkout regressed; commits were safe only because they were already pushed). Two defenses, apply BOTH:
   - Spawn the reviewer with `isolation: "worktree"` so any git op it runs is contained in its own throwaway worktree, never the main checkout. (A read-only reviewer needs no shared state; `gh pr diff` reads from GitHub.)
   - Include the read-only git prohibition in the prompt (it is baked into the template below). Belt and suspenders: isolation contains the damage, the prompt prevents the attempt.
   - After EACH round returns, before acting on findings, run a one-line repo-health check and repair if needed (the worktree isolation in the first bullet has itself corrupted the main repo: spawning isolated reviewers flipped the main repo's `core.bare` to `true` and left a locked `.claude/worktrees/agent-*` worktree, after which `git checkout` failed with "this operation must be run in a work tree"). Check ALL of:
     - `git rev-parse --is-inside-work-tree` is `true` and `git config --get core.bare` is NOT `true`. If the work tree is broken, repair with `git config core.bare false`, then `git worktree prune` (and `git worktree remove -f -f .claude/worktrees/agent-*` for any locked leftover). Do NOT touch the user's OWN unrelated worktrees (anything outside `.claude/worktrees/`).
     - `git rev-parse --abbrev-ref HEAD` is still the feature branch and `git status` is clean. If HEAD moved (or points at a now-deleted branch / `0000000`), `git checkout -f <feature-branch>` (or `main` post-merge) restores it.
     The merge / commits are always safe on GitHub regardless; this only repairs the LOCAL repo. Nothing is lost. If you cannot cleanly repair, `git checkout -f main && git pull` to resync, then continue.

   Pass a prompt that:
   - Names the PR number and branch.
   - Tells it to fetch the diff (`gh pr diff <N> --repo webjsdev/webjs`) and read the changed files in context.
   - Instructs it to look for: bugs, regressions, security issues, missed edge cases, broken invariants, doc drift, test gaps, stylistic problems against `AGENTS.md` and `CONVENTIONS.md` (root and per-package).
   - Asks for a numbered list with `file:line` references. Problems only, no suggestions.
   - Ends with: "If you find nothing genuinely wrong, say exactly `CLEAN` and stop. Do not pad."

2. **For each finding the subagent reports**, do exactly ONE of these three. There is no fourth option, and "mention it and move on" is not allowed:
   - **Fix it** on the branch (commit + push to update the PR), OR
   - **Reject it** explicitly with a one-sentence reason written in your reply to the user and in the PR body. Rejection has to be defensible (e.g. "the agent flagged X as a security issue but X runs server-side only and never reaches user input"). False positives are real; reject them on the merits, don't just hand-wave. OR
   - **File it** as a tracked issue when it is genuine but out of scope for THIS PR (a pre-existing bug, an unrelated dependency/hygiene problem, a separate feature). "Out of scope" is NOT a reason to drop a finding. INVOKE the `webjs-file-issue` skill rather than hand-rolling `gh issue create`: it gates on grounding the body in the real codebase first, which is exactly what an out-of-scope review finding needs and exactly what a hurried two-command version omits. Capture the issue number. Verify it landed (`gh project item-list 1 --owner webjsdev --limit 20000`, the board is past 200 items so the default cap of 30 reports a false negative). A finding you call out-of-scope without an issue number is an unfiled finding, which is the exact mistake this clause exists to prevent. If unsure whether something is in-scope, default to fixing it in this PR; only file-and-defer when it is clearly separable and fixing it here would mean scope creep.

   **Record every genuine finding as a comment ON THE PR, the way a human reviewer would.** The self-review trail must live on the PR, not only in your reply to the user (a finding that exists only in the chat transcript is invisible to anyone reading the PR later). For findings tied to specific lines, post an INLINE review comment at `file:line` (`gh api repos/webjsdev/webjs/pulls/<N>/comments --input comment.json`, writing the body into that JSON file first, or a `gh pr review` with line comments). Build that JSON with a real serializer, never by interpolating into a shell string: review text is dense with backticks, and an unquoted shell string runs them as command substitution. That is exactly how a review on #1115 lost every code reference in its inline comments and had to be deleted and reposted. For cross-cutting or round-summary notes, use `gh pr comment <N> --body-file /tmp/pr-comment.md`. Each comment states the finding, its `file:line`, and its disposition (`fixed in <sha>` / `rejected because <reason>` / `filed as #<n>`). Post rejected findings and false positives too, so the reasoning is auditable on the PR. A `CLEAN` round can be noted briefly. Do this as part of the loop, not as an afterthought. (Reminder: em-dashes and the other banned glyphs in AGENTS.md invariant 11 apply to PR comment bodies too, since they go through the same tooling.)

3. **If the round found any findings (even rejected ones)**, run another round with a fresh subagent. The new round picks a slightly different focus prompt: if round 1 was broad, round 2 zooms in on the file you most edited; if round 2 zoomed in, round 3 zooms out to cross-file consistency, etc. Rotate focus to avoid the agent rediscovering the same surface.

4. **If the round reports `CLEAN`**, the loop is done. THIS is the point at which the slow layers run, once (see "Cost discipline in the loop" above), not before.

The minimum is TWO rounds. A clean first round is rare and usually means the review was too shallow; if round 1 is clean, spawn a second one with a sharper, narrower focus before believing the result.

**The LAST round must be clean, always. A fix is never the end of the loop.** The moment a round surfaces a genuine finding and you fix it (or reject it), you have NOT finished: the fix changed the branch, so it needs its own round. Run another round on the new HEAD and keep going until one round finds zero issues. Do NOT report "fixed it" or "ready to merge" after a round that found something, even if the fix is obviously correct and tests pass. The recurring failure this prevents: review finds X, you fix X and immediately report done, having never re-reviewed the fix. If you ever notice you are about to report a result where the most recent review round found a finding, stop and run another round first.

**A standalone "review the PR" request IS the loop, not a one-shot.** When the user asks you to review an existing PR (separately from the post-`gh pr create` flow), you re-enter this exact loop: spawn a fresh round, and if it finds anything, fix/reject/file it and run further rounds until the last one is clean, BEFORE you report back. "I reviewed it and fixed one thing" is not an acceptable stopping point; "I reviewed it in a loop and the last round was clean" is. The user should never have to ask "was the last review clean?" because you should not have stopped until it was.

### When to skip the loop

Skip only for PRs that change a single line of trivially-correct content (a doc typo, a renamed local variable, a one-token config bump). Anything that touches logic, public surface, the build, the importmap, security-relevant code, or multiple files goes through the loop without exception. A bias toward running the loop is correct; a bias toward skipping it is the exact failure mode this rule exists to prevent.

### Reporting after the loop

After the loop converges, report exactly this shape to the user:

> PR #<N> is up at <URL>. Self-review loop ran <K> rounds; last round clean. Issues found and fixed during the loop: <one-line list, or "none" if rounds 2+ kept finding nothing>. Out-of-scope findings filed as follow-ups: <issue numbers, or "none">. Ready to merge.

If you cannot honestly say "last round clean", you cannot say "ready to merge". If a finding is rejected as a false positive, mention it in the report so the user can second-guess the rejection. Every finding the loop surfaced must be accounted for in this report as fixed, rejected-with-reason, or filed-with-issue-number; if you reported an out-of-scope finding to the user but cannot point to its issue number, you have not finished the loop. Every genuine finding must ALSO appear as a comment on the PR (see step 2), so the report and the PR agree.

**Merge is gated on green CI, enforced at the branch level, not by trust.** A PR must not merge until all CI checks pass. `main` branch protection requires the five `ci.yml` checks (Conventions, Unit+integration, Browser, E2E, Build) before any merge; if `gh api repos/webjsdev/webjs/branches/main/protection` shows `required_status_checks: null`, run `bash scripts/protect-main.sh` once (needs repo admin) to restore it. Do not work around a red or pending check; wait for green.

**NEVER use `gh pr merge --admin` to bypass a FAILING check.** `--admin` skips ALL branch-protection gates, not only the review requirement, so a red CI check merges silently and lands broken code on `main`. This has happened (a Unit-test failure was admin-merged, breaking `main`). `--admin` is acceptable ONLY to bypass a required-review gate on a PR whose CI is confirmed all-green. Before any `--admin` merge, re-run `gh pr checks <N>` and confirm EVERY check reads `pass` (a `BLOCKED` state can mean review-required OR a failing check, so never assume which). If any check is red or pending, stop and fix or wait.

### Subagent prompt template

```
Review PR #<N> at https://github.com/webjsdev/webjs/pull/<N> for bugs, regressions, security issues, missed edge cases, broken invariants, doc drift, test gaps, and style violations against the project's AGENTS.md and CONVENTIONS.md (root + per-package).

HARD CONSTRAINT, read first: you are running in a SHARED working directory that the main session is actively using. You are a READ-ONLY reviewer. Do NOT run any command that changes git branch, HEAD, the index, or the working tree: no `git checkout`, `git switch`, `git reset`, `git restore`, `git stash`, `git pull`, `git fetch` that moves refs, `git merge`, `git rebase`, `git clean`, `git branch -f`, or `git worktree`. Any of these silently corrupts the main session's checkout (it moved HEAD off the branch and looked like lost work). You do NOT need to switch branches to review: the branch is already checked out, so read files in place; use `gh pr diff <N>` and `gh pr view <N>` (which read from GitHub, not the local tree) for the diff and metadata. The only git you may run is read-only inspection (`git log`, `git show`, `git diff` WITHOUT changing state, `git status`, `git blame`). If you think you need to change git state to do the review, you are wrong; report what you found instead.

You start with no prior context on this PR. Steps:

1. Run `gh pr diff <N> --repo webjsdev/webjs` to see the full diff.
2. Run `gh pr view <N> --repo webjsdev/webjs --json title,body` to see what the author claims it does.
3. Read every file the diff touches in its current state (not just the diff hunks) so you see edits in context.
4. Read root AGENTS.md, the per-package AGENTS.md for each touched package, and CONVENTIONS.md if a scaffolded template was touched.
5. Specifically check: <focus rotates per round, e.g. "edge cases in importmap routing for both dist and src modes" or "whether the regression test actually fails when the code change is reverted">.

Report findings as a numbered list with file:line references. Problems only. No suggestions, no nits about style if the rule isn't enforceable. If you find nothing genuinely wrong, say exactly `CLEAN` on its own line and stop. Do not pad with "looks good overall" or summaries.
```

## After a merge: decide on a version bump, automatically

After ANY PR that lands a user-facing change (a `feat` / `fix` / `perf` / `breaking` to a published package: `core`, `server`, `cli`, `ui`, `intellisense`, `mcp`; `intellisense` lives at `packages/editors/intellisense`, the rest at `packages/<pkg>`) merges into `main`, assess whether a release bump is owed and open a release PR WITHOUT being asked. The user should not have to ask "do we need to bump versions?". Docs-only / chore / scaffold-doc changes do NOT bump on their own; they ride to the next functional bump.

**Decide per package, across ALL of them, not just the ones this PR touched.** Release debt accumulates: a package can carry unreleased `feat`/`fix` commits from earlier PRs that were never released. For EACH published package, compare its shipped binary/surface against its latest `changelog/<pkg>/<version>.md`:

```sh
# What is published vs what the changelog covers, per package:
for p in core server cli ui mcp editors/intellisense; do
  name=$(basename "$p")
  echo "$name: pkg=$(node -p "require('./packages/$p/package.json').version") latest-changelog=$(ls changelog/$name 2>/dev/null | sort -V | tail -1)"
done
# For each package, are there feat/fix/perf/breaking commits touching its tree since the last release?
git log --oneline <last-release-sha>..main -- packages/<pkg>/
```

If a package has qualifying commits since its last `changelog/<pkg>/<version>.md` that the changelog does not cover, it is owed a bump, EVEN IF the current PR did not touch it. (Real miss: a release PR for core+server shipped while `cli` had an unreleased `vendor --from`/`audit`/`outdated` surface from an earlier PR that no cli changelog covered. Surface every such debt to the user; do not silently leave it.)

**Mechanics of the release PR** (also see Definition-of-done item 9):
1. Branch `chore/release-<pkg>-<version>[-<pkg>-<version>]`.
2. Bump `version` in each `packages/<pkg>/package.json` (edit ONLY the version line; do not reformat the file). Level: **patch** for a `fix`/`feat`/`perf` while the package stays in one minor line (dependents pin `^0.x.0`); **minor** only when you are also ready to widen every dependent's caret range; **major/breaking** for an actual breaking change.
3. Dependent ranges: `grep -rn '"@webjsdev/<pkg>"' --include=package.json . | grep -v node_modules`. A patch stays within the existing caret, so no edits; a minor needs every dependent range widened.
4. `npm install --package-lock-only` and stage `package-lock.json` (a desync reds CI's `npm ci`).
5. Changelog: the pre-commit hook runs `scripts/backfill-changelog.js`, which parses `^(feat|fix|perf|breaking):` from commit subjects in the package's tree. **Squash-merge subjects are PR titles with no conventional prefix, so the generator finds nothing and the hook fails.** Hand-write `changelog/<pkg>/<version>.md` (match an existing file's frontmatter: `package`, `version`, `date`, `commit_count`; sections ordered Breaking, Features, Performance, Fixes; entries link the PR and the squash commit) and stage it; then the commit passes.
6. Open the release PR. Note in the body that merging it adds the `changelog/**.md` files to `main`, which triggers `release.yml` to `npm publish` and cut GitHub Releases (idempotent).
7. Run the self-review loop on it too (a release publishes to npm; a wrong bump level, missed package, or inaccurate changelog is worth catching). Merge is still user-gated.

### Then: make sure the deployed Railway services actually picked it up

A merge updates `main` and npm, but the four in-repo apps deployed to Railway (`examples/blog`, `website`, `docs`, `packages/ui/packages/website`) keep serving the OLD code until they redeploy. After merging a change that affects what those services serve (framework code in `core`/`server`, or an app's own files), verify each service is now running the new `main`, automatically, without being asked. A user-visible fix is not actually shipped until the running service has it.

**Check (needs `railway login`; the Railway MCP):** for each service, `mcp__railway__list_deployments` and compare the latest SUCCESSFUL deployment's commit hash to `git rev-parse origin/main`. A service whose running commit is an ancestor of (behind) `main` is stale. If `mcp__railway__whoami` returns "Not authenticated", say so and ask the user to run `! railway login`; do not guess.

**If a service is stale, trigger a redeploy.** Two mechanisms, in order of preference:
1. If the Railway MCP is authenticated, `mcp__railway__deploy` the stale service directly. No commit, cleanest.
2. Otherwise, the user has authorized a **zero-diff empty commit to `main`** as a deploy trigger: `git commit --allow-empty -m "chore: trigger Railway redeploy (<reason>)" && git push origin main`. THIS IS THE ONE SANCTIONED DIRECT PUSH TO `main` (everything else goes through a PR). It is explicitly NOT a code change and bypasses no review, because there is nothing to review; its sole purpose is to give Railway's auto-deploy a new commit to deploy.

**Nuance, do not over-fire the empty commit.** Railway services connected to a GitHub branch auto-deploy on every push BY DEFAULT, so a real merge already triggered the redeploy and an empty commit right after would be redundant; only the version-bump/merge commit itself is needed. The empty commit is the fix for the narrower case where a service has Railway **watch-paths** configured (it only redeploys when files under its own path change), so a framework-only change (e.g. `packages/core`) did not trigger the app service. A no-diff empty commit also will NOT match a restrictive watch-path, so if the check shows a watch-path-filtered service still stale, prefer mechanism 1 (MCP `deploy`) or tell the user the service needs a manual redeploy / a watch-path that includes the framework packages. So: check first, redeploy ONLY the services the check proves are behind, and report which services you redeployed and how.

## What this skill does NOT do

- Opens the PR as a DRAFT at the START (step 6), not at the end. It is NOT created late once all the work is done. At draft-create time:
  - The body MUST include `Closes #<N>` near the top so merging auto-closes the issue and the project card auto-moves to Done. If the work turns out to only partially address the issue, use a plain `#N` reference, not `Closes`.
  - The PR MUST be assigned to vivek7405 (`gh pr create ... --assignee vivek7405`). Matches the project's per-issue-owner convention.
  - It stays a draft until the Definition of done is satisfied and the self-review loop has converged; then `gh pr ready <N>` flips it to ready for review.
- Does not make commits FOR you. Subsequent work follows the standard webjs git workflow (commit per logical unit, push after each, run tests before committing); those commits stream onto the already-open PR.
- Does not merge. Merging is always user-approved per the project's git rules.

## Failure handling

- If `git status` is dirty: stop and ask the user to stash, commit, or abandon their pending work before creating the new branch. Never silently lose changes.
- If the issue is already in `In progress` (someone else's work, or a prior branch left open): report this and ask the user whether to continue on the existing branch, branch off a fresh main, or pick a different issue.
- If the local checkout regressed mid-loop (HEAD on `main` or a base commit, the feature branch's work seemingly "gone"): a review subagent mutated shared git state. Do NOT panic or redo work. The local feature-branch ref and `origin/<branch>` still point at the latest commit (every logical unit was pushed). Recover with `git checkout <feature-branch>`; confirm with `git log --oneline origin/main..HEAD` and `git status` clean. The PR on GitHub was never affected (the GitHub-reading reviewer still saw correct content), so no re-push or force-push is needed.
- If the `gh project item-edit` call fails (auth scope, missing field): report the failure clearly and offer to do the move manually via the web UI. The branch creation still stands.
