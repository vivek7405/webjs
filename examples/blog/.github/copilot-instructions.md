# GitHub Copilot Instructions: webjs app

You are working on a webjs app, an AI-first, no-build, web-components-first
framework. Read AGENTS.md for the full API reference and CONVENTIONS.md for
project-specific conventions. When AGENTS.md doesn't cover what you need,
the full hosted docs are at **https://webjs.dev/docs**.

## Persistence + scaffold rules (non-negotiable)

- **Use Drizzle + SQLite for data, never JSON files.** It's already wired up
  (`db/schema.server.ts`, `db/connection.server.ts`, `npm run db:generate` + `npm run db:migrate`). For ANY
  data the app stores (todos, posts, messages, products, comments…),
  define a Drizzle table. NEVER create `data/*.json`, `db.json`, or any
  JSON file as a fake database. NEVER use module-scope arrays / Maps as
  a substitute. NEVER use localStorage for app data. It resets on reload and cannot scale. This is a project convention
  (CONVENTIONS.md).
- **The scaffold is reference, not the final product.** Replace
  `app/page.ts`, the example `User` model, the example users module, etc.
  with the app the user actually asked for. Don't ship "Hello from
  <app-name>" as the deliverable.
- **Only two templates exist:** `webjs create <name>` (default
  full-stack) and `--template api`. The CLI rejects any other
  `--template` value. Pick:
  - Any product UI (todo, blog, dashboard, marketplace, social, a SaaS with accounts…) → default
  - HTTP/JSON API only, no UI → `--template api`
  - Auth (login, session, a protected route) ships as a full-stack gallery card, not a template.

## Before starting ANY work

FIRST, before writing any code:
1. Check `git branch --show-current`.
   - If on main/master: create a feature branch before editing.
   - If on a feature branch: verify it matches the task at hand.
2. Sync: `git fetch origin && git rebase origin/main` if behind.

## Autonomous mode (sandbox / no-prompt)

If running without interactive approval (sandbox, auto-approve, etc.):
- On main? Auto-create feature/<task-slug> branch
- Parent behind? Auto-rebase. Merge? Auto-merge + delete feature branches.
- Auto-generate meaningful commit messages. Fix tests and violations.

Quality bar stays the same, no blocking on questions.

## Mandatory workflow (never skip)

Every code change must include:
1. Server tests in `test/<feature>/*.test.ts` (node:test).
2. Browser tests in `test/<feature>/browser/*.test.js` (WTR + Playwright, real Chromium).
3. Documentation updates. Walk every surface in the **Definition of done**
   section of CONVENTIONS.md (AGENTS.md, CONVENTIONS.md, README.md, docs/,
   website/, scaffold scripts) and either update or write
   "N/A because <reason>" in the PR body. Docs land on the same PR as the
   code, never as a follow-up.
4. Convention check: `webjs check` must pass.

How a PR gets REVIEWED is deliberately not specified here. Use whatever your
team already does. WebJs has opinions about the code (the conventions above,
`webjs check`, the test layers) and none about your review process.

The user should never have to ask for tests or documentation. The
commit-per-logical-unit rule lives under "Git rules"
below, not here, since it governs how work is grouped rather than what
each change must include.

## Git rules

- COMMIT AND PUSH PER LOGICAL UNIT, NOT AT THE END. One feature, one fix,
  one rename, one doc rewrite per commit. Always `git push` after
  committing. The user should never have to ask for a commit.
- HARD LIMIT: if you have 5+ unstaged files spanning different concerns,
  commit before continuing. The Claude Code hook at
  `.claude/hooks/nudge-uncommitted.sh` enforces threshold 4 for Claude
  users. Copilot has no equivalent hook surface today; self-enforce the
  same rule. Batching multiple logical units into one commit is the
  failure mode this rule exists to prevent.
- Meaningful commit messages: what changed and why
- NEVER add Co-Authored-By or AI attribution trailers to commits
- NEVER use em-dashes (U+2014), a hyphen-as-pause (` - `), or a
  semicolon-as-pause (` ; `) in commit messages or anywhere else.
  Rewrite the sentence so no pause-punctuation crutch is needed. Use a
  period, comma, colon, parentheses, or a restructured phrasing. Plain
  hyphens stay fine in compound words, CLI flags, filenames, and ranges.
  Semicolons stay fine inside code.
- Work on feature branches, create PRs, never push directly to main
- NEVER merge any branch without explicit user permission. Always ask:
  "Ready to merge <branch> into <target>? Delete or keep <branch> after?"
  Wait for approval AND the delete/keep preference. Applies to ALL merges.
- Run `webjs test` before every commit

## Framework rules

- No build step: source files are served as ES modules. Don't introduce
  build tools or bundlers in the critical path.
- **Erasable TypeScript only.** The runtime strips types via `module.stripTypeScriptTypes` (Node's built-in, or `amaro` on Bun) (whitespace replacement, byte-exact position preservation, no sourcemap). The scaffold's tsconfig.json sets `erasableSyntaxOnly: true`, so the TS compiler rejects `enum`, `namespace` with values, constructor parameter properties, legacy decorators with `emitDecoratorMetadata`, and `import = require`. Use erasable equivalents: `const X = { ... } as const` plus a derived union type instead of `enum`; explicit fields plus constructor body assignments instead of parameter properties. If `erasableSyntaxOnly` is disabled and non-erasable syntax is used, the dev server fails at strip time and returns a 500 pointing at the `no-non-erasable-typescript` lint rule. WebJs is buildless end-to-end and has no bundler fallback.
- Tagged template: html`<div>${value}</div>` with css`...` for styles.
  Don't use inline `style="..."` on components (use `static styles = css\`...\``).
- Components: extend the `WebComponent({ ... })` factory to declare reactive properties (e.g. `extends WebComponent({ count: Number })`; per-prop options via `prop(Number, { reflect: true })`), add `static styles` for shadow-DOM components, call `Class.register('tag-name')` at the bottom of the file. The tag name is the argument to `.register()`, not a static field. A hand-written `static properties` throws at construction (`no-static-properties`); set defaults in the constructor, never a class-field initializer (`reactive-props-no-class-field`).
- Server actions: *.server.ts files with one exported async function each.
- Server-only code (a DB driver like pg, node:*, anything needing Node APIs) goes only in .server.{js,ts} files, route.ts handlers, or middleware.ts. Never in pages, layouts, or components. Wrap in a .server.{js,ts} file; the framework rewrites that import to an RPC stub for the browser. The DB lives in db/*.server.ts; lib/ holds other server-only infra and browser-safe utilities (lib/utils/cn.ts with cn); apply the same rule per file.
- Directives: webjs exports the lit directives with no clean native equivalent (`repeat`, `unsafeHTML`, `live`, `keyed`, `guard`, `cache`, `until`, `ref` / `createRef`, `templateContent`, `asyncAppend` / `asyncReplace`, `watch`). Lit's `classMap` / `styleMap` / `ifDefined` / `when` / `choose` are NOT exported; use plain template-literal expressions instead.
- Context: import { createContext, ContextProvider, ContextConsumer } from '@webjsdev/core/context'
- Task: import { Task, TaskStatus } from '@webjsdev/core/task'
- Routing: file-based under app/ (page.ts, layout.ts, route.ts, middleware.ts).
- Component state lives in signals from @webjsdev/core. Module-scope signals share state across components; instance signals (created in the constructor) carry component-local state. Reactive properties (declared via the `WebComponent({ ... })` factory) are for HTML attributes and .prop=${...} hydration.
- Don't skip tests or documentation updates.
