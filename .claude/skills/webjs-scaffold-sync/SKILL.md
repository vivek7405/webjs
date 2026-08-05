---
name: webjs-scaffold-sync
description: Use this skill whenever a change affects what `webjs create` GENERATES (a new or changed gallery/showcase demo, a new template, a changed generated file like the layout/home/theme/schema, a new convention that belongs in generated apps, a new scaffold-shipped config/hook) OR what the agent skill `.agents/skills/webjs/` (SKILL.md + references/) TEACHES, OR when the user asks to sync the scaffold or the skill, "update all three templates", check the scaffold is consistent, keep the skill in sync with framework features, or teach agents how to use WebJs. The scaffold teaches AI agents through TWO surfaces that must stay in sync with the framework: the agent skill `.agents/skills/webjs/` (the DURABLE teacher, the only surface that survives `gallery:clear`) and the runnable gallery (DISPOSABLE, removed by `gallery:clear`). A feature change usually needs BOTH. A change to either must propagate in lockstep across the skill, the generators, the per-agent rule files, the scaffold tests, the framework docs that describe the scaffold, and the preview/example apps. This skill is the authoritative map of every surface plus the change-type to surface mapping, and the mandatory "generate + boot + check" verification, so no surface is silently skipped. Complements webjs-doc-sync (which owns framework API/behaviour docs); this skill owns what the scaffold and the skill teach.
when_to_use: |
  Examples that should trigger this skill:
    "add a new demo to the feature gallery"
    "the gallery should also ship in the saas template"
    "update all three scaffold templates with this"
    "add a backend-features showcase to the api template"
    "make sure the scaffold teaches agents how to do X"
    "does the skill teach everything the gallery demonstrates?"
    "keep .agents/skills/webjs/ in sync with this feature"
    "the gallery demoes X but the skill does not mention it"
    "did we keep the scaffold rule files in sync?"
    "the saas home / theme / schema changed, sync everything"
    finishing any change to what `webjs create` generates OR what the
    agent skill `.agents/skills/webjs/` teaches
  Do NOT trigger for: a framework API/behaviour change with no scaffold
  impact (use webjs-doc-sync), or a pure-internal refactor of the CLI
  that does not change generated output.
---

# Keep every scaffold surface in sync with what `webjs create` generates

The scaffold is the **primary way AI agents learn WebJs**, through TWO teaching
surfaces that must stay in sync with the framework:

1. **The agent skill `.agents/skills/webjs/`** (SKILL.md + references/): the
   DURABLE teacher. It is the ONE canonical source (bundled into every scaffold
   at prepack via `scripts/sync-scaffold-skill.mjs`, and the repo's own agent
   guide). Crucially, `gallery:clear` strips the whole gallery to a blank slate,
   so the skill is the ONLY teaching surface that SURVIVES, and after a clear it
   is the agent's sole reference. A feature the skill does not teach is lost the
   moment an agent clears the gallery.
2. **The gallery** (`packages/cli/templates/gallery/**`): runnable, densely
   commented demos an agent learns the idioms from by reading and running, then
   adapts. It is DISPOSABLE (removed by `gallery:clear` before real work begins).

So a change to a WebJs FEATURE usually needs BOTH: the skill updated (the durable
pattern) AND a gallery demo (the runnable illustration). A change to what
`webjs create` emits is a first-class change with MANY surfaces, and the
recurring failure is updating one (usually a template file, or the gallery but
not the skill) while the skill, the per-agent rule files, the scaffold tests, the
framework docs, and the preview apps drift behind. This skill closes that gap.

It is the sibling of `webjs-doc-sync`. Division of labour:

- **webjs-doc-sync** owns the framework's API/behaviour docs (the root `AGENTS.md`
  API sections, `agent-docs/*.md`, docs-site topic pages, the marketing website).
- **webjs-scaffold-sync** (this skill) owns what the scaffold GENERATES and the
  surfaces that DESCRIBE the scaffold.

