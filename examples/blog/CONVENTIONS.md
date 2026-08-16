# CONVENTIONS.md for blog

This file defines the conventions for this webjs app. **AI agents MUST read
this file before writing any code.** It is the single source of truth for
how code should be structured, tested, and organized.

Sections marked `<!-- OVERRIDE -->` contain defaults you can customize.
Edit the content below the marker to change the convention for your project.

---

## `CONVENTIONS.md` vs `webjs check`: two different things

This file is the source of truth for **project conventions**: how code
is organized, named, and tested. They are preferences a reasonable
project could do differently, so they are guidance (for humans and AI
agents), not a hard gate. Customize any of them; sections marked
`<!-- OVERRIDE -->` are explicit customization points.

`webjs check` is a separate, narrower tool: **correctness checks** that
catch objectively broken code (a crash, a security leak, a reactive prop
that silently stops re-rendering, a build or type-strip failure). Those always run, there is no per-project
disabling, and they are not listed here (run `webjs check --rules` to
see them). The line between the two: *could a sensible app legitimately
want this to pass?* If yes, it is a convention (this file); if no, it is
a check (the tool).

### Project conventions (follow these)

These are the architectural conventions for this app. They are not
enforced by `webjs check`; follow them by judgment.

- **Server actions and queries live in `modules/<feature>/actions/` and
  `modules/<feature>/queries/`** (`*.server.{js,ts}`), not loose in the
  app root. The DB connection lives in `db/connection.server.ts`; other cross-cutting server infrastructure (the
  session helpers, auth config) lives in `lib/`.
- **One exported function per action/query file.** Name the file after
  the function (`create-post.server.ts` exports `createPost`).
- **Every feature has tests.** A `modules/<feature>/` directory should
  have matching test files under `test/<feature>/`.
- **Persist data with Drizzle + SQLite, never JSON files.** A
  `data/todos.json` or `db.json` used as a database resets on reload and
  cannot scale; define a Drizzle table instead.

---

## AI agent workflow (non-negotiable)

**These rules apply to ALL AI agents (Claude, Cursor, Copilot, etc.)
working on this codebase. They are not optional and must not be skipped
even if the user doesn't explicitly ask.**

### Before starting ANY work: verify and sync the branch

1. Check `git branch --show-current`
2. If on `main`/`master` → create a feature branch first
3. If on a feature branch → verify it matches the current task
4. Sync with parent: `git fetch origin && git rebase origin/main` if behind
5. Don't mix unrelated work on the wrong branch

### Every code change must include:

1. **Commit and push per logical unit, not at the end.** A logical unit is
   one feature, one fix, one rename, one doc rewrite. Small, focused commits
   with meaningful messages. Always `git push` after committing. Do not
   accumulate uncommitted or unpushed changes. If you have 5+ unstaged files
   spanning different concerns, commit before continuing. The
   `.claude/hooks/nudge-uncommitted.sh` hook fires at threshold 4 to remind
   you, and ignoring it means you are batching. The user should never have
   to ask for a commit.

2. **Tests.** Unit test for logic, E2E test for user-facing behavior.
   See the "Testing" section below for what type of test each change needs.
   Run `webjs test` after every change. Never mark work as done with
   failing tests.

3. **Documentation updates.** When adding or modifying features:
   - Update `AGENTS.md` if the change affects the framework API surface.
   - Update `CONVENTIONS.md` only if the change introduces a new convention.
   - If a `docs/` directory exists, add or update the relevant doc page.
   - If a `website/` directory exists, update the landing page for
     user-facing features.

3. **Convention check.** Run `webjs check` after changes and fix
   any violations before reporting the task as done.

### Autonomous mode (sandbox / bypass permissions)

