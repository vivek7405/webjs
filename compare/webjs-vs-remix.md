---
title: "WebJs vs Remix 3: No Bundler, Beyond React, Web Standards"
date: 2026-07-09T10:00:00+05:30
slug: webjs-vs-remix
description: "An honest comparison of WebJs and Remix 3. Both drop the bundler, move beyond React, run on web standards, and are built for AI agents. They diverge on how much compiling sits between your source and the browser, and on the view layer: WebJs uses native web components with a declarative reactive API, Remix 3 uses its own runtime-first virtual DOM with an imperative model."
competitor: "Remix 3"
link: "https://remix.run"
tagline: "Two frameworks that dropped React and the bundler, diverging on the view layer and on how much of your source gets compiled."
tags: comparison, remix, remix-3, web-standards, no-bundler
author: Vivek
---

This compares WebJs with **Remix 3**, the ground-up rewrite currently in beta, not Remix 1 or 2. That distinction matters, because Remix 3 is a different framework from the React-based Remix that came before. It drops React entirely, drops the bundler, and rebuilds on web standards. Where the older Remix was a React framework with a compiler, Remix 3 shares a surprising amount of philosophy with WebJs, so this is more a story of two frameworks reaching similar conclusions and then diverging.


# What the two share

Remix 3 and WebJs agree on more than most framework pairs:

- **No bundler and no build command.** Remix 3 is "religiously runtime": no Webpack, no Vite, no build step you run before starting the app. The server runs your TypeScript and JSX source through a Node `--import` loader, and browser modules are compiled one at a time, on demand, by its own asset server. WebJs also has no bundler and no build command, and reaches the browser through a different route (the next section is about exactly that difference). Both treat pre-runtime static analysis as something to avoid designing around.
- **Beyond React.** Remix 3 removed React and renders through its own lightweight virtual DOM (a few low-level pieces adapted from Preact), authored in JSX. WebJs uses native web components. Both concluded that the React runtime is not the thing to build the future on.
- **Web standards at the core.** Remix 3 runs directly on the Fetch API with standard `Request` and `Response` objects. WebJs is built on native custom elements and the same web platform primitives.
- **Built for AI agents.** Remix 3 aims for a model-first API surface optimized for humans and AI agents. WebJs is AI-first by design, small enough to read end to end, with conventions the tooling enforces.
- **Progressive enhancement.** Both send real HTML and treat forms and the request/response cycle as first-class, not a fallback nobody tests.

If you were drawn to Remix 3's direction, WebJs will feel philosophically adjacent. The differences are in how much compiling each one does, how each builds the view, and how each shapes the data layer.


# Difference one: compiled on demand vs served as source

Dropping the bundler is not the same as dropping compilation, and this is where the two frameworks separate first.

Remix 3 authors components in JSX, which no browser executes, so every browser module has to be compiled before it can run. Its asset server does that at request time: it transforms TypeScript and JSX through oxc, rewrites imports to public URLs, and follows CSS `@import` and `url()` references through lightningcss. In production the same pipeline lowers syntax to the browser targets you declare, minifies, and serves fingerprinted URLs. That is a genuine compiler, and setting it up is part of setting up an app (a file map, an allow list of servable files and packages, targets, minification, source maps, fingerprints, file watching). It runs per request instead of ahead of time, which is a real simplification over a bundler, but it is not the absence of a build.

WebJs serves the file. Its `html` templates are ordinary tagged template literals, so a `.js` component is valid JavaScript the browser runs as written, and a `.ts` file only has its type annotations erased by Node's built-in stripper. The framework does its own rewriting on top of that (the import graph decides what is servable at all, a `.server.ts` import becomes a typed RPC stub, and display-only modules are elided out of the page), but there is no syntax to compile, no CSS compiler in the path, and nothing about the pipeline to configure.

So the honest version of the shared headline is that neither framework has a build step you run, and the difference is how much translation happens between your source and the browser. Remix compiles a language the browser cannot run. WebJs erases types from one it can.


# Difference two: native web components vs a runtime-first VDOM

This is the core divergence in the view layer. Remix 3 renders through its own lightweight virtual DOM (with a reconciler, a `mix` composition system, JSX, and frame hydration) that it ships and controls. WebJs renders through native web components: `customElements.define`, shadow DOM when you want it, `<slot>` projection, no virtual DOM and no reconciler shipped to the browser.

The consequence is what outlives the framework. A WebJs `<my-counter>` is a real custom element that the browser upgrades and runs on its own; it keeps working independent of the framework version. Remix 3's components live inside its VDOM runtime. One bets on the browser's own component model, the other on a small controlled virtual DOM. WebJs also elides display-only components entirely, so a component with no interactivity ships zero JavaScript, which a shipped VDOM runtime does not do by default.


