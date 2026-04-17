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

### 1. Commit and push often

**Commit AND push after each logical unit of work** — a completed
feature, a passing test, a doc update. Don't accumulate uncommitted
or unpushed changes. Small focused commits with meaningful messages.
No AI attribution trailers. Always `git push` after committing.

### 2. Tests

- **Unit tests** in `test/*.test.js` for any new/changed functionality
- **E2E tests** in `test/browser/` for user-facing features
- Run `npm test` after every change. Run `npm run test:browser` for E2E.
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

## Framework philosophy

- **Opinionated defaults.** `REDIS_URL` → everything scales. No config files.
- **Built-in essentials: auth (OAuth + credentials + JWT), sessions (cookie or Redis), cache() for queries, HTTP Cache-Control, WebSocket broadcast(), rateLimit().
- **Less is more** for abstractions (directives, lifecycle hooks) — only what has no native workaround.
- **No build step by default.** Never introduce a bundler in the critical path.
- **JSDoc types in framework code** (packages/). Do not add `.ts` files there.
- **TypeScript in examples/apps** (examples/blog, docs, website). `.ts` is fine.
- **Web components first.** Shadow DOM scoped styles via `static styles = css`.
- **Commits**: do NOT add a `Co-Authored-By: Claude…` trailer.

## Common commands

```sh
npm install                          # workspace-linked deps
npm test                             # run unit tests (153 tests)
npm run test:browser                     # run E2E tests (9 tests, needs chromium)
cd examples/blog && npx webjs dev    # dev server with live reload
cd website && npm run dev            # website + docs + blog together

# scaffold
webjs create <name>                  # full-stack app (default)
webjs create <name> --template api   # backend-only API app
webjs create <name> --template saas  # auth + dashboard + Prisma User model
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
- **`next.js`** — [NextJs](https://nextjs.org): React framework with
  App Router. Compare: file conventions, routing, layouts, metadata,
  loading states, streaming SSR. webjs's router is at near-parity.
