---
title: "What Is WebJs? A No-Build Full-Stack Web Framework"
date: 2025-12-15T10:00:00+05:30
slug: why-webjs
description: "WebJs is a no-build, web-components-first full-stack framework that stays close to web standards, with a Next.js-style developer experience. AI-first."
tags: webjs, origin, frameworks, ai-first, web-components
author: Vivek
---

Most web frameworks put a compile step between you and the browser, so the code you read is not the code that runs, and every few years you relearn a new proprietary runtime. I wanted the opposite. I wanted a full-stack framework that stayed close to web standards. The kind where the things you learn carry over to the platform, where the source you read in `node_modules` is the source that runs, where there is no mystery layer of compiled output between you and the runtime.

I also wanted the developer experience I enjoy in Next.js. File-based routing. Server actions importable from the client. SSR (server-side rendering) that just works. Sensible defaults. The good parts of the Rails-style "you do not need to make 30 decisions before your first feature."

I tried to find one that hit both. I did not find one I personally enjoyed using. So I built one for myself.

That is the entire origin story. WebJs is the framework I wanted to exist.


# What "close to web standards" actually means

It means web components for the view layer. Native browser primitives: `customElements.define`, shadow DOM, `<slot>` projection. They have been shipping in every major browser since 2018. They render without a framework. They survive framework churn. When the next big thing arrives, your `<my-counter>` element still works.

It means no proprietary component runtime to reinvent things the platform already does. Most modern frameworks ship a custom virtual DOM, a custom reconciler, a custom hydration story, a custom component lifecycle. Each of those is thousands of lines that exist because the framework chose not to use what the browser provides. WebJs uses what the browser provides, then adds the smallest layer needed to make the developer experience comfortable on top.

