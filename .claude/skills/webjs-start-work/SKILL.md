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

3. **Fetch, and leave the primary checkout alone.** `git fetch origin`. The task's worktree cuts from `origin/main`, so a dirty or mid-something primary checkout neither blocks starting nor gets "fixed"; it is never edited at all (enforced by `.claude/hooks/require-worktree-for-edits.sh`, which blocks tracked-file edits in a primary checkout).

4. **Create the task's WORKTREE and push its branch immediately.** One task, one worktree, ALWAYS; there is no lone-agent plain-branch path, because "no other agent is active" is unverifiable mid-task. Pick the prefix from the issue labels: `enhancement` to `feat/`, `bug` to `fix/`, `documentation` to `docs/`, otherwise `chore/`. Build the slug from the issue title (lowercase, kebab-case, max 30 chars, drop conjunctions). The push happens right away so the work survives any local-machine failure even before the first commit.

   ```sh
   git worktree add -b <prefix>/<slug> ../<repo>-<slug> origin/main
   git -C ../<repo>-<slug> push -u origin <prefix>/<slug>
   ```

   ALL work for the task happens inside that worktree, by absolute path when the session's cwd resets. A fresh worktree has NO `node_modules`; see AGENTS.md for the symlink remedy (#954). Cleanup after merge is automatic (`cleanup-merged-worktree.sh`). After this step, ALSO push after every subsequent commit (`git push` is cheap and is the safety net against losing work). Do not batch multiple commits before pushing.

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

6. **Open a DRAFT PR immediately, BEFORE writing any code.** This is the single most important ordering rule and it is NOT optional: the PR is opened at the START of the work, not the end. The whole point of the PR is to be the durable, append-only record of the change AS IT HAPPENS: every per-logical-unit commit lands on it, every design-rationale / decision / follow-up context comment is posted to it the moment that discussion happens, and every review round is posted to it. NONE of that is possible if the PR does not exist yet, which is exactly the failure a late `gh pr create` causes. So open it now, empty branch and all (the branch was already pushed in step 4).

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

   From here on, the PR exists, so: commit per logical unit and push after each (the commits stream onto the PR); post design-rationale / decision / follow-up context comments to the PR as those discussions happen (do not hoard them for the end); and run every review round ON the PR. The PR is marked **ready for review** (`gh pr ready <N>`) only at the very end, AFTER the Definition of done is satisfied and the review cycle has finished (the final whole-diff review, and the fix-check if it had one). Opening late and dumping everything at the end is the anti-pattern this step exists to kill.

7. **Report back briefly.** One short message to the user: issue title + number, new branch name, draft PR URL, "project card moved to In progress". Then continue with the actual work the user asked for.

## Definition of done (MUST be satisfied BEFORE marking the draft PR ready for review)

The PR is already open as a draft (step 6). "Done" here means the gate to flip it from draft to **ready for review** (`gh pr ready <N>`), NOT the gate to create it. Everything below must be addressed, and the review cycle must have finished, before that flip.

