# AGENTS.md — webjs

This file is the contract for **AI agents** (and humans) editing a webjs app.
It describes file conventions, the public API, invariants to preserve, and
recipes for common tasks. Keep it in sync whenever behaviour changes.

---

## AI-driven development — guardrails for all agents

**webjs is an AI-first framework. These rules apply to ALL AI agents
(Claude, Cursor, Copilot, Windsurf, Aider, etc.) and are enforced via
config files that each agent reads automatically.**

### Agent config files (scaffolded by `webjs create`)

| File | Agent | Purpose |
|---|---|---|
| `AGENTS.md` | All agents | Framework API, conventions, recipes (this file) |
| `CONVENTIONS.md` | All agents | Project-specific overridable conventions |
| `CLAUDE.md` | Claude Code | Points to AGENTS.md + CONVENTIONS.md, no duplication |
| `.claude/settings.json` | Claude Code | PreToolUse hook guarding git merge/push to main |
| `.cursorrules` | Cursor | Workflow rules, git rules, framework patterns |
| `.windsurfrules` | Windsurf | Same rules in Windsurf format |
| `.github/copilot-instructions.md` | GitHub Copilot | Same rules in Copilot format |
| `.github/pull_request_template.md` | All (via GitHub) | PR checklist: tests, docs, convention check |
| `.editorconfig` | All editors | Consistent indent/encoding/line endings |

### Before starting ANY work — verify and sync the branch

**FIRST thing before writing any code, every time:**

1. Run `git branch --show-current` to check what branch you're on.
2. If on `main` or `master` — **STOP. Do not edit files.** Ask the user
   which branch to work on, or create one: `git checkout -b feature/<name>`.
3. If on a feature branch — verify it matches the task. If the user asks
   to "add a contact page" but you're on `fix/login-redirect`, ask before
   proceeding. Don't mix unrelated work on the wrong branch.
4. **Sync with parent branch.** Before making any changes, check if the
   parent branch (usually `main`) has new commits that this branch doesn't:
   ```
   git fetch origin
   git log HEAD..origin/main --oneline
   ```
   If there are upstream changes, rebase or merge before starting work:
   ```
   git rebase origin/main    # preferred: clean linear history
   ```
   This prevents conflicts later and ensures you're building on the
   latest code. If the rebase has conflicts, resolve them before
   proceeding with the task.

The Claude Code hook (`.claude/hooks/guard-branch-context.sh`) enforces
step 2 programmatically by intercepting Edit/Write calls when on main.
Other agents must check manually as their first action.

### Autonomous mode (sandbox / bypass permissions)

When the user runs the agent in sandbox mode, bypass-permissions mode,
or any mode where interactive approval is disabled, the agent MUST NOT
ask questions or wait for permission. Instead, it should **auto-decide
using these defaults:**