That layer is lit-shaped. `render() { return html\`\` }`, `ReactiveController`, the full directive set, reactive properties declared up front (via the `extends WebComponent({ … })` factory rather than lit's decorators, the one erasability-driven divergence). lit's API is what the corpus and the muscle memory already knows for web components, so I aligned the public surface to it. The runtime under the hood is WebJs's own (so we control the SSR pipeline end-to-end), but the surface an agent or a developer reads matches what they already know.


# How small "close to standards" lets the framework be

By leaning on the platform, the framework code stays small. The full WebJs framework, including `@webjsdev/core` and `@webjsdev/server`, is on the order of 30,000 lines of plain JavaScript with JSDoc types. For comparison, Next.js is in the hundreds of thousands of lines. WebJs is roughly 5-10% the size of Next.js by source.

The features are comparable. WebJs ships:

- File-based routing (`page.ts`, `layout.ts`, `route.ts`, `[param]`, `(group)`, `_private`, the full Next.js app-router shape)
- Server actions with full type safety across the network boundary (a `.server.ts` file with `'use server'`, imported from client code, gets rewritten to a typed RPC stub, a remote-procedure-call proxy, at request time)
- SSR with streaming Suspense boundaries
- Client router that preserves layout DOM across navigations (no white flash)
- Built-in auth, sessions, cookies, cache, and rate limiting, all sharing one pluggable store
- WebSockets on the same route file
- Drizzle + SQLite (or Postgres) configured out of the box
- Tailwind CSS configured out of the box
- A component library (`@webjsdev/ui`) with `webjs ui add button card dialog`

The reason the size delta is so large despite comparable features: the platform does the heavy lifting. Native web components replace the custom component runtime. Node 24's built-in `module.stripTypeScriptTypes` replaces the build step. HTTP/2 multiplex at the edge replaces the bundler. CSS variables replace the theme runtime. Each of those is a feature WebJs gets to delete.


# No build step

WebJs has no build step. The `.ts` files you write are the files the browser fetches. Node 24's built-in TypeScript stripper does position-preserving whitespace erasure, so stack traces point at the lines you wrote without a sourcemap layer. Edit, save, refresh.

This is what makes the framework feel close to the metal. There is no `webjs build` command because there is nothing to build. The dev loop and the production runtime serve the same files.

Production performance comes from HTTP/2 multiplex plus `<link rel="modulepreload">` hints emitted at SSR time. PaaS edges (Railway, Fly, Vercel, Cloudflare) handle HTTP/2 automatically. Same architecture as Rails 7 with `importmap-rails`. The Rails team got there first; WebJs adopted the model for Node-shaped apps.


# Why AI-first followed naturally

When you build a framework from scratch in 2025, you write it knowing that AI agents will read it, write code with it, and ship features in it. That is not a marketing layer added later. It is a constraint that shapes every design decision from day one.

What that translates to:

- **The source is readable.** `node_modules/@webjsdev/core/src/component.js` is a real JS file with comments and JSDoc, not a minified bundle. An agent can `cat` it and reason about it the same way it reads project code.

- **The file layout is opinionated.** `app/` is routing only. `modules/<feature>/{actions,queries,utils,components}` is where business logic goes. `lib/` is for cross-cutting helpers. No "you decide where this goes" ambiguity. An agent that knows the convention writes correct code on the first try.

- **Conventions are enforced by tooling.** `webjs check` lints the rules that can be checked mechanically. The pre-commit hook refuses commits that break tests, refuses commits to `main`, auto-generates changelog entries on version bumps. The framework guards itself in the seams where mistakes happen, not in a doc page.

- **AGENTS.md is the contract.** Every scaffolded WebJs app ships with `AGENTS.md` at the root: file conventions, public API, framework invariants, recipes, and a "deliberately deferred" list so the agent does not try to add a bundler. Cursor, opencode, Antigravity, and Copilot's coding agent read that file natively, and Claude Code gets a one-line `CLAUDE.md` pointing at it. One source of truth, every major coding agent reads it.

- **No build step means console parity.** When DevTools shows an error at `app/posts/[slug]/page.ts:42:8`, the agent opens that exact path and jumps to that exact line. The file on disk is what the runtime sees.

- **Types span the network boundary.** Import a server-side function from `actions/create-post.server.ts` into a client component, and TypeScript sees the real signature. WebJs's wire serializer round-trips `Date`, `Map`, `Set`, `BigInt`, `TypedArray`, `Blob`, `File`, `FormData`, and reference cycles. No hand-written JSON adapters at the boundary.

None of this is a special-case for AI tools. It is what you get when you build a framework whose primary user, from day one, is an agent reading the source.


# Stack defaults

The scaffold ships with sensible defaults so you can write features instead of integrating libraries:

- **Database:** Drizzle + SQLite (swap one file, `db/columns.server.ts`, to move the same schema and queries to Postgres).
- **Styling:** Tailwind via the CLI (no browser runtime; CSS is built at startup, served as a static file).
- **Auth:** built-in `createAuth()` with Google, GitHub, and Credentials providers.
- **Server actions:** a `.server.ts` file with `'use server'` plus an import from client code, rewritten at request time into a typed RPC stub.
- **Wire serializer:** rich types (`Date`, `Map`, `Set`, `BigInt`, `TypedArray`, `Blob`, `File`, `FormData`, cycles) round-trip without hand-written adapters. Inspired by Superjson, written to share code paths with the framework renderer.
- **Tests:** `node:test` for server-side, web-test-runner + Playwright for browser, both pre-wired.

Each one is swappable. Out of the box, they all work together. You scaffold the app, type `npm run dev`, and you have a working full-stack codebase with auth in under thirty seconds.


# What ships in every scaffolded app

```sh
npm create webjs@latest my-app
```

Auto-installs dependencies. The scaffold lands you with:

- A working auth flow (Google / GitHub / Credentials)
- A protected dashboard
- A starter test suite for both server and browser
- `AGENTS.md`, `CONVENTIONS.md`, `CLAUDE.md`, and per-tool agent configs
- A pre-commit hook that blocks commits to `main`, runs `npm test`, and auto-generates changelog entries on version bumps
- `@webjsdev/ui` installed and ready (`webjs ui add button card dialog`)
- A `.env.example` and a Drizzle schema with a working example


# Where it stands

Pre-1.0 as of this writing. 1151 unit tests, 271 browser tests, 61 puppeteer e2e tests. The framework is small enough to read end-to-end in an afternoon, which is the whole point. The example blog under `examples/blog/` exercises every feature.

The rest of this blog is design notes. Each post covers a single decision in depth: the lit-API parity rationale, the signals migration, how the client router avoids the white flash between navigations, what light-DOM `<slot>` projection looks like, the npm naming saga that ate a Saturday.

The thesis is straightforward. A framework that stays close to web standards stays small. A framework that is small stays readable. A framework that is readable is one an AI agent can ship features in without getting lost. WebJs is my attempt at that shape, and it is the framework I now use for my own work.

The site is at [webjs.dev](https://webjs.dev). The repo is at [github.com/webjsdev/webjs](https://github.com/webjsdev/webjs). The CLI is on npm at `@webjsdev/cli`, or scaffold directly with `npm create webjs@latest my-app`.
