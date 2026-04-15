# CLAUDE.md

This repo's authoritative contract for AI agents (and humans) is
**[`AGENTS.md`](./AGENTS.md)**. Read it before editing anything under this
repository — it defines:

- What webjs is and what it is not (see _"What webjs is"_ and _"Deliberately deferred"_).
- File-system conventions (routing, layouts, errors, middleware, server actions, components).
- The public API surface exported from `webjs` and `@webjs/server`.
- The `html` tag's expression-prefix rules (`@event`, `.prop`, `?bool`, plain).
- Invariants that must hold (e.g. do not import `@prisma/client` from a
  client component; custom element tag names must contain a hyphen; event/
  prop/bool holes must be unquoted; `setState` not direct mutation).
- Recipes for common tasks (new page, dynamic route, API route, server
  action, component, DB model).
- Security checklist for `expose()` endpoints.
- Advanced features: streaming Suspense, bundling, rate limiting,
  per-segment middleware, raw-text templates, HTTP/2, 103 Early Hints,
  WebSockets.
- Runtime targets (Node / embedded / edge) and what currently ports.

## Quick reminders for Claude

- **Before implementing any change**, consult `AGENTS.md` — many apparent
  "gaps" are deliberate choices documented there. Don't re-implement
  something marked deferred without explicit instruction.
- **No build step by default.** Source files are served to the browser as
  ES modules. Never introduce a bundler/compile step in the critical path.
  `webjs build` is the one opt-in exception (production bundle).
- **JSDoc types, not TypeScript.** Type info lives in `@param` / `@returns`
  / `@typedef` doc comments. Do not add `.ts` files.
- **Web components first.** Repeated visual chunks should become components
  with shadow-DOM scoped styles via `static styles = css\`…\``, not inline
  `style="…"` attributes on tags.
- **When writing code, follow CODE-style in AGENTS.md**: minimal comments,
  `register(import.meta.url)` on every component, shadow DOM by default,
  server-only code in `.server.js` or `'use server'` files.
- **Tests**: `npm test` at the repo root runs the full suite
  (`node --test test/*.test.js`). Keep it green; add tests when adding
  non-trivial behaviour.
- **Commits**: do NOT add a `Co-Authored-By: Claude…` trailer (the user
  has opted out).

## Common commands

```sh
npm install                          # workspace-linked deps
npm test                             # run all tests
cd examples/blog
npx prisma migrate dev --name <name> # scaffold DB migration
npx webjs dev                        # dev server with live reload
npx webjs build                      # (optional) prod bundle via esbuild
npx webjs start --port 3000          # production server
```

If any of the above goes stale, the source of truth is the `scripts` in
`package.json` at the repo root and `examples/blog/package.json`.
