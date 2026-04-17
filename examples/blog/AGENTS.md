# AGENTS.md — webjs blog example

This is the reference app for the webjs framework. It exercises every
feature the framework ships. Read this before editing any file.

## App layout

```
app/                         thin route adapters
  layout.ts                  root layout (design tokens, theme toggle, <blog-shell>)
  page.ts                    / (home — post feed, counter, chat)
  error.ts                   error boundary
  not-found.ts               404
  login/page.ts              /login (auth-forms component)
  blog/[slug]/page.ts        /blog/:slug (post + live comments)
  dashboard/
    middleware.ts             auth gate (302 → /login if no session)
    page.ts                  /dashboard
    posts/new/page.ts        /dashboard/posts/new
  (marketing)/about/page.ts  /about (route group — parens not in URL)
  _utils/format.ts           private folder (underscore — not routable)
  api/
    hello/route.ts           GET /api/hello
    posts/route.ts           GET/POST /api/posts
    posts/[slug]/route.ts    GET/DELETE /api/posts/:slug
    comments/[postId]/route.ts  GET/POST + WS /api/comments/:postId
    chat/route.ts            GET + WS /api/chat
    auth/
      middleware.ts           rate limit (5 req / 10s / IP)
      login/route.ts          POST /api/auth/login
      signup/route.ts         POST /api/auth/signup
      logout/route.ts         POST /api/auth/logout
middleware.ts                root middleware (request logging)
lib/                         cross-cutting infra
  prisma.ts                  PrismaClient singleton
  password.ts                scrypt hash/verify
  session.ts                 session cookie helpers
modules/
  auth/
    actions/signup.server.ts, login.server.ts, logout.server.ts
    queries/current-user.server.ts
    components/auth-forms.ts
    utils/validate.ts
    types.ts                 PublicUser, ActionResult<T>
  posts/
    actions/create-post.server.ts, delete-post.server.ts
    queries/list-posts.server.ts, get-post.server.ts
    components/new-post.ts
    utils/slugify.ts         slugify() + formatPost()
    types.ts                 PostFormatted, CreatePostInput
  comments/
    actions/create-comment.server.ts
    queries/list-comments.server.ts
    components/comments-thread.ts
    utils/format.ts          formatComment()
    utils/bus.ts             in-process pub/sub for live comments
    types.ts                 CommentFormatted
  chat/
    components/chat-box.ts
    utils/clients.ts         shared WebSocket client Set + broadcast()
    types.ts                 ChatMessage
components/                  shared UI primitives
  blog-shell.ts, counter.ts, error-card.ts, muted-text.ts, theme-toggle.ts
prisma/schema.prisma         User, Session, Post, Comment
```

## Feature usage in this app

### Rate limiting
`app/api/auth/middleware.ts` applies `rateLimit({ window: '10s', max: 5 })` to all auth endpoints — 5 requests per 10 seconds per IP. Exceeding returns 429 with `retry-after` header. Uses the global cache store (memory in dev, Redis if `REDIS_URL` is set).

### Error boundaries
`app/error.ts` catches any unhandled error during page rendering. Receives `{ error }` and renders a user-friendly error card. Nested error boundaries are supported — place `error.ts` deeper in the route tree to isolate failures.

### Client router
The layout (`app/layout.ts`) imports `webjs/client-router` — all `<a>` links navigate via fetch + DOM swap. The `<blog-shell>` layout stays mounted across navigations (header, footer, theme state preserved). Only page content swaps.

### Middleware
- `middleware.ts` (root) — request logging on every route.
- `app/dashboard/middleware.ts` — auth gate: redirects to `/login` if no session.
- `app/api/auth/middleware.ts` — rate limiting on auth endpoints.

### WebSockets
- `app/api/chat/route.ts` exports `WS` for the live chat.
- `app/api/comments/[postId]/route.ts` exports `WS` for live comment threads.
- Client components use `connectWS()` for auto-reconnecting WebSocket connections.

## Conventions

- **One exported function per action/query file.** Name the file after the function.
- **ActionResult<T> envelope** for all actions: `{ success: true, data } | { success: false, error, status }`.
- **Routes are thin adapters.** Business logic lives in modules. A route imports a module function, calls it, translates the result to a Response.
- **Server-only imports** (prisma, node:crypto, etc.) only in `.server.ts` files or `lib/`.
- **No barrel files.** Import from the specific file.
- **Types per module** in `types.ts`. Shared types (ActionResult) live in `modules/auth/types.ts`.
- **globalThis for dev singletons** (Prisma, WS clients, comment bus) — survives module cache-busting.

## Invariants

1. Never import `@prisma/client` or `node:*` from components or pages.
2. Custom element tags must contain a hyphen. Set `static tag`, call `register(import.meta.url)`.
3. Event/property/boolean holes in `html` must be unquoted: `@click=${fn}`, not `@click="${fn}"`.
4. Use `setState()`, not direct `this.state` mutation.
5. Pages/layouts are server-only functions returning TemplateResult.

## Recipes

### Add a page
Create `app/<path>/page.ts`. Export default async function returning `html\`...\``.

### Add an API endpoint
Create `app/api/<path>/route.ts`. Export named functions: `GET`, `POST`, etc.

### Add a server action
Create `modules/<feature>/actions/<name>.server.ts`. Export one async function.
Import from auth/types.ts for ActionResult<T>.

### Add a component
Create `modules/<feature>/components/<name>.ts` or `components/<name>.ts`.
Extend WebComponent. Set `static tag`. Call `register(import.meta.url)`.

### Add a database model
Edit `prisma/schema.prisma`. Run `npx webjs db migrate <name>` then `npx webjs db generate`.