They overlap on two surfaces (the scaffold's per-agent rule files, and the
template matrix in the framework docs/README). Whichever skill reaches that
surface must update it; when in doubt run both.

Enforcement is TWO tiers, deliberately mirroring how tests are enforced (a
commit-time floor plus an un-skippable CI gate):

- **Tier 1, the commit floor.** `.claude/hooks/require-scaffold-with-src.sh`
  BLOCKS a commit that stages framework-feature source (`packages/(core|server|cli)/src`)
  with no teaching surface in the same commit (escape hatch
  `WEBJS_NO_SCAFFOLD_GATE=1`). A teaching surface is EITHER the scaffold
  (`packages/cli/templates` or `packages/cli/lib`) OR the agent skill
  (`.agents/skills/webjs/`), since the skill is the durable half of the teaching
  pair. Like the test commit gate, it only proves you *touched* a teaching file;
  it cannot tell a real demo from a doc bullet, nor that you updated BOTH the
  gallery and the skill where both were needed, which is exactly how #848 slipped
  (forbidden()/unauthorized() staged doc bullets, shipped no gallery demo).

- **Tier 2, the CI coverage gate.** `test/scaffolds/gallery-coverage.test.js`
  reconciles the LIVE framework surface against the hand-curated
  `test/scaffolds/gallery-coverage.json` manifest and FAILS when a new surface is
  neither demoed nor exempted. It gates THREE surfaces: **`@webjsdev/core`
  exports** (a `{ demo }` pointing at a gallery file that references it),
  **`@webjsdev/server` exports** (`{ demoed: true }`, verified by a generated app
  importing it), and **routing convention files** (the stems the router parses,
  DERIVED from `packages/server/src/router.js` so a new `stem === '...'` branch
  auto-appears, each demonstrated by a file in a generated app). Every entry is
  `demo`/`demoed` or `{ exempt }` with a reason (`internal: ...` for plumbing,
  `deferred: ...` for an agent-facing surface not yet demoed). It runs on every
  `npm test` and in CI, so it cannot be skipped with a local `--no-verify`, the
  analogue of "a test must exist AND pass": a new export or convention turns CI red
  until it is classified. **When you add or rename a core/server export, or add a
  routing convention file the router parses, update the manifest** (a demo, or an
  honest exemption), the same reflex as writing a test.

THIS skill does the substantive per-surface judgment and the generate-boot-check
verification that neither tier can automate.

## The complete scaffold surface map

Treat this as the universe. For any scaffold change, decide per surface whether
it applies, then update or consciously skip each.

1. **The agent skill `.agents/skills/webjs/`** (the DURABLE teacher, canonical at
   the repo root, bundled into every scaffold at prepack). It is the surface most
   likely to be forgotten and the most important to keep current, because it is
   the ONLY teaching surface that survives `gallery:clear`. A new feature, export,
   idiom, or convention MUST be taught here so an agent building AFTER a clear
   still learns it:
   - `.agents/skills/webjs/SKILL.md` (the router: add the concept to the right
     "what this covers" line and route to the reference).
   - `.agents/skills/webjs/references/*.md` (the focused reference the feature
     belongs to, e.g. `data-and-actions.md`, `client-router-and-streaming.md`,
     `components.md`, `styling.md`, `built-ins.md`). Add the API + the idiom +
     the gotcha, matching the depth of the sibling entries.
   - Edit the repo-root copy; `scripts/sync-scaffold-skill.mjs` bundles it into
     `templates/` at prepack (do NOT hand-edit a bundled copy).
