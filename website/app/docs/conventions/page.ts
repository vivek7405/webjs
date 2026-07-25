import { html } from '@webjsdev/core';

export const metadata = { title: 'Conventions & AI Workflow | WebJs' };

export default function Conventions() {
  return html`
    <h1>Conventions &amp; AI Workflow</h1>
    <p>WebJs is an <strong>AI-first framework</strong>. It ships an opinionated conventions system that both humans and AI agents follow. The conventions are enforced via config files, CLI commands, and guardrails that ensure consistent, high-quality code across the entire project, whether written by a person or an agent.</p>

    <h2>Where the conventions live</h2>
    <p>The project conventions ship as prose in the cross-agent skill, <code>.agents/skills/webjs/SKILL.md</code> (a routing skill), plus the git, test, and review workflow rules in <code>.agents/rules/workflow.md</code>. There is no separate <code>CONVENTIONS.md</code> file. All AI agents read the skill and <code>AGENTS.md</code> before writing code. The conventions define:</p>

    <ul>
      <li><strong>Module architecture</strong>: where actions, queries, and components go.</li>
      <li><strong>Testing rules</strong>: when unit vs E2E tests are required.</li>
      <li><strong>Component patterns</strong>: light DOM by default with Tailwind, shadow DOM opt-in, <code>Class.register('tag')</code>, and the class-prefix rule for light-DOM custom CSS.</li>
      <li><strong>Styling convention</strong>: a static compiled Tailwind stylesheet (<code>css:build</code>) + <code>@theme</code> tokens, JS helpers in <code>lib/utils/ui.ts</code> to dedupe repeated class bundles, no <code>@apply</code>.</li>
      <li><strong>Server action patterns</strong>: one function per file, <code>ActionResult</code> envelope.</li>
      <li><strong>Code style</strong>: TypeScript extensions, const/let preferences, async/await patterns.</li>
    </ul>

    <h3>How to Override Architectural Conventions</h3>
    <p>The conventions are prose, so you customize them by editing the skill (<code>.agents/skills/webjs/SKILL.md</code>) or the workflow rules (<code>.agents/rules/workflow.md</code>) to match your team's preferences. For example, if you prefer shadow DOM components by default (the scaffold defaults to light DOM + Tailwind), state that in the component-patterns section:</p>

    <pre># Component patterns

- Opt in to shadow DOM (static shadow = true) for every component
- Author styles via static styles = css\`...\`
- Always call register()</pre>

    <p>AI agents read the skill and <code>AGENTS.md</code> before every task and follow them. Together they are the source of truth for <em>project conventions</em>: how code is organized, named, and tested. These are preferences you can change, so they are guidance, not a hard gate.</p>

    <h2>webjs check: correctness, not conventions</h2>
    <p>The <code>webjs check</code> command is a <strong>separate tool</strong> from the conventions. It runs only <strong>correctness checks</strong>: rules that catch objectively broken code, such as a browser global in <code>render()</code> that crashes SSR, a non-public <code>process.env</code> read that leaks a secret, a reactive prop that silently breaks reactivity, a server-only <code>.server.ts</code> import reaching a page that ships to the browser (a runtime crash the elision verdict lets the check catch statically), a <code>'use server'</code> file that exports no callable action (so a client import resolves to nothing and the call 404s), or non-erasable TypeScript that fails the type-strip. Every rule always runs.</p>

    <h3>The dividing line</h3>
    <p>One test decides where something belongs: <em>could a sensible app legitimately want this to pass?</em> If yes, it is a convention (it lives in the skill and <code>AGENTS.md</code> as guidance). If no, it is a check (it lives in <code>webjs check</code> and always runs). That is why checks are not overridable, they catch real breakage, and conventions are not enforced by a tool, they are judgment.</p>

    <pre># Validate the project (correctness only)
webjs check

# List the correctness checks and their descriptions
webjs check --rules</pre>

    <h3>Workflow for AI agents</h3>
    <ol>
      <li>Read the skill (<code>.agents/skills/webjs/SKILL.md</code>) and <code>AGENTS.md</code> for the project conventions and follow them by judgment.</li>
      <li>Run <code>webjs check</code> and fix every violation: they are correctness bugs, not style.</li>
      <li>To change a convention, edit the prose in the skill or <code>.agents/rules/workflow.md</code>. There is no <code>package.json</code> switch and nothing to toggle.</li>
      <li>Run <code>webjs check</code> before every commit. AI agents run it automatically as part of their workflow.</li>
    </ol>

    <h2>webjs test</h2>
    <p>WebJs ships a testing setup based on <code>node:test</code> and WTR + Playwright.</p>

    <h3>Unit Tests</h3>
    <pre># Run all unit tests
webjs test

# Test files live in test/unit/*.test.{ts,js}</pre>

    <p>Unit tests use <code>node:test</code> and <code>node:assert/strict</code>. Test server actions (via direct import), component rendering (via <code>renderToString</code>), and utility functions:</p>

    <pre>import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html } from '@webjsdev/core';
import { renderToString } from '@webjsdev/core/server';

test('renders heading', async () =&gt; {
  const result = await renderToString(html\`&lt;h1&gt;Hello&lt;/h1&gt;\`);
  assert.ok(result.includes('Hello'));
});

test('action validates input', async () =&gt; {
  const result = await createPost({ title: '', body: '' });
  assert.equal(result.success, false);
  assert.equal(result.status, 400);
});</pre>

    <h3>E2E Tests</h3>
    <pre># Run unit + E2E tests
webjs test --e2e

# Test files live in test/browser/*.test.{ts,js}</pre>

    <p>E2E tests use WTR + Playwright to launch a real browser and test complete user flows: navigation, form submission, auth, and live interactions.</p>

    <h3>Convention: Always Write Tests</h3>
    <p>When implementing any feature, tests are mandatory:</p>
    <ul>
      <li><strong>Unit tests</strong> for server actions, queries, and component rendering.</li>
      <li><strong>E2E tests</strong> for user-facing features (navigation, forms, auth flows).</li>
    </ul>
    <p>Tests-per-feature is a project convention (guidance), not a <code>webjs check</code> rule.</p>

    <h2>AI Agent Guardrails</h2>
    <p>WebJs enforces disciplined AI workflows through config files and hooks. These guardrails apply to all agents: Claude, Cursor, Copilot, Antigravity, and others.</p>

    <h3>Branch Checking</h3>
    <p>AI agents must never commit directly to <code>main</code> or <code>master</code>. Before any edit, the agent checks what branch it is on:</p>
    <ul>
      <li>If on <code>main</code>: stop immediately and create a feature branch.</li>
      <li>If on a feature branch: verify it matches the current task.</li>
      <li>Before starting work: sync with the parent branch (<code>git fetch origin &amp;&amp; git rebase origin/main</code>).</li>
    </ul>
    <p>The Claude Code hook (<code>.claude/hooks/guard-branch-context.sh</code>) enforces this programmatically by intercepting Edit/Write calls when on main.</p>

    <h3>Merge Approval</h3>
    <p>Agents never merge without explicit user permission. Before any merge, the agent asks:</p>
    <pre>Ready to merge &lt;branch&gt; into &lt;target&gt;?
After merging, should &lt;branch&gt; be deleted or kept?</pre>
    <p>The agent waits for approval before proceeding.</p>

    <h3>Automatic Tests &amp; Docs</h3>
    <p>Every code change includes the following, automatically, without the user asking:</p>
    <ol>
      <li><strong>Tests</strong>: unit tests for logic, E2E tests for user-facing behavior.</li>
      <li><strong>Documentation</strong>: updates to <code>AGENTS.md</code> for API changes, the skill (<code>.agents/skills/webjs/SKILL.md</code>) for convention changes, and <code>docs/</code> for user-facing features.</li>
      <li><strong>Convention validation</strong>: <code>webjs check</code> runs and violations are fixed.</li>
    </ol>
    <p>The user should never have to say "also write tests" or "also update the docs." That is the default behavior in a WebJs project.</p>

    <h2>Agent Config Files</h2>
    <p>When you scaffold a project with <code>webjs create</code>, it generates config files for every major AI coding agent:</p>

    <table>
      <thead>
        <tr><th>File</th><th>Agent</th><th>Purpose</th></tr>
      </thead>
      <tbody>
        <tr><td><code>AGENTS.md</code></td><td>All agents (Cursor, opencode, Antigravity, Copilot coding agent read it natively)</td><td>Framework API, conventions, recipes (the source of truth)</td></tr>
        <tr><td><code>.agents/skills/webjs/SKILL.md</code></td><td>All agents</td><td>The shipped routing skill carrying the framework context and project conventions (guidance, customizable in the prose)</td></tr>
        <tr><td><code>.agents/rules/workflow.md</code></td><td>All agents</td><td>Git, test, and review workflow rules</td></tr>
        <tr><td><code>CLAUDE.md</code></td><td>Claude Code</td><td>Thin bridge pointing at AGENTS.md</td></tr>
        <tr><td><code>GEMINI.md</code></td><td>Gemini CLI</td><td>Thin bridge pointing at AGENTS.md</td></tr>
        <tr><td><code>.claude/settings.json</code></td><td>Claude Code</td><td>PreToolUse hook guarding git merge/push to main</td></tr>
        <tr><td><code>.github/copilot-instructions.md</code></td><td>Copilot in VS Code</td><td>Thin bridge pointing at AGENTS.md</td></tr>
        <tr><td><code>.github/pull_request_template.md</code></td><td>All (via GitHub)</td><td>PR checklist: tests, docs, convention check</td></tr>
        <tr><td><code>.editorconfig</code></td><td>All editors</td><td>Consistent indent/encoding/line endings</td></tr>
      </tbody>
    </table>

    <p>All config files encode the same rules: the framework conventions, git workflow, and quality expectations. Each is formatted for its target agent's native config format.</p>

    <h2>Autonomous Mode</h2>
    <p>When an agent runs in sandbox or bypass-permissions mode, it follows these defaults instead of asking questions:</p>

    <table>
      <thead>
        <tr><th>Decision</th><th>Autonomous Default</th></tr>
      </thead>
      <tbody>
        <tr><td>On <code>main</code>, need a branch</td><td>Auto-create <code>feature/&lt;task-slug&gt;</code></td></tr>
        <tr><td>Parent branch has new commits</td><td>Auto-rebase before starting</td></tr>
        <tr><td>Ready to merge</td><td>Auto-merge (no prompt)</td></tr>
        <tr><td>Delete branch after merge?</td><td>Delete feature/fix branches, keep long-lived branches</td></tr>
        <tr><td>Commit message</td><td>Auto-generate meaningful message</td></tr>
        <tr><td>Tests failing</td><td>Fix them, don't ask</td></tr>
        <tr><td>Convention violations</td><td>Fix them, don't ask</td></tr>
      </tbody>
    </table>

    <p>The principle: in autonomous mode, the agent is <em>more</em> disciplined, not less. It follows every rule but makes decisions instead of blocking on questions.</p>

    <h2>webjs create</h2>
    <p>The scaffolding command generates a complete project with all conventions, config files, and example tests pre-configured:</p>

    <pre>npm i -g webjsdev
webjs create my-app
cd my-app && npm run dev</pre>

    <p>This generates:</p>
    <ul>
      <li><code>app/</code> with root layout + page</li>
      <li><code>modules/</code> skeleton for feature-scoped code</li>
      <li><code>components/</code> with a theme toggle component</li>
      <li><code>db/schema.server.ts</code>: the Drizzle schema, SQLite by default, example <code>User</code> model. <code>db/connection.server.ts</code> exports the <code>db</code> connection.</li>
      <li><code>test/unit/</code> and <code>test/browser/</code> with example tests</li>
      <li><code>.agents/skills/webjs/SKILL.md</code>: the shipped routing skill with the framework context and editable project conventions</li>
      <li><code>.agents/rules/workflow.md</code>: git, test, and review workflow rules</li>
      <li><code>AGENTS.md</code>: full framework API reference</li>
      <li>Thin bridges pointing at AGENTS.md (<code>CLAUDE.md</code>, <code>GEMINI.md</code>, <code>.github/copilot-instructions.md</code>)</li>
      <li><code>.editorconfig</code> for consistent formatting</li>
      <li><code>package.json</code> with scripts (<code>dev</code>, <code>build</code>, <code>start</code>, <code>test</code>, <code>check</code>, <code>db:migrate</code>, <code>db:generate</code>, <code>db:studio</code>)</li>
    </ul>

    <p>Every file is ready to use immediately. The project works out of the box with <code>webjs dev</code>, and every AI agent that opens the project will automatically read the config files and follow the conventions.</p>

    <h2>The Complete Workflow</h2>
    <p>When a user tells an AI agent "add a contact page" in a WebJs project, the agent automatically delivers:</p>

    <pre>app/contact/page.ts                           # the page
modules/contact/actions/send-message.server.ts # the server action
modules/contact/types.ts                       # type definitions
test/unit/contact.test.ts                      # unit test for the action
test/browser/contact.test.ts                       # E2E test for the form flow
AGENTS.md                                      # updated if new API/conventions
docs/app/docs/contact/page.ts                  # doc page (if docs/ exists)</pre>

    <p>Plus: a git commit with a meaningful message, passing tests, and valid conventions. The user never has to ask for tests, docs, or a commit. That is the default behavior.</p>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/getting-started">Getting Started</a>: quick start guide</li>
      <li><a href="/docs/architecture">Architecture</a>: app layout, modules, and file conventions</li>
      <li><a href="/docs/testing">Testing</a>: detailed testing guide</li>
    </ul>
  `;
}