| Decision | Autonomous default | Rationale |
|---|---|---|
| On `main`, need a branch | Auto-create `feature/<task-slug>` | Never pollute main |
| Parent branch has new commits | Auto-rebase before starting | Avoid conflicts |
| Ready to merge | Auto-merge, no prompt | User opted into full autonomy |
| Delete branch after merge? | **Delete** feature/fix branches, **keep** long-lived (dev, staging, release/*) | Feature branches are disposable |
| Commit message | Auto-generate meaningful message | Never ask "what should the message be?" |
| Tests failing | Fix them, don't ask | User expects working code |
| Convention violations | Fix them, don't ask | User expects clean code |

**The principle:** in autonomous mode the agent should be MORE disciplined,
not less. It follows every rule in this file but makes decisions instead
of blocking on questions. The quality bar is the same — tests pass,
conventions valid, docs updated, commits clean.

### Code workflow (mandatory, never skip)

Every code change MUST include — **automatically, without the user asking:**

1. **Tests** — Unit test for logic (server actions, queries, components),
   E2E test for user-facing behaviour (pages, forms, navigation). See the
   "Testing" section for the test matrix. Run `webjs test` after every
   change. Never report work as done with failing tests.

2. **Documentation** — Update `AGENTS.md` when adding API surface. Update
   `CONVENTIONS.md` when adding conventions. If the project has `docs/` or
   `website/` directories, update them for user-facing features.

3. **Convention validation** — Run `webjs check` and fix violations.

### Git workflow (mandatory, never skip)

**The model:** Always work on a feature branch. On a feature branch,
commit and push freely — no permissions needed. The only gate is
merging back into main, which requires user approval (unless in
bypass/autonomous mode).

1. **Create a feature branch first.** Before any code change:
   `git checkout -b feature/<task-slug>`. Never edit directly on main.

2. **On the feature branch: commit and push freely.** No prompts, no
   approval needed. Commit after each logical unit of work. Push after
   each commit. This is fully autonomous.

3. **Meaningful commit messages.** Describe what changed and why, not "update
   files" or "fix stuff". Format: imperative mood, under 72 chars for the
   first line. Example: `Add contact form with email validation`.

4. **No AI attribution in commits.** NEVER add `Co-Authored-By: Claude`,
   `Generated by AI`, `AI-assisted`, or any similar trailer or prefix.
   The commit is the user's work — the agent is a tool.

5. **Pull requests.** Create a PR for every feature branch. Use the PR
   template (`.github/pull_request_template.md`) which includes a test
   and documentation checklist.

6. **Never push to main.** Always push to the feature branch and create a
   PR. The Claude Code hook enforces this programmatically; for other
   agents, this rule is enforced via the config files above.

7. **NEVER merge without user permission.** Before merging ANY branch into
   ANY other branch, ask the user exactly this:

   > Ready to merge `<branch>` into `<target>`?
   > After merging, should `<branch>` be **deleted** or **kept**?

   Wait for explicit approval AND the delete/keep preference. Then:
   - If delete: `git merge <branch> && git branch -d <branch>`
   - If keep: `git merge <branch>` (leave the branch intact)

   This applies to ALL merges, not just main. The Claude Code hook
   enforces the approval programmatically; other agents must ask via
   their config files.

7. **Run tests before committing.** `npx webjs test` must pass. If the
   change is user-facing, `npx webjs test --browser` must also pass.

### What "automatically" means — a concrete example

When a user says "add a contact page", the agent delivers ALL of this
without being asked:

```
app/contact/page.ts                           ← the page
modules/contact/actions/send-message.server.ts ← the server action
modules/contact/types.ts                       ← type definitions
test/unit/contact.test.ts                      ← unit test for the action
test/e2e/contact.test.ts                       ← E2E test for the form flow
AGENTS.md                                      ← updated if new API/conventions
docs/app/docs/contact/page.ts                  ← doc page (if docs/ exists)
```

Plus: a git commit with a meaningful message, tests passing, conventions valid.

The user should never have to say "also write tests", "also update the docs",
or "also commit". That is the default behaviour in a webjs project.

---

## What webjs is

An **AI-first, batteries-included, convention-over-configuration** web
framework inspired by NextJs, Lit, and Rails.

- **Convention over configuration.** Set `REDIS_URL` and sessions, cache,
  rate limiting, pub/sub, and background jobs all use Redis automatically.
  Set `S3_BUCKET` for cloud file storage. Environment variables, not config files.
- **Batteries included.** Sessions, background jobs, file storage, pub/sub,
  cache store, rate limiting — all built in with pluggable adapters.
- **No build step.** Source files are served to the browser as native ES modules.
- **JSDoc or TypeScript.** Plain `.js` with JSDoc is the default; `.ts`/`.mts`
  files are a supported first-class option — Node 23.6+ strips types at runtime
  for server files, and the dev server strips types via esbuild when serving
  browser-facing `.ts` files. No ahead-of-time build step either way.
- **SSR + CSR by default.** Pages are server-rendered (real HTML, no hydration fallback). Interactive web components ship Declarative Shadow DOM and upgrade on the client.
- **Server actions with rich types.** Any file ending `.server.js` / `.server.ts`
  (or starting with `'use server'`) exports functions the client imports and
  calls directly — the import is rewritten into an RPC stub. The RPC wire uses
  **superjson**, so `Date`, `Map`, `Set`, `BigInt`, `undefined`, `URL`, `RegExp`
  round-trip as their real types.

---

## Framework source — where to find it

The webjs framework code lives in `node_modules/` in the user's project:

```
node_modules/
  webjs/                          ← core: html, css, WebComponent, render, directives
    src/
      html.js                     ← tagged template → TemplateResult
      component.js                ← WebComponent base class (lifecycle, controllers, properties)
      render-client.js            ← client-side fine-grained DOM renderer
      render-server.js            ← async SSR renderer (renderToString, renderToStream)
      directives.js               ← unsafeHTML, live
      repeat.js                   ← keyed list reconciliation
      context.js                  ← Context Protocol (ContextProvider, ContextConsumer)
      task.js                     ← Task controller (async data with states)
      router-client.js            ← Turbo Drive–style client router
      suspense.js                 ← streaming Suspense boundary
      lazy-loader.js              ← IntersectionObserver–based lazy module loading
  @webjs/server/                  ← server: SSR, router, actions, dev server
    src/
      dev.js                      ← request handler, file serving, TS transforms
      router.js                   ← file-based route scanner + matcher
      ssr.js                      ← SSR pipeline (layouts, metadata, Suspense streaming)
      actions.js                  ← server action scanner, RPC endpoints, expose()
      serializer.js               ← pluggable wire format (superjson default)
      check.js                    ← convention validator (webjs check)
      vendor.js                   ← auto-bundle npm deps for browser
      module-graph.js             ← dependency graph for transitive preloads
  @webjs/cli/                     ← CLI: dev, start, build, test, check, create
```

**AI agents: when debugging framework behaviour** (e.g., "why doesn't my
component hydrate?" or "why is SSR missing my layout?"), read the relevant
source file above. The code is plain JS with JSDoc — no build artifacts,
no minification. What you read is what runs.

**For UI debugging**, use the Playwright MCP server (configured in
`.claude.json`). It gives you direct browser control: navigate pages,
click elements, take screenshots, inspect the accessibility tree. Use
Playwright MCP tools instead of writing one-shot Bash scripts with
browser automation imports.

---

## App layout (cannot be renamed)

```
app/                        thin route adapters — import from modules/
  layout.js                 root layout, wraps every page
  page.js                   /
  error.js                  nested error boundary (catches render errors)
  not-found.js              404 page (only at app/ root)
  <segment>/page.js         /<segment>
  [param]/page.js           dynamic route; `params.param` in handler
  [...rest]/page.js         catch-all
  [[...rest]]/page.js       optional catch-all (matches with AND without params)
  (group)/…                 route group — folder NOT in URL; still scopes layout/error
  _private/…                private folder — fully ignored by the router
  <path>/route.js           HTTP handler at /<path> — may live anywhere under app/
  <segment>/middleware.js   per-segment middleware (auth gate, rate limit, …)
  <segment>/not-found.js   nested 404 (nearest wins when notFound() is thrown)
  <segment>/loading.js     auto Suspense boundary (wraps page in Suspense with this as fallback)
middleware.js               root-level middleware (runs on every request)
sitemap.js                  metadata route → /sitemap.xml
robots.js                   metadata route → /robots.txt
manifest.js                 metadata route → /manifest.json
icon.js                     metadata route → /icon (dynamic image)
opengraph-image.js          metadata route → /opengraph-image
twitter-image.js            metadata route → /twitter-image
apple-icon.js               metadata route → /apple-icon
lib/                        cross-cutting infra (prisma.js, session.js, password.js, …)
modules/                    feature-scoped code (actions + queries + UI)
  <feature>/
    actions/                mutations — one file per action, `'use server'`
    queries/                reads — one file per query, `'use server'`
    components/             feature-owned web components (e.g. <auth-forms>, <comments-thread>)
    utils/                  internal helpers (formatters, pure fns)
    types.js                JSDoc typedefs shared across the module
components/*.js             SHARED presentational primitives (chrome, typography, icons)
public/*                    static assets, served at /<name>
prisma/schema.prisma        data models
```

Every file is a plain ES module. No config required.

---

## Public API — `webjs`

Import from the bare specifier `'webjs'` (resolved via the injected import map).

```js
import { html, css, WebComponent, render, renderToString } from 'webjs';
```

| Export            | Purpose |
| ----------------- | ------- |
| `html`            | Tagged template literal producing a `TemplateResult`. Use in pages, layouts, and component `render()`. |
| `css`             | Tagged template literal producing a `CSSResult`. Assign to `static styles` on components. |
| `WebComponent`    | Base class for interactive components. |
| `register(tag,C)` | Register a tag → class. Called automatically by `Class.register()`. |
| `render(v, el)`   | Client-side: render a value into a DOM element. |
| `renderToString`  | Server-side: **async** — render a value to an HTML string with DSD injection. Awaits Promise-valued holes and async component `render()` methods. |
| `notFound()`      | Throw inside a page/layout/server action to return a 404 rendered via `not-found.js`. |
| `redirect(url)`   | Throw inside a page/layout/server action to return a 307 (default) or 308 redirect. |
| `expose(p, fn)`   | Tag a server action to ALSO be reachable at a REST path, e.g. `expose('POST /api/posts', fn)`. Optional `{ validate }` runs before the handler over HTTP. |
| `repeat(items, k, t)` | Keyed list directive — `${repeat(items, it => it.id, it => html\`...\`)}`. Preserves element identity / focus when items reorder. |
| `Suspense({fallback, children})` | Streaming boundary — server flushes `fallback` immediately, streams `children` (a Promise<TemplateResult>) when it resolves. |
| `connectWS(url, handlers)` | Client-side WebSocket with auto-reconnect, JSON parse/stringify, queued sends. |
| `richFetch<T>(url, init?)` | Client-side fetch that adds `Accept: application/vnd.webjs+json`, encodes plain-object bodies via superjson, and decodes responses with rich types. |

### Directives — `import { … } from 'webjs/directives'`

webjs follows a **"less is more"** philosophy: only directives that solve
problems with NO native alternative are included. AI agents don't need
syntax sugar — they write code that works, not code that looks pretty.

**Three built-in directives:**

| Directive | Purpose | Example |
|---|---|---|
| `repeat(items, keyFn, templateFn)` | Keyed list reconciliation — preserves DOM identity on reorder | `${repeat(items, i => i.id, i => html\`…\`)}` |
| `unsafeHTML(str)` | Render trusted raw HTML (CMS, markdown). **XSS risk — never use with user input** | `${unsafeHTML(markdownToHtml(md))}` |
| `live(value)` | Input value sync — dirty-checks against live DOM, not last render | `.value=${live(inputVal)}` |

**Everything else uses native patterns:**

| Need | Native pattern (no directive needed) |
|---|---|
| Conditional CSS classes | `` class=${[active && 'active', error && 'error'].filter(Boolean).join(' ')} `` |
| Dynamic inline styles | `` style=${`color:${c};font-size:${s}`} `` |
| Optional attribute | `attr=${val ?? null}` (null removes the attribute) |
| Conditional rendering | `${cond ? html\`…\` : html\`…\`}` |
| Multi-branch | `${status === 'ok' ? html\`✓\` : status === 'err' ? html\`✗\` : html\`…\`}` |
| Memoization | Compute in `render()` before the template, store on `this` |
| Element reference | `this.shadowRoot.querySelector('#el')` in `firstUpdated()` |
| Preserve DOM (tabs) | CSS `display:none` / `visibility:hidden` |
| Async data in component | `Task` controller with `task.render()` |
| Async data in page | `async` page function (just `await`) |
| Lists without reorder | `${items.map(item => html\`…\`)}` |

### Context Protocol — `import { … } from 'webjs/context'`

Share data across deeply nested components without prop drilling.

| Export | Purpose |
|---|---|
| `createContext(name)` | Create a unique context key for identifying a value channel. |
| `ContextProvider` | Controller: provides a value to all descendants. `new ContextProvider(host, { context, initialValue })`. Call `provider.setValue(v)` to update + notify subscribers. |
| `ContextConsumer` | Controller: consumes a provided value. `new ContextConsumer(host, { context, subscribe: true })`. Read `consumer.value`. Auto-updates host on changes. |
| `ContextRequestEvent` | The DOM event used by the protocol. Bubbles + composed (crosses shadow DOM). |

**When to use Context (AI hint):** Use when data (theme, auth state, locale, config) must reach components many levels deep without threading it through every intermediate component's attributes. Do NOT use for data that changes on every render (use state for that) or for data that only one component needs (use a server action or prop).

### Task Controller — `import { Task, TaskStatus } from 'webjs/task'`

Manages async operations (fetch, compute) inside components with automatic loading/error states and AbortController.

```js
class UserProfile extends WebComponent {
  #task = new Task(this, {
    task: async ([userId], { signal }) => {
      const res = await fetch(\`/api/users/\${userId}\`, { signal });
      return res.json();
    },
    args: () => [this.userId],
  });
  render() {
    return this.#task.render({
      pending: () => html\`<p>Loading…</p>\`,
      complete: (user) => html\`<h1>\${user.name}</h1>\`,
      error: (e) => html\`<p>Error: \${e.message}</p>\`,
    });
  }
}
```

| Status | Value | Meaning |
|---|---|---|
| `TaskStatus.INITIAL` | 0 | Never run yet |
| `TaskStatus.PENDING` | 1 | Running (abort controller active) |
| `TaskStatus.COMPLETE` | 2 | Resolved — `task.value` is the result |
| `TaskStatus.ERROR` | 3 | Rejected — `task.error` is the Error |

**When to use Task (AI hint):** Use for **component-scoped** async: search-as-you-type, lazy data on scroll, autocomplete. For **page-level** data loading, use async page functions instead (they run on the server). Task handles AbortController automatically — navigating away or re-running cancels the previous request.

### `html` — expression prefixes

Inside an `html` template:

| Syntax            | Meaning |
| ----------------- | ------- |
| `<div>${x}</div>` | Text child. Values may be primitives, arrays, or other `TemplateResult`s. |
| `class=${x}`      | Plain attribute — value is stringified and HTML-escaped. |
| `@click=${fn}`    | Event listener. Only rendered on the client. |
| `.value=${v}`     | Direct **property** set on the DOM element (not an attribute). |
| `?disabled=${b}`  | Boolean attribute — attribute is present iff the value is truthy. |

Event/property/boolean-prefixed attributes **must be unquoted**.

### `WebComponent`

```js
class MyThing extends WebComponent {
  static tag = 'my-thing';           // required
  static shadow = true;              // false = render into light DOM
  static lazy = false;               // true = load module on viewport entry (IntersectionObserver)
  static properties = {              // attribute → property coercion
    count: { type: Number, reflect: true },
    mode:  { type: String, state: true },           // internal — no attribute
    data:  { type: Object, converter: { fromAttribute: JSON.parse } },
    size:  { type: Number, hasChanged: (n, o) => Math.abs(n - o) > 1 },
  };
  static styles = css`…`;            // CSSResult or array of them
  state = { /* any */ };             // internal state

  connectedCallback() {              // call super! then seed state from props
    super.connectedCallback();
  }

  render() {                         // returns TemplateResult
    return html`…`;
  }
}
MyThing.register(import.meta.url);
```

Mutate state with `this.setState({...})` — it batches a re-render via microtask.
Attribute changes auto-trigger re-render when the attribute is declared in
`static properties`.

#### Lifecycle hooks

The update cycle runs in this order when `setState()` or a property change triggers a re-render:

| Hook | When | Use for |
|---|---|---|
| *controllers'* `hostUpdate()` | Before render | Controller pre-render logic. |
| `render()` | Render phase | Return `TemplateResult`. |
| *controllers'* `hostUpdated()` | After render | Controller post-render logic. |
| `firstUpdated()` | After first render only | One-time DOM setup (focus, measure, attach third-party libs). |

**"Less is more":** Most components only need `render()`. Add `firstUpdated`
for one-time DOM work (canvas init, focus). For pre-render computation,
do it at the top of `render()`. For post-render side effects, use
`queueMicrotask()` after `setState()`. No `shouldUpdate`, `willUpdate`,
`updated`, or `changedProperties` — AI agents don't need those abstractions.

#### ReactiveControllers

Composable logic that hooks into any component's lifecycle without inheritance:

```js
class FetchController {
  constructor(host, url) {
    this.host = host;
    this.url = url;
    this.data = null;
    host.addController(this);     // ← register
  }
  async hostConnected() {
    this.data = await (await fetch(this.url)).json();
    this.host.requestUpdate();
  }
  hostDisconnected() { /* cleanup */ }
}

