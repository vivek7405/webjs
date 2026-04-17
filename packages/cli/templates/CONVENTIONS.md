# CONVENTIONS.md — {{APP_NAME}}

This file defines the conventions for this webjs app. **AI agents MUST read
this file before writing any code.** It is the single source of truth for
how code should be structured, tested, and organized.

Sections marked `<!-- OVERRIDE -->` contain defaults you can customize.
Edit the content below the marker to change the convention for your project.
The `webjs check` command validates your code against these conventions.

---

## AI agent workflow (non-negotiable)

**These rules apply to ALL AI agents (Claude, Cursor, Copilot, etc.)
working on this codebase. They are not optional and must not be skipped
even if the user doesn't explicitly ask.**

### Before starting ANY work — verify and sync the branch:

1. Check `git branch --show-current`
2. If on `main`/`master` → create a feature branch first
3. If on a feature branch → verify it matches the current task
4. Sync with parent: `git fetch origin && git rebase origin/main` if behind
5. Don't mix unrelated work on the wrong branch

### Every code change must include:

1. **Commit and push** — Commit AND push after each logical unit of work.
   Small, focused commits with meaningful messages. Always `git push`
   after committing. Don't accumulate uncommitted or unpushed changes.
   This is automatic — the user should never have to ask.

2. **Tests** — Unit test for logic, E2E test for user-facing behavior.
   See the "Testing" section below for what type of test each change needs.
   Run `npx webjs test` after every change. Never mark work as done with
   failing tests.

3. **Documentation updates** — When adding or modifying features:
   - Update `AGENTS.md` if the change affects the framework API surface.
   - Update `CONVENTIONS.md` only if the change introduces a new convention.
   - If a `docs/` directory exists, add or update the relevant doc page.
   - If a `website/` directory exists, update the landing page for
     user-facing features.

3. **Convention check** — Run `npx webjs check` after changes and fix
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
docs" — that is the agent's default behavior in a webjs project.

---

## Sensible defaults

<!-- OVERRIDE -->
webjs uses sensible defaults. Environment
variables control infrastructure — no config files needed:

| Environment variable | Effect |
|---|---|
| `REDIS_URL` | Cache, sessions, rate limiting, and pub/sub all use Redis |
| `AUTH_SECRET` | Required for auth JWT signing (32+ random chars) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID (optional) |
| `AUTH_GITHUB_ID` | GitHub OAuth client ID (optional) |
| `PORT` | Server port (default: 3000) |

**Development:** zero env vars needed. Everything works with memory/cookie/disk.
**Production:** set `REDIS_URL` + `SESSION_SECRET`. That's it.

---

## Architecture: Modules

<!-- OVERRIDE -->
This app uses the **modules architecture** for feature-scoped code:

```
modules/
  <feature>/
    actions/        Server mutations — one async function per file (*.server.ts)
    queries/        Server reads — one async function per file (*.server.ts)
    components/     Feature-owned web components
    utils/          Pure helper functions
    types.ts        Shared TypeScript types / JSDoc typedefs
```

**Rules:**
- One exported function per server action/query file
- Server actions must use `'use server'` pragma or `.server.ts` extension
- Components must call `Class.register(import.meta.url)`
- Never import `@prisma/client`, `node:*`, or `lib/` directly from components — use server actions
- Routes (`app/**/page.ts`, `app/**/route.ts`) must be thin: import logic from modules

---

## Architecture: Routes

<!-- OVERRIDE -->
Routes live under `app/` and follow NextJs App Router conventions:

- `app/page.ts` — Homepage
- `app/<segment>/page.ts` — Static route
- `app/[param]/page.ts` — Dynamic route
- `app/[...rest]/page.ts` — Catch-all
- `app/(group)/...` — Route group (folder not in URL)
- `app/**/route.ts` — API endpoint
- `app/**/layout.ts` — Layout wrapper
- `app/**/error.ts` — Error boundary
- `app/**/middleware.ts` — Per-segment middleware

**Rules:**
- A folder cannot have both `page.ts` and `route.ts`
- Page/layout default exports must be functions (possibly async)
- Route handlers export named methods: `GET`, `POST`, `PUT`, `DELETE`, `WS`

---

## Testing

<!-- OVERRIDE -->
Every feature module should have corresponding tests:

### Unit tests — `test/unit/`

```
test/
  unit/
    <feature>.test.ts     One test file per module feature
```

- Run with: `webjs test` or `node --test test/unit/*.test.ts`
- Use `node:test` and `node:assert/strict`
- Test server actions by importing and calling them directly
- Test component rendering with `renderToString` from webjs
- Test utility functions with simple assertions

**Naming:** `test/unit/<module-name>.test.ts` (e.g., `test/unit/auth.test.ts`)

### Browser tests — `test/browser/`

```
test/
  browser/
    <feature>.test.js     Real-browser tests per feature
```

- Run with: `webjs test --browser` or `npx wtr`
- Uses **Web Test Runner (WTR) + Playwright** — tests run in real Chromium
- Full Shadow DOM, events, adoptedStyleSheets, IntersectionObserver
- Test components, user interactions, navigation, form submission