2. **The generators** (the code that writes the app):
   - `packages/cli/lib/create.js` (the main generator: layout, home page, the
     theme block, db/schema, the full-stack gallery wiring, the per-template
     gates like `isApi` / `isFullStack` / `!isApi`).
   - `packages/cli/lib/api-gallery.js` (the api backend-features showcase). Auth
     is a full-stack GALLERY card now (`templates/gallery/{app/features/auth,
     modules/auth}`), pruned by `gallery:clear`, not a separate template.
   - **The `gallery:clear` reset scripts (BOTH templates, MANDATORY parity).**
     `packages/cli/templates/scripts/clear-gallery.mjs` (full-stack) strips the
     app to a barebones blank slate (the gallery routes + modules, the example
     design system `components/ui/`, `lib/utils/ui.ts`, the example theme-toggle +
     its layout wiring, the example tests, empty leftover dirs), keeping only the
     buildable base + the skill. `packages/cli/templates/scripts/clear-api-gallery.mjs`
     (the `api` template) does the same for the backend showcase (`app/api/features`,
     the demo modules, `env.ts`, the widgets test), keeping the health + users base.
     **RULE: any NEW gallery artifact (a route, a module, a shared component, a lib
     helper, a schema table) MUST be added to the matching clear script's removal
     list in the SAME change, or `gallery:clear` leaves it behind and the app is not
     a blank slate.** This is enforced by `test/scaffolds/scaffold-gallery.test.js`
     (full-stack: asserts `modules/` and `components/` are EMPTY after clear, so a
     forgotten module/component fails) and the api clear test in the same file; run
     them after any gallery change.
   - Any future `*-template.js` / `*-gallery.js` split out for escaping sanity.
3. **The verbatim template files** copied into every app:
   - `packages/cli/templates/gallery/**` (the UI feature gallery + example app,
     shipped in full-stack AND saas).
   - `packages/cli/templates/**` (everything else copied per app: `lib/utils/ui.ts`,
     `public/`, `tsconfig.json`, `gitignore`, `.hooks/`, the metadata/route stubs).
