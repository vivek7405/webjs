---
title: "Give AI Coding Assistants Live Access to Your App"
date: 2026-06-16T15:00:00+05:30
slug: mcp-server-for-ai-coding-agents
description: "WebJs ships a read-only MCP server for AI coding agents. Learn how the Model Context Protocol lets Claude, Cursor, and other AI assistants read your app's real routes, actions, and components instead of guessing them."
tags: mcp, ai-first, ai-agents, tooling, dx
author: Vivek
---

You have probably felt this already. You ask an AI coding assistant to add a feature, it writes something that looks perfect, and then you notice it invented a route that does not exist, or called a server action with a signature you never wrote. The code compiles in its head. It just does not match your actual app.

This is not the model being dumb. It is the model working with incomplete information. When an assistant only has your files to read, it reconstructs your app's shape from source and fills the gaps with plausible guesses. Most of the time the guess is close. The times it is wrong are the times you lose an hour.

WebJs ships a small thing that fixes a big part of this. Every scaffolded app wires up a read-only MCP server, `@webjsdev/mcp`, that lets the agent ask the running project what actually exists instead of guessing.

# What MCP is, in one sentence

MCP (Model Context Protocol) is the emerging open standard for how an AI tool like Claude or Cursor connects to an outside source of data or tools, so the model can read real information at the moment it needs it rather than working from a static snapshot.

Think of it as a plug. On one side is your AI assistant. On the other is anything that can answer questions (a database, a filesystem, an API, or in this case, your WebJs project). Once the plug is connected, the assistant can pull ground truth on demand.

# What the WebJs MCP server exposes

The server is intentionally small and gives the agent five tools plus a knowledge layer.

- `list_routes` returns every route your app actually serves, derived from the `app/` file tree the same way the router derives it.
- `list_actions` returns your server actions, including the RPC hash each one is called through and its per-action config (the HTTP verb, the cache settings). This is the big one, more on it below.
- `list_components` returns the custom elements your app registers.
- `list_elision` returns which of your component modules the browser never downloads, because WebJs strips the JavaScript of anything that does no client-side work. For each module that does ship, it also returns the evidence that forced it, so the agent can see when a component turned out interactive by accident.
- `check` runs the `webjs check` correctness validator and hands back the violations as structured data.

On top of those, there is a knowledge layer that serves the WebJs docs, the recipes, and the framework source. So the agent can look up how a feature is meant to be used, straight from the authoritative reference, without you pasting docs into the chat.

# Why the action hashes matter most

Here is the thing an agent genuinely cannot infer reliably.

In WebJs, a server action is a function in a `*.server.ts` file marked `'use server'`. When a client component imports it, the import is rewritten into an RPC stub that POSTs to a hashed URL like `/__webjs/action/<hash>/<fn>`. The hash and the per-action config (the verb, whether the result is cached) are computed by the framework, not written by you.

So if an agent is reasoning about how a client actually reaches the server, or debugging a request in the network tab, the hash is not sitting in your source in a form it can read off. It is a derived value. Guessing it is hopeless. Reading it live from `list_actions` is trivial.

```sh
# Run the server directly
npx @webjsdev/mcp

# Or through the CLI, same thing
webjs mcp
```

Point your assistant's MCP config at that command and the tools show up in the agent's toolbox. From then on, "what actions does this app expose" is a lookup, not a search-and-guess.

# It is read-only, which is the point

The WebJs MCP server does not write files, run migrations, or mutate anything. Every tool answers a question. That is a deliberate design choice, because it means pointing an agent at it carries no risk. The worst it can do is tell the agent the truth about your app.

Read-only also keeps the trust model simple. You do not have to review what the MCP server did, because it did nothing except report. The agent still makes its edits through the normal channels you already supervise.

# This is the AI-first thesis, made concrete

I have written before that WebJs being AI-first is plumbing, not a slogan. AGENTS.md, the enforced conventions, the readable source, the lint rules that fail at the seam where mistakes happen. The MCP server is another piece of that same plumbing.

The pattern is always the same. Instead of hoping the agent guesses right, remove the need to guess. AGENTS.md removes the guess about where a file goes. `webjs check` removes the guess about whether the code is correct. The MCP server removes the guess about what the running app actually contains.

Notice that `@webjsdev/mcp` is a standalone package, extracted out of the CLI so it can be installed and pointed at on its own. It is the same read-only introspection the CLI already had, packaged as a protocol any MCP-speaking tool can plug into. A separate note: for UI debugging (clicking through pages, taking screenshots) you would reach for the Playwright MCP server. `@webjsdev/mcp` is about the shape of your app, not driving its browser.

AI coding assistants are genuinely useful, and they are at their worst when they have to invent your project's details. The WebJs MCP server closes that gap by letting the agent ask the running project for ground truth: the real routes, the real components, and above all the real server actions with their framework-computed RPC hashes and per-action config that no amount of reading source can reliably reconstruct. It is read-only, so it is safe to hand to any agent, and it ships wired up in every scaffold. Run `npx @webjsdev/mcp` or `webjs mcp`, connect it to Claude or Cursor, and your assistant stops guessing what your app looks like and starts reading it.
