# CLAUDE.md — webjs blog example

**Do not duplicate content.** Reference the authoritative sources below.

## Required reading

1. **[AGENTS.md](./AGENTS.md)** — File layout, conventions, invariants, recipes.
2. **[../../AGENTS.md](../../AGENTS.md)** — Full webjs framework API reference
   (directives, lifecycle, controllers, context, task, testing, conventions).

## AI-driven development workflow (non-negotiable)

**Every code change MUST include — automatically, without the user asking:**

1. **Tests** — Unit test for new actions/queries/components. E2E test for
   user-facing features. Run `npm test` from repo root after every change.
2. **Documentation** — Update `AGENTS.md` if adding new modules/conventions.
3. **Convention check** — Run `npx webjs check` and fix violations.

The user should never have to say "also write tests" or "update the docs."

## Quick reference

```sh
npx webjs dev              # dev server
npx webjs test             # run tests
npx webjs test --e2e       # run with E2E
npx webjs check            # validate conventions
npx prisma migrate dev     # DB migration
```

All conventions, API details, and recipes → see **AGENTS.md** files above.
