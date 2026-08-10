---
title: "How WebJs Stops AI Coding Agents From Breaking Your Code"
date: 2026-06-29T10:00:00+05:30
slug: stop-ai-agents-breaking-your-code
description: "AI coding agents commit to main, skip tests, and ignore your conventions. WebJs is an AI-first framework that bakes those guardrails into tooling so drift is caught early."
tags: ai-first, ai-agents, guardrails, tooling, dx
author: Vivek
---

If you build software in 2026, an AI agent writes a good chunk of your code. Claude Code, Cursor, Copilot, Antigravity, Aider. You describe a feature, the agent produces files, you skim and accept. It is genuinely fast.

It is also, left to its own devices, a little reckless. An agent will happily commit straight to `main`. It will ship a feature with no test, because the feature "works". It will drop a helper in the wrong directory because it did not read your project layout. It will confidently add a bundler config to a framework that has no build step. None of this is malice. The agent is doing what its training data suggests, and your project's rules live in a `CONTRIBUTING.md` it never opened.

I wrote about the philosophy of this in an earlier post ("AI-first is plumbing, not a marketing tag"). This post is the concrete version. Here is exactly how WebJs stops an agent from breaking your code, mechanism by mechanism. Every piece below is real and ships in the scaffold.

# The rules go where the agent will actually read them

An agent reads whichever instruction file matches its tool. Most of them now agree on one, so WebJs writes the contract once and bridges only where a tool still needs it.

```
AGENTS.md                        the contract (source of truth)
CONVENTIONS.md                   project conventions, overridable
CLAUDE.md                        Claude Code (imports AGENTS.md)
.agents/rules/workflow.md        Antigravity workspace rules
.agents/skills/webjs/            the teaching skill, loaded on demand
```

Plus a `.claude/settings.json` wiring up hooks, a PR template, and an `.editorconfig`. The point is not the file count, and the count has gone down: Cursor, opencode, and Copilot's coding agent all read AGENTS.md directly, so the separate rule files they each used to need are gone. The point is that whichever agent you happen to be driving, it lands in the project and finds the same conventions. There is no "the agent didn't know" excuse, because the knowledge is in the file the agent reads first.

But a document is advisory. An agent can read a rule and still forget it three tool-calls later. That is why the load-bearing enforcement is not the docs. It is the hooks.

# Hooks that block bad commits and bad prompts

Claude Code fires shell hooks on tool events (before an edit, before a Bash command, after a write, on every prompt). WebJs ships a set of them under `.claude/hooks/`, and they turn "please follow the rules" into "you literally cannot do that". Here is what each one does, verified against the scripts themselves.

`guard-branch-context.sh` runs before any edit. If you are on `main` or `master`, it pauses and asks you to create a feature branch first (`git checkout -b feature/<name>`) before it lets the edit through. No more accidental direct-to-main commits from an agent that skipped the git etiquette.

`require-tests-with-src.sh` runs before `git commit`. It inspects the staged diff, and if you staged framework source with no accompanying test file, it stops the commit and names the layers you might need (unit, browser, e2e, smoke, Bun). It even catches the sneaky failure mode where an agent trims tests to make the suite pass. It counts staged test lines, and a net-negative count next to a source change gets blocked as "tests removed to slip through". In the framework repo this hook blocks; in a scaffolded app it warns by default (set `WEBJS_TEST_GATE=block` to make it hard).

`require-docs-with-src.sh` is the documentation twin. Change a public-facing surface and stage no doc update, and the commit is blocked until you bring a doc surface along. This exists because the recurring failure was updating one surface and leaving the rest stale.

`require-bun-parity-with-runtime-src.sh` guards the fact that WebJs runs on Node 24+ and Bun. Touch a runtime-sensitive file (the serializer, the listener, streams, crypto) with no cross-runtime test staged, and it blocks until you prove the change on both runtimes.

