# Antigravity Workspace Rules: webjs app

You are working on a webjs app, an AI-first, no-build, web-components-first
framework. Read AGENTS.md for the full API reference and CONVENTIONS.md for
project-specific conventions before writing any code. When AGENTS.md does not
cover what you need, the full hosted docs are at **https://webjs.dev/docs**.

## Persistence + scaffold rules (non-negotiable)

- **Use Drizzle + SQLite for data, never JSON files.** It is already wired up
  (`db/schema.server.ts`, `db/connection.server.ts`, `npm run db:generate` + `npm run db:migrate`). For
  ANY data the app stores (todos, posts, messages, products, comments), define
  a Drizzle table. NEVER create `data/*.json`, `db.json`, or any JSON file as a
  fake database. NEVER use module-scope arrays / Maps as a substitute. NEVER
  use localStorage for app data. These are project conventions in
  CONVENTIONS.md (a JSON file used as a database resets on reload and
  cannot scale).
- **The scaffold is reference, not the final product.** Replace `app/page.ts`,
  the example `User` model, the example users module, etc. with the app the
  user actually asked for. Do not ship "Hello from <app-name>" as the
  deliverable.
- **Only two templates exist:** `webjs create <name>` (default full-stack) and
  `--template api`. The CLI rejects any other `--template` value. Pick:
  - Any product UI (todo, blog, dashboard, marketplace, social, a SaaS with
    accounts) goes through the default template. Auth is one of the full-stack
    gallery cards (login, session, a protected route), not a separate template.
  - HTTP/JSON API only, no UI, uses `--template api`.

## Before starting ANY work

FIRST, before writing any code:
1. Check `git branch --show-current`.
   - If on main/master: create a feature branch before editing.
   - If on a feature branch: verify it matches the current task.
2. Sync: `git fetch origin && git rebase origin/main` if behind.

## Autonomous mode (sandbox / no-prompt)

If running without interactive approval, auto-decide:
- On main? Auto-create feature/<task-slug> branch.
- Parent behind? Auto-rebase. Merge? Auto-merge + delete feature branches.
- Auto-generate commit messages. Fix failing tests and violations.
Quality bar stays the same, no blocking on questions.

## Mandatory workflow (never skip)

Every code change must include:
1. Server tests in `test/<feature>/*.test.ts` (node:test).
2. Browser tests in `test/<feature>/browser/*.test.js` (WTR + Playwright, real Chromium).
3. Documentation updates. Walk every surface in the **Definition of done**
   section of CONVENTIONS.md (AGENTS.md, CONVENTIONS.md, README.md, docs/,
   website/, scaffold scripts) and either update it or write
   "N/A because <reason>" in the PR body. Docs land on the same PR as the
   code, never as a follow-up.
4. Convention check: `webjs check` must pass.

How a PR gets REVIEWED is deliberately not specified here. Use whatever your
team already does. WebJs has opinions about the code (the conventions above,
`webjs check`, the test layers) and none about your review process.

The user should never have to ask for tests or documentation.

## Git rules

- COMMIT AND PUSH PER LOGICAL UNIT, NOT AT THE END. One feature, one fix, one
  rename, one doc rewrite per commit. Always `git push` after committing.
  The user should never have to ask for a commit.
- HARD LIMIT: if you have 5+ unstaged files spanning different concerns,
  commit before continuing. The Claude Code hook at
  `.claude/hooks/nudge-uncommitted.sh` fires at threshold 4. Antigravity
  users should self-enforce the same rule. Batching multiple logical units
  into one commit is the failure mode this rule exists to prevent.
- Meaningful commit messages: what changed and why.
- NEVER add Co-Authored-By or AI attribution trailers to commits.
- NEVER use em-dashes (U+2014), a hyphen-as-pause (` - `), or a
  semicolon-as-pause (` ; `) in commit messages or anywhere else. Rewrite the
  sentence so no pause-punctuation crutch is needed. Use a period, comma,
  colon, parentheses, or a restructured phrasing. Plain hyphens stay fine in
  compound words, CLI flags, filenames, and ranges. Semicolons stay fine
  inside code.
- Work on feature branches, never push directly to main.
- Create pull requests for review.
- NEVER merge any branch without explicit user permission. Always ask:
  "Ready to merge <branch> into <target>? Delete or keep <branch> after?"
  Wait for approval AND the delete/keep preference. Applies to ALL merges.
