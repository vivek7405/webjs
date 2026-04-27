# AGENTS.md — {{APP_NAME}}

Read this before editing any file. This is a webjs app: AI-first, web-
components-first, no build step. The framework's own full API reference
lives at https://github.com/vivek7405/webjs/blob/main/AGENTS.md — treat
this file as the app-scoped companion.

## Framework source is in `node_modules/`

No build step, no bundler, no minification — what you read is what
runs. When in doubt, grep the framework:

```
node_modules/@webjskit/
  core/            renderer, WebComponent, directives, client router,
                    Task, context, testing helpers
    src/component.js          ← lifecycle, properties, light vs shadow DOM
    src/render-client.js      ← client-side DOM patching + hydration
    src/render-server.js      ← renderToString / renderToStream
    src/router-client.js      ← Turbo-Drive-style client navigation
    src/directives.js         ← unsafeHTML, live
    src/context.js            ← Context Protocol
    src/task.js               ← async data with states
  server/          dev + prod server, SSR, file router, actions,
                    auth, sessions, cache, rate-limit, WebSocket
    src/ssr.js                ← how metadata becomes <head> tags
    src/router.js             ← file convention → route table
    src/actions.js            ← .server.ts scanner, RPC, expose()
    src/auth.js, session.js, cache.js, rate-limit.js, csrf.js
  cli/             webjs CLI (dev / start / build / test / check / create / db)
  ts-plugin/       tsserver go-to-definition for custom-element tag names
```

Reaching straight for the source is the fastest way to resolve "why
doesn't X work?" — no documentation guesswork, no stale blog posts.

## File conventions

```
app/                     thin route adapters — import from modules/
  page.ts                → /
  layout.ts              root layout, wraps every page
  error.ts               error boundary (render failures → user-friendly)
  loading.ts             Suspense fallback for sibling page
  not-found.ts           custom 404 page
  middleware.ts          global request middleware
  [slug]/page.ts         dynamic route segment
  [...rest]/page.ts      catch-all
  (group)/               route group (parens not in URL)
  _private/              underscore = not routable
  api/
    <path>/route.ts      GET / POST / PUT / DELETE / WS handlers
  sitemap.ts             metadata route → /sitemap.xml
  robots.ts              metadata route → /robots.txt
  opengraph-image.ts     metadata route → /opengraph-image
components/              web components — extend WebComponent, call .register()
modules/<feature>/
  actions/*.server.ts    server actions (one function per file)
  queries/*.server.ts    data reads (one function per file)
  components/*.ts        feature-scoped components
  utils/*.ts             feature-scoped helpers
  types.ts               feature types
lib/
  prisma.ts              PrismaClient singleton (import from here, never `new PrismaClient()`)
  ...                    other cross-cutting infra (session, auth config, etc.)
prisma/
  schema.prisma          Prisma schema — SQLite by default, switch provider for Postgres/MySQL
  dev.db                 SQLite file (gitignored); run `npm run db:migrate` to create
  migrations/            generated migration SQL
public/                  static assets, served at /public/*
test/unit/*.test.ts      unit tests (node --test)
test/browser/*.test.ts   browser tests (web-test-runner)
middleware.ts            root middleware (optional, outermost)
```

## Database (Prisma + SQLite by default)

Every scaffold includes a Prisma setup pointed at a local SQLite file.
First-run workflow:

```sh
cp .env.example .env          # DATABASE_URL is pre-filled for SQLite
npm run db:migrate            # creates prisma/dev.db + migration
npm run dev                   # webjs dev + prisma generate via predev
```

Scripts:

- `npm run db:migrate` — `prisma migrate dev` (dev-time schema changes + migration + generate)
- `npm run db:generate` — `prisma generate` (regenerate client only)
- `npm run db:studio` — `prisma studio` (GUI)
- `predev` hook auto-runs `prisma generate` before `npm run dev`
- `prestart` hook runs `prisma migrate deploy` before `npm start` (idempotent in prod)

Always import the client from `lib/prisma.ts` (never `new PrismaClient()` directly —
the singleton avoids opening a new connection on every dev-server reload):

```ts
import { prisma } from '../../../lib/prisma.ts';
const users = await prisma.user.findMany();
```

To switch to Postgres or MySQL: change `provider` in `prisma/schema.prisma`
and the `DATABASE_URL` in `.env`.

## Imports

```ts
import { html, css, WebComponent } from '@webjskit/core';
import '@webjskit/core/client-router';              // enable SPA nav
import { unsafeHTML, live } from '@webjskit/core/directives';
import { createContext } from '@webjskit/core/context';
import { Task } from '@webjskit/core/task';
import { fixture, waitForUpdate } from '@webjskit/core/testing';

import { rateLimit, cache, createAuth, Credentials, Session } from '@webjskit/server';
```

## Component pattern

```ts
import { WebComponent, html, css } from '@webjskit/core';

export class Counter extends WebComponent {
  static tag = 'my-counter';       // required, must contain a hyphen
  static properties = { count: { type: Number } };
  static styles = css`button { padding: 8px 12px; }`;
  // static shadow = true;          // opt into shadow DOM (default: light DOM)
  // static lazy = true;             // download JS only when scrolled into view

  render() {
    return html`
      <button @click=${() => this.setState({ count: this.count + 1 })}>
        ${this.count}
      </button>
    `;
  }
}
Counter.register('my-counter');
```

## Server action pattern

```ts
// modules/posts/actions/create-post.server.ts
'use server';
import { prisma } from '../../../lib/prisma.ts';

export async function createPost(input: { title: string; body: string }) {
  if (!input.title) return { success: false, error: 'title required', status: 400 };
  const post = await prisma.post.create({ data: input });
  return { success: true, data: post };
}
```

Import it from a client component — the framework rewrites it into a
type-safe RPC stub automatically.

## Metadata (per-page)

```ts
export const metadata = {
  title: 'My page',
  description: 'A page in {{APP_NAME}}',
  openGraph: { type: 'website', image: 'https://...' },
  twitter: { card: 'summary_large_image' },
  cacheControl: 'public, max-age=60',  // opt into caching (default: no-store)
};
```

Use `generateMetadata(ctx)` when you need request-scoped values (e.g.
absolute URLs from `ctx.url`).

## Invariants (do not violate)

1. Custom element tags must contain a hyphen. Set `static tag`, call `.register()`.
2. Never import `@prisma/client` or `node:*` from client-reachable files —
   only from `.server.ts` modules or `lib/*.ts`.
3. Event / property / boolean holes in `` html`` `` are unquoted:
   `@click=${fn}`, not `@click="${fn}"`.
4. Use `setState()` — never mutate `this.state` directly.
5. Pages / layouts / metadata routes default-export a server-only function.
6. One exported function per action / query file. Name the file after it.

## Workflow expectations for AI agents

1. Branch before editing — never push to `main` directly.
2. Every code change comes with: unit test(s), AGENTS.md / docs updates if
   the feature surface changed, `webjs check` passing.
3. Commit and push after each logical unit. No AI attribution trailers.
4. When unsure how a framework feature works, `grep` or `cat` the
   relevant `node_modules/@webjskit/*/src/` file before asking the user.

Project-specific conventions and overrides live in
[CONVENTIONS.md](./CONVENTIONS.md).
