# GitHub Copilot Instructions — webjs app

You are working on a webjs app — an AI-first, no-build, web-components-first
framework. Read AGENTS.md for the full API reference and CONVENTIONS.md for
project-specific conventions.

## Before starting ANY work

FIRST, before writing any code:
1. Check `git branch --show-current`.
   - If on main/master: create a feature branch before editing.
   - If on a feature branch: verify it matches the task at hand.
2. Sync: `git fetch origin && git rebase origin/main` if behind.

## Autonomous mode

If running without interactive approval (sandbox, auto-approve, etc.):
- On main? Auto-create feature/<task-slug> branch
- Parent behind? Auto-rebase. Merge? Auto-merge + delete feature branches.
- Auto-generate meaningful commit messages. Fix tests and violations.

## Mandatory workflow

Every code change must include:
1. Commit and push — COMMIT AND PUSH after each logical unit of work.
   Always `git push` after committing. Don't accumulate changes. Automatic.
2. Server tests in test/unit/*.test.ts (node:test for actions, queries, utilities)
3. Browser tests in test/browser/*.test.js (WTR + Playwright, real Chromium)
4. Documentation updates (AGENTS.md for API, docs/ for user guides)
5. Convention validation: `npx webjs check` must pass

## Git rules

- Commit after each logical unit of work
- Meaningful commit messages: what changed and why
- NEVER add Co-Authored-By or AI attribution trailers to commits
- Work on feature branches, create PRs, never push directly to main
- NEVER merge any branch without explicit user permission. Always ask:
  "Ready to merge <branch> into <target>? Delete or keep <branch> after?"
  Wait for approval AND the delete/keep preference. Applies to ALL merges.
- Run `npx webjs test` before every commit

## Code patterns

- Tagged template: html`<div>${value}</div>` with css`...` for styles
- Components: extend WebComponent, use static tag/styles/properties, call .register(import.meta.url)
- Server actions: *.server.ts files with one exported async function each
- Directives: import { classMap, styleMap, ref, when, ... } from 'webjs/directives'
- Context: import { createContext, ContextProvider, ContextConsumer } from 'webjs/context'
- Task: import { Task, TaskStatus } from 'webjs/task'
- Routing: file-based under app/ (page.ts, layout.ts, route.ts, middleware.ts)

## What NOT to do

- Don't introduce build tools or bundlers in the critical path
- Don't import @prisma/client or node:* from client components
- Don't use inline style="..." on components (use static styles = css`...`)
- Don't mutate this.state directly (use this.setState())
- Don't skip tests or documentation updates