4. **The per-agent rule files** (LOCKSTEP: all carry the SAME rules in each
   agent's format, the #134/#136 divergence lesson). A convention/workflow change
   for generated apps must land in ALL of them together:
   - `packages/cli/templates/AGENTS.md`
   - `packages/cli/templates/CLAUDE.md`
   - `packages/cli/templates/CONVENTIONS.md`
   - `packages/cli/templates/.cursorrules`
   - `packages/cli/templates/.github/copilot-instructions.md`
   - `packages/cli/templates/.agents/rules/workflow.md`
   - `packages/cli/templates/.gemini/**`, `.opencode/**`, `.claude/**` (whatever
     per-agent rule files the scaffold currently ships; enumerate, do not assume)
5. **The scaffold tests**: `test/scaffolds/*.test.js` (e.g. `scaffold-gallery`,
   `scaffold-ui-integration`). A new demo/template/generated-file assertion goes
   here, including the counterfactual (a per-template exclusion test).
6. **The framework docs that DESCRIBE the scaffold** (shared with doc-sync):
   - Root `AGENTS.md` "Scaffolding" section.
   - The docs site: `website/app/docs/getting-started/page.ts` (+ `backend-only`,
     `ai-first`, `conventions` where they describe generated structure).
   - `README.md` (the template matrix + the "scaffold is the tutorial" note).
7. **The CLI surface**: `packages/cli/` `--template` validation + `--help`/usage
   text when a template or flag is added or renamed.
8. **The preview / example / dogfood apps**: `examples/blog/` and any in-repo
   apps, plus the local preview apps the user tests, when a convention they
   demonstrate changes.

## Change-type to surface mapping

| Change | Surfaces that MUST be checked |
|---|---|
| New / changed **WebJs feature, export, idiom, or convention** an agent must know | **the agent skill** `.agents/skills/webjs/` FIRST (SKILL.md routing line + the right `references/*.md`), the DURABLE teacher that survives `gallery:clear`, THEN a gallery demo (surface 2/3). Skill-without-demo means no runnable example; demo-without-skill means the pattern is LOST the moment an agent clears the gallery. A feature needs BOTH. |
| New / changed **gallery or showcase demo** | the template file(s) or generator strings for the demo + the home-page `features`/index array + the scaffold AGENTS.md gallery list + **the matching `gallery:clear` removal list** (`clear-gallery.mjs` for full-stack, `clear-api-gallery.mjs` for api, so the new demo/module/component/lib artifact is stripped to a blank slate) + `test/scaffolds/*` FEATURES/assertions + **generate + boot the affected template + run `gallery:clear` and confirm a blank slate** |
| **Removed / renamed gallery artifact** (a demo route, a module, a shared component, a lib helper, a schema table the gallery added) | the matching `gallery:clear` script's removal list (add the new path; remove a stale one) + the blank-slate clear test (`test/scaffolds/scaffold-gallery.test.js`) + **generate + run the clear + assert nothing gallery remains** |
| New / removed **template** | the `create.js` template branch (+ a `*-template.js` if large) + the "only N templates exist" list in EVERY per-agent rule file + the framework `AGENTS.md`/getting-started/README template matrix + the CLI `--template` validation + `--help` + `test/scaffolds/*` |
| New **control-flow throw or routing boundary file** (`notFound` / `redirect` / `forbidden` / `unauthorized` and their `not-found` / `forbidden` / `unauthorized` / `error` / `loading` / `global-error` / `global-not-found` boundary files) | a runnable **gallery demo** that exercises it (a route that throws it plus the nearest boundary file), NOT just an app-tree bullet in the rule files + the home-page `features` array + `test/scaffolds/*` FEATURES/boundary-file asserts + **generate + boot + hit the route**. A doc bullet in `AGENTS.md` / `CONVENTIONS.md` is necessary but NOT sufficient: the gallery is the primary teaching surface, so an undemoed thrower is invisible to a scaffolding agent (the #848 gap). Carve-out: a **root-only** boundary (`global-error` / `global-not-found`) cannot mount under `app/features/` without clashing with the generated app root, so teach those in the demo's PROSE rather than as a live route. |
| New / renamed **public `@webjsdev/core` or `@webjsdev/server` export, or a new routing convention file** the router parses | `test/scaffolds/gallery-coverage.json` MUST classify it (a `{ demo }` / `{ demoed: true }`, or `{ exempt }` with an `internal:` / `deferred:` reason) or the tier-2 CI gate (`gallery-coverage.test.js`) FAILS. Prefer a real demo; `deferred:` is a conscious, reviewer-visible exemption tracked for later. This is the coverage-gate teeth described above. |
| New **convention/rule** for generated apps | ALL per-agent rule files in lockstep (surface 3) + repo `CONVENTIONS.md` if the repo demonstrates it + `agent-docs` only if it also changes a framework API |
| Changed **generated file** (layout, theme, home, schema, middleware) | the generator (`create.js`/`*-template.js`) + any scaffold test asserting it + any doc/preview describing it + **regenerate + boot** |
| New **scaffold-shipped config/hook** (`.hooks/`, `webjs.*` in the generated `package.json`, a check rule) | `templates/**` + `webjs doctor`/`check` that reads it + the per-agent rule files if agents must know it |
| Which **templates ship the gallery** (scoping) | the `copyGallery` / gallery gate in `create.js` + the "full-stack only / full-stack and saas" wording in the per-agent rule files AND the framework docs (grep the old scoping phrase everywhere) |
| Pure-internal CLI refactor (no change to generated output) | NONE. Record that no scaffold surface applies. |

## Per-change sync procedure

Run the mandatory generate + boot + check verifications in PARALLEL when more than one template is affected: each verification is its own background Bash task, launched in one batch, with EVERY task's result collected before the sync is declared done (a forgotten background boot is a silently unverified template). Prefer the in-process harness (`createRequestHandler` + `Request` objects, the dogfood boot-check pattern in the start-work skill): it binds no port, so parallel runs cannot collide. When a real `webjs dev` listen is unavoidable, give each boot a distinct `--port`.

1. Identify the change's IDENTIFYING TOKENS: the demo route (`app/features/<x>`,
   `app/api/features/<x>`), the template name, the generated file path, the
   convention phrase, or the scoping phrase (e.g. "full-stack only").
2. Grep those tokens across every scaffold surface:
   ```sh
   git grep -n -iE '<token1>|<token2>' -- \
     'packages/cli/lib/**' 'packages/cli/templates/**' 'test/scaffolds/**' \
     AGENTS.md README.md 'website/app/docs/**'
   ```
3. Update every surface the mapping says applies. For a SCOPING or wording change
   (e.g. "gallery is full-stack only" becoming "full-stack and saas"), the grep
   MUST surface and fix every copy, in the rule files AND the framework docs.
4. **VERIFY BY GENERATING (mandatory, non-negotiable).** The generators emit
   strings, so a template-literal / escaping / interpolation bug is invisible in
   the generator's own syntax and only appears in the GENERATED app. For each
   affected template, generate an app and prove it:
   ```sh
   # generate (files only is enough for structure/typecheck; install to boot)
   node -e "import('packages/cli/lib/create.js').then(m => m.scaffoldApp('probe', '/tmp/x', { template: 'full-stack', install: false }))"
   # then in the generated app: webjs check (clean), webjs typecheck (clean),
   # and boot it to hit the new route(s).
   ```
   A scaffold change is NOT done until a freshly generated app of each affected
   template BOOTS, serves the new/changed route, passes `webjs check`, and
   `webjs typecheck` is clean.
5. Run the scaffold tests (`node --test 'test/scaffolds/*.test.js'`) and add/adjust
   assertions (a new demo in the FEATURES list, a per-template inclusion/exclusion
   test, the counterfactual).
6. Respect the prose-punctuation invariant (#11) in every comment and doc, and
   keep each demo densely commented (a header stating the webjs concept + the
   why, inline comments on the non-obvious idiom, and a line naming what to
   delete when the demo is pruned). The scaffold teaches by its comments, and a
   thin demo is a bug.

## Audit-mode procedure (sweep the scaffold for drift)

Fan the sweep out like the doc-sync audit: one read-only `Explore` agent per surface of the map, spawned in one message; the agents report and the edits stay in the main session.

1. List the shipped scaffold changes (new demos, new template, scoping changes,
   changed generated files).
2. For each, pull its tokens and run the surface grep above.
3. A surface is a GAP when the mapping says it applies but the token is absent or
   describes stale behaviour there (a classic gap: a demo added to the full-stack
   home but missing from the saas home, or a scoping phrase updated in one rule
   file but not the other five).
   - **Skill-vs-gallery coverage sweep** (the highest-value audit now that
     `gallery:clear` strips the gallery): for EACH gallery demo
     (`app/features/<x>` + its `modules/<x>`), confirm the concept it teaches is
     also taught in `.agents/skills/webjs/references/*.md`. A concept the gallery
     demonstrates but the skill omits is a GAP, because it vanishes at
     `gallery:clear` and the agent building the real app never sees it. Fill it in
     the matching reference at the depth of its siblings.
4. For a bulk audit, file a grounded follow-up via **webjs-file-issue** per gap
   (title `scaffold: <surface> missing <thing>`); for a single in-flight change,
   just fix all surfaces on the same PR.

## What this skill does NOT do

- It does not regenerate `llms.txt` / `llms-full.txt` (live-generated) or the
  website changelog (auto from PR titles).
- It does not own framework API/behaviour docs (that is `webjs-doc-sync`); when a
  change touches both a framework API and the scaffold, run both skills.
- It does not decide whether a CLI change alters generated output; that judgement
  is step 1, and a pure-internal refactor correctly updates no scaffold surface.
