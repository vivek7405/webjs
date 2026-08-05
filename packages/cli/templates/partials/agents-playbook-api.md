## Build a backend API (api template)

This template has NO UI: no layout, no pages, no components, no CSS. It ships a
backend-features showcase under `app/api/features/`, a set of JSON and HTTP
endpoints that demonstrate the `route()` adapter, input validation, and rate
limiting, with logic in `modules/`. Build in this order.

### 1. Study the showcase, then clear it

Read the endpoints under `app/api/features/` so you copy the real idiom: a
`route.ts` handler, the `route()` adapter over a `'use server'` action,
`validate`, and rate limiting. Then run `npm run gallery:clear` to shed the
showcase and reset to a clean base. The skill teaches the same patterns and
survives the clear, so the showcase is a runnable copy you study first, not
something you lose.

### 2. Model the data

Define real models in `db/schema.server.ts`, then run `npm run db:generate` and
`npm run db:migrate`. Write a seed script at `db/seed.server.ts` and run
`npm run db:seed` so endpoints return real rows while you build, instead of
empty arrays. Put reads in `modules/<feature>/queries/*.server.ts` and writes
in `modules/<feature>/actions/*.server.ts`, one function per file.

### 3. Build endpoints

Expose HTTP with a `route.ts` handler (named `GET` / `POST` / `PUT` / `PATCH` /
`DELETE` exports), each `(request, { params }) => Response | value` (a returned
plain value auto-JSONs, so return the data directly unless you need headers or
a status). To publish a `'use server'` action as REST, use the `route()`
adapter from `@webjsdev/server`, which merges the query, the route params, and
the JSON body into one input object and JSON-responds. Full reference:
`.agents/skills/webjs/references/data-and-actions.md` and
`.agents/skills/webjs/references/routing-and-pages.md`.

### 4. Secure every endpoint

A `route.ts` handler is NOT covered by the action-RPC CSRF and error-sanitizing
layer, so on every mutating endpoint you must: authenticate the request
(sessions and auth are in `.agents/skills/webjs/references/auth-and-sessions.md`),
pass a `validate` function, rate-limit it, and log without leaking secrets. For
cross-origin access use the `cors()` middleware from `@webjsdev/server`; with
`credentials: true` set an explicit origin allowlist, never `'*'`.

### 5. Verify before you call it done

Run each of these and fix what it reports, in order:

- `npm run check` (correctness: no browser-import or boundary violation).
- `npm run doctor` (project health; CI runs it too, and it fails on whatever
  `package.json` `webjs.doctor.gate` marks `error`).
- `npm run typecheck` (zero type errors).
- `npm test` (unit tests for the endpoints and modules you built).

Then boot `npm run dev` and probe each endpoint for the expected status and JSON
shape.

### Commands

```sh
npm install
npm run gallery:clear   # shed the backend-features showcase before building
npm run dev             # dev server at http://localhost:8080
npm run start           # production server
npm test                # unit + browser tests
npm run typecheck
npm run check           # correctness checks
npm run doctor          # project health (severity per check: webjs.doctor.gate)
npm run db:generate && npm run db:migrate
```