`route-skills.sh` runs on every prompt. A "skill" is a scripted workflow the agent is supposed to invoke, but a model only invokes it when it judges the prompt to match, and that judgement is wobbly. This hook keyword-matches your prompt against each skill's triggers and injects a directive telling the agent to run the matching skill first. It makes routing deterministic instead of hoping the model notices.

`nudge-uncommitted.sh` is the gentle one. After enough edits pile up (four by default), it reminds the agent to commit the current logical unit before sprawling further. Soft, does not block, just keeps the history clean.

`block-prose-punctuation.sh` enforces the writing style, and it is the reason this very post reads the way it does. It blocks em-dashes and a few other patterns in any new content the agent writes. I am composing this under that hook right now, which is why you will not find a single em-dash anywhere above or below.

The theme across all of them is the same. The rule is enforced at the exact seam where the mistake happens (the commit, the edit, the prompt), not in a paragraph the agent skimmed once.

# One task, one git worktree

Here is a subtle one that only bites when more than one agent works the repo at once. Two agents sharing a single checkout collide. A `git checkout` in one moves `HEAD` under the other, so the next commit from the second agent lands on the wrong branch.

This is not hypothetical. It happened to me. A `chore: release` commit landed on an unrelated `feat/` branch, dragging a contaminated changelog with it, because one agent switched branches while another was mid-commit.

The fix is boring and total. One task gets one git worktree.

```sh
git worktree add -b feature/my-task ../repo-my-task origin/main
cd ../repo-my-task    # all work for this task happens here
```

Git enforces one branch per worktree, so two agents in two worktrees physically cannot move each other's `HEAD`. The collision becomes impossible rather than merely discouraged. AGENTS.md documents this as the standing rule for any concurrent work.

# The webjs check command runs correctness rules, and never optionally

WebJs draws a hard line between two kinds of rules, and keeping them separate is what makes each one trustworthy.

`CONVENTIONS.md` holds project conventions. Where actions live, one function per file, how features are tested. These are preferences a reasonable project could do differently, so they are guidance you can customize.

`webjs check` is the other kind. It runs correctness-only rules, the things that are wrong to ship. Code that crashes in production, a server secret leaking into a browser bundle, TypeScript that will not strip, a shell written in a non-root layout. These run unconditionally with no per-project disabling, because the answer to "could a sensible app want this to pass?" is no.

```sh
webjs check           # report violations
webjs check --rules   # list every rule
```

The rules are the concrete failure modes an agent trips over. A few real ones:

- `use-server-needs-extension`, a `'use server'` directive requires a `.server.{js,ts}` filename, so server code cannot leak through a plain module.
- `no-static-properties`, reactive properties are declared through the `WebComponent({ ... })` factory, not a hand-written `static properties` block that would throw at runtime.
- `erasable-typescript-only`, the tsconfig must keep types strippable, because WebJs has no bundler to fall back on.
- `shell-in-non-root-layout`, only the root layout may write `<!doctype>` / `<html>` / `<head>` / `<body>`.
- `no-browser-globals-in-render`, a component's constructor and `render()` stay off browser globals, because both run on the server too and a `window` read there crashes the SSR pass.

An agent runs `webjs check`, reads concrete violation messages, and fixes them before the code is anywhere near a review. The narrowness is deliberate. It is a short list of "this will break", not a hundred style opinions, so a green check actually means something.

# Guardrails dull on purpose

AI agents are fast and a little careless, and a framework built in 2026 has to plan for that. WebJs does it by moving the rules out of prose and into tooling, so an agent that skips the docs still cannot commit to main, ship untested source, drift the docs, or collide with another agent. The guardrails are dull on purpose (a few shell hooks, a correctness linter, one worktree per task), and dull is the point, because they catch mistakes at the seam where they happen instead of in a review three days later. If you want to see them work, scaffold an app with `npm create webjs@latest my-app` and watch your agent get corrected in real time. The friction you feel is the framework doing its job.
