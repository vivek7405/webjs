# Workspace workflow rules: WebJs app

You are working on a WebJs app (AI-first, no-build, web-components-first). This
file is the WORKFLOW contract (git, tests, review). For HOW to build (routing,
components, actions, styling, the framework API), read
`.agents/skills/webjs/SKILL.md`, which routes to focused references on demand.
Read `AGENTS.md` first. Full hosted docs are at https://webjs.dev/docs.

## Grow the app in place (non-negotiable)

- **Study the shipped examples, then clear them and build.** The scaffold is a
  starting point with a browsable showcase to learn the real idioms from, plus a
  database wired up. A full-stack app ships a UI feature gallery (`app/features/`,
  `app/examples/todo`); the api template ships a backend-features showcase
  (`app/api/features/`), with logic in `modules/`. Building a real app: study the
  parts that match your task (the skill teaches the same and SURVIVES the clear),
  run `npm run gallery:clear` to shed the showcase (it keeps the agent skill and
  the database wiring, and resets to a clean base), then regenerate the database
  and grow the app in place under `app/`, `components/`, and `modules/<feature>/`.
  `AGENTS.md` carries the full template-specific build playbook and the order to
  follow.
- **Use the wired-up database (Drizzle), never JSON files.** For any data the app
  stores, define a Drizzle table in `db/schema.server.ts`, then
  `npm run db:generate` and `npm run db:migrate`. Never use a JSON file, a
  module-scope array or Map, or localStorage as a database.
- **`app/` is routing-only.** Only routing files live in `app/` (page, layout,
  route, middleware, metadata routes). Browser-safe helpers go in `lib/utils/`,
  feature logic in `modules/`, server-only code behind `.server.ts`.
- **For a UI app, render and LOOK before calling it done.** Define design tokens
  in `app/layout.ts` with a palette that fits the app
  (`.agents/skills/webjs/references/styling.md` is the guide), then open every
  route you changed in a real browser and play through its states.
  `npm run check` and `npm run typecheck` pass even when a layout collapses, so
  the browser is the real check.

## Before starting ANY work

1. Check `git branch --show-current`. If on main or master, create a feature
   branch before editing. If on a feature branch, verify it matches the task.
2. Sync: `git fetch origin` and `git rebase origin/main` if behind.
3. If more than one agent may work this repo at once, use a DEDICATED git worktree
   per task (`git worktree add -b <branch> ../<repo>-<slug> origin/main`, work
   there, `git worktree remove` after merge), never a shared checkout. Two agents
   in one directory collide: a `git checkout` in one moves HEAD under the other,
   so commits land on the wrong branch.

## Every code change

1. Server tests in `test/<feature>/*.test.ts` (node:test).
2. Browser tests in `test/<feature>/browser/*.test.js` for hydration, DOM, slots,
   and the client router.
3. Documentation stays in sync on the SAME PR as the code, never a follow-up.
4. `npm run check` must pass (correctness), and so must `npm run doctor`
   (project health). CI runs both. Doctor fails on whatever your `package.json`
   `webjs.doctor.gate` marks `error`, which starts as the un-versioned
   stylesheet link check, plus the two hard toolchain checks that default to
   `error` with no gate entry at all: `NODE_VERSION` (the Node floor) and
   `TSCONFIG_ERASABLE` (`erasableSyntaxOnly` missing from an existing
   tsconfig), either of which would 500 the app at runtime. Everything else it
   reports is a warning that cannot fail the build. Widen or narrow the gate in
   `package.json` rather than in the workflow.
5. Pre-merge self-review: before saying a PR is ready, run fresh-context review
   rounds until one round finds zero issues (minimum two rounds, rotate focus).
   Skip only for a one-line trivial change.

## Git rules

- Commit and push per logical unit (one feature, one fix, one rename, one doc
  rewrite), not at the end. Push after every commit.
- If you have 5 or more unstaged files spanning different concerns, commit before
  continuing.
- Meaningful commit messages: what changed and why.
- Never add Co-Authored-By or AI-attribution trailers.
- Never use an em-dash (U+2014), a space-surrounded hyphen as a pause, or a
  space-surrounded semicolon as a pause, in commit messages or anywhere. Use a
  period, comma, colon, parentheses, or a restructured phrasing.
- Work on feature branches, never push directly to main. Open pull requests for
  review. Never merge without explicit user permission (ask which target, and
  whether to delete or keep the branch, then wait for both answers).

## Autonomous mode (sandbox / no-prompt)

If running without interactive approval, auto-decide: on main, auto-create a
`feature/<task-slug>` branch; auto-rebase if the parent moved; auto-generate
commit messages; fix failing tests and check violations rather than asking. The
quality bar stays the same. Only merging into main is gated on user permission.
