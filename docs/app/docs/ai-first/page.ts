import { html } from 'webjs';

export const metadata = { title: 'AI-First Development — webjs' };

export default function AIFirst() {
  return html`
    <h1>AI-First Development</h1>
    <p>webjs is designed from the ground up to be <strong>the framework AI agents can read, write, and ship</strong>. Every architectural decision — from the file layout to the naming conventions to the one-function-per-file rule — was made with one question in mind: <em>can an LLM understand this without loading the entire codebase into context?</em></p>

    <h2>Why AI-First Matters</h2>
    <p>Modern AI coding assistants (Claude Code, GitHub Copilot, Cursor, Windsurf, etc.) are increasingly writing production code. But most frameworks were designed for humans who hold the whole project in their head. They rely on:</p>
    <ul>
      <li><strong>Implicit conventions</strong> — "you just know" where to put things.</li>
      <li><strong>Barrel files</strong> — re-exports that hide the real location of code.</li>
      <li><strong>Magic config</strong> — next.config.js, vite.config.ts, webpack aliases.</li>
      <li><strong>Build-time transforms</strong> — what the source says isn't what runs.</li>
      <li><strong>Scattered state</strong> — a single feature touches 5 files across 3 directories with no discoverable link.</li>
    </ul>
    <p>These work fine for experienced developers who've memorised the conventions. They're hostile to AI agents that need to discover structure from the files themselves.</p>

    <h2>How webjs Solves This</h2>

    <h3>1. AGENTS.md — The Machine-Readable Contract</h3>
    <p>Every webjs app has an <code>AGENTS.md</code> at the root. This is a structured document that AI agents read before touching any code. It contains:</p>
    <ul>
      <li><strong>File conventions table</strong> — which filename means what (page.ts, route.ts, middleware.ts, .server.ts, etc.).</li>
      <li><strong>Public API surface</strong> — every exported function from <code>webjs</code> and <code>@webjs/server</code> with a one-line description.</li>
      <li><strong>Invariants</strong> — rules that must never be broken ("never import @prisma/client from a component", "event holes must be unquoted").</li>
      <li><strong>Recipes</strong> — step-by-step instructions for "add a page", "add a server action", "add a component", "add a DB model".</li>
      <li><strong>What's deliberately deferred</strong> — so agents don't try to implement features that aren't supported yet.</li>
    </ul>
    <p>An AI agent reads AGENTS.md once and knows: the shape of the app, what's safe to change, what's not, and how to add any feature. No guessing.</p>

    <h3>2. Predictable File Layout</h3>
    <pre>app/
  page.ts              → always the page component for this URL
  layout.ts            → always the wrapping layout
  route.ts             → always the HTTP handler
  middleware.ts         → always the request interceptor
  error.ts             → always the error boundary
  not-found.ts         → always the 404 page
modules/
  &lt;feature&gt;/
    actions/           → mutations, one file per function
    queries/           → reads, one file per function
    components/        → feature-owned UI
    utils/             → pure helpers
    types.ts           → shared type definitions</pre>
    <p>Every file has one job. An AI agent looking for "the function that creates a post" searches <code>modules/posts/actions/</code> — not a 500-line utils.ts or a re-exported barrel index. One grep, one result.</p>

    <h3>3. One Function Per File</h3>
    <p>Server actions and queries follow a strict <strong>one exported function per file</strong> convention:</p>
    <pre>modules/posts/actions/create-post.server.ts   → exports createPost()
modules/posts/actions/delete-post.server.ts   → exports deletePost()
modules/posts/queries/list-posts.server.ts    → exports listPosts()
modules/posts/queries/get-post.server.ts      → exports getPost()</pre>
    <p>This is the single most AI-friendly decision in the architecture. When an LLM needs to modify <code>createPost</code>, it reads exactly one file. It doesn't need to understand the rest of the module. Context window usage is minimal. The blast radius of a change is visible from the filename.</p>

    <h3>4. No Build Step = What You See Is What Runs</h3>
    <p>Frameworks with build pipelines transform source code before it executes. The JSX you write becomes <code>React.createElement</code> calls. Your imports become webpack chunks. Your CSS modules get hashed classnames. An AI agent reading the source sees one thing; the runtime does another.</p>
    <p>webjs has <strong>no build step</strong>. The <code>.ts</code> file you see is the file that runs (Node strips types; the dev server strips types for the browser). There's no intermediate representation, no generated code, no output directory. An AI agent can reason about what the code does by reading the file — because the file IS what runs.</p>

    <h3>5. Explicit Server Boundary</h3>
    <p>The <code>.server.ts</code> extension is a visible, greppable marker that says "this code runs only on the server." An AI agent never accidentally puts a database call in a component — the naming convention prevents it. And the framework enforces it: <code>.server.ts</code> files are rewritten to RPC stubs for the browser.</p>
    <p>Compare with NextJs where <code>'use client'</code> / <code>'use server'</code> directives are easy to forget and their scope rules are subtle. The <code>.server.ts</code> convention is filename-level — you can't accidentally import server code without the filename literally telling you.</p>

    <h3>6. Typed RPC Without Schema</h3>
    <p>When an AI agent writes a server action:</p>
    <pre>// modules/posts/actions/create-post.server.ts
export async function createPost(
  input: { title: string; body: string }
): Promise&lt;ActionResult&lt;PostFormatted&gt;&gt; { ... }</pre>
    <p>The TypeScript signature IS the API contract. No separate schema file, no OpenAPI spec, no GraphQL SDL. The client component imports the function, TypeScript checks the types, and superjson preserves them on the wire. An AI agent can:</p>
    <ol>
      <li>Read the function signature to understand the API.</li>
      <li>Modify the function and know every call site that breaks (via tsc).</li>
      <li>Add a new action by copying the pattern from an existing one.</li>
    </ol>
    <p>Zero indirection. Zero codegen. Zero schema drift.</p>

    <h3>7. JSDoc or TypeScript — Agent's Choice</h3>
    <p>Some AI agents work better with TypeScript; others prefer JSDoc. webjs supports both equally. The type-checking story is identical either way — the TS language server reads both. An agent can generate whichever format it's more fluent in.</p>

    <h3>8. Cross-Agent Config Files</h3>
    <p><code>webjs create</code> scaffolds guardrail config files for every major AI coding agent:</p>
    <ul>
      <li><code>CLAUDE.md</code> + <code>.claude/settings.json</code> + hooks — Claude Code</li>
      <li><code>.cursorrules</code> — Cursor</li>
      <li><code>.windsurfrules</code> — Windsurf</li>
      <li><code>.github/copilot-instructions.md</code> — GitHub Copilot</li>
      <li><code>AGENTS.md</code> + <code>CONVENTIONS.md</code> — all agents</li>
    </ul>
    <p>Every agent gets the same rules: check the branch before coding, sync with parent before starting, auto-generate tests, auto-update docs, ask before merging (with delete/keep prompt), no AI attribution in commits.</p>

    <h3>9. Autonomous Mode</h3>
    <p>In sandbox or bypass-permissions mode, agents auto-decide using best-practice defaults: create feature branches, rebase before starting, fix failing tests, generate meaningful commits, delete feature branches after merge. Same quality bar — no blocking on questions.</p>

    <h3>10. Automatic Tests and Docs</h3>
    <p>In a webjs project, the user never has to say "also write tests" or "also update the docs." Agents do this automatically with every code change. The convention is enforced via <code>CONVENTIONS.md</code>, <code>webjs test</code>, and <code>webjs check</code>.</p>

    <h2>What an AI Agent Can Do with webjs</h2>
    <p>Given a webjs app + AGENTS.md, an AI coding assistant can:</p>
    <ul>
      <li><strong>Add a new page</strong> — create <code>app/about/page.ts</code>, export a function returning <code>html\`...\`</code>. Done. No router config.</li>
      <li><strong>Add a new API endpoint</strong> — create <code>app/api/users/route.ts</code>, export <code>GET</code> / <code>POST</code>. Done. No Express boilerplate.</li>
      <li><strong>Add a server action</strong> — create <code>modules/foo/actions/bar.server.ts</code>, export an async function. Import it from a component. Done. No tRPC setup.</li>
      <li><strong>Add a component</strong> — create a file, extend <code>WebComponent</code>, set <code>static tag</code>, implement <code>render()</code>, call <code>register()</code>. Done. No framework CLI scaffolding.</li>
      <li><strong>Add authentication</strong> — follow the recipe in AGENTS.md. Create lib/session.ts, modules/auth/*, middleware.ts. The pattern is documented step by step.</li>
      <li><strong>Add a database model</strong> — edit <code>prisma/schema.prisma</code>, run <code>webjs db migrate</code>. Create queries + actions in a new module. Done.</li>
      <li><strong>Debug an issue</strong> — read the failing route file, trace imports, find the action, check types. No build-artifact archaeology.</li>
    </ul>

    <h2>Design Principles for AI-Friendly Code</h2>
    <p>If you're writing a webjs app that AI agents will work on (and they will), follow these principles:</p>
    <ol>
      <li><strong>One function per file</strong> for actions and queries. Name the file after the function.</li>
      <li><strong>Type everything.</strong> Function signatures are the API contract. An untyped function is invisible to the agent's reasoning.</li>
      <li><strong>Keep routes thin.</strong> Business logic goes in modules. Routes are 5-line adapters that call a module function and return a Response.</li>
      <li><strong>Use the modules convention.</strong> <code>modules/feature/{actions,queries,components,utils,types.ts}</code>. An agent knows where to look and where to put things.</li>
      <li><strong>Keep AGENTS.md up to date.</strong> When you add a new convention, document it. When you add a new module, add a recipe. The agent reads this file on every session.</li>
      <li><strong>No barrel files.</strong> Import from the specific file, not from an <code>index.ts</code> that re-exports. Agents work with individual files, not module graphs.</li>
      <li><strong>No magic.</strong> If something happens implicitly (auto-registration, runtime transforms, generated code), document it explicitly in AGENTS.md. What the agent can't see, it can't reason about.</li>
    </ol>

    <h2>Comparison: AI-Friendliness</h2>
    <blockquote>This is an opinionated comparison. Every framework has trade-offs.</blockquote>
    <pre>                       webjs        NextJs       Express
──────────────────────────────────────────────────────────
AGENTS.md contract     ✅ built-in   ❌ none       ❌ none
Cross-agent configs    ✅ 5 agents   ❌ none       ❌ none
Auto tests + docs      ✅ enforced   ❌ manual     ❌ manual
Branch guardrails      ✅ hooks      ❌ none       ❌ none
Convention validator   ✅ webjs check ❌ none      ❌ none
File = function        ✅ one/file   ⚠️ varies     ❌ free-form
No build transforms    ✅ none       ❌ SWC/webpack ✅ none
Explicit server bound. ✅ .server.ts ⚠️ 'use srv'  n/a
Typed RPC (no schema)  ✅ superjson  ⚠️ Flight     ❌ manual
Autonomous mode        ✅ defaults   ❌ n/a        ❌ n/a</pre>

    <h2>The AGENTS.md File</h2>
    <p>Here's what a webjs app's <code>AGENTS.md</code> contains (the blog example ships a complete one):</p>
    <pre>## What webjs is
## App layout (file conventions table)
## Public API — webjs
## Public API — @webjs/server
## Modules architecture
## File conventions — detail (pages, layouts, routes, actions, components)
## Invariants (rules agents must follow)
## Recipes (step-by-step: add a page, add an action, add a component...)
## Security checklist for expose()
## Advanced features (Suspense, bundling, rate limiting, WebSockets...)
## Runtime targets (Node, embedded, edge)
## Deliberately deferred (what NOT to implement)</pre>
    <p>You can read the full <a href="https://github.com/vivek7405/webjs/blob/main/AGENTS.md">AGENTS.md on GitHub</a>.</p>
  `;
}