**Naming:** `test/browser/<feature>.test.js` (e.g., `test/browser/auth.test.js`)

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
| New server action | Required | — |
| New component | Required (SSR output) | Required (interaction) |
| New page/route | — | Required |
| Bug fix | Required (regression) | If user-facing |
| Refactor | Existing tests must pass | Existing tests must pass |

---

## Components

<!-- OVERRIDE -->

```ts
import { WebComponent, html, css } from 'webjs';

export class MyWidget extends WebComponent {
  static tag = 'my-widget';
  static styles = css`
    :host { display: block; }
  `;

  render() {
    return html`<p>Hello</p>`;
  }
}
MyWidget.register(import.meta.url);
```

**Rules:**
- One component per file
- Shadow DOM by default (`static shadow = true`)
- Styles via `static styles = css\`...\``, never inline `style="..."` on host
- Tag name must contain a hyphen (HTML spec)
- Always call `.register(import.meta.url)` — enables modulepreload hints
- Use `setState()` for state changes, never mutate `this.state` directly
- Use lifecycle hooks (`firstUpdated`, `updated`) only when needed

---

## Server actions

<!-- OVERRIDE -->

```ts
// modules/posts/actions/create-post.server.ts
'use server';
import { prisma } from '../../../lib/prisma.ts';
import type { ActionResult } from '../types.ts';

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
- Never throw for expected errors — return `{ success: false, error, status }`
- Validate input at the top of the function

---

## Code style

<!-- OVERRIDE -->
- TypeScript with explicit `.ts` extensions in imports
- No semicolons (or with — pick one and be consistent)
- `const` by default, `let` when needed, never `var`
- Prefer `async/await` over `.then()` chains
- Minimal comments — code should be self-documenting
- No barrel files (`index.ts` re-exporting everything) — import from the source directly

---

## Git workflow

<!-- OVERRIDE -->

This project enforces a git workflow via agent-specific config files
(`.claude/settings.json`, `.cursorrules`, `.windsurfrules`,
`.github/copilot-instructions.md`). These rules apply to ALL AI agents:

**Commit rules:**
- **Commit often** — after each logical unit of work, not at the end
- **Meaningful messages** — imperative mood, what changed and why
  (e.g., `Add contact form with email validation`)
- **NEVER add AI attribution** — no `Co-Authored-By: Claude`, no
  `Generated by AI`, no `AI-assisted` trailers or prefixes
- **Small, focused commits** — don't batch unrelated changes
- **Committing is automatic** — the user should never have to ask
  "please commit". Commit after completing each task.

**Branch rules:**
- **Feature branches** — never commit directly to main
- **Branch naming** — `feature/<name>`, `fix/<name>`, `refactor/<name>`
- **Pull requests** — always create a PR, never push to main directly
- **NEVER merge without user permission** — before merging ANY branch
  into ANY other branch, ask: "Ready to merge `<branch>` into `<target>`?
  Delete or keep `<branch>` after?" Wait for approval AND the preference.
- **Claude Code hook** (`.claude/hooks/guard-main-merge.sh`) enforces
  merge/push-to-main approval programmatically for Claude agents.
  Other agents enforce this via `.cursorrules`, `.windsurfrules`,
  `.github/copilot-instructions.md`.

**Pre-commit checks:**
- `npx webjs test` must pass
- `npx webjs check` must pass
- No unrelated files in the commit

---

## Overriding conventions

To disable a convention check, add to your `package.json`:

```json
{
  "webjs": {
    "conventions": {
      "actions-in-modules": false,
      "one-function-per-action": false,
      "tests-exist": false
    }
  }
}
```

Or create `webjs.config.js`:

```js
export default {
  conventions: {
    'actions-in-modules': false,
  },
};
```

Run `webjs check` to validate your app against these conventions.
Run `webjs check --fix` to see suggested fixes for violations.

---

## Scaffold & generators

Use the built-in generators to create files that follow these conventions:

```sh
webjs generate page <path>                # → app/<path>/page.ts
webjs generate module <name>              # → modules/<name>/{actions,queries,components,utils,types.ts}
webjs generate action <module>/<name>     # → modules/<module>/actions/<name>.server.ts
webjs generate query <module>/<name>      # → modules/<module>/queries/<name>.server.ts
webjs generate component <tag-name>       # → components/<tag-name>.ts
webjs generate route <path>               # → app/<path>/route.ts
```

**Route-wrapping pattern (especially for `--template api` apps):**
Routes are thin wrappers over typed server actions. Business logic lives in
`modules/`, routes just import and call the action/query:

```ts
// app/api/users/route.ts — thin wrapper
import { listUsers } from '../../../modules/users/queries/list-users.server.ts';
import { createUser } from '../../../modules/users/actions/create-user.server.ts';

export async function GET() { return Response.json(await listUsers()); }
export async function POST(req: Request) {
  const result = await createUser(await req.json());
  if (!result.success) return Response.json({ error: result.error }, { status: result.status });
  return Response.json(result.data, { status: 201 });
}
```