- Run `webjs test` before every commit.

## Framework rules

- No build step: ES modules served directly.
- **Erasable TypeScript only.** The runtime (Node 24+ or Bun) strips types via
  `module.stripTypeScriptTypes` (whitespace replacement, byte-exact position
  preservation, no sourcemap). The scaffold's `tsconfig.json` sets
  `erasableSyntaxOnly: true`, so the TS compiler rejects `enum`, `namespace`
  with values, constructor parameter properties, legacy decorators with
  `emitDecoratorMetadata`, and `import = require`. Use erasable equivalents:
  `const X = { ... } as const` plus a derived union type instead of `enum`;
  explicit fields plus constructor body assignments instead of parameter
  properties. If `erasableSyntaxOnly` is disabled and non-erasable syntax is
  used, the dev server fails at strip time and returns a 500 pointing at the
  `no-non-erasable-typescript` lint rule. WebJs is buildless end-to-end and
  has no bundler fallback.
- Web components render into light DOM by default (so Tailwind / global CSS
  apply directly). Opt in to shadow DOM per component with
  `static shadow = true` when you need scoped styles (via
  `static styles = css\`...\``) or third-party-embed isolation. `<slot>`
  projection works identically in both modes (named slots, fallback content,
  `assignedNodes` / `slotchange`, first-wins resolution).
- Custom-element tag names are passed to `.register('tag-name')`. They are NOT
  a static field on the class.
- One function per server action file (`*.server.ts`).
- Server-only code (a DB driver like `pg`, `node:*`, anything that needs Node APIs)
  goes only in `.server.{js,ts}` files, `route.ts` handlers, or
  `middleware.ts`. Never in pages, layouts, or components. Wrap the access in
  a `.server.{js,ts}` file; the framework rewrites that import into an RPC
  stub for the browser. `lib/` holds both server-only infra
  (the DB in `db/*.server.ts`) and browser-safe utilities (`lib/utils/cn.ts` with
  `cn`); follow the same rule per file.
- Directives: webjs exports the lit directives with no clean native equivalent
  (`repeat`, `unsafeHTML`, `live`, `keyed`, `guard`, `cache`, `until`, `ref` /
  `createRef`, `templateContent`, `asyncAppend` / `asyncReplace`, `watch`).
  `classMap` / `styleMap` / `ifDefined` / `when` / `choose` are NOT exported.
  For those, use plain template-literal expressions
  (`class=${active ? 'btn active' : 'btn'}`, `style=${'color:' + color}`,
  `${cond ? a : b}`) and lifecycle hooks (`this.query('#el')` in
  `firstUpdated`) instead of Lit's `classMap` / `styleMap` / `ref` / `when` /
  `choose` / `guard`.
- Use Context for cross-component data, Task for async data in components.
- **Progressive enhancement is the default.** Pages AND every web component
  are SSR'd to real HTML. Write components so the first paint is the right
  content. Read SSR-meaningful defaults in `constructor()`. `connectedCallback`
  is never called on the server, so anything there only runs after
  hydration. Initial data for components comes from the page function
  (server-side fetch plus pass as attribute/property), NOT from `fetch` calls
  in `connectedCallback`. For write-paths, bind a `'use server'` action into
  the form (`<form action=${createPost}>`) over `fetch` plus a click handler.
  The renderer omits the attribute so the form posts to the page's own URL,
  supplies `method="post"` and an enctype, and emits a hidden field naming the
  action, so nothing about the action's source reaches the browser. The
  framework upgrades the form to a partial-swap submission automatically. A
  bare `<form method="post">` binds nothing and is a 405.
- **Client navigation is auto-magic.** Real `<a href>` and `<form action>`
  get partial-swap behavior with no opt-in. Because layouts persist across
  navigation, put shared chrome (sidenav, header) in `layout.ts` and
  page-specific content in `page.ts`. For validation errors, return 4xx HTML
  from a `route.ts` POST handler; the router renders it in place preserving
  the user's input. For non-layout swap regions, wrap in `<webjs-frame id="...">`. See "Client
  navigation patterns" in AGENTS.md.
- Full API reference in AGENTS.md.
