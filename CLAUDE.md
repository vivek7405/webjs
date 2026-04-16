# CLAUDE.md

**Do not duplicate content here.** This file points to authoritative sources
and defines the AI-driven development workflow for the webjs framework itself.

## Required reading

1. **[`AGENTS.md`](./AGENTS.md)** — The authoritative contract. Defines: what
   webjs is, file conventions, public API surface, directives, lifecycle,
   controllers, context, task, invariants, recipes, security, testing,
   conventions, advanced features. **Read it before editing anything.**

## AI-driven development workflow (non-negotiable)

**Before starting ANY work:**
1. `git branch --show-current` — if on `main`, create a feature branch
2. `git fetch origin && git log HEAD..origin/main --oneline` — rebase if behind
3. Verify the branch matches the task at hand

**Autonomous mode (sandbox/bypass):** Don't ask questions. Auto-create
branches, auto-rebase, auto-merge + delete feature branches, auto-generate
commit messages, fix failing tests and violations. Same quality bar.

**Every change to this framework MUST include — automatically, without the
user asking:**

### 1. Commit often

**Commit after each logical unit of work** — a completed feature, a
passing test, a doc update. Don't accumulate 50 files of uncommitted
changes. Small focused commits with meaningful messages. No AI
attribution trailers.

### 2. Tests

- **Unit tests** in `test/*.test.js` for any new/changed functionality
- **E2E tests** in `test/e2e.test.mjs` for user-facing features
- Run `npm test` after every change. Run `npm run test:e2e` for E2E.
- Never report work as done with failing tests.

### 3. Documentation

When adding or modifying framework features, update:

- **`AGENTS.md`** — API surface, directive table, lifecycle docs, recipes
- **`docs/`** — Add or update the relevant documentation page
- **`website/`** — Update the landing page for marketable features
- **`examples/blog/`** — Update the blog to use the new feature so E2E
  tests exercise it
- **`packages/cli/templates/`** — Update CONVENTIONS.md/CLAUDE.md templates
  if the change affects what scaffolded apps should know

### 4. Convention validation

Run `npx webjs check` on the blog example after changes.

## Framework-specific reminders

- **No build step by default.** Never introduce a bundler in the critical path.
- **JSDoc types in framework code** (packages/). Do not add `.ts` files there.
- **TypeScript in examples/apps** (examples/blog, docs, website). `.ts` is fine.
- **Web components first.** Shadow DOM scoped styles via `static styles = css`.
- **Commits**: do NOT add a `Co-Authored-By: Claude…` trailer.

## Common commands

```sh
npm install                          # workspace-linked deps
npm test                             # run unit tests (153 tests)
npm run test:e2e                     # run E2E tests (9 tests, needs chromium)
cd examples/blog && npx webjs dev    # dev server with live reload
cd website && npm run dev            # website + docs + blog together
```

## Reference codebases

Cloned locally at `~/Documents/Projects/` for architectural reference:

- **`lit`** — [Lit](https://lit.dev): web-component-first JS library.
  Compare: rendering, hydration, component lifecycle, directives.
- **`remix`** — [Remix](https://remix.run) v3: AI-first web framework
  (under active development). Compare: module loading, streaming SSR,
  hydration data delivery.
- **`turbo`** — [Turbo](https://turbo.hotwired.dev): Turbo Drive library.
  Compare: link interception, body swap, history, View Transitions.
- **`next.js`** — [Next.js](https://nextjs.org): React framework with
  App Router. Compare: file conventions, routing, layouts, metadata,
  loading states, streaming SSR. webjs's router is at near-parity.