# Difference three: declarative reactivity vs an imperative model

Remix 3 leans deliberately imperative. A component is a setup function that receives a `handle` and returns a render function: the outer function runs once, the inner one runs on each update. State is plain local variables, you trigger a re-render explicitly by calling `handle.update()`, and you compose reusable behavior with `mix` and mixins. It is a procedural style: first do this, then do that.

WebJs is declarative and lit-shaped. State lives in signals or reactive properties, and reads inside `render()` re-render automatically when they change, through the lit lifecycle (`willUpdate`, `updated`, and the rest). You describe what the UI is for a given state rather than imperatively pushing updates. Neither is objectively better; it is a genuine taste split between an explicit imperative model and an automatic declarative one, and it is the clearest day-to-day difference in how the two feel to write.


# Difference four: data and mutations

Both keep data and mutations on the server, but the surface differs. Remix 3 is model-first: you start from a declarative schema, with first-class database drivers, and mutations are actions tied to form submissions.

WebJs uses one server-action boundary. A `.server.ts` file with `'use server'` exports functions that a component imports and calls directly; the import is rewritten to a typed RPC stub, and the same mechanism carries both reads and writes, with the HTTP verb, caching, and validation declared through sibling config exports. Types flow across that boundary, so a component sees the real signature of a server function. A leaf component can also `await` its own data during SSR and have it in the first paint. WebJs keeps the Next.js-style nested `app/` routing (route groups, per-segment error and loading boundaries, catch-all segments) as its one strong convention, and leaves the rest of the architecture to you.


# Difference five: stability today

Remix 3 is in [beta preview](https://remix.run/blog/remix-3-beta-preview). Its ideas are compelling and its direction is close to WebJs's, but the API is still moving, and building on it today means building on a moving target. This is a factual note about where Remix 3 is in its cycle, worth weighing if you need to ship on a stable surface now.


# Where Remix 3 is the better pick

- You prefer JSX and an explicit imperative model (plain variables, `handle.update()`, `mix` composition) over a declarative reactive one.
- You want the model-first, schema-driven approach where routes and components derive from a declarative data model.
- You want a configurable asset pipeline with browser targets, minification, and fingerprinted URLs under your control.
- You want to follow the Remix team's roadmap and ecosystem as Remix 3 matures.


# Where WebJs is the better pick

- You want native web components as the view layer: standards-based custom elements that render on their own and outlive the framework, with no virtual DOM shipped to the browser.
- You want the code the browser runs to be the code you wrote, with no compiler between the two and no asset pipeline to configure.
- You prefer a declarative, lit-shaped reactive model over an imperative one, with signals and reactive properties that re-render automatically.
- You want automatic zero-JavaScript elision for display-only components, so static parts of the page ship no script.
- You want a single typed server-action boundary for reads and writes, with types spanning the client and server, and file-routing conventions you already know from the Next.js app router.

WebJs and Remix 3 arrived at the same crossroads, no bundler, beyond React, web standards, built for agents, and then took different roads. The choice is largely native web components you serve as source with declarative reactivity, versus a JSX virtual DOM compiled on demand with an imperative model.

## FAQ

### How is WebJs different from Remix 3?

Both drop the bundler, move beyond React, and lean on web standards. WebJs builds on native web components with declarative reactivity, while Remix 3 uses a runtime-first virtual DOM with a more imperative model authored in JSX. WebJs also serves component source to the browser without a compile step, and elides display-only components to zero JavaScript automatically.

### Is Remix 3 a no-build framework?

Remix 3 is bundler-free, and a Remix 3 app has no build command to run before it starts. It is not compile-free, though. Because components are written in JSX, its asset server compiles every browser module on demand, rewrites imports, processes CSS, and in production lowers syntax to your browser targets, minifies, and fingerprints URLs. WebJs is the stricter case: its templates are plain tagged template literals, so component source is served as written and only TypeScript annotations are stripped.

### Do both WebJs and Remix work without a build step?

Neither asks you to run a build before starting the app, and neither ships a bundler. They differ in what happens on the way to the browser. Remix compiles JSX and TypeScript on demand through its own asset server, while WebJs serves native ES modules directly and only strips TypeScript at load.

### Which should I choose, WebJs or Remix 3?

Choose WebJs when you want native web components, source served as written, declarative reactivity, automatic zero-JavaScript elision, and a single typed server-action boundary for reads and writes. Choose Remix 3 if its JSX virtual-DOM view layer, its configurable asset pipeline, and its ecosystem fit how you prefer to build. Both are strong web-standards bets.