// Usage in any component:
class MyEl extends WebComponent {
  #users = new FetchController(this, '/api/users');
  render() { return html`${this.#users.data?.length} users`; }
}
```

**AI hint for controllers:** Use controllers when the same lifecycle logic (fetch, timer, subscription, resize observer) is needed in multiple unrelated components. Prefer controllers over mixins or inheritance chains. The built-in `Task`, `ContextProvider`, and `ContextConsumer` are all controllers.

#### Property declarations — detail

| Option | Type | Default | Meaning |
|---|---|---|---|
| `type` | `Number\|String\|Boolean\|Object\|Array` | `String` | Used by the default attribute converter |
| `reflect` | `boolean` | `false` | Property changes write back to the HTML attribute |
| `state` | `boolean` | `false` | Internal-only — no attribute, not in `observedAttributes` |
| `hasChanged` | `(newVal, oldVal) => boolean` | strict `!==` | Custom change detection |
| `converter` | `{ fromAttribute?, toAttribute? }` | type-based | Custom attribute ↔ property serialization |

#### Helper methods

| Method | Purpose |
|---|---|
| `this.requestUpdate()` | Manually schedule a re-render (used by controllers) |
| `this.shadowRoot.querySelector(sel)` | Query elements in shadow DOM (native API) |

---

## File conventions — detail

### Pages (`app/**/page.js`)

- **Default export is a (possibly async) function.** Receives `{ params, searchParams, url }`. Returns a `TemplateResult`.
- Runs **only on the server**. Data fetching is just `await` — same mental model as React Server Components.
- May `throw notFound()` or `throw redirect('/somewhere')` — the SSR pipeline converts these to 404 / 3xx responses.
- Named exports read by the framework:
  - `metadata` — static object (`{ title, description, viewport, themeColor, openGraph: {…} }`) merged into `<head>`.
  - `generateMetadata(ctx)` — async function returning the same shape. Takes precedence over `metadata`.
- Page modules are also loaded on the client (as a side effect) so transitively imported components register their custom elements. Keep top-level imports safe to execute in the browser (do **not** import `@prisma/client`, `node:fs`, etc. directly — go through a server action).

### Error boundaries (`app/**/error.js`)

- Default export receives `{ error, ...ctx }` and returns a `TemplateResult`.
- Catches errors thrown during render of the sibling page or any deeper segment (not 404/redirect sentinels — those are handled separately).
- Nearest boundary wins: innermost `error.js` on the route's folder chain is tried first.

### Custom components (`components/*.js`)

- `render()` can be `async` on the server — the SSR pipeline awaits it before emitting Declarative Shadow DOM. Mirrors async React Server Components.
- On the client, `render()` is expected to be synchronous (runs in the browser event loop).

### Layouts (`app/**/layout.js`)

- Default export receives `{ children, params, searchParams, url }`.
- Must embed `children` somewhere in its returned template.
- Nest by folder: `app/layout.js` wraps everything; `app/blog/layout.js` wraps only `/blog/**`.

### Route handlers (`app/**/route.js`)

- Export named async functions per method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- Each receives `(Request, { params })` and returns either a `Response` or any value (auto-JSON).
- Can live anywhere under `app/` — the file path becomes the URL path.
  `app/webhook/route.js` → `/webhook`, `app/api/users/[id]/route.js` → `/api/users/:id`.
  The `app/api/…` convention is idiomatic, not required.
- A folder cannot have both `page.js` and `route.js` (they'd conflict on the same URL).
- **WebSocket support**: exporting a `WS` function from the same `route.js`
  turns the URL into a WebSocket endpoint. The server handles the HTTP
  `Upgrade` handshake; your function receives the `ws` object, the upgrade
  `Request` (for cookies / headers / auth), and `{ params }`:
  ```js
  export function WS(ws, req, { params }) {
    ws.on('message', (data) => ws.send('echo:' + data));
    ws.on('close', () => { /* cleanup */ });
  }
  ```
  In **dev mode**, the module is re-imported on each connection to pick up
  edits — store shared state (e.g. connected clients Set) on `globalThis`
  so it survives the reload:
  ```js
  const clients = globalThis.__my_clients ?? (globalThis.__my_clients = new Set());
  ```
  Client helper: `connectWS(url, { onOpen, onMessage, onClose, onError, reconnect })`
  from `webjs` — auto-reconnect with exponential backoff, JSON parse/stringify,
  queues sends while disconnected.

### Middleware (`middleware.js` at the app root)

- Optional top-level file. Default export is `async (req, next) => Response`.
- `req` is the standard `Request`; `next()` returns the normal pipeline's `Response`.
- Return a `Response` to short-circuit (redirect, 401, etc.); call `next()` then post-process to add headers, log, etc.
- Only one file, only at the app root (no per-segment middleware in v1).

### Server actions (`**/*.server.js` or `'use server'`)

- Export named async functions. Arguments and return values must be JSON-serialisable.
- **Importing these modules from a client component** (e.g. a file under `components/`) is the entire API: the dev server rewrites the import into an RPC stub that POSTs to `/__webjs/action/<hash>/<fn>` and returns the JSON result.
- On the server these modules are imported normally; you can freely use Prisma, `fs`, environment variables, etc.
- **Expose as REST**: wrap any action with `expose('METHOD /path', fn)` to ALSO make it reachable at a stable REST URL. The same function body powers both callers:
  ```js
  import { expose } from 'webjs';
  export const createPost = expose('POST /api/posts', async ({ title, body }) => { … });
  ```
  When called over HTTP, the adapter merges `{ ...query, ...urlParams, ...jsonBody }` into a single object argument. This is the recommended way to surface a server action to external consumers — no `route.js` wrapper needed.
- **Validate input**: pass a third arg `{ validate }`. The function runs before your handler over HTTP; throw to fail (→ 400 JSON with the message and any `issues`). Plays nicely with zod / valibot / hand-written validators:
  ```js
  expose('POST /api/posts', handler, { validate: Schema.parse });
  ```
  Validate runs only on the HTTP path. Direct client-component RPC calls bypass it (the function trusts its argument because the call is same-origin and CSRF-protected).

### Internal RPC — security model

- Every action call from a client component is a `POST /__webjs/action/<hash>/<fn>` with `x-webjs-csrf` and a matching `webjs_csrf` cookie issued on the first SSR response. Cross-origin attackers cannot read the cookie, so they cannot forge the header. CSRF mismatch → 403.
- Errors thrown from action handlers are sanitised in production: only the thrown `message` is returned, never the stack. Internal errors (no message) collapse to "Internal server error". The full error is logged server-side.
- `expose()`d REST endpoints are NOT CSRF-protected (they target external consumers). Apply auth via `middleware.js` or per-route checks.

### Security checklist for `expose()`

When you mark an action as `expose('METHOD /path', fn)`, you are declaring it part of your public API surface. Treat it like one:

1. **Authenticate every mutating endpoint.** Cookie auth alone is not enough — without CSRF a malicious site can POST to your endpoint with the user's cookies. Either:
   - Require a bearer token / API key (read via `headers().get('authorization')`).
   - Add an explicit CSRF check in your `validate` or `middleware.js`.
   - Reject browser POSTs by checking `headers().get('origin')` against an allow-list.
2. **Use `validate`** — never trust the merged `{ ...query, ...params, ...body }` shape. A handler that does `db.user.update({ where: input.filter, data: input.data })` is a foot-gun.
3. **Log responsibly.** The default `actionErrorResponse` returns the thrown `message` only in prod; never include user input in error messages, never include secrets.
4. **Configure CORS narrowly.** `cors: true` is fine for genuinely public reads. For anything authenticated, prefer an explicit origin or list.
5. **Rate-limit at the edge.** webjs ships no built-in rate limiter. Use a reverse proxy (nginx, fly, cloudflare) or write a small middleware over `headers()`/in-process counters.

### Components (`components/*.js`)

- Each file should define **one** custom element and call `Class.register(import.meta.url)` at module top level.
  Passing `import.meta.url` lets the SSR shell emit a `<link rel="modulepreload">` so the browser can fetch the module without waiting for its parent to parse. Zero build step; big first-paint win.
- Imported by pages (for SSR) and/or other components (for composition).
- **Styling convention: shadow-DOM CSS via `static styles = css\`…\``, not inline `style="…"` attributes.** Any repeated visual chunk in pages (layout chrome, cards, muted labels, etc.) should become a component whose styles live in its shadow root. The example app's `<blog-shell>` and `<muted-text>` demonstrate this — pages emit semantic HTML with zero inline styles.

---

## Modules architecture (preferred for non-trivial apps)

Feature-scoped modules keep business logic out of routes and off
components. Conventions enforced across the example blog:

### Layout

- **`modules/<feature>/actions/*.server.js`** — mutations, one file per
  function. Each exports a single named async function (e.g.
  `create-post.server.js` exports `createPost`). Always start with the
  `'use server'` pragma or the `.server.js` extension (the `.server.js`
  extension is the recommended default — unambiguous in file listings).
- **`modules/<feature>/queries/*.server.js`** — reads. Same shape as
  actions; the split is so grep quickly shows what mutates vs. what
  doesn't.
- **`modules/<feature>/components/*.js`** — web components that belong
  conceptually to one feature (`modules/auth/components/auth-forms.js`,
  `modules/comments/components/comments-thread.js`). Pages import them
  directly from the module. Shared UI primitives that aren't feature-
  specific (chrome, typography helpers, reusable cards) stay in the
  top-level `components/` dir.
- **`modules/<feature>/utils/*.js`** — pure helpers and formatters.
  Importable from anywhere, no `'use server'`, no DB access.
- **`modules/<feature>/types.js`** — JSDoc `@typedef` blocks for shapes
  returned from actions/queries. File is effectively empty at runtime —
  `export {};` keeps it a valid ES module.
- **`lib/*.js`** — cross-cutting infra: `prisma.js` (singleton), auth
  primitives (`password.js`, `session.js`), external-service clients.
  Not feature-specific.

### Return shape

Actions that can fail with a user-facing error return the
pilot-platform `ActionResult<T>` envelope so route adapters translate
them mechanically:

```js
/**
 * @template T
 * @typedef {{ success: true, data: T }
 *          | { success: false, error: string, status: number }} ActionResult
 */