**Bun parity is part of the task, not an afterthought.** webjs runs on Node 24+ AND Bun (#508). If the change touches a runtime-sensitive surface (the serializer, the node:http vs `Bun.serve` listener + request path, SSR / action / CSRF dispatch, streams, `node:crypto`, the TS stripper, auth / session / cors), then BEFORE you mark the PR ready you MUST (1) run the Bun matrix and report it green (`node scripts/run-bun-tests.js` plus the touched `test/bun/*.mjs` under `bun`), and (2) add or update a `test/bun/<feature>.mjs` cross-runtime assertion for the surface. This is enforced: `.claude/hooks/require-bun-parity-with-runtime-src.sh` BLOCKS a commit that stages runtime-sensitive source with no `test/bun/**` test (escape hatch `WEBJS_BUN_VERIFIED=1` only when an existing Bun script already covers it AND you ran it). Treat the parity, not just the Node result, as the bar.

Doc drift is the #1 way a framework rots. Documentation MUST stay in sync with code on the same PR that changes the code. Do NOT defer doc work to a follow-up issue, do NOT let the user have to ask. Before marking the draft PR ready for review, walk through every surface below and either update it OR write "N/A because <reason>" in the PR body so the omission is visible.

### Surfaces to consider on EVERY PR

1. **Tests, ALL applicable layers (not just unit).** This is generative, not "write a unit test and move on". The repo has several test layers; for the changed surface, add or update coverage in EVERY layer the change can affect, then RUN that layer. Walk them explicitly:
   - **Unit** (`packages/*/test/**`, `test/**`): pure logic, analysers, helpers. Include counterfactuals (the negative case that proves the check actually fires).

     **Running a counterfactual safely (commit FIRST, revert through git, never sed-toggle source).** A counterfactual proves a test fails when the fix is removed. The safe order is: COMMIT the fix and its test first, THEN temporarily revert ONLY the source guard, run the test (expect red), and restore. Two traps that have bitten this exact flow, both avoidable:
       - **Do NOT `git checkout <file>` to "undo" a counterfactual while the fix is still uncommitted.** `git checkout` restores the file to HEAD, which (pre-commit) has NO fix, so it silently throws the whole fix away, not just the temporary neutering. Commit first; then `git checkout <file>` restores the COMMITTED fix, which is what you want.
       - **Do NOT neuter a guard by `sed`-rewriting the source to a sentinel like `''`.** Shell-quoted escapes land as a literal control byte (a NUL/0x01) inside the file, which renders like a space in an editor but breaks the comparison and makes `grep` treat the file as binary (silent empty matches). Verify any byte-level edit with `od -c` on the changed line and `tr -d '\000' | wc -c` for stray NULs. Prefer the Edit tool (toggle the guard, run, toggle back) or `git stash`/`git stash pop` of the committed source over `sed` for this.
     The clean loop: commit fix+test, run test green, `git stash push -- <source-file>` (or Edit out the guard), run test red, `git stash pop` (or Edit the guard back), run test green again. The test having gone red in the middle is the proof.

     **A counterfactual CLAIM decays.** "Reverting X reds Y" is true of a commit, not a branch: a later commit touching the same mechanism can make it false while every test stays green (a review-loop fix once made an older test non-discriminating exactly this way). So date the claim to the commit it was proven at, and when a later commit touches that mechanism, re-run the toggle and restate or correct the claim. This applies to mid-cycle fix commits too (see the speed rule in the review cycle).
   - **Integration** (server-level through `createRequestHandler`, SSR pipeline, scaffolds): behaviour across modules without a browser.
   - **Browser** (`*/test/**/browser/*.test.js`, run via `npm run test:browser` / `wtr`): anything touching hydration, client render, DOM, slots, the client router, custom-element upgrade.
   - **E2E** (`test/e2e/e2e.test.mjs`, run via `WEBJS_E2E=1`): full-stack behaviour observable only in a real browser against the running blog example, including **network probes** (was a module fetched or not), navigation, and streaming.
   - **Smoke** (`test/examples/*/smoke/*`): the example apps still boot and serve their key routes.
   - **Cross-runtime (Bun)** (`node scripts/run-bun-tests.js`, needs `bun` on PATH; the `test/bun/*.mjs` scripts run under both runtimes): webjs runs on **Node 24+ OR Bun** (#508), so a change to runtime-sensitive code MUST be proven on Bun, not just Node. "Runtime-sensitive" = the serializer (Blob/File/FormData/typed arrays), the server request/listener path (the node:http vs `Bun.serve` shells, SSE, WebSocket upgrade, compression, timeouts), streams + `node:fs` (anything using `Readable.fromWeb` / `pipeline` / `createWriteStream`), `node:crypto`, the TS stripper, `AsyncLocalStorage`, or ANY `node:*` API whose behaviour Bun may implement differently. The Bun matrix (`scripts/run-bun-tests.js`) re-runs the `node:test` suite under `bun test` and FAILS on a genuine divergence; a divergence is a REAL bug to fix in the framework (this session found 5: a FormData fresh-identity serializer crash, a `Readable.fromWeb` `put()` hang, the amaro vs Node TS-strip error code, a JSC vs V8 error-message format, a link-unsafe `node:module` named import), not something to skip. Add a `test/bun/<feature>.mjs` cross-runtime assert script (wired into the CI `bun` job) for any new surface that touches the listener / serializer / streaming path. A test that is legitimately Node-only (asserts a node:http internal, the built-in stripper, `module.registerHooks` seeding, the node `ws`-library subsystem) goes on the runner's documented `DENYLIST` with a reason and a note of where the Bun behaviour IS covered; if a file MIXES runtime-agnostic and Node-only tests, SPLIT the Node-only ones into their own file so the rest still runs on Bun. See the skill's `references/testing.md`.

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
   - **The shared language service** (`packages/editors/intellisense/src`): any change to its behaviour (the template parser, tag/attr resolution, completions, diagnostics, hover) flows to EVERY consumer. **This is the single most-missed step, and it reds CI:** both editor plugins **bundle** a copy. The VS Code extension esbuilds it at vsix package time (`packages/editors/vscode/scripts/build.mjs`, picked up automatically), but webjs.nvim ships a COMMITTED verbatim copy that a drift test enforces. So after ANY edit under `packages/editors/intellisense/src/` (even one line), AND after any edit to that package's `package.json` INCLUDING a release version bump, you MUST, before pushing, run `node packages/editors/nvim/scripts/vendor-intellisense.mjs` then `git add -f packages/editors/nvim/vendor` (the copy is under a gitignored `node_modules/`), or the `packages/editors/nvim/test/vendor-sync.test.mjs` drift guard FAILS the "Unit + integration" CI job ("vendored intellisense src is byte-identical ..."). The manifest is compared in full, version included, so a release that bumps intellisense must re-vendor on the release branch (#1117 shipped a plugin misreporting its own language-service version because nothing enforced that). Confirm with `node --test packages/editors/nvim/test/vendor-sync.test.mjs`. The coupling is bidirectional: the nvim copy under `packages/editors/nvim/vendor/node_modules/@webjsdev/intellisense/` is GENERATED, so NEVER hand-edit it when working in the nvim package (edit `intellisense/src` + re-vendor instead); the same drift guard reds CI either way. The scaffold ALSO pins `@webjsdev/intellisense` in app node_modules + tsconfig (intelligence with no editor plugin; tsserver dedupes when both load), so an intellisense version bump is a real publish. (Full flow also in `packages/editors/intellisense/AGENTS.md`.)
   - **Template grammars / injection queries** (`packages/editors/vscode/syntaxes/webjs-{html,css,svg}.json` AND `packages/editors/nvim/queries/{typescript,javascript}/injections.scm`): if you add, rename, or change the recognised tags (`html`/`css`/`svg`) or how `${...}` holes are scoped, update BOTH the VS Code TextMate grammars and the Neovim treesitter queries, plus their tests (`packages/editors/vscode/test/extension.test.mjs` begin-patterns, `packages/editors/nvim/test/selftest.lua` injection assertions).
   - **Snippets + commands** (`packages/editors/vscode/snippets/webjs.json`, `src/extension.js`; webjs.nvim `lua/webjs/` commands): if you add or rename a common recipe or a surfaced command, add/adjust the matching snippet/command (the vscode test cross-checks contributed commands against `registerCommand`).
   - **Publishing on a release.** The VS Code extension publishes to the VS Marketplace + Open VSX (`packages/editors/vscode/PUBLISHING.md`); webjs.nvim is a git subtree split mirrored to `webjsdev/webjs.nvim` (re-run the split + force-push after a change; `packages/editors/nvim/PUBLISHING.md`). Bump `packages/editors/vscode/package.json` `version` when its bundle changes.
   - **Heuristic:** if your change would make an editor highlight wrong, resolve the wrong definition, offer a stale snippet/command, or ship a drifted bundle, the editor plugins are part of your change. Update them on the same PR (with the matching test), re-vendor the nvim copy, or write "N/A because <reason>" in the PR body.
7. **Marketing copy** at `website/app/page.ts`. Update if the change touches positioning or any landing-page claim ("no-build", "AI-first", "web components first", etc.).
8. **Dogfood apps must still build and boot. MANDATORY GATE, run it automatically, never wait to be asked.** The framework ships two in-repo apps that consume it: `examples/blog` (the demo) and `website` (the marketing pages plus /docs and /ui). A framework change that compiles is NOT done until both still serve. This is a recurring miss: running only the blog e2e and stopping is the exact failure this gate exists to prevent. For ANY change to `packages/core`, `packages/server`, `packages/cli`, the dist build, the importmap, or anything that alters what the browser fetches, you MUST run the full two-app check below before marking the draft PR ready for review and report its result in the PR body. The user should never have to ask "did you check the apps?".

   **The check (copy-paste, runs in seconds):**
   - `examples/blog`: covered by the e2e suite. Run `WEBJS_E2E=1 node --test test/e2e/e2e.test.mjs` (it exercises the blog in a real browser; if `dist/` is built it runs in dist mode, so it covers the production wire too).
   - `website`: boot it through `createRequestHandler` in PROD mode and GET a real route, asserting status < 400. It is the app that serves every HTML surface the project has, the marketing pages plus the documentation at `/docs` (#1098) and the component gallery at `/ui` (#1099), so its routes are where a break shows up. Write this harness to a file INSIDE the repo (bare `@webjsdev/*` specifiers only resolve from the repo's `node_modules`, NOT from `/tmp`), run it, delete it:

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

   Report the dogfood result in the PR body (e.g. "Dogfood: blog e2e 50/50; website boots 200 on /, /docs/*, /ui, /ui/button in dist mode with no broken preloads; scaffold N/A"). "All apps verified" with no evidence is not acceptable.
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
4. **Review comments: a summary AND per-code-line comments.** Every review (each round of the review cycle and any manual review) posts a summary review plus an inline comment on each finding's `file:line` (see "Every PR review is posted ON the PR" below).

All four are written in the owner's voice (first person, plain, no AI/agent framing) and free of AGENTS.md invariant 11 banned glyphs. The no-machinery-tells rule binds the review and context comments; the PR BODY is the one place machinery evidence is REQUIRED content (the test plan and the dogfood results the Definition of done demands), so reporting it there is not a tell. The sections below specify the mechanics for items 3 and 4.

**Header every standalone comment with a short, meaningful bold heading** so a future reader (human or AI) knows what the comment is and what it is about before reading it. Put the heading on its own first line as bold markdown, blank line, then the body. Write the heading to fit THIS comment, do not pick from a fixed list. A good heading names the kind of comment and its topic, e.g. `**Design rationale: why analysis moved off boot, and what it costs**`, `**Review: lazy-boot model holds, one real bug**`, `**Decision: kept the derived gate over a declared allowlist**`, `**Follow-up: aliased-expose 404 filed as #N**`. A bare category word like `Context` or `Review` is the floor, not the goal; prefer a heading that also says the subject, so a reader scanning the PR's comment list can tell the boot-rationale note from the elision-review note without opening either. **Per-line inline review comments do NOT need a heading** because their `file:line` anchor already classifies them as review; keep those terse. The heading rule is for standalone, top-level comments (the PR body in item 2 is exempt, since it has its own `## Summary` structure).

## Pre-merge review cycle (MUST run before reporting "ready for merge")

Saying "ready for merge" before the review cycle completes is the single biggest source of low-quality PRs. The recurring pattern to AVOID: claim ready-for-merge, the user requests a review, find issues, fix them, claim ready-for-merge again, repeat 4-5 times before a review comes back clean. The cure is to run that cycle internally BEFORE the first "ready" signal. The user should only hear "ready to merge" after the cycle has finished AND the suites it deferred have run.

### Every PR review is posted ON the PR (summary + per-line comments)

This applies to EVERY review of a PR: each round of the review cycle below, AND any time the user asks you to "review the PR" manually. A review that lives only in your chat reply is not a review the PR carries. For every review you perform, post BOTH:

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

**Every round repeats the whole flow.** Each round of the review cycle, and each manual re-review the user asks for, is a NEW review object: a fresh `POST /pulls/<N>/reviews` carrying that round's summary and findings, followed by fix + reply + resolve for that round's threads. Never append a later round's findings into an earlier round's review, and never edit a prior finding to say it is fixed (reply instead). A round that REVIEWED and found nothing still posts a short summary review saying it is clean, with no inline comments. A round whose reviewer did not review (see the liveness rules) posts nothing, because there is no round to summarize and a clean review object on the PR would be a lie.

Banned prose glyphs (AGENTS.md invariant 11) apply to every comment, reply, and summary body, so keep them clean.

### Capture significant design discussion as PR comments (standing, automatic)

Beyond review findings, proactively record the *reasoning* behind a PR as comments on it, without being asked. The PR is the durable memory a future reader (an AI agent picking the work back up, or the owner months later) consults to understand WHY the code is the way it is. The git diff shows WHAT changed; the conversation that produced it (tradeoffs weighed, alternatives rejected, constraints discovered, "we chose X over Y because Z") is lost unless it is written onto the PR. The chat transcript is not durable PR context; the PR comment is.

**Trigger (automatic, not on request):** whenever a conversation about an open PR produces a non-obvious design decision, a rejected alternative, a tradeoff accepted with eyes open, or context the diff alone does not explain, post it as a PR comment AS THE DISCUSSION HAPPENS. Use `gh pr comment <N> --body-file /tmp/pr-comment.md` for cross-cutting narrative, or an inline `file:line` comment when it pertains to specific code. Same voice as review comments: first person, plain, owner's voice, no AI/agent framing, no machinery tells, no banned glyphs.

**This runs continuously across the PR's whole life, not once.** Because the PR opens as a draft at the START (step 6), there is a place to post from the first commit onward, so keep adding context throughout: when a mid-work investigation changes the approach, when a reviewer finding is resolved a particular way, when an edge case is discovered, when something is deliberately deferred. The acceptance test is concrete: a future AI agent (or the owner) who opens ONLY this PR, with zero access to this chat, should find every non-obvious "why" already written on it. If reconstructing the reasoning would require the chat transcript, a context comment is missing. Do not save it all for a single end-of-work dump; that recreates the exact gap the early-draft-PR rule exists to close.

**What's worth capturing (judgement, not a checklist):** why an approach won over a credible alternative; an experiment tried and reverted, with the reason; a tradeoff accepted knowingly (a cold-start cost, a known-small race window left in, a documented edge case); a constraint or invariant discovered mid-work; anything you would want explained if you returned to the PR with no memory of the conversation. Skip the trivial: routine fixes, mechanical edits, anything the diff already makes obvious. The bar is "would a future agent be missing important context without this", not "log everything". When the PR body already covers a decision, a short comment is fine or skip it; do not duplicate the whole body into a comment.

**A PR carries exactly two kinds of content: the code change and the review rounds.** Everything on it (body, commits, review summaries, inline findings, context comments) must be meaningful data about one or the other. Session and harness machinery is NOT PR content and must never be posted there. Concretely, keep OFF the PR: a subagent that could not be spawned or died, a tool that errored or was declined, a retry, an interruption, how many turns something took, and above all your own process mistakes in running the PR (a stale body you then fixed, a mirror you forgot to sync, a mis-posted comment). Those are conversation, not record. The test: would this still matter to someone reading the PR in a year who has no idea which agent or session produced it? A design decision passes. A rejected alternative passes. A review finding passes. "My reviewer spawn was declined and I retried" does not, and neither does "I got this wrong earlier in the PR and then corrected it", which reads as noise around a diff that already shows the correction. Fix the mistake and move on; do not narrate it onto the PR.

### How the cycle works

The draft PR is already open (step 6), so reviews post to it from the first round. Do NOT mark it ready for review or report "ready for merge" yet.

**FAST is the default shape.** A reviewer spawn costs roughly 10 minutes of wall clock, so every round is a real, measurable tax on the PR, and the owner should never have to ask for a short cycle. The default therefore buys the SECOND read only when there is evidence the change needs it, and the thorough shape below is what that evidence escalates to. Speed is bought by running fewer rounds, NEVER by lowering the bar inside a round: the minor / must-fix call is unchanged, still by surface, still fail-open to must-fix.

**The fast cycle (default):**

1. **Round 1: ONE fresh reviewer over the WHOLE diff.** The same shape for every PR, whatever paths it touches. No fleet, no lenses, no jury, no per-diff tier choice.
2. **Judge each finding MINOR or MUST-FIX** (rule below), then fix, reject, or defer it (the three dispositions below). Apply every minor finding; they buy nothing. A rejection buys one REFUTER, a deferral buys nothing.
3. **Only a MUST-FIX fix buys a round, and it buys exactly ONE:** a delta-scoped reviewer whose QUESTION is those fix commits alone. A round whose fixes were ALL minor ends the cycle instead, because wording and naming edits cannot introduce the class of defect a round exists to catch.
4. **Then STOP.** The cycle ends when nothing must-fix is left OPEN. If that one delta round itself finds something must-fix, fix it, and escalate to the thorough cycle rather than chaining further: a fix that produces another must-fix finding is the evidence the escalation ladder is asking for.

So a clean or minor-only round 1 finishes the cycle with ONE review. That is the intended common case, not a shortcut.

**Escalate to the THOROUGH cycle when ANY of these hold**, checked at the end of round 1 and again after a delta round:

- the owner asks for a thorough, full, or deep review;
- round 1 produced TWO OR MORE must-fix findings, or a delta round produced any, which says the change is not yet understood;
- the diff touches a surface where a miss is expensive: the serializer, SSR or action dispatch, auth or session, the client router, or the elision analyser.

**The thorough cycle (on escalation):** steps 1 and 2 as above, except that the one-delta-round limit lifts, so each later round is delta-scoped to the previous round's fix commits and the chain continues while its rounds keep producing fixes. Then:

4. **The first round that produces no fixes buys the FINAL review: ONE fresh reviewer over the WHOLE diff again**, on the head the fixes produced. Two different jobs are being done here. After delta rounds, it is the first read of the finished change rather than of a fragment. After a clean round, when it is the same diff at the same head, it is a second independent read, which is the check a single-reviewer cycle owes in place of the fleet's second opinion. Either way a clean round is not the end of the THOROUGH cycle. This is. **A delta chain that keeps producing fixes stops after the FIFTH DELTA ROUND**, unfinished, reported per its own entry in Failure handling rather than continued: a change whose repairs keep breaking something is signal about the change, not about the review, and the measured 18-round loop that motivated this spent its last four rounds catching regressions its own fixes had introduced.
5. **Judge the final review the same way, then STOP.** Its fixes get ONE delta-scoped check of those fix commits alone; its rejections get a refuter; its deferrals and minor findings are recorded and applied. The cycle ends when nothing must-fix is left OPEN, which means the check came back with nothing, or there was no fix to check because every must-fix finding it raised was rejected or deferred. A check that does find something must-fix gets that fixed and ONE more check of the same shape, and if that one does too, stop and report the PR unfinished. The final review is never re-run and the delta rounds are never re-entered.

**Do not file follow-up issues for what a review turns up.** A finding that is real but out of scope goes in the reply to the owner, who decides whether it becomes tracked work. A small tweak in a file the PR already touches is folded into the PR instead. This is the standing no-proactive-follow-up rule, and it applies to review findings like anything else.

**Minor or must-fix.** MUST-FIX when the finding touches what ships: source, a test's ability to OBSERVE the defect it claims to cover (a tautological assertion that stays green with the bug present counts), or a factual claim about runtime behavior in docs (a stated default, limit, or condition list). MINOR is everything else: wording, naming, comment style, PR-body counts, nits about the review artifacts. Judge by SURFACE, never by importance, because importance is judged by the same agent that wants to stop. When it could go either way, it is must-fix.

**Every reviewer is the same spawn:** the Agent tool, `subagent_type: "general-purpose"`, `model: "opus"` (Opus 5, always, no other model anywhere in the cycle), `run_in_background: true`, `isolation: "worktree"`, carrying the prompt template at the end of this section. Reviewers are fresh and ONE-SHOT: a reviewer that carries context across rounds re-derives its own conclusions, which is the blind spot a fresh one exists to avoid.

**Give the reviewer the diff and nothing else.** The PR diff, the PR title and body, the touched files, and the rule files it judges against (`AGENTS.md`, `CONVENTIONS.md`). NEVER prior PR comments or reviews, and never a growing list of already-handled findings: on #1159 the comment payload alone reached 171 KB by the fifth round. An unbiased reviewer is the point, and a duplicate finding costs you a second of reading.

**Do not tell it what to look for.** The prompt sets the SCOPE (which diff) and nothing else: no list of defect classes, no "specifically check for X and Y", no ranking of what matters, however sure you are about where the risk sits. A checklist narrows a fresh reviewer to what you already suspect, which is the bias it exists to escape, and everything outside your list becomes what it does not look at. The one exception is a REFUTER, whose whole job is the single claim it is handed. Naming the touched files is scope; naming the bugs to hunt is steering.

**Keep the cycle fast.** After a fix, run only the test file(s) covering the line you changed, with the counterfactual toggle the Definition of done mandates (a fix can make an older test non-discriminating without failing it). The e2e, full Node, browser, and Bun suites and the two-app dogfood check run ONCE, after the cycle ends. CI is not read during the cycle at all, and not at the end of it either. It is read once, at merge, under the merge gate below. Both rules change WHEN work happens, never WHETHER.

**Do not restore what this replaced.** This cycle used to run a 16-agent fleet with a scout, parallel lenses, and a jury, pick round 1's shape by a path check, sort findings into two tiers, cap itself at five rounds, and poll a file to watch each spawn. Almost all of it is gone on purpose: termination is mostly structural now (only a fix buys a round, delta rounds narrow the question, the minor call stops wording from buying rounds, the final review plus one fix-check is a hard end). Reviews are async, so the harness completion notification is the signal, with at most an optional background progress check that never kills anything. The one exception to the removals is the round cap, which came back in a narrower form, because structure alone cannot bound a chain where every fix produces the next round's finding: it now bounds ONLY that case, at five delta rounds, instead of counting every round of the cycle.

The two-review minimum went the same way, and this is the part most likely to be "restored" by mistake. It was introduced on the reasoning that a lone reviewer's miss is the cost of dropping the fleet and the final pass is what covers it. That reasoning was right about the risk and wrong about the price: it charged EVERY PR a second 10 minute round to cover a miss that mostly matters on a few surfaces, and in practice the second read on a small single-surface diff came back clean or minor. So the final review is now bought by evidence rather than owed by default, through the escalation ladder above, which keeps the protection where it pays. Do NOT reinstate an unconditional final review or an unconditional two-review floor; if the ladder is letting real defects through, tighten a TRIGGER, which is the knob that was built for it.

Each round must:

1. **Spawn the round's reviewer** per the spawn spec, and act on the harness completion notification when it arrives. Do not badger it for results and do not re-read its message hoping for a different answer.

   **Liveness.** Only two things are evidence a reviewer is alive: the harness status, and byte growth on its transcript when the output file is one. Its own prose never is (one signed off with "I'm partway through the careful pass" while its status read `killed`).
   - **A dead spawn is not a round.** Declined, errored, killed, or empty means nothing ran. It does not count toward the cycle and does not advance it.
   - **Waiting is not blocking.** The spawn is async precisely so the turn stays free, so never wait on it with a foreground `sleep`: that stalls everything and hands back exactly what the async spawn bought. Keep working, or, if there is genuinely nothing else to do, do NOTHING and let the completion notification arrive. A blocking probe is worse than no probe.
   - **A progress check is optional, runs in the BACKGROUND, and never kills.** Rising bytes on the spawn's output path (`stat -c %s`, following the symlink) prove it is working, so leave it alone however long it has run. Nothing proves the opposite: a file that never grows may simply be a stub the harness does not write to, and elapsed time never proves a stall, since reviewers here routinely run 5 to 10 minutes while working normally. So there is no AUTOMATIC re-spawn trigger short of a killed or errored harness status; never wire one to a flat file or a timer. Giving up applies ONLY where there is no growth to see (a flat file, a stub-backed spawn), and "none to see" means you PROBED and saw none, never that you did not look, so the probe is optional only while you are content to wait and required before you give up. There it is a DELIBERATE call, weighing how long it has been against what a restart costs, and that judgement is the one place elapsed time legitimately counts. A transcript that is still growing is never abandoned, whatever the clock says. Giving up means STOPPING it (`TaskStop`) and re-spawning, so there is never a second reviewer in flight, no question of which return is the round, and no late result to reconcile. Never read the transcript's contents: it is large enough to swamp your own context, and a subagent's words are not evidence either way.
   - **A reviewer that returns without reviewing is also not a round.** Anything that is not a finding list or the literal `CLEAN` is a non-review, including "I could not fetch the diff", a refusal, or an answer to another question. The absence of findings is not a clean round. A REFUTER is the one exception, since its job is not to review: it answers `REFUTED` or `STANDS`, and either is a complete result.
   - **Re-spawn rather than asking.** Spawn it again, varying the approach after a few identical failures. Never stop mid-cycle to report a failed spawn or hand back a half-finished cycle.
   - **NEVER substitute an inline self-review.** Reviewing your own work re-derives the assumptions that produced the bug; that downgrade already shipped three real bugs through a PR two inline passes had called clean. Only a reviewer that cannot be produced at all stops the cycle, reported once at the end and kept out of the PR (a spawn that could not run is session tooling, not a fact about the change).

   **Working-tree safety.** Every worktree shares ONE `.git`, so a reviewer's git write reaches this session's checkout (one ran `git checkout main` mid-cycle and the local checkout regressed).
   - `isolation: "worktree"` on every spawn, so a stray checkout cannot move the files under this session.
   - The read-only git prohibition in the prompt, which covers the shared refs and config that isolation cannot.
   - After EACH spawn resolves, before acting on findings, check the repo: `git rev-parse --is-inside-work-tree` is `true` and `git config --get core.bare` is NOT `true` (spawning isolated reviewers has flipped it; repair with `git config core.bare false`, then `git worktree prune`, plus `git worktree remove -f -f .claude/worktrees/agent-*` for a locked leftover, never touching worktrees outside `.claude/worktrees/`). In the task's worktree, HEAD is still the feature branch and `git status` is clean; in the primary, HEAD is `main` (`git checkout -f main` if it moved). Run it after failed spawns too, since a spawn that died after creating its worktree is the likeliest leaker. GitHub is unaffected either way; this only repairs the local repo.

2. **For each finding, do exactly ONE of three things.** There is no fourth, and "mention it and move on" is not one. A REFUTER, a fresh spawn told to DISPROVE a claim (does it reproduce in the code as written, is the behavior intended, is it already guarded or tested somewhere the finder did not look), has two uses here: BEFORE acting on a must-fix finding whose fix would be expensive or behavior-changing, and AFTER rejecting any must-fix finding, since a rejection is your own unadjudicated judgment and one cheap spawn is what adjudicates it. That second use is what a rejection buys instead of a whole round, and it terminates: one spawn per rejection, never a refuter of a refuter. A refuted finding is a rejection carrying the refuter's reason. On the post-rejection use only, a refuter that answers `STANDS` has contradicted your rejection, so the rejection does not hold: fix the finding, or defer it if it is genuinely out of scope. That is one of the three dispositions arriving late, not a fourth. In a delta round the fix it usually produces buys its round like any other; on the final review it joins that phase's single fix-check instead, since the final review is never re-run. (On the pre-action gate there is no rejection yet, so `STANDS` there simply means the finding is real and you act on it.) The two uses fail differently when no refuter can be produced: on the pre-action gate, act on the finding as real, since the gate is an optimization and must fail toward the finding being genuine; on the post-rejection adjudication, keep the rejection but record it as UNREFUTED on its thread and carry it into the end-of-cycle report, so the user can second-guess it. Trivial or obviously-real findings skip the first use.
   - **Fix it** on the branch (commit + push to update the PR), OR
   - **Reject it** with a one-sentence reason, stated to the user and recorded on the finding's thread. Rejection has to be defensible ("flagged as a security issue, but this runs server-side only and never sees user input"), not hand-waved. OR
   - **Defer it** when it is genuine but out of scope (a pre-existing bug, an unrelated hygiene problem, a separate feature). A finding on code this PR adds or changes is NEVER out of scope, whatever its size. Deferral is not a way to drop a finding: record it on the thread, and carry it into the end-of-cycle report, where the USER decides what gets filed (the cycle never files a follow-up issue on its own; invoke `webjs-file-issue` only on their go-ahead). **The final summary review also carries a deferral ledger**, one line per deferral with its reason, so a cold reader sees them all without walking the threads. When unsure, fix it here.


   **Record every finding ON THE PR**, through the mechanics in `### Every PR review is posted ON the PR` and `### Follow the real review flow`, which are authoritative: one review object per round carrying the summary plus every inline `file:line` finding, each stating the problem only, with the disposition (`fixed in <sha>` / `rejected because <reason>` / `deferred as out of scope because <reason>`) in a threaded reply, then the thread resolved. Post rejections and false positives too, so the reasoning is auditable. A round that found nothing posts a short summary saying so. Build the review JSON with a real serializer, never by interpolating into a shell string: a review on #1115 lost every code reference to shell command substitution and had to be reposted.

**When the cycle FINISHES, run everything it deferred:** the full suites for every layer the change touches (e2e, Node, browser, Bun matrix, the two-app dogfood boot check, per the Definition of done). Launch them as parallel background tasks in one batch and collect EVERY result before reporting: a task you forget to collect is a silently skipped layer. A cycle that STOPPED unfinished runs none of this and says so in the report, because these gate the flip to ready for review and that flip is not happening.

**A fix is never the end.** A fix changes the branch, so the changed branch needs its own round; that is what the delta rounds are, and why a round with no fixes still buys the final review. Never report "fixed it" or "ready to merge" off a round that found something must-fix, however obviously correct the fix looks. On #1159 three consecutive rounds each found problems introduced by the previous round's fix, which is what a re-used reviewer, already invested in that fix, is worst at seeing.

**A standalone "review the PR" request IS this cycle, not a one-shot.** Re-enter at round 1 over the whole diff however many times the PR has been reviewed before, since the ask itself says the existing trail is not trusted. It also overrides the trivial-change skip below: when the user asks for a review, they get one. Then fix, reject, or defer, run the delta rounds, run the final review, and only then report back.

### When to skip the cycle

Skip only for PRs that change a single line of trivially-correct content (a doc typo, a renamed local variable, a one-token config bump). Anything that touches logic, public surface, the build, the importmap, security-relevant code, or multiple files goes through the cycle without exception. A bias toward running it is correct; a bias toward skipping it is the exact failure mode this rule exists to prevent.

### Reporting after the cycle

After the final review (and its fix-check, if it had one) and the deferred suites, report exactly this shape:

> PR #<N> is up at <URL>. Reviewed it over <K> rounds plus a final pass over the whole diff; nothing must-fix is left open. Issues found and fixed: <one-line list, or "none">. Out-of-scope findings, recorded on the PR and awaiting your call on filing: <one-line list, or "none">. Ready to merge.

When anything was deferred, expand each one right there (the finding, its one-sentence reason, its thread), and END WITH A DIRECT QUESTION, on its own line, asking whether to file follow-up issues and which ones. Filing happens only on the user's answer; silence is never consent.

**Only a round where a fresh subagent actually REVIEWED counts toward `<K>`.** A declined, errored, killed, or empty spawn produced no round, and neither did one that returned without reviewing, so neither can be the final review nor part of the total. An inline pass of your own is not a round at all. A cycle whose reviewer never reviewed has run ZERO rounds, and the honest report is that the review is blocked and why, not a count and not "ready to merge".

If you cannot honestly say the final review left nothing must-fix open, you cannot say "ready to merge". Mention any finding you rejected as a false positive so the user can second-guess it. Every finding must be accounted for here as fixed, rejected-with-reason, or deferred, and must also appear on the PR, so the report and the PR agree; a deferred finding missing from its thread, this report, or the ledger is a dropped finding.

**Merge is gated on green CI, enforced at the branch level, not by trust.** A PR must not merge until all CI checks pass. `main` branch protection requires the five `ci.yml` checks (Conventions, Unit+integration, Browser, E2E, Build) before any merge; if `gh api repos/webjsdev/webjs/branches/main/protection` shows `required_status_checks: null`, run `bash scripts/protect-main.sh` once (needs repo admin) to restore it. Do not work around a red or pending check. Wait for green, and fix whatever is red before merging.

**This is the ONLY place CI is read, on purpose. Do not add one back to the end of the review cycle.** An end-of-cycle read was removed because it was redundant against this gate: branch protection refuses the merge whatever the report claimed, so a red check gets caught and fixed right here, and reading it earlier only parks the finished cycle on a multi-minute CI run. What that costs is worth stating plainly, because it looks like a gap. Every `ci.yml` job with no counterpart in the deferred local suites now fails for the first time at merge rather than before the ready signal. That is a CLASS, not a list. Its membership moves as jobs are added and as the local suites grow to cover them, so derive it when you need it, by reading `.github/workflows/ci.yml` against the deferred set named above. Do NOT write the membership down here.

That instruction is the finding of two failed attempts, both made while writing this very paragraph, and both caught only by review. The first named the webjs.nvim vendored-intellisense drift guard and the `Build (@webjsdev/core dist)` job as members. Neither is one: `scripts/run-node-tests.js` walks `packages/editors/<sub>/test/`, so `vendor-sync.test.mjs` runs in the full Node suite, and `test/packaging/build-dist.test.js` shells the same `scripts/build-framework-dist.js` that `build:dist` runs, so a bundling break reds locally too. The second attempt closed the list at the survivors and read complete while omitting `E2E (blog served on Bun)`, which IS a member, because `scripts/run-bun-tests.js` excludes the `e2e/` segment and the deferred e2e arm is the Node-served run. A list here is wrong in one direction or the other, and each wrong version is load-bearing, since the trade below only holds if the membership is right.

The class is real and not small, and what it costs is the same work done later rather than work skipped, which is the trade that was chosen. It is a real cost rather than a free one. The local suites the Definition of done demands still run at the end of the cycle and still gate the flip to ready for review, so only the CI read moved.

**NEVER use `gh pr merge --admin` to bypass a FAILING check.** `--admin` skips ALL branch-protection gates, not only the review requirement, so a red check merges silently and lands broken code on `main`. This has happened (a Unit-test failure was admin-merged, breaking `main`). It is acceptable ONLY to bypass a required-review gate on a PR whose CI is confirmed all-green, so re-run `gh pr checks <N>` first and confirm EVERY check reads `pass` (a `BLOCKED` state can mean review-required OR a failing check, so never assume which).

### Subagent prompt template

One template serves every reviewer in the cycle: round 1, each delta round, the final whole-diff review, the final review's fix-check, and a refuter. Only the question in its numbered step 5 changes.

```
Review PR #<N> (branch `<branch>`) at https://github.com/webjsdev/webjs/pull/<N> for anything genuinely wrong with it, judged against the project's AGENTS.md and CONVENTIONS.md (root + per-package).

HARD CONSTRAINT, read first: you are running against a repository the main session is actively using, and every worktree of it shares ONE `.git` directory, so a git write here reaches the main session's checkout even from an isolated worktree. You are a READ-ONLY reviewer. Do NOT run any command that changes git branch, HEAD, the index, or the working tree: no `git checkout`, `git switch`, `git reset`, `git restore`, `git stash`, `git pull`, `git fetch` that moves refs, `git merge`, `git rebase`, `git clean`, `git branch -f`, or `git worktree`. Any of these silently corrupts the main session's checkout (it moved HEAD off the branch and looked like lost work, and a stray worktree op once flipped the shared repo's `core.bare` to `true`). You do NOT need to switch branches to review. Use `gh pr diff <N>` and `gh pr view <N>` for the diff and metadata, and read any file at its PR-branch state with `gh api repos/<owner>/<repo>/contents/<path>?ref=<branch> --jq .content | base64 -d`. All of those read from GitHub, so they work whether or not the branch exists locally, which matters because a PR you were asked to review may not be checked out here at all. If the branch does happen to be the one checked out, reading files in place is fine too. The only git you may run is read-only inspection (`git log`, `git show`, `git diff` WITHOUT changing state, `git status`, `git blame`). If you think you need to change git state to do the review, you are wrong; report what you found instead.

You start with no prior context on this PR. Steps:

1. Run `gh pr diff <N> --repo webjsdev/webjs` to see the full diff.
2. Run `gh pr view <N> --repo webjsdev/webjs --json title,body` to see what the author claims it does.
3. Read every file the diff touches in its current state (not just the diff hunks) so you see edits in context.
4. Read root AGENTS.md, the per-package AGENTS.md for each touched package, and CONVENTIONS.md if a scaffolded template was touched.
5. The question for this round is a SCOPE, not a checklist: <Round 1 and the final review: the whole diff. A delta round or a fix-check: the fix commits' diff, and trace their blast radius, grepping every symbol, rule, or concept the fix touches across the whole PR surface and comparing each other occurrence, since a small fix can break something far from its own hunk. A refuter: DISPROVE this claim, <the finding>.> Review it as a whole and report whatever is actually wrong.

Report findings as a numbered list with file:line references. Problems only. No suggestions, no nits about style if the rule isn't enforceable. If you find nothing genuinely wrong, say exactly `CLEAN` on its own line and stop. Do not pad with "looks good overall" or summaries. (A REFUTER answers differently, since it is judging one claim rather than reviewing: say exactly `REFUTED` or `STANDS` on its own line, then one or two sentences of reason, and ignore the finding-list and `CLEAN` contract entirely.)

If you CANNOT review (you could not fetch the diff, you have no access to the repo or PR, the branch does not resolve), say exactly `BLOCKED` on its own line followed by one line naming what you are missing. Do NOT report `CLEAN` in that case: `CLEAN` means you looked and found nothing, and reporting it for a review you could not perform is the single worst outcome here, because it ends the cycle on a review that never happened.
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
2. Bump `version` in each `packages/<pkg>/package.json` (edit ONLY the version line; do not reformat the file). Level: **patch** for a `fix`/`feat`/`perf` while the package stays in one minor line (dependents pin `^0.x.0`); **minor** only when you are also ready to widen every dependent's caret range; **major/breaking** for an actual breaking change. **If the bump includes `@webjsdev/intellisense`, re-vendor on this branch** (`node packages/editors/nvim/scripts/vendor-intellisense.mjs` then `git add -f packages/editors/nvim/vendor`), because webjs.nvim ships a committed copy of that manifest and the drift guard compares it in full, version included. Skipping it reds CI, and skipping it silently is how the plugin once shipped misreporting its own language-service version (#1117).
3. Dependent ranges: `grep -rn '"@webjsdev/<pkg>"' --include=package.json . | grep -v node_modules`. A patch stays within the existing caret, so no edits; a minor needs every dependent range widened.
4. `npm install --package-lock-only` and stage `package-lock.json` (a desync reds CI's `npm ci`).
5. Changelog: the pre-commit hook runs `scripts/backfill-changelog.js`, which parses `^(feat|fix|perf|breaking):` from commit subjects in the package's tree. **Squash-merge subjects are PR titles with no conventional prefix, so the generator finds nothing and the hook fails.** Hand-write `changelog/<pkg>/<version>.md` (match an existing file's frontmatter: `package`, `version`, `date`, `commit_count`; sections ordered Breaking, Features, Performance, Fixes; entries link the PR and the squash commit) and stage it; then the commit passes.
6. Open the release PR. Note in the body that merging it adds the `changelog/**.md` files to `main`, which triggers `release.yml` to `npm publish` and cut GitHub Releases (idempotent).
7. Run the review cycle on it too (a release publishes to npm; a wrong bump level, missed package, or inaccurate changelog is worth catching). Merge is still user-gated.

### Then: make sure the deployed Railway services actually picked it up

A merge updates `main` and npm, but the two in-repo apps deployed to Railway (`examples/blog`, `website`) keep serving the OLD code until they redeploy. After merging a change that affects what those services serve (framework code in `core`/`server`, or an app's own files), verify each service is now running the new `main`, automatically, without being asked. A user-visible fix is not actually shipped until the running service has it.

**Check (needs `railway login`; the Railway MCP):** for each service, `mcp__railway__list_deployments` and compare the latest SUCCESSFUL deployment's commit hash to `git rev-parse origin/main`. A service whose running commit is an ancestor of (behind) `main` is stale. If `mcp__railway__whoami` returns "Not authenticated", say so and ask the user to run `! railway login`; do not guess.

**If a service is stale, trigger a redeploy.** Two mechanisms, in order of preference:
1. If the Railway MCP is authenticated, `mcp__railway__deploy` the stale service directly. No commit, cleanest.
2. Otherwise, the user has authorized a **zero-diff empty commit to `main`** as a deploy trigger: `git commit --allow-empty -m "chore: trigger Railway redeploy (<reason>)" && git push origin main`. THIS IS THE ONE SANCTIONED DIRECT PUSH TO `main` (everything else goes through a PR). It is explicitly NOT a code change and bypasses no review, because there is nothing to review; its sole purpose is to give Railway's auto-deploy a new commit to deploy.

**Nuance, do not over-fire the empty commit.** Railway services connected to a GitHub branch auto-deploy on every push BY DEFAULT, so a real merge already triggered the redeploy and an empty commit right after would be redundant; only the version-bump/merge commit itself is needed. The empty commit is the fix for the narrower case where a service has Railway **watch-paths** configured (it only redeploys when files under its own path change), so a framework-only change (e.g. `packages/core`) did not trigger the app service. A no-diff empty commit also will NOT match a restrictive watch-path, so if the check shows a watch-path-filtered service still stale, prefer mechanism 1 (MCP `deploy`) or tell the user the service needs a manual redeploy / a watch-path that includes the framework packages. So: check first, redeploy ONLY the services the check proves are behind, and report which services you redeployed and how.

## What this skill does NOT do

- Opens the PR as a DRAFT at the START (step 6), not at the end. It is NOT created late once all the work is done. At draft-create time:
  - The body MUST include `Closes #<N>` near the top so merging auto-closes the issue and the project card auto-moves to Done. If the work turns out to only partially address the issue, use a plain `#N` reference, not `Closes`.
  - The PR MUST be assigned to vivek7405 (`gh pr create ... --assignee vivek7405`). Matches the project's per-issue-owner convention.
  - It stays a draft until the Definition of done is satisfied and the review cycle has finished; then `gh pr ready <N>` flips it to ready for review.
- Does not make commits FOR you. Subsequent work follows the standard webjs git workflow (commit per logical unit, push after each, run tests before committing); those commits stream onto the already-open PR.
- Does not merge. Merging is always user-approved per the project's git rules.

## Failure handling

- If the TASK worktree's `git status` is dirty at start (a prior session died mid-work in it): stop and ask the user to commit, stash, or abandon that work. Never silently lose changes. A dirty PRIMARY checkout is not a blocker and not yours to fix; the worktree cuts from `origin/main` regardless.
- If the issue is already in `In progress` (someone else's work, or a prior branch left open): report this and ask the user whether to continue on the existing branch, branch off a fresh main, or pick a different issue.
- If the TASK worktree regressed mid-loop (its HEAD detached or off the feature branch, work seemingly "gone"): a review subagent mutated shared git state. In the PRIMARY, HEAD on `main` is the healthy state, not a regression. Do NOT panic or redo work. The local feature-branch ref and `origin/<branch>` still point at the latest commit (every logical unit was pushed). Recover with `git -C <task-worktree> checkout <feature-branch>` (anchored: run bare from the primary it would succeed and park the PRIMARY on the feature branch, since a detached worktree no longer holds it); confirm with `git log --oneline origin/main..HEAD` and `git status` clean. The PR on GitHub was never affected (the GitHub-reading reviewer still saw correct content), so no re-push or force-push is needed.
- If the FIFTH delta round still produces fixes: commit them, then stop instead of running a sixth. What makes this stop unfinished is not open findings, since that round's findings were fixed, but that its FIXES are on the branch unreviewed, so say exactly that. Report the rounds run, those unreviewed fixes, anything rejected or deferred along the way, and your read on why the fixes keep breaking something. Withhold the flip to ready for review; the branch, the commits, and the card all stay exactly as they are, and the deferred suites do not run, since they gate a flip that is not happening.
- If the final review's fix-check keeps surfacing must-fix findings (two of them in a row): stop there per the last step of the cycle, withhold the flip to ready for review, and report the rounds run, the open findings, and your read on why the fixes keep breaking something. The branch, the commits, and the card all stay exactly as they are.
- If a round's reviewer cannot be produced (a spawn declined at the permission prompt, an internal error, a killed task, a reviewer you stopped and re-spawned, or a return that is neither a finding list nor `CLEAN`): the round did not happen. Re-spawn it, varying the approach after a few identical failures, and do NOT stop mid-cycle to report the failure or ask how to proceed: recovering costs seconds and interrupting costs the cycle its momentum. Only a reviewer that cannot be produced at all blocks the cycle; then withhold the flip to ready for review and say once, at the end, that the review did not run and why. Keep that out of the PR body and PR comments, since a spawn that could not run is session tooling rather than a fact about the change. Do NOT review it yourself inline and count that as the round; an inline pass is what let three real bugs through a supposedly clean PR. The branch, the commits, and the card all stay exactly as they are. Full rules in the liveness block of the review cycle.
- If the `gh project item-edit` call fails (auth scope, missing field): report the failure clearly and offer to do the move manually via the web UI. The branch creation still stands.
