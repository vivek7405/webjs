# CLAUDE.md — {{APP_NAME}}

This file instructs AI coding agents on how to work in this project.
**Do not duplicate content here** — reference the authoritative sources below.

## Required reading (in this order)

1. **[AGENTS.md](./AGENTS.md)** — Full webjs API reference, file conventions,
   invariants, recipes, directives, lifecycle, controllers, context, task.
2. **[CONVENTIONS.md](./CONVENTIONS.md)** — Project-specific conventions for
   module architecture, testing rules, component patterns, code style.
   Users may override sections.

## AI-driven development workflow

**CRITICAL: Every code change MUST include the following — automatically,
without the user having to ask:**

### 1. Commit often (mandatory, never skip)

**Commit after each logical unit of work** — a completed feature, a
passing test, a doc update. Don't accumulate many files of uncommitted
changes. Small focused commits with meaningful messages. No AI
attribution trailers. Committing is automatic — the user should never
have to ask.

### 2. Tests (mandatory, never skip)

- **New server action or query** → add unit test in `test/unit/<module>.test.ts`
- **New or modified component** → add unit test (SSR rendering via `renderToString`)
- **New or modified page/route** → add E2E test in `test/e2e/<feature>.test.ts`
- **Bug fix** → add regression test proving the fix
- **Refactor** → run existing tests, ensure they pass

After writing code, ALWAYS run `npx webjs test`. If E2E-relevant,
also run `npx webjs test --e2e`. Never report a task as done with
failing tests.

### 3. Documentation (mandatory, never skip)

When adding or modifying features, update:

- **AGENTS.md** — API surface table, directive reference, recipes, or
  relevant sections. This is the source of truth for the framework.
- **CONVENTIONS.md** — Only if the change introduces or modifies a convention.

If this project has a **docs/** directory, also:
- Add or update the relevant documentation page under `docs/`.

If this project has a **website/** directory, also:
- Update the website landing page if the feature is user-facing/marketable.

### 4. Convention validation

After making changes, run `npx webjs check` and fix any violations before
reporting the task as done.

## Quick reference

```sh
npx webjs dev              # dev server with live reload
npx webjs test             # run unit tests
npx webjs test --e2e       # run unit + E2E tests
npx webjs check            # validate conventions
npx webjs build            # (optional) production bundle
npx webjs start            # production server
```

All API details, recipes, and feature documentation → see **[AGENTS.md](./AGENTS.md)**.
All project conventions and overrides → see **[CONVENTIONS.md](./CONVENTIONS.md)**.