```

Route handler pattern:

```js
import { createPost } from '../../modules/posts/actions/create-post.server.js';

export async function POST(req) {
  const r = await createPost(await req.json());
  if (!r.success) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r.data);
}
```

### Rules

- **Routes must stay thin.** If a `route.js` has more than ~20 lines of
  business logic, extract it into a module action.
- **Client components import server modules via the normal import path.**
  webjs rewrites the import into an RPC stub automatically — don't hand-
  write `fetch()`.
- **Server-only imports (`@prisma/client`, `node:*`, `lib/password.js`)
  stay out of components/ and pages' top-level graphs** except through
  `.server.js` files.
- **One module, one feature.** If code naturally splits (e.g. `auth`,
  `posts`, `comments`), give each its own module folder.
- **Modules can depend on `lib/*` and on other modules' public exports.**
  Prefer importing through a module's action/query files rather than
  reaching into its `utils/`.

## Invariants (for both humans and agents)

1. **Never import `@prisma/client`, `node:*`, or any server-only dependency from a file under `components/` or from a page's top-level module graph that isn't a server action.** The browser will try to load it and fail. Use a server action instead.
2. **Every `*.server.js` export must be an `async` JSON-safe function.** Arguments/results are serialised over the wire.
3. **Custom element tag names must contain a hyphen** (HTML spec). Set `static tag`, call `.register()`.
4. **Event (`@`), property (`.`), and boolean (`?`) holes in `html` must be unquoted** — e.g. `@click=${fn}`, never `@click="${fn}"`.
5. **Do not mutate `this.state` directly** — use `setState`. State reads are fine.
6. **Page and layout default exports must be functions.** They return a value (usually a `TemplateResult`); they do not call `render()` themselves.

---

## Recipes

### Add a new page at `/about`

```js
// app/about/page.js
import { html } from 'webjs';
export default function About() {
  return html`<h1>About</h1><p>…</p>`;
}
```

### Add a dynamic route

```js
// app/users/[id]/page.js
import { html } from 'webjs';
export default async function User({ params }) {
  // use a server action to fetch; never import a DB client directly in a page
  const user = await fetchUser(params.id);
  return html`<h1>${user.name}</h1>`;
}
```

### Add an API route

```js
// app/api/ping/route.js
export async function GET() { return { pong: Date.now() }; }
```

### Add a server action (modules architecture)

```js
// modules/users/actions/update-profile.server.js
'use server';
import { prisma } from '../../../lib/prisma.js';
import { currentUser } from '../queries/current-user.server.js';

/**
 * @param {{ name: string }} input
 * @returns {Promise<import('../types.js').ActionResult<import('../types.js').PublicUser>>}
 */