When running without interactive approval, agents must NOT ask questions.
Instead, auto-decide using best practices:
- On `main`? → Auto-create `feature/<task-slug>` branch
- Parent branch has new commits? → Auto-rebase before starting
- Ready to merge? → Auto-merge, delete feature/fix branches, keep
  long-lived branches (dev, staging, release/*)
- Commit message? → Auto-generate: what changed and why
- Tests failing? → Fix them, don't report the failure and stop
- Convention violations? → Fix them silently

The quality bar is the same. Autonomous mode means faster, not sloppier.

### What "automatically" means:

When a user says "add a contact page" or "add a delete button to posts",
the AI agent must deliver:
- The implementation (page, component, action, etc.)
- Unit tests for any new server actions/queries/components
- E2E test if the feature involves user interaction
- Documentation updates if applicable

The user should never have to say "also write tests" or "also update the
docs". That is the agent's default behavior in a webjs project.

---

## Data persistence: Drizzle + SQLite, never JSON files

<!-- OVERRIDE -->

Every webjs app uses **Drizzle + SQLite** for persistence by default. The
scaffold ships the `db/` folder (`schema.server.ts`, `columns.server.ts`,
`connection.server.ts`), the `webjs.start.before` step that runs
`webjs db migrate` inside `webjs start` (#550), and the
`npm run db:migrate` / `db:generate` / `db:studio` scripts.

**AI agents: these rules are absolute.**

1. For ANY data the app stores (todos, posts, messages, products,
   comments, users…), define a Drizzle table in `db/schema.server.ts`
   and persist there.
2. **NEVER** create JSON files under `data/`, `db.json`, `posts.json`,
   `todos.json`, etc. as a fake database. It resets on reload and cannot scale; this is a
   project convention (see the conventions section above).
3. **NEVER** use module-scope arrays or `Map`s as a "store". They
   reset on every dev-server reload and can't scale beyond one process.
4. **NEVER** use `localStorage` / `sessionStorage` to persist app data -
   it's per-browser and never reaches the server. Use it only for UI
   preferences (theme, sidebar collapsed, etc.).
5. To add a model: edit `db/schema.server.ts`, then `npm run db:generate`
   and `npm run db:migrate`. Access via `import { db } from
   '../../../db/connection.server.ts'` (and the tables from db/schema.server.ts).

To switch to Postgres or MySQL: change `provider` in
the `db/` columns + connection files (or scaffold with --db postgres) and the `DATABASE_URL` in `.env`. Do this only
if the user explicitly asks for it. SQLite is the right default for
dev and small production workloads.

---

## The scaffold is reference, not the final product

<!-- OVERRIDE -->

This project was created with `webjs create`. Every file you see right
now (the `app/page.ts` "Hello from …" homepage, the example `User`
model, the `theme-toggle` component, the example users module in api /
saas templates) is a **starting point**.

When the user asks the agent to build their actual app:

1. **Replace the example `User` model** in `db/schema.server.ts` with
   the real domain models the app needs (e.g. `Todo`, `Post`, `Message`)
   - unless the app actually has users.
2. **Replace `app/page.ts`** with the app's real homepage. Don't ship
   "Hello from …" as the deliverable.
3. **Delete or replace `components/theme-toggle.ts`** if the app doesn't
   need a theme picker.
4. **Delete the example users module** (api/saas templates) if the app
   doesn't use it.
5. **Keep:** the Drizzle setup, the test config, the agent config files
   (`AGENTS.md`, `CONVENTIONS.md`, `CLAUDE.md`, `.cursorrules`, etc.),
   `db/connection.server.ts`, the directory conventions, the design tokens in
   `app/layout.ts`. These are the infrastructure, not the example app.

The scaffold exists so the agent doesn't reinvent the directory layout,
the Drizzle wiring, the test runner config, or the convention files. It
does NOT exist so the agent ships the example homepage.

---

## Sensible defaults

<!-- OVERRIDE -->
WebJs uses sensible defaults. Environment
variables control infrastructure (no config files needed):

| Environment variable | Effect |
|---|---|
| `REDIS_URL` | Connection string consumed by `redisStore({ url: process.env.REDIS_URL })`. Not auto-wired. Call `setStore(redisStore())` once at app startup to put cache / sessions / rate-limit on Redis. |
| `AUTH_SECRET` | Required for auth JWT signing (32+ random chars) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID (optional) |
| `AUTH_GITHUB_ID` | GitHub OAuth client ID (optional) |
| `PORT` | Server port. Precedence: `--port` flag > `PORT` (a real exported env var or a `PORT` in `.env`) > 8080. |
| `WEBJS_PUBLIC_*` | Any env var starting with this prefix is exposed to the browser as `process.env.WEBJS_PUBLIC_X`. Components can read it directly. No build step, no transform. Use for API base URLs, Stripe publishable keys, analytics IDs, anything that is intended to be visible client-side. |

**Server-only by default.** Any env var without the `WEBJS_PUBLIC_` prefix never reaches the browser. Reading `process.env.DATABASE_URL` from a component returns `undefined`, the same as a typo. The prefix is fail-closed: secrets cannot accidentally leak.

**Development:** zero env vars needed. Everything works with memory/cookie/disk.
**Production:** set `AUTH_SECRET` + `SESSION_SECRET`. For horizontal scaling, also set `REDIS_URL` and add one line at app startup:

```js
import { setStore, redisStore } from '@webjsdev/server';
setStore(redisStore({ url: process.env.REDIS_URL }));
```

---

## Architecture: Modules

<!-- OVERRIDE -->
This app uses the **modules architecture** for feature-scoped code:

```
modules/
  <feature>/
    actions/        Server mutations (one async function per file, *.server.ts)
    queries/        Server reads (one async function per file, *.server.ts)
    components/     Feature-owned web components
    utils/          Pure helper functions
    types.ts        Shared TypeScript types / JSDoc typedefs
```

**Rules:**
- One exported function per server action/query file
- Server actions need BOTH the `.server.{js,ts}` extension AND a `'use server'` directive at the top. Extension alone marks a server-only utility (source-protected, not RPC-callable). Directive alone is a lint violation (`use-server-needs-extension`).
- Components must call `Class.register('tag')`
- Never import a DB driver (`node:sqlite`), `node:*`, or `db/`/`lib/` server files directly from components. Use server actions instead
- Routes (`app/**/page.ts`, `app/**/route.ts`) must be thin: import logic from modules

---

## Architecture: Routes

<!-- OVERRIDE -->
Routes live under `app/` and follow NextJs App Router conventions:

- `app/page.ts`: Homepage
- `app/<segment>/page.ts`: Static route
- `app/[param]/page.ts`: Dynamic route
- `app/[...rest]/page.ts`: Catch-all
- `app/(group)/...`: Route group (folder not in URL)
- `app/**/route.ts`: API endpoint
- `app/**/layout.ts`: Layout wrapper
- `app/**/error.ts`: Error boundary
- `app/**/middleware.ts`: Per-segment middleware

**Special route files:**
- `app/**/error.ts`: Error boundary. Default export receives `{ error }`, returns `TemplateResult`. Nearest boundary catches errors from pages below it.
- `app/**/loading.ts`: Loading state. Auto-wraps the sibling page in a `Suspense` boundary. Shown while async page functions resolve.
- `app/**/not-found.ts`: 404 page. Nearest wins when `notFound()` is thrown.
- `app/sitemap.ts`: Dynamic sitemap at `/sitemap.xml`. Export a function returning an array of `{ url, lastModified }`.
- `app/robots.ts`: Dynamic robots.txt at `/robots.txt`.
- `app/manifest.ts`: Web app manifest at `/manifest.json`.

**Rules:**
- A folder cannot have both `page.ts` and `route.ts`
- Page/layout default exports must be functions (possibly async)
- Route handlers export named methods: `GET`, `POST`, `PUT`, `DELETE`, `WS`

---

## Testing

<!-- OVERRIDE -->
Tests are organised by **feature**, mirroring `modules/<feature>/`.
Each feature gets its own folder under `test/`, even when it starts
with a single file. Test KIND (browser / e2e / smoke) lives in a
subfolder inside the feature, and only appears when there is a real
test of that kind.

```
test/
  <feature>/
    <name>.test.ts             ← node test: unit + integration
    browser/<name>.test.js     ← real-browser test (web-test-runner)
    e2e/<name>.test.ts         ← full-app end-to-end (opt in: WEBJS_E2E=1)
    smoke/<name>.test.ts       ← fast post-deploy sanity check
```

Concrete shape in this app:

```
test/
  auth/
    auth.test.ts              # signup / login / currentUser
    password.test.ts          # scrypt hash + verify
  chat/chat.test.ts
  comments/comments.test.ts
  posts/posts.test.ts
```

### Test kinds

| Kind | Where | What it does |
|------|-------|--------------|
| node (unit + integration) | `test/<feature>/*.test.ts` | Fast, no spawned process. Import server actions/queries/utilities and call them directly. Use `renderToString` for SSR HTML assertions. |
| browser | `test/<feature>/browser/*.test.js` | Real Chromium via web-test-runner + Playwright. Shadow DOM, events, `adoptedStyleSheets`, `IntersectionObserver`. |
| e2e | `test/<feature>/e2e/*.test.ts` | Boots the app and drives it through HTTP / a real browser. Gated behind `WEBJS_E2E=1`. |
| smoke | `test/<feature>/smoke/*.test.ts` | Fast deploy-time sanity check. |

### Running

- `webjs test` (or `node --test`) runs the node tests.
- `webjs test --browser` (or `npx wtr`) runs the browser tests.
- `WEBJS_E2E=1 webjs test` adds the e2e tests.

### Choosing a feature folder

Use the same name as the matching module folder when one exists:
`modules/posts/` ↔ `test/posts/`. If the test spans more than one
module, pick the most prominent feature or create a new folder
(`test/checkout/`, `test/onboarding/`). Never use catch-alls like
`test/utils/` or `test/misc/`.

### Debugging with Playwright MCP

This project includes a Playwright MCP server (`.claude.json`). When
debugging UI issues, AI agents can use the Playwright MCP tools to:
- Navigate to pages in a real browser
- Click elements, fill forms, interact with the UI
- Take screenshots to see what the user sees
- Inspect the accessibility tree for element discovery

Use `Playwright MCP` tools instead of writing one-shot Bash scripts
with puppeteer or playwright imports.

### When to write tests

| Change | Server test (node:test) | Browser test (WTR) |
|--------|------------------------|-------------------|
| New server action | Required | - |
| New component | Required (SSR output) | Required (interaction) |
| New page/route | - | Required |
| Bug fix | Required (regression) | If user-facing |
| Refactor | Existing tests must pass | Existing tests must pass |

---

## UI components: prefer the Webjs UI kit over raw Tailwind

<!-- OVERRIDE -->

This scaffold ships with the Webjs UI kit preinstalled at `components/ui/`.
The kit splits into **two tiers**. Picking the wrong tier produces
broken markup.

**Tier 1: class helpers** (button, card, input, label, alert, badge,
separator, skeleton, table, etc.): pure functions that return Tailwind
class strings. Call them and spread onto a **raw native element**.

**Tier 2: custom elements** (dialog, popover, tooltip, dropdown-menu,
tabs, accordion, collapsible, progress, etc.): real `<ui-X>` tags. Import
the module once (typically in `app/layout.ts`) and use the tag.

```ts
// Tier 1: class helpers on native elements (use this for forms,
// dashboards, cards, layouts, anywhere the value is purely visual)
import { buttonClass } from '#components/ui/button.ts';
import { inputClass } from '#components/ui/input.ts';
return html`
  <button class=${buttonClass({ size: 'lg' })}>Save</button>
  <input class=${inputClass()} placeholder="Email">
`;

// Tier 2: custom elements (modals, dropdowns, tab strips, tooltips,
// state the browser doesn't give you natively)
return html`
  <ui-dialog>
    <ui-dialog-trigger>
      <button class=${buttonClass({ variant: 'outline' })}>Edit</button>
    </ui-dialog-trigger>
    <ui-dialog-content>…</ui-dialog-content>
  </ui-dialog>
`;

// Avoid: hand-rolled Tailwind on every <button> loses visual
// consistency. Tier-1 helpers give you the same control with one import.
return html`
  <button class="px-4 py-2 rounded-md bg-primary text-primary-foreground">Save</button>
`;
```

Add more components with `webjs ui add <name>` (e.g. `webjs ui add dialog
tabs popover`). The catalogue lives at
[https://webjs.dev/ui](https://webjs.dev/ui).

**Hand-rolled Tailwind is still appropriate for:**
- One-off marketing pages, hero sections, landing CTAs.
- Anywhere the visual design intentionally diverges from the kit baseline.
- Layout primitives (`<div class="grid grid-cols-3 gap-4">`).

The convention: any visual element with a Tier-1 helper uses the helper.
Any stateful behavior with a Tier-2 element uses the element.

---

## Components

<!-- OVERRIDE -->

```ts
import { WebComponent, html } from '@webjsdev/core';

// Declare-free base-class factory style
export class MyWidget extends WebComponent({
  label: String,
  count: Number
}) {
  // Light DOM is the default; Tailwind utility classes apply directly.

  constructor() {
    super();
    // Defaults go here, never as class-field initializers
    // (`label = ''` would clobber the framework's reactive accessor).
    this.label = '';
    this.count = 0;
  }

  render() {
    return html`
      <div class="p-4 border border-border rounded-lg">
        <p class="font-serif text-foreground">${this.label}: ${this.count}</p>
      </div>
    `;
  }
}
MyWidget.register('my-widget');
```

The properties shape passed to `WebComponent({ ... })` is the runtime
declaration (reactive accessor, attribute coercion, reflection), and the
property types flow to `this.<prop>` with no `declare` lines needed. For
per-property options use the `prop()` helper inside the shape
(`count: prop(Number, { reflect: true })`, `mode: prop({ state: true })`);
narrow a type with `prop<Student>(Object)`. Set defaults in the constructor
after `super()`. A hand-written `static properties = { ... }` throws at
construction. The factory gives you full intelligence in any tsserver-backed
editor. See the Editor Setup docs for the standalone `@webjsdev/intellisense`
(no Lit dependency) that extends this to tag / attribute
intelligence inside `html\`…\`` templates (go-to-definition, binding-aware
completions, value/binding diagnostics, and hover on registered webjs
elements).

**Rules:**
- One component per file
- **Light DOM by default.** Opt in to shadow DOM with `static shadow = true` when you need scoped styles (via `static styles = css\`...\``) or third-party-embed isolation. `<slot>` projection works identically in both modes (named slots, fallback content, `assignedNodes` / `slotchange`, first-wins resolution), so slot usage alone is never a reason to opt into shadow DOM.
- Prefer Tailwind utility classes for styling. They're unique by construction (`p-4`, `font-semibold`) so they can't collide across components.
- **If a light-DOM component authors its own custom CSS (a `<style>` block in `render()` or an imported stylesheet), every class selector MUST be prefixed with the component's tag name.** Either pattern works. Pick one and stay consistent:
  - `.my-widget__body`, `.my-widget__title` (BEM-ish)
  - `my-widget .body`, `my-widget .title` (descendant selector)
- **Never extend raw HTMLElement directly for app components.** Always subclass `WebComponent` (or the factory form `WebComponent({...})`) to hook into SSR, lifecycle, elision, and the reactive property system. Extend raw HTMLElement only for rare native-API edge cases (like form-associated `ElementInternals` or customized built-in elements), and add a `webjs-allow-htmlelement: <reason>` comment to acknowledge the exception.
- Tag name must contain a hyphen (HTML spec)
- Always call `Class.register('tag')`. That's the standard DOM API.
- **Reactive props are declared via the base-class factory `WebComponent({ ... })`, with defaults set in `constructor()` after `super()`.** A hand-written `static properties = { ... }` throws at construction (`webjs check` flags it via `no-static-properties`). Never write `propName = value` or `propName: Type = value` as a class-field initializer. It compiles to `Object.defineProperty(this, …)` after `super()` and clobbers the framework's reactive accessor, silently breaking re-renders (`webjs check` flags this via `reactive-props-no-class-field`).
- Component state lives in signals. Import `signal` from
  `@webjsdev/core`, read via `signal.get()` inside `render()`, write
  via `signal.set(value)`. Module-scope signals share state across
  components; instance signals (created in the constructor) carry
  component-local state. Reactive properties (declared via the
  `WebComponent({ ... })` factory) wrap HTML attributes, attribute
  reflection, and `.prop=${value}` SSR hydration.
- Use lifecycle hooks (`firstUpdated`, `updated`) only when needed

---

## Components: Light DOM (default) vs Shadow DOM (opt-in)

<!-- OVERRIDE -->

| Use case | Mode | How |
|---|---|---|
| Global / Tailwind CSS, simple composition | **Light DOM** (default) | Write `class="..."` in your template. Plain children, global styles apply. |
| Scoped styles via `static styles = css\`\`` | Shadow DOM | Set `static shadow = true`. `adoptedStyleSheets` scopes bare selectors. |
| `<slot>` content projection | **Either** | Same `<slot>` / `<slot name="x">` / fallback / `assignedNodes` / `slotchange` API in both modes. Light DOM uses framework projection; shadow DOM uses native browser projection. |
| Third-party embed isolation | Shadow DOM | CSS can't leak in or out. |

**Light DOM** = the component renders as plain HTML. Global CSS and
Tailwind utility classes apply directly. Use `document.querySelector`
to find elements. No `:host`, no `::part`, no CSS-variable plumbing.

**Shadow DOM** = opt-in style encapsulation. Declare `static shadow = true`
and author styles via `static styles = css\`...\`` (adopted via
`adoptedStyleSheets`). The browser enforces the boundary, and nothing
leaks in or out.

Both modes are fully SSR'd. Light DOM emits content as direct children
with a `<!--webjs-hydrate-->` marker. Shadow DOM emits a
`<template shadowrootmode="open">` that the browser attaches automatically.
Both hydrate without flash on the client.

---

## Styling: Tailwind + JS helpers

<!-- OVERRIDE -->

The scaffold ships with the **Tailwind CSS browser runtime** + `@theme`
design tokens defined in the root layout. Every colour, font family,
fluid type scale value, and motion duration is declared once in `@theme`
and available everywhere via utility classes (`text-foreground`, `bg-card`,
`font-serif`, `duration-fast`, `text-display`).

**Dedup repeated Tailwind class bundles with JS helpers, not `@apply`.**
When the same string of classes appears in 2+ places, extract it into a
small function returning an `html` fragment. App-wide chunks live in
`lib/utils/ui.ts` (this file's examples); a chunk only one feature draws
lives in `modules/<feature>/utils/ui/<name>.ts` instead, so a view helper
never sits unlabelled beside the pure data helpers in `utils/`:

```ts
// lib/utils/ui.ts
import { html } from '@webjsdev/core';

export function rubric(label: string) {
  return html`
    <span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-primary mb-4">● ${label}</span>
  `;
}
```

Consume:

```ts
// app/page.ts
import { rubric } from '#lib/utils/ui.ts';

export default function Home() {
  return html`
    ${rubric('welcome')}
    <h1 class="font-serif text-display">Hello</h1>
  `;
}
```

Helpers run at SSR time inside `html\`\``, so the output is identical
to writing the classes inline. No client-side runtime.

**Why not `@apply`?** `@apply` hides which utilities back a class and
creates a second source of truth. JS helpers keep the class bundle
visible at the definition site and compose naturally with conditional
classes and active states.

**Custom CSS is still supported.** Plain `<style>` blocks, CSS modules,
or a build-step pipeline. The framework has no hard dependency on Tailwind.
If you mix custom CSS into a light-DOM component, apply the class-prefix
rule (see Components section above).

---

## Styling alternative: vanilla CSS end-to-end

<!-- OVERRIDE -->

If you'd rather skip Tailwind, webjs works with plain CSS as long as you
wrap pages, layouts, and components so class names don't collide in the
global light-DOM namespace.

**Convention: three scopes**

| Scope | Wrapper | Derivation |
|---|---|---|
| **Component** | Custom-element tag | Tag is already unique |
| **Page** | `.page-<route>` | `app/dashboard/page.ts` → `.page-dashboard`; `app/blog/[slug]/page.ts` → `.page-blog-slug`; root `app/page.ts` → `.page-home` |
| **Layout** | `.layout-<name>` | `app/layout.ts` → `.layout-root`; `app/admin/layout.ts` → `.layout-admin` |

Every page wraps its output in `<div class="page-<route>">`. Every
layout wraps in `<div class="layout-<name>">`. Components scope via
their tag. Styles colocate as `const STYLES = css\`…\`` + `<style>${'$'}{STYLES.text}</style>`.

```ts
// app/dashboard/page.ts
import { html, css } from '@webjsdev/core';

const STYLES = css\`
  .page-dashboard {
    .actions     { display: flex; gap: 12px; }
    .btn         { padding: 12px 24px; border-radius: 999px; }
    .btn-primary { background: var(--primary); color: var(--primary-foreground); }
  }
\`;

export default function Dashboard() {
  return html\`
    <style>${'$'}{STYLES.text}</style>
    <div class="page-dashboard">
      <div class="actions">
        <a class="btn btn-primary" href="/new">+ New</a>
      </div>
    </div>
  \`;
}
```

Inside each scope, `.btn` / `.input` / `.form` / `.item` are free
names. CSS descendant combinators stop them at the scope boundary.
A small curated set of **primitives** (`rubric`, `banner`,
`accent-link`, `display-h1`, …) can live global in the root layout
as your design system.

**When you'd pick this over Tailwind:**
- You want zero runtime scripts and zero build step.
- You prefer idiomatic CSS and plain-cascade debugging.
- You already have a design system in CSS custom properties.

**Costs:**
- Write more per-file CSS (no utility ecosystem).
- Discipline: every page/layout remembers to wrap.
- Renaming a route folder = 2 textual edits in one file (the wrapper class + the matching `class=` attribute).

Pick one convention per project and stay consistent.

---

## Rate limiting & middleware

<!-- OVERRIDE -->
Use `rateLimit()` as per-segment middleware to protect routes:

```ts
// app/api/auth/middleware.ts: protect auth endpoints
import { rateLimit } from '@webjsdev/server';

// Direct deploy (default). Keys on the socket-stamped IP, ignoring
// forwarded-IP headers.
export default rateLimit({ window: '10s', max: 5 });

// Behind a reverse proxy or CDN (Cloudflare, Railway, Fly, Vercel,
// nginx, Caddy). Set trustProxy to honour X-Forwarded-For. The proxy
// MUST strip inbound X-Forwarded-For before adding its own.
export default rateLimit({ window: '10s', max: 5, trustProxy: true });
```

Place `middleware.ts` at any route level. It applies to that subtree only.
Chain runs outermost → innermost.

---

## Lazy loading

<!-- OVERRIDE -->
For below-the-fold components with heavy JS, defer loading until visible:

```ts
class HeavyChart extends WebComponent {
  static lazy = true;  // module loaded on scroll, not on page load
  // ...
}
```

SSR content is visible immediately. Only the JS download is deferred.
**Do NOT use** for above-the-fold or critical UI (navigation, forms).

---

## REST endpoints from server actions (route.ts)

<!-- OVERRIDE -->
A server action is RPC-callable from components. To ALSO reach the same
function over plain HTTP (mobile apps, webhooks, third parties), put it behind
a `route.ts` handler. The action stays a normal `'use server'` function; the
route imports and calls it.

```ts
// modules/posts/actions/create-post.server.ts
'use server';
export async function createPost({ title, body }) {
  const [post] = await db.insert(posts).values({ title, body }).returning();
  return post;
}
```

```ts
// app/api/posts/route.ts
import { route } from '@webjsdev/server';
import { createPost } from '#modules/posts/actions/create-post.server.ts';
// The route() adapter merges query + route params + JSON body into one input
// object and JSON-responds the result. Pass { validate } to guard the input.
export const POST = route(createPost);
```

A hand-written `route.ts` (a `POST(req)` that reads the body and calls the
action) is always available for full control (custom headers, streaming).

**Security:** a `route.ts` REST endpoint is NOT CSRF-protected (only the RPC
path is). Authenticate every mutating endpoint via bearer tokens, API keys, or
auth middleware.

---

## Progressive enhancement (write HTML-first)

<!-- OVERRIDE -->

WebJs pages work without JavaScript by design. Read-paths render to
real HTML on the server. Write-paths run through plain `<form>` plus
server actions, and navigation is a real `<a href>`. Every web component
is SSR'd too. Its `render()` runs on the server, so the component's
initial markup is in the response before any script loads. With JS
disabled, a display-only custom element looks correct, and an
interactive one (counter, dropdown, tabs) still paints its initial
state. Only the *interactivity itself* (the +/- click, the open/close
toggle, the tab switch) requires JS.

**Default rules:**
- **Forms must work as plain HTML POSTs.** Bind the `'use server'` action
  into the form (`<form action=${createPost}>`), which is the whole
  wiring: the renderer omits the attribute so the form posts to the
  page's own URL, supplies `method="post"` and an enctype, and emits a
  hidden field carrying the action's identity, so the action's source
  never reaches the browser. Never `fetch` + a JS click handler for the
  happy path. A bare `<form method="post">` binds nothing and is a 405.
  The framework upgrades the form to a partial-swap
  submission automatically when the client router is active, and with
  JS disabled the same form does a full-page POST and works identically
  end-to-end.
- **Links must be real `<a href="…">`.** Don't roll a JS-only click
  handler for navigation. The client router intercepts `<a>` clicks and
  enhances them into SPA transitions. Without JS, the browser navigates
  the old-fashioned way.
- **Custom elements are the only place JS is allowed to be required.**
  If a feature works without state (a styled card, a layout, a list,
  a marketing section), it should not be a custom element with
  lifecycle. Use a plain function returning `html\`…\`` or a Tier-1
  Webjs-UI class helper (`buttonClass`, `cardClass`).
- **Test JS-off explicitly before marking a feature done.** Open the
  page in a browser with JS disabled (DevTools → Settings → Debugger
  → "Disable JavaScript") and exercise the user's read + write paths.
  If a write fails without JS, you've reached for `fetch` where a
  server action would have done the job.
- **Don't gate read-paths on hydration.** Never write components whose
  SSR'd HTML is empty or wrong on purpose with the expectation that
  JS will fill it in. The first paint must be the right content.

**SSR-meaningful component state.** The SSR pipeline constructs the
component, applies its attributes, and calls `render()`. It does NOT
call `connectedCallback`, `firstUpdated`, or any other browser-only
lifecycle hook. Whatever state should appear on first paint MUST be
set in the constructor (after `super()`) or be derivable from the
factory-declared reactive props + attributes on the rendered tag.

```ts
import { WebComponent, html, signal } from '@webjsdev/core';

class Cart extends WebComponent {
  items = signal<Item[]>([]);          // instance signal, SSR uses this for first paint

  connectedCallback() {
    super.connectedCallback();
    // Browser-only refinement, read localStorage and write the signal.
    // The component re-renders automatically.
    const stored = readFromLocalStorage();
    if (stored) this.items.set(stored);
  }

  render() {
    return html`<ul>${this.items.get().map(/* … */)}</ul>`;
  }
}
```

