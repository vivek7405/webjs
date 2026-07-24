# AGENTS.md for {{APP_NAME}}

This is a WebJs app: AI-first, web-components-first, buildless, and
progressively enhanced. Read this whole file before you edit anything, then
follow it. The steps here are required, not optional.

## Gather context BEFORE you build (required)

WebJs is its own framework. It is not React, Next, or Lit, so writing code from
that muscle memory produces broken WebJs code. Before you write or change
anything, gather context from these sources. Do not skip a step to save time.
This is what separates a working app from a broken one.

1. **Read the skill.** Start with `.agents/skills/webjs/SKILL.md`, then load the
   `references/*.md` files it routes to for the surface you are touching. The
   skill is the guide to building a WebJs app: it helps you choose the right
   layer, reach for the right export, and avoid the mistakes Next.js or Lit
   habits cause. It SURVIVES `gallery:clear`, so reading it is never wasted work.
2. **Study the shipped examples, then build on a clean slate.** The template
   playbook below says what ships and the exact order to follow.
3. **Read the framework source for exact contracts.** WebJs is 100% buildless
   native ES modules, so the source you run IS the source you read. When you
   need a precise API signature or behavior, open the package source under
   `node_modules/@webjsdev/*` directly (each package ships its own `AGENTS.md`).
   The full hosted docs are at https://docs.webjs.dev.

{{PLAYBOOK}}

## Type everything (all templates)

Define explicit TypeScript interfaces and discriminated unions for your data
payloads and action inputs and outputs (and, in a UI app, component props and
optimistic updates). Narrow an `ActionResult` with
`if (result.success && result.data)`. Never reach for `any` or a loose
`as any` cast.

Keep server-only code (database drivers, secrets, `node:*` builtins) in
`.server.ts` modules. A `.server.ts` file whose functions a browser module
imports MUST start with `'use server';` on its first line, so WebJs compiles
those exports into RPC stubs.

## Data (all templates)

Use the wired-up database (Drizzle). Define real models in
`db/schema.server.ts`, then run `npm run db:generate` and `npm run db:migrate`.
Never store app data in a JSON file, an in-memory array, or localStorage.