export async function updateProfile(input) {
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };
  const name = String(input?.name || '').trim();
  if (!name) return { success: false, error: 'name required', status: 400 };
  const row = await prisma.user.update({ where: { id: me.id }, data: { name } });
  return { success: true, data: { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt } };
}
```

Expose it via a thin route:

```js
// app/api/users/me/route.js
import { updateProfile } from '../../../../modules/users/actions/update-profile.server.js';
export async function PATCH(req) {
  const r = await updateProfile(await req.json());
  if (!r.success) return Response.json({ error: r.error }, { status: r.status });
  return Response.json(r.data);
}
```

Or call it directly from a client component — the dev server rewrites
the import into an RPC stub:

```js
import { updateProfile } from '../../../modules/users/actions/update-profile.server.js';
const r = await updateProfile({ name: 'New name' });
if (!r.success) this.setState({ error: r.error });
```

### Add a new component

```js
// components/hello-world.js
import { WebComponent, html } from 'webjs';
export class HelloWorld extends WebComponent {
  static tag = 'hello-world';
  render() { return html`<p>Hello!</p>`; }
}
HelloWorld.register();
```

Then use it as `<hello-world></hello-world>` in any page or component.

### Add a database model

Edit `prisma/schema.prisma`, then run:

```sh
webjs db migrate add_posts
webjs db generate
```

Reference it via JSDoc:

```js
/** @param {import('@prisma/client').Post} post */
```

---

## Production deployment

- `webjs start` runs the production server: prod logger (one JSON object per
  line on stdout), graceful shutdown on SIGTERM/SIGINT, ETag + cache headers
  on static assets, gzip/brotli compression negotiated via `Accept-Encoding`.
- Long-lived caching: `/__webjs/core/*` ships `Cache-Control: public, max-age=
  31536000, immutable`. Other static files get `max-age=3600` + ETag.
- Health probe: `GET /__webjs/health` and `/__webjs/ready` return `{status:"ok"}`
  with `Cache-Control: no-store`. Wire these into your orchestrator.
- Embed in another runtime: import `createRequestHandler({ appDir, dev })`
  from `@webjs/server`. It returns `{ handle(req: Request) → Promise<Response> }`
  — usable in Express (`app.use((req, res) => …)`), Fastify, Deno, Bun, Workers.
- Plug your own logger via `createRequestHandler({ logger })`. Any `{ info,
  warn, error }` shape works (pino, winston, etc.).

## TypeScript without a build step

Files ending in `.ts` / `.mts` are supported everywhere `.js` / `.mjs` are —
same routing conventions, same server-action behaviour, same bundle
participation. No `tsc` run is part of the user-visible workflow:

- **Editor** (VS Code) runs the TypeScript language server continuously.
  Red-squiggle on wrong types.
- **CI** (optional) runs `tsc --noEmit` against `tsconfig.json` at the
  app root — type-check only, zero generated files.
- **Dev server** (runtime): when the browser requests a `.ts` file, the
  dev server transforms via `esbuild.transform()` (~0.5–1ms per file,
  cached by mtime) and serves JavaScript with an inline sourcemap.
- **Node server-side** (runtime): Node 23.6+ natively strips types
  from `.ts` / `.mts` modules on import. Pages, layouts, server actions
  and route handlers all run unchanged.
- **`webjs build`**: esbuild already handles `.ts` in its bundle entry
  graph; no extra config needed.

### Import convention

Use explicit `.ts` extensions in imports. This is what Node's native
TS support expects and matches the framework's resolution. For mixed
codebases, `.js` imports that point at a `.ts` sibling also resolve
in the dev server (fallback) — but prefer explicit `.ts` for clarity.

```ts
// modules/posts/queries/list-posts.server.ts
import { prisma } from '../../../lib/prisma.js';         // JS file unchanged
import { formatPost } from '../utils/slugify.ts';         // TS file
```

### Minimum viable `tsconfig.json`

A `tsconfig.json` at the app root enables editor + CI checking. No emit,
no separate build:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "checkJs": true,
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  }
}
```

### What doesn't work with Node's strip-types

Node's runtime stripper handles **erasable syntax only**. The following
don't run and need to be avoided (or moved into dev dependencies that
pre-compile):

- `enum`, `namespace`
- Parameter properties (`constructor(public x: number)`)
- Legacy decorators (`@foo` with emit)

All other TS — `type`, `interface`, generics, `as`, conditional types,
mapped types, template-literal types — run fine.

## Full-stack type safety (actions + API routes)

### Server actions — type-safe automatically

Calling a server action from a client component resolves — at type-check
time — to the action's real source file. The dev server's runtime stub
replacement is invisible to the type checker. A typed action like:

```ts
// modules/posts/actions/create-post.server.ts
export async function createPost(
  input: { title: string; body: string },
): Promise<ActionResult<PostFormatted>> { /* … */ }
```

…gives every client caller full inference:

```ts
// modules/posts/components/new-post.ts
import { createPost } from '../actions/create-post.server.ts';
const r = await createPost({ title, body });
//        ^ Promise<ActionResult<PostFormatted>>
if (r.success) r.data.title;   // ← PostFormatted.title: string
```

**Runtime reality matches the types** because the RPC wire is superjson:
a `Date` on the server is a `Date` on the client, a `Map` is a `Map`, a
`BigInt` is a `BigInt`. Supported types: everything superjson handles
(Date, Map, Set, BigInt, undefined, URL, RegExp, Error, Decimal, plus
any custom transformer you register). Class instances come through as
plain objects — prototypes are lost, methods don't survive.

### API routes — opt in via content negotiation

`route.ts` handlers use standard JSON by default so external consumers
(curl, mobile, third-party services) keep working unchanged. To opt
into rich types for your own UI code:

```ts
// app/api/posts/route.ts — server side
import { json } from '@webjs/server';
import { listPosts } from '.../queries/list-posts.server.ts';

