---
title: "What an AI-First Framework Actually Means (It's Plumbing, Not a Marketing Tag)"
date: 2026-04-18T12:00:00+05:30
slug: ai-first-is-plumbing
description: "What an AI-first framework actually means for WebJs: the AGENTS.md contract, hooks, lint rules, and operational details that make a codebase agent-readable."
tags: ai-first, agents, conventions, tooling
author: Vivek
---

You have probably watched an AI coding agent produce something that looks right and is quietly wrong: a broken convention, a config it could not have known about, code dropped in the wrong place. "AI-first framework" is the label everyone reaches for as the cure, and most of the time it means nothing at all.

When I say WebJs is AI-first, I do not mean it has an AI-generated landing page or a chat widget on the docs. I mean a list of dull operational decisions, each of which makes the difference between an agent that writes correct code on the first try and one that produces a plausible-looking file in the wrong directory.

Here is the actual list, ordered roughly by how much each thing pays back.

# AGENTS.md (and its siblings)

Every scaffolded WebJs app (the starter project `webjs create` generates for you) ships with these files at the root:

```
AGENTS.md                                  agent contract (this is the load-bearing one)
CONVENTIONS.md                             project-specific overridable conventions
CLAUDE.md                                  Claude Code import file (points at AGENTS.md)
.cursorrules                               Cursor rules (same content, different format)
.agents/rules/workflow.md                  Antigravity (Google) workspace rules
.github/copilot-instructions.md            GitHub Copilot
.github/pull_request_template.md           PR template (also AI-readable)
.editorconfig                              text-tool consistency
```

