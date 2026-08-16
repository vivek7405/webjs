# Conventions for {{APP_NAME}}

The conventions for building a WebJs app live in the agent skill. **Read
`AGENTS.md` first, then `.agents/skills/webjs/SKILL.md`** (it routes to focused
references under `.agents/skills/webjs/references/`, loaded on demand). This file
is the short version.

## The essentials

- **`app/` is routing only.** Only routing files live there (page, layout, route,
  middleware, metadata routes). Feature logic goes in `modules/<feature>/`
  (`actions/`, `queries/`, `components/`, `utils/`); shared UI primitives go in
  top-level `components/`; browser-safe helpers in `lib/utils/`.
- **Server-only code goes behind `.server.ts`.** Reach it from a page or component
  through a `'use server'` action, never by importing a server-only utility
  directly into browser-bound code.
- **Use the wired-up database (Drizzle).** Define real models in
  `db/schema.server.ts`, then `npm run db:generate` and `npm run db:migrate`.
  Never persist to a JSON file, an in-memory array or Map, or localStorage.
- **The scaffold ships a showcase to learn from.** A full-stack app ships a UI
  feature gallery (`app/features/`, `app/examples/todo`); the api template ships
  a backend-features showcase (`app/api/features/`), with logic in `modules/`.
  When you build a real app, study the parts that match your task (the skill
  teaches the same and survives the clear), run `npm run gallery:clear` to shed
  the showcase, then grow the app in place. `AGENTS.md` has the full
  template-specific playbook.
- **Derive types at every boundary.** Rows from `$inferSelect`, action inputs
  from an `interface`, routing files from `PageProps` / `LayoutProps`. Never
  `any`, and never `unknown` where a real type exists.
- **Progressive enhancement is the default.** Pages render as HTML, `<a>`
  navigates, a `<form action=${importedAction}>` submits, all with JavaScript off; opt into
  interactivity per behaviour inside a component.
- **Commit per logical unit** as soon as it is complete, and never push to `main`.

Everything else (the module architecture, the `ActionResult` envelope, styling,
testing, the client router, optimistic UI) is in the skill's references.