export async function GET() {
  return json(await listPosts());   // content-negotiates automatically
}
```

```ts
// caller — client side
import { richFetch } from 'webjs';
const posts = await richFetch<Post[]>('/api/posts');
// posts[0].createdAt is a Date here (richFetch sends
// Accept: application/vnd.webjs+json and superjson-parses the response).
```

The `json()` helper reads the in-flight Request via the AsyncLocalStorage
context:
- `Accept: application/vnd.webjs+json` → superjson-encoded response,
  `Content-Type: application/vnd.webjs+json`, `Vary: Accept` for
  correct shared-cache keying.
- Otherwise → plain JSON with `Content-Type: application/json`.

Request bodies can be parsed with the dual-format `readBody(req)`
helper from `@webjs/server`.

### TypeScript is not required

If you prefer staying on JS + JSDoc: **same type safety at call sites,
same tooling**. The TypeScript language server reads `@typedef` /
`@param` / `@returns` annotations identically to `.ts` type syntax.
Add `"checkJs": true` to `tsconfig.json` to enforce types in editor
+ CI. The framework doesn't care either way — pick what fits the
codebase.

## Batteries included — `import { … } from '@webjs/server'`

webjs is batteries-included for production. Convention over configuration:
**set `REDIS_URL` in the environment and everything scales horizontally.**
No config file needed.

### Cache store

```js
import { getStore } from '@webjs/server';
const store = getStore(); // auto: REDIS_URL → Redis, otherwise → memory
await store.set('key', 'value', 60000); // TTL in ms
await store.get('key');
await store.increment('counter', 60000); // atomic counter with TTL
```

Used internally by rate limiter, sessions, and jobs. You can use it
directly for app-level caching.

### Sessions

```js
// middleware.js — add session support to all routes
import { session } from '@webjs/server';
export default session(); // auto: REDIS_URL → server-side, otherwise → cookie

