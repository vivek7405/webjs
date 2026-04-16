# CLAUDE.md — webjs blog example

Read **[AGENTS.md](./AGENTS.md)** before editing anything. It has the full
file layout, conventions, invariants, and recipes.

## Quick reminders

- **No build step.** Edit `.ts`, restart `npx webjs dev`, refresh.
- **One function per file** for actions and queries.
- **Routes are thin** — import from `modules/`, don't put logic in `app/api/`.
- **Never import server-only deps** from components or pages — use `.server.ts`.
- **ActionResult<T>** envelope for every action that can fail.
- **globalThis** for dev singletons (Prisma, WS clients, pub/sub bus).
- **register(import.meta.url)** on every component.

## Common commands

```sh
npx webjs dev              # dev server
npx webjs start            # prod server
npx prisma migrate dev     # DB migration
npx prisma generate        # regenerate client
npm test                   # framework tests (from repo root)
```
