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
   habits cause. Reading it is never wasted work: it survives the
   gallery-clearing step in the playbook below.
2. **Study the shipped examples, then build on a clean slate.** The template
   playbook below says what ships and the exact order to follow. The workflow
   rules (git, tests, review) are in `.agents/rules/workflow.md`; follow them
   too.
3. **Wire the WebJs MCP server into your agent (optional, recommended).** It
   is read-only and version-matched to the app: `list_routes`, `list_actions`,
   `list_components`, `list_elision`, `check`, `ui`, plus a docs and recipes
   layer. Run it with `npx @webjsdev/mcp`, registered in whatever MCP config
   your agent uses. This app ships no agent-specific config, so nothing is
   wired for you.
4. **Read the framework source for exact contracts.** WebJs is 100% buildless
   native ES modules, so the source you run IS the source you read. When you
   need a precise API signature or behavior, open the package source under
   `node_modules/@webjsdev/*` directly (each package ships its own `AGENTS.md`).
   The full hosted docs are at https://webjs.dev/docs.

{{PLAYBOOK}}

## Type everything (all templates)

Full-stack type safety is what the `.server.ts` boundary buys you: a client
component importing a server action resolves to that action's real signature at
type-check time, with no build step and no code generation in between. So
DERIVE the type at every boundary instead of widening it:

- A database row: `export type Todo = typeof todos.$inferSelect` in
  `db/schema.server.ts` (`$inferInsert` for a write), carried into a
  browser-shipped component with `import type` (erased before it reaches the
  browser, so it does not trip the server-import boundary).
- An action's input: a named `interface`. Its result: `ActionResult<T>`.
  Narrow with `if (result.success && result.data)`.
- Routing files: `PageProps<'/blog/[slug]'>`, `LayoutProps`,
  `RouteHandlerContext`, all from `@webjsdev/core`. Run `npx webjsdev types`
  for the typed `Route` union and per-route `params`.
- A reactive property: `prop<Student>(Object)`, `prop<Tag[]>(Array)`.

Never reach for `any` or a loose `as any` cast, and do not reach for `unknown`
either just because it looks safer. `unknown` is right for a payload nothing
has vouched for yet, narrowed on the very next line (a `route.ts` `await
req.json()`, an action's `export const validate` or a validator it delegates
to, a `catch` binding), and for a parameter of YOUR OWN helper that forwards
into an `html` template hole (a hole renders a string, a number, a
`TemplateResult`, or an array of those, so `TemplateResult` alone is too
narrow). That second case is about a value you accept, never one the framework
already types. Everywhere else it is a missing type, not a safe one: `unknown`
that survives into a return type, a component prop, a layout's `children`, or
an action signature is the shape to fix.
Nothing enforces this (both are valid TypeScript, so `webjs check` and `tsc`
pass either way), which is exactly why it is written down. The full ladder,
with an end-to-end example, is in
`.agents/skills/webjs/references/typescript.md`.

Keep server-only code (database drivers, secrets, `node:*` builtins) in
`.server.ts` modules. There are exactly two kinds:

- A `.server.ts` file WITH `'use server';` as its first line is a server
  action: WebJs exposes its exported async functions to browser code as RPC
  calls, so browser modules may import it directly.
- A `.server.ts` file WITHOUT `'use server'` is a server-only utility:
  importing it from a page, layout, or component CRASHES in the browser at
  module load. Reach it only from `'use server'` actions, `route.ts` handlers,
  or middleware. Never add `'use server'` to a file only other server code
  imports (the DB connection, the schema).

## Data (all templates)

Use the wired-up database (Drizzle) for every piece of data the app stores;
the playbook above has the modeling step. Never store app data in a JSON file,
an in-memory array, or localStorage.
