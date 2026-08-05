---
title: "Buildless TypeScript: Strip Types, Not esbuild"
date: 2026-01-12T09:30:00+05:30
slug: strip-types-not-esbuild
description: "How WebJs serves buildless TypeScript by stripping types at runtime with Node 24's module.stripTypeScriptTypes instead of esbuild, with no sourcemaps needed."
tags: typescript, no-build, runtime, performance
author: Vivek
---

You write a `.ts` file, and it runs. No build step, no bundler warming up, no generated output to chase when a stack trace lands somewhere you did not write. That is what a WebJs app feels like today, and it took some work to get here. For the early months of WebJs, every `.ts` file in your project went through esbuild (a fast JavaScript and TypeScript build tool) before it reached the browser. esbuild is fast (about 1ms per file on warm cache), and we ran it as an ESM loader hook so the server-side and the client-bound transforms shared one code path. It worked.

It worked, but it produced sourcemaps (files that map the generated code back to the source you wrote). And the sourcemaps were the thing that kept biting me.


# What the sourcemap layer cost

A user file at `app/posts/[slug]/page.ts` would arrive in the browser as a slightly-different-shaped JS file with an inline base64 sourcemap appended. The sourcemap let DevTools show the original source when you hit a breakpoint, which is what sourcemaps are for. Fine.

But every time an agent hit a runtime error and tried to fix it, the agent's debugging loop went through the sourcemap. Read the stack trace. The trace points at the generated file at line X column Y. The agent has to mentally map that back to the original source. Sometimes it gets it right. Sometimes it patches the wrong line because the line numbers do not match what it expects.

Worse, the assistant would sometimes read the generated JS instead of the source, propose a fix to the generated output, and the fix did not apply because the source was different. Watching this happen a few times made me realize the sourcemap was an abstraction the agent did not handle reliably.


# What Node 24 changed

Node 24 ships `module.stripTypeScriptTypes`. The stripper reaches it through a namespace import rather than a named one:

```js
import * as nodeModule from 'node:module';
// nodeModule.stripTypeScriptTypes, or undefined on a runtime without it
```

That detail is not stylistic. A named import of a builtin export that does not exist is a link-time SyntaxError, which fires before any module body runs and would take down the import of the server package itself on a runtime that ships no stripper. A namespace import links everywhere and leaves the branch to run time.

It is a position-preserving type eraser. Take a `.ts` file, strip the types, and the output has every line at the same line number and every column at the same column. Where there used to be `let foo: number = 1`, there is now `let foo         = 1`. The whitespace shows up where the type annotation used to be. The semantics are identical to what the user wrote.

The runtime backing is the `amaro` package, vendored into Node 24. WebJs also depends on `amaro` directly, as an optional dependency, which is what covers a runtime that ships no stripper of its own. Which of the two runs is decided by a feature-detection check at server start.

What it gets you:

- No sourcemap is needed. Position information is preserved.
- Wire bytes drop. Same file, minus a base64 blob.
- Stack traces point at lines the user can open in their editor and read.
- The agent's debugging loop converges in fewer iterations because the file on disk matches what the runtime sees.

The catch: the stripper only supports erasable TypeScript. `enum`, `namespace` with values, constructor parameter properties, legacy decorators with `emitDecoratorMetadata`, and `import = require` are all rejected. The TypeScript team added `erasableSyntaxOnly: true` in `tsconfig.json` to make the editor flag those at edit time.

WebJs's scaffolded `tsconfig.json` turns the flag on by default. If you write `enum Status { ... }` in a WebJs project, your editor underlines it and the framework's `webjs check` lint catches it before commit. We made the trade: less TypeScript surface area, no sourcemap layer, smaller wire bytes, exact stack traces.


# The migration

The work landed as PR #9 (merge `3c29d99`, branch `feat/replace-esbuild-with-strip-types`). It removed the esbuild ESM loader hook and replaced it with a server-side call to `stripTypeScriptTypes`. The implementation lives in `packages/server/src/dev.js`.

The cache shape is straightforward:

```ts
const TS_CACHE_MAX = 500;
// state.tsCache, one Map per request handler
// Entry: { mtimeMs, code, map: string | null }
```

Capped at 500 entries to prevent unbounded memory growth in long-running production servers. Keyed by absolute path, invalidated when the file's mtime changes. First request through is on the order of a hundred microseconds per file. Subsequent requests are Map lookups. The Map hangs off the request handler rather than the module, because the cached bytes bake in that handler's elision verdict, so two handlers for the same app with different elision settings must not share one.

There is no fallback for a file that uses non-erasable syntax. Stripping throws and the server returns a clean 500, and that is the entire error path. In dev the response names the offending construct and points at the rule; in production it stays terse on purpose, so no path leaks to a visitor, and the detail goes to the server log instead. Nothing regenerates the code through a bundler, which is what keeps the guarantee worth having: the file on disk is the file that runs, with no second code path where that stops being true. Two `webjs check` rules catch the problem at edit time instead, `erasable-typescript-only` on the tsconfig flag and `no-non-erasable-typescript` on the source itself.

What does vary is the backend doing the stripping. On Node it is the built-in `module.stripTypeScriptTypes`. On Bun, which has no such built-in, it is `amaro`, and since Node's built-in is itself a thin wrapper over `amaro`'s `strip-only` mode, both runtimes produce byte-identical output with the same position preservation.


# What this enabled downstream

A few things got simpler once we stopped emitting sourcemaps.

The HTTP layer no longer had to negotiate content types or worry about source-content delivery. Every `.ts` response is just JS bytes with the type annotations whitespace-erased.

The 103 Early Hints flow got cleaner. We emit `<link rel="modulepreload">` headers before SSR (server-side rendering) begins. The preload references the canonical URL with the `.ts` extension. The browser fetches that URL, gets stripped JS back, runs it. No content-type fight.

The dev-mode live reload got cheaper. The watcher signals "file changed at this path." The cache evicts that entry by mtime mismatch. The next browser fetch returns the freshly-stripped output. Total work per change: stat the file, strip the bytes, write to the cache.

The test runner got faster because `node --test` runs raw `.ts` files natively in Node 24. No transform step at all in the test path. Same code that runs in production is the code the tests see.


# What it did not solve

Type checking is still a separate step. `tsc --noEmit` runs in the editor (via the language server) and in CI. The runtime does not type-check; it just erases types. This is the lit / Svelte / Vue split that the ecosystem has been converging on.

The other limit: the agent has to know about `erasableSyntaxOnly`. When it reaches for `enum`, the lint catches it at commit, but a freshly-spawned agent in autonomous mode could spend a few minutes writing enum-shaped code before the linter pushes back. The framework's AGENTS.md hints at this up front (invariant 10 has the rule and the erasable equivalents), so the agent reads it and adapts. The first few times we caught the agent writing enums, we updated the doc to be more direct.


# What changed in the user-facing story

For someone writing a WebJs app today: nothing visible. The `.ts` file you write is the file that runs. There is no build step to remember, no sourcemap to chase. Stack traces point at the file you opened. The TypeScript you write must be erasable, but the editor flags non-erasable syntax at edit time so you never get surprised in production.

For someone debugging a WebJs app today: noticeably better. Open DevTools. Hit a breakpoint at `app/components/foo.ts:42`. Open the same file in your editor. Same line. Same column. No translation layer in the way.

That is the whole pitch for this PR. A new Node version shipped a feature that obviated 80% of what our build step did. We removed the build step. The rest is downstream cleanup.

The framework got measurably smaller after this PR. Less code is the win you do not advertise but you feel every day. Less surface area to debug, less to teach the agent, less for the runtime to do per request.