Where the data lives, where to read it:

| Data source | Where to read it |
|---|---|
| Database, session, cookies, request headers | Page function (server). Pass to component as attribute / property. |
| Component's own initial defaults | Component `constructor()` after `super()`. |
| Browser-only: `localStorage`, viewport, `matchMedia`, `navigator.*` | Component `connectedCallback()`, then write a signal (instance-scoped in the constructor, or module-scope if shared) to refine. |
| Theme color, RTL direction (flash-sensitive) | Synchronous inline `<script>` in root layout that sets `document.documentElement` attributes before custom elements upgrade. |

---

## Server actions

<!-- OVERRIDE -->

```ts
// modules/posts/actions/create-post.server.ts
'use server';
import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';
import type { ActionResult } from '#modules/posts/types.ts';

export async function createPost(input: {
  title: string;
  body: string;
}): Promise<ActionResult<Post>> {
  // validate, create, return
}
```

**Rules:**
- One function per file (greppable, AI-agent friendly)
- File name matches function name: `create-post.server.ts` → `createPost`
- Return `ActionResult<T>` envelope for actions that can fail
- Never throw for expected errors. Return `{ success: false, error, status }`
- Validate input at the top of the function

---

## Code style

<!-- OVERRIDE -->
- TypeScript with explicit `.ts` extensions in imports
- **Erasable TypeScript only.** The runtime strips types at the runtime layer (Node 24+'s built-in `module.stripTypeScriptTypes`, or `amaro` on Bun, byte-identical) with whitespace replacement, so line + column positions are byte-exact and no sourcemap ships. Your `tsconfig.json` sets `erasableSyntaxOnly: true`, so the compiler rejects: `enum`, `namespace` with values, constructor parameter properties, legacy decorators with `emitDecoratorMetadata`, and `import = require`. Write the erasable equivalents:
  ```ts
  // Not allowed
  enum Color { Red, Green, Blue }
  class Foo { constructor(public x: number) {} }

  // Erasable equivalents
  const Color = { Red: 'Red', Green: 'Green', Blue: 'Blue' } as const;
  type Color = typeof Color[keyof typeof Color];

  class Foo {
    x: number;
    constructor(x: number) { this.x = x; }
  }
  ```
  If you turn `erasableSyntaxOnly` off and use non-erasable syntax, the dev server fails at strip time and returns a 500 pointing at the `no-non-erasable-typescript` lint rule. WebJs is buildless end-to-end and has no bundler fallback. The `erasable-typescript-only` convention check warns when the flag is off.
- **Derive types at every boundary, never `unknown` or `any`.** Full-stack type safety is what the `.server.ts` boundary buys: a component importing a server action resolves to its real signature at type-check time, with no build step in between. So take the type that is already there: a row from the schema (`typeof posts.$inferSelect`, carried into a shipping component with `import type`), an action's input from a named `interface` and its result from `ActionResult<T>`, the routing files from `PageProps` / `LayoutProps` / `RouteHandlerContext`, an href from the generated `Route` union, a reactive property from `prop<Post>(Object)`. `unknown` is right for a payload nothing has vouched for yet that the next line narrows (a `route.ts` `await req.json()`, an action's `export const validate`, a `catch` binding), and for a parameter of your own helper that forwards into an `html` template hole, which is NOT narrowed because a hole renders a string, a number, a `TemplateResult`, or an array of those, so `TemplateResult` alone is too narrow (a value the framework already types, like a layout's `children`, is not this case). `unknown` that survives into a return type, a component prop, or an action signature is a missing type, not a safe one, and `any` has no carve-out. Nothing enforces this, since both are valid TypeScript, which is why it is written down.
- No semicolons (or with semicolons, pick one and stay consistent)
- `const` by default, `let` when needed, never `var`
- Prefer `async/await` over `.then()` chains
- Minimal comments. Code should be self-documenting
- No barrel files (`index.ts` re-exporting everything). Import from the source directly

---

## Git workflow

<!-- OVERRIDE -->

This project enforces a git workflow via agent-specific config files
(`.claude/settings.json`, `.cursorrules`, `.agents/rules/workflow.md`,
`.github/copilot-instructions.md`). These rules apply to ALL AI agents:

**Commit rules:**
- **Commit per logical unit, not at the end.** One feature, one fix, one
  rename, one doc rewrite per commit. Push after each commit.
- **Hard limit.** If you have 5+ unstaged files spanning different concerns,
  commit before continuing. The `.claude/hooks/nudge-uncommitted.sh` hook
  fires at threshold 4 to enforce this. Do not ignore the reminder.
- **Meaningful messages.** Imperative mood, what changed and why
  (`Add contact form with email validation`, not `update files`).
- **NEVER add AI attribution.** No `Co-Authored-By: Claude`, no
  `Generated by AI`, no `AI-assisted` trailers or prefixes.
- **Committing is automatic.** The user should never have to ask
  "please commit". Commit after completing each logical unit.

**Branch rules:**
- **Feature branches.** Never commit directly to main
- **Branch naming.** `feature/<name>`, `fix/<name>`, `refactor/<name>`
- **Pull requests.** Always create a PR, never push to main directly
- **NEVER merge without user permission.** Before merging ANY branch
  into ANY other branch, ask: "Ready to merge `<branch>` into `<target>`?
  Delete or keep `<branch>` after?" Wait for approval AND the preference.
- **Claude Code hook** (`.claude/hooks/guard-main-merge.sh`) enforces
  merge/push-to-main approval programmatically for Claude agents.
  Other agents enforce this via `.cursorrules`, `.agents/rules/workflow.md`,
  `.github/copilot-instructions.md`.

**Pre-commit checks:**
- `webjs test` must pass
- `webjs check` must pass
- No unrelated files in the commit

---

## Customizing conventions

The conventions in this file are guidance, so customize them directly:
edit the prose under any `<!-- OVERRIDE -->` marker. There is no
`package.json` switch and nothing to toggle, because conventions are not
enforced by a tool.

`webjs check` is separate: it runs only correctness checks, always, with
no per-project disabling. Run `webjs check` to validate, and
`webjs check --rules` to list those checks.

---

## Scaffold

Create new projects with `webjs create`:

```sh
webjs create <name>                  # full-stack (default; auth ships as a gallery card)
webjs create <name> --template api   # backend-only API (routes + modules + Drizzle)
```

**Route-wrapping pattern (especially for `--template api` apps):**
Routes are thin wrappers over typed server actions. Business logic lives in
`modules/`, routes just import and call the action/query:

```ts
// app/api/users/route.ts: thin wrapper
import { listUsers } from '#modules/users/queries/list-users.server.ts';
import { createUser } from '#modules/users/actions/create-user.server.ts';

export async function GET() { return Response.json(await listUsers()); }
export async function POST(req: Request) {
  const result = await createUser(await req.json());
  if (!result.success) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data, { status: 201 });
}
```