The trick is that all of them say the same thing. AGENTS.md is the source of truth; CLAUDE.md is just `@AGENTS.md` (Claude Code's import syntax). Cursor and Antigravity (formerly Windsurf) use their own formats that load equivalent content. The PR template carries the convention checklist into every code review.

Most agents read whichever file matches their tool first. AGENTS.md is the cross-tool standard ([emerging spec, FYI](https://agents.md/)). Every WebJs scaffold ships it.

Concretely, the AGENTS.md file is around 40k characters. It covers: file conventions (where every kind of file goes), the public API of each package, framework invariants (the things that crash in production if you violate them), recipes for common tasks, and a list of `Deliberately deferred` items (so the agent does not try to add a bundler or a build command).

# The pre-commit hook

The hook (in `.hooks/pre-commit`, distributed via the scaffold) does three things:

1. Blocks commits to `main` / `master`. Forces a feature branch + PR.
2. Runs `npm test`. Refuses commits that break the suite.
3. Auto-generates `changelog/<pkg>/<version>.md` when a `packages/<pkg>/package.json` version bumps. (Yes, the framework itself ships its changelog this way. Yes, the scaffolded apps inherit the pattern.)

The hook is enforced via `git config core.hooksPath .hooks`. Scaffolded apps have it set automatically on `webjs create`. The framework's own repo uses the same hook.

What this gets us is that an agent in autonomous mode (running with permission to commit) cannot accidentally commit broken code to main. The hook fails, the agent reads the error, the agent fixes the test. The discipline is enforced in the tooling layer, not in a prompt.

# The convention validator

`webjs check` runs a set of lint rules over the project. A few real ones:

- `no-server-import-in-browser-module`: a module that genuinely ships to the browser does not import a server-only file, whose client stub throws at load
- `use-server-needs-extension`: a `'use server'` directive requires a `.server.{js,ts}` filename
- `no-static-properties`: reactive properties are declared via the `extends WebComponent({ … })` factory, not a hand-written `static properties`
- `erasable-typescript-only`: `tsconfig.json` has `erasableSyntaxOnly: true`
- `shell-in-non-root-layout`: non-root layouts and pages don't write `<!doctype>` / `<html>` / `<head>` / `<body>`
- `no-server-env-in-components`: `process.env.X` in components only reads `WEBJS_PUBLIC_*` or `NODE_ENV`

Each rule lives in `packages/server/src/check.js`. The agent runs `webjs check` before committing, sees violations as concrete messages, and fixes them.

The lint is intentionally narrow. Every rule catches something that is wrong to ship, a crash, a leaked secret, a reactive prop that silently stops re-rendering, or source that will not strip, and the framework does not lint style preferences. `webjs check --rules` prints the current set, which is the only place worth reading it from, because a list copied into a blog post goes stale the next time a rule lands.

# Hooks beyond pre-commit

`webjs create` also scaffolds:

- `.claude/hooks/block-prose-punctuation.sh` (blocks em-dashes, pause-semicolons, and other patterns that come from training data but don't fit our docs)
- `.claude/hooks/guard-branch-context.sh` (intercepts Edit/Write when the agent is on main, forces a feature branch)
- `.claude/hooks/nudge-uncommitted.sh` (reminds the agent to commit when uncommitted-file count crosses a threshold)
- `.gemini/hooks/nudge-uncommitted.sh` (same threshold logic, Gemini CLI format)
- `.cursor/hooks/nudge-uncommitted.sh` (same, Cursor 1.7+ format)
- `.opencode/plugins/nudge-uncommitted.ts` (same, OpenCode plugin format)

Each hook is a small shell script (or TS plugin for OpenCode). They fire on the agent's tool-call events. They are advisory for everything except the branch-guard, which actively blocks edits when on main.

The interesting bit is that the framework ships hooks for multiple agents in the same scaffold. The agent picks the one matching its tool; the others are inert.

# WEBJS_PUBLIC_* environment shim

This is a tiny detail but it pays for itself constantly. Variables named `WEBJS_PUBLIC_*` (matching the `NEXT_PUBLIC_*` convention) get injected into the browser as `window.process.env.WEBJS_PUBLIC_X`. The shim is one inline `<script>` in the SSR (server-rendered HTML) head.

Why this is AI-first: the agent reading the doc sees the convention name and knows immediately what is browser-safe and what is server-only. The naming scheme is the API. Other variables (`DATABASE_URL`, `AUTH_SECRET`) silently return `undefined` in the browser, so a write of `process.env.DATABASE_URL` from a component fails closed instead of leaking the secret.

# The `Deliberately deferred` list

Inside AGENTS.md there is a section called `Deliberately deferred`. It lists things WebJs does not do and will not do in v1:

- Bundling (WebJs is no-build; do not propose `webjs build`)
- Per-route code splitting (downstream of no-build)
- Vite-grade HMR (hot module replacement) with state preservation
- React Server Components Flight
- i18n / image optimization (layer libraries on top)

The reason this is here is that agents will otherwise try to add these things. They see Next.js doing them and assume WebJs should too. The doc says no, here are the trade-offs, do not propose this.

This list is read at the start of every long-running session. Saves cycles.

# What this does not look like

It does not look like a chat box. It does not look like a code-suggestion popup. It does not look like a marketing message. It is a stack of operational decisions that, together, mean an agent dropped into a WebJs project writes correct code without asking what the framework wants.

Each individual piece is unsexy. The pre-commit hook is 100 lines of bash. The lint rules are short string-matching predicates. AGENTS.md is a wall of text. None of this is exciting on its own.

What is exciting is watching an agent take the framework as a given. No "where does this go" questions. No second tries because the lint caught a violation. No silent breakage because the test suite refused the commit. The agent just ships.

# What I am still figuring out

The hooks fragment across tools. Every new agent CLI (Cline, Codex, Factory Droid, Aider, etc.) wants its own hook format. We can ship the same content in each format via the scaffold, but maintaining six near-identical files is brittle. The longer-term answer is for AGENTS.md to become the universal contract (which is happening, slowly) and the per-tool hooks to read from it.

The other thing is the AGENTS.md size budget. We are at ~40k characters and growing. Each new feature adds a recipe, an invariant, or a doc-link. Agents have token windows that get pricey above ~50k. We are about to need a "load this section on demand" mechanism. The skill at `.agents/skills/webjs/` (SKILL.md plus its `references/`) is the start of that pattern: detail references that load only when relevant.

If you are building tooling for AI agents, the takeaway is to put the rules where the agent will find them, in a format the agent can parse, with enforcement at the seams where mistakes happen. Everything else is a marketing tag.