// In any page or action:
import { getSession } from '@webjs/server';
const s = getSession(req);
s.userId = user.id; // auto-saved after response
```

Cookie sessions (default): signed + encrypted, no server state.
Store sessions (with Redis): session ID in cookie, data in Redis.
Requires `SESSION_SECRET` environment variable.

### Background jobs

```js
import { defineJob, enqueue } from '@webjs/server';

// Define a job handler (runs in the background)
defineJob('send-email', async (data, { signal }) => {
  await sendEmail(data.to, data.subject, data.body);
});

// Enqueue from any server action
await enqueue('send-email', { to: 'user@example.com', subject: 'Welcome' });
```

Convention: REDIS_URL → jobs survive restarts (Redis queue).
No REDIS_URL → in-process queue (dev mode, jobs lost on restart).

### Pub/Sub (WebSocket scaling)

```js
import { getPubSub } from '@webjs/server';
const ps = getPubSub(); // auto: REDIS_URL → Redis, otherwise → memory

// Publish from any server action or route
ps.publish('chat', JSON.stringify({ user: 'alice', text: 'hello' }));

// Subscribe in a WebSocket handler
ps.subscribe('chat', (msg) => ws.send(msg));
```

With Redis, messages reach WebSocket clients on ALL server instances.

### File storage

```js
import { getStorage } from '@webjs/server';
const store = getStorage(); // auto: S3_BUCKET → S3, otherwise → disk

// Upload
const key = await store.put('avatars/user-123.jpg', fileBuffer);

// Get URL
const url = store.url(key); // /__webjs/uploads/... or https://s3...
```

Convention: `S3_BUCKET` + `AWS_REGION` → S3. Otherwise → local `./uploads/`.

### Environment variables (convention over configuration)

| Variable | Effect |
|---|---|
| `REDIS_URL` | Cache, sessions, rate limiter, pub/sub, and job queue all use Redis |
| `SESSION_SECRET` | Required for session signing (any random string, 32+ chars) |
| `S3_BUCKET` | File storage uses S3 instead of local disk |
| `AWS_REGION` | AWS region for S3 (default: `us-east-1`) |
| `AWS_ACCESS_KEY_ID` | S3 credentials |
| `AWS_SECRET_ACCESS_KEY` | S3 credentials |
| `PORT` | Server port (default: 3000) |

**Zero config for development.** Everything works with memory/cookie/disk
defaults. For production, set `REDIS_URL` and optionally `S3_BUCKET` —
that's it.

---

## Advanced features

### Streaming SSR / Suspense

```js
import { html, Suspense } from 'webjs';

export default function Page() {
  return html`
    <h1>Catalogue</h1>
    ${Suspense({ fallback: html`<p>Loading…</p>`, children: fetchExpensive() })}
  `;
}
```

TTFB = time to render everything *outside* the Suspense boundary. The
fallback flushes immediately; the resolved content streams in as a
`<template>` + inline `__webjsResolve('id')` script when the promise lands.
Nested Suspense is supported.

### First-paint performance without a build step

webjs stacks three zero-build optimizations that together replace what a
traditional bundler buys you for the initial page load:

1. **`<link rel="modulepreload">` per used component + transitive deps.**
   The SSR pass knows every custom element in the final HTML; a startup
   module-graph scan adds their transitive import dependencies too. All
   preload hints are deduplicated and emitted in `<head>`. The browser
   starts all fetches the moment it parses the head — no ES-module waterfall.
2. **HTTP/2 (ALPN over TLS).** `webjs start --http2 --cert … --key …` serves
   everything over one multiplexed connection. N small module files no
   longer mean N TCP handshakes.
3. **103 Early Hints.** Before SSR even starts computing the response,
   the server sends `103 Interim Response` with the page's module URLs as
   `rel=modulepreload`. Chrome/Edge and edge proxies (Cloudflare, fly-proxy,
   Fastly) forward these to the client, which begins fetching modules
   *while the server is still rendering*.

4. **Lazy component loading (opt-in).** Components with `static lazy = true`
   are excluded from modulepreload and loaded on-demand via
   `IntersectionObserver` when the element enters the viewport. Ideal for
   below-the-fold widgets (charts, maps, carousels).
5. **Auto-vendor bundling (Vite-style optimizeDeps).** At startup the server
   scans client-reachable source for bare npm import specifiers. Each
   discovered package is bundled into a single ESM file via esbuild and
   served at `/__webjs/vendor/<pkg>.js`. The import map is populated
   automatically — no manual configuration needed.

For most apps these five together produce first-paint performance
comparable to a tree-shaken bundle — without running a bundler. For larger
apps (many components) where request count still matters, `webjs build`
is available as an opt-in.

### Bundling — `webjs build` (optional)

Runs esbuild over every client-facing module (components, pages, layouts,
error, not-found) and writes a single `.webjs/bundle.js`. Prod serves the
bundle with `Cache-Control: immutable, max-age=1y`; the SSR shell imports
only the bundle, collapsing N HTTP requests into one on first paint.

  webjs build                        # default: minified + sourcemap
  webjs build --no-minify            # for debugging
  webjs build --no-sourcemap         # smaller deploy

One bundle for the whole app — no per-route code splitting in v1.

### Rate limiting — `rateLimit()`

In-memory fixed-window limiter, shaped as middleware:

```js
import { rateLimit } from '@webjs/server';
export default rateLimit({ window: '1m', max: 60 });    // 60 req/min
export default rateLimit({
  window: '10s', max: 10,
  key: req => `login:${req.headers.get('x-forwarded-for') || 'anon'}`,
});
```

Single-process only — use Redis or edge rate-limiting for multi-instance.

### Per-segment middleware

`middleware.js` can live at any level under `app/` and only applies to its
subtree. Chain runs outermost → innermost, root sibling → app root first,
then segment-scoped files.

### Raw-text templates

`<script>` and `<style>` are now parsed as raw-text — `<` and `>` inside
them aren't tag starts. Holes interpolate verbatim (no HTML escaping).

## Runtime targets

### Node (default)

`startServer({ appDir })` — opens an `http.Server`, installs SIGTERM/SIGINT
handlers, enables chokidar file watching in dev.

### Embedded / other runtimes

Import `createRequestHandler` and adapt the platform's Request/Response:

```js
// Express
import express from 'express';
import { createRequestHandler } from '@webjs/server';
const webjs = await createRequestHandler({ appDir });
app.use(async (req, res) => {
  const webReq = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method, headers: req.headers, body: req.method === 'GET' ? null : req,
  });
  const r = await webjs.handle(webReq);
  res.status(r.status);
  r.headers.forEach((v, k) => res.setHeader(k, v));
  r.body?.pipeTo(new WritableStream({ write: c => res.write(c), close: () => res.end() }));
});
```

### Edge runtimes (Cloudflare Workers, Deno Deploy, Bun)

**Partially supported.** The pieces that port today:
- `createRequestHandler(...).handle(Request)` — fully runtime-agnostic.
- CSRF uses Web Crypto (`crypto.getRandomValues`) — works on all edge runtimes.
- Server actions, `expose()`, `cookies()`/`headers()`, middleware, CORS, Suspense.

**What doesn't port yet:**
- File-system module loading. Edge runtimes don't have `node:fs`; app code
  must be bundled ahead-of-time. Needs: a build step that inlines
  `app/**/*.js` into the handler. **Not shipped in v1.**
- Compression: uses `node:zlib`. On edge use `CompressionStream` (web-std).
  We'd need to detect the runtime and swap. **Not shipped in v1.**
- Chokidar file watching: dev-only, Node-only. Edge is prod-deploy only anyway.

Realistic path to edge today: deploy a Node server to a compute platform
that runs Node (Fly, Render, Cloud Run). True edge (Workers) requires the
missing build step above.

## Testing — `webjs test`

webjs ships an opinionated testing setup. When you scaffold an app with
`webjs create`, it comes with example test files ready to run.

### Unit tests — `test/unit/*.test.{ts,js}`

```sh
webjs test              # runs all unit tests
```

Use `node:test` and `node:assert/strict`. Test server actions, components
(via `renderToString`), and utility functions.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, renderToString } from 'webjs';

test('component renders heading', async () => {
  const result = await renderToString(html`<h1>Hello</h1>`);
  assert.ok(result.includes('Hello'));
});
```

### Browser tests — `test/browser/*.test.js`

```sh
webjs test --browser        # browser tests only (WTR + Playwright)
```

Browser tests run in real Chromium via Web Test Runner (WTR) + Playwright.
Full Shadow DOM, events, adoptedStyleSheets, IntersectionObserver — everything
works because it's a real browser, not a fake DOM.

### Convention: always write tests

**AI agents: when implementing any feature, you MUST also write:**
1. Unit tests for server actions, queries, and component rendering
2. E2E tests for user-facing features (navigation, forms, auth flows)

This is not optional. The `webjs check` command flags modules without tests.

### Convention validation — `webjs check`

```sh
webjs check             # validate app against conventions
webjs check --rules     # list all rules
```

Checks for: actions in modules, one-function-per-action, components have
`.register()`, no server imports in client code, tests exist for modules,
tag names have hyphens. Override any rule in `package.json`:

```json
{ "webjs": { "conventions": { "tests-exist": false } } }
```

### Scaffolding — `webjs create`

```sh
webjs create my-app
```

Generates an opinionated project with:
- `app/` with root layout + page
- `modules/` skeleton
- `components/` with theme toggle
- `test/unit/` and `test/e2e/` with example tests
- `CONVENTIONS.md` — editable project conventions (AI agents read this)
- `AGENTS.md` — full framework API reference
- `CLAUDE.md` — quick reminders for Claude

### CONVENTIONS.md — overridable project conventions

Every webjs app has a `CONVENTIONS.md` at its root. AI agents MUST read
it before writing code. It defines:

- Module architecture (where actions, queries, components go)
- Testing rules (when unit vs E2E tests are required)
- Component patterns (shadow DOM, register, styles)
- Server action patterns (one per file, ActionResult envelope)
- Code style (TS extensions, const/let, async/await)

Users can edit any section. Sections marked `<!-- OVERRIDE -->` are the
customization points. The `webjs check` command reads both the built-in
rules and any overrides.

---

## Deliberately deferred

These features are *explicitly not* in v1 and agents should not try to
implement them as part of other tasks without a separate design pass:

- **Per-route code splitting.** `webjs build` produces one bundle for the
  whole app. Splitting per route would need a dependency graph analysis
  pass and router-coordinated preload hints.
- **Vite-grade HMR with state preservation.** Web components can only be
  registered once (`customElements.define` throws on redefinition), so true
  component HMR requires either scoped registries (not widely supported) or
  tag-name versioning (invasive). We do full-page reload instead. Data
  reloads are near-instant via chokidar → SSE.
- **React Server Components Flight protocol.** Our server actions already
  cover "call a server function from the client"; Flight is React's specific
  wire format for serializing server-rendered component trees. Re-implementing
  it would fight our web-components model and duplicate years of React work.
  Use `Suspense` + streaming for progressive rendering instead.
- **Edge-runtime bundling / full portability.** See above.
- **i18n, image optimisation.** Outside the scope of the core framework;
  layer libraries on top.
