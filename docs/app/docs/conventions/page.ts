import { html } from 'webjs';

export const metadata = { title: 'Conventions & AI Workflow — webjs' };

export default function Conventions() {
  return html`
    <h1>Conventions &amp; AI Workflow</h1>
    <p>webjs is an <strong>AI-first framework</strong>. It ships an opinionated conventions system that both humans and AI agents follow. The conventions are enforced via config files, CLI commands, and guardrails that ensure consistent, high-quality code across the entire project — whether written by a person or an agent.</p>

    <h2>CONVENTIONS.md</h2>
    <p>Every webjs app has a <code>CONVENTIONS.md</code> file at its root. This is the project-specific conventions document that all AI agents read before writing code. It defines:</p>

    <ul>
      <li><strong>Module architecture</strong> — where actions, queries, and components go.</li>
      <li><strong>Testing rules</strong> — when unit vs E2E tests are required.</li>
      <li><strong>Component patterns</strong> — light DOM by default with Tailwind; shadow DOM opt-in; <code>Class.register('tag')</code>; the class-prefix rule for light-DOM custom CSS.</li>
      <li><strong>Styling convention</strong> — Tailwind browser runtime + <code>@theme</code> tokens; JS helpers in <code>app/_utils/ui.ts</code> to dedupe repeated class bundles; no <code>@apply</code>.</li>
      <li><strong>Server action patterns</strong> — one function per file, <code>ActionResult</code> envelope.</li>
      <li><strong>Code style</strong> — TypeScript extensions, const/let preferences, async/await patterns.</li>
    </ul>

    <h3>How to Override</h3>
    <p>Sections in <code>CONVENTIONS.md</code> marked with <code>&lt;!-- OVERRIDE --&gt;</code> are customization points. Edit these to match your team's preferences. For example, if you prefer shadow DOM components by default (the scaffold defaults to light DOM + Tailwind):</p>

    <pre># Component patterns  &lt;!-- OVERRIDE --&gt;

- Opt in to shadow DOM (static shadow = true) for every component
- Author styles via static styles = css`...`
- Always call register()</pre>

    <p>AI agents read <code>CONVENTIONS.md</code> before every task and follow the overrides. You can also disable specific convention rules in <code>package.json</code>:</p>

    <pre>{
  "webjs": {
    "conventions": {
      "tests-exist": false,
      "one-function-per-action": true
    }
  }
}</pre>

    <h2>webjs check</h2>
    <p>The <code>webjs check</code> command validates your app against the conventions. It checks for common mistakes and enforces project structure rules.</p>

    <pre># Validate the entire app
webjs check

# List all available rules
webjs check --rules</pre>

    <p>What <code>webjs check</code> validates:</p>
    <ul>
      <li><strong>Actions in modules</strong> — server actions live under <code>modules/&lt;feature&gt;/actions/</code>, not scattered in random directories.</li>
      <li><strong>One function per action</strong> — each <code>.server.ts</code> file exports a single named async function.</li>
      <li><strong>Components have register()</strong> — every component class calls <code>Class.register('tag')</code> at module top level.</li>
      <li><strong>No server imports in client code</strong> — <code>@prisma/client</code>, <code>node:*</code>, and other server-only modules are not imported from components or pages.</li>
      <li><strong>Tests exist for modules</strong> — every module under <code>modules/</code> has corresponding test files.</li>
      <li><strong>Tag names have hyphens</strong> — custom element tags contain at least one hyphen (HTML spec requirement).</li>
    </ul>

    <p>Run <code>webjs check</code> before every commit. AI agents run it automatically as part of their workflow.</p>

    <h2>webjs test</h2>
    <p>webjs ships a testing setup based on <code>node:test</code> and WTR + Playwright.</p>

    <h3>Unit Tests</h3>
    <pre># Run all unit tests
webjs test

# Test files live in test/unit/*.test.{ts,js}</pre>

    <p>Unit tests use <code>node:test</code> and <code>node:assert/strict</code>. Test server actions (via direct import), component rendering (via <code>renderToString</code>), and utility functions:</p>

    <pre>import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, renderToString } from 'webjs';

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

    <p>E2E tests use WTR + Playwright to launch a real browser and test complete user flows — navigation, form submission, auth, and live interactions.</p>

    <h3>Convention: Always Write Tests</h3>
    <p>When implementing any feature, tests are mandatory:</p>
    <ul>
      <li><strong>Unit tests</strong> for server actions, queries, and component rendering.</li>
      <li><strong>E2E tests</strong> for user-facing features (navigation, forms, auth flows).</li>
    </ul>
    <p>The <code>webjs check</code> command flags modules without tests.</p>

    <h2>AI Agent Guardrails</h2>
    <p>webjs enforces disciplined AI workflows through config files and hooks. These guardrails apply to all agents — Claude, Cursor, Copilot, Windsurf, and others.</p>

    <h3>Branch Checking</h3>
    <p>AI agents must never commit directly to <code>main</code> or <code>master</code>. Before any edit, the agent checks what branch it is on:</p>
    <ul>
      <li>If on <code>main</code> — stop immediately and create a feature branch.</li>
      <li>If on a feature branch — verify it matches the current task.</li>
      <li>Before starting work — sync with the parent branch (<code>git fetch origin &amp;&amp; git rebase origin/main</code>).</li>
    </ul>
    <p>The Claude Code hook (<code>.claude/hooks/guard-branch-context.sh</code>) enforces this programmatically by intercepting Edit/Write calls when on main.</p>

    <h3>Merge Approval</h3>
    <p>Agents never merge without explicit user permission. Before any merge, the agent asks:</p>
    <pre>Ready to merge &lt;branch&gt; into &lt;target&gt;?
After merging, should &lt;branch&gt; be deleted or kept?</pre>
    <p>The agent waits for approval before proceeding.</p>

    <h3>Automatic Tests &amp; Docs</h3>
    <p>Every code change includes — automatically, without the user asking:</p>
    <ol>
      <li><strong>Tests</strong> — unit tests for logic, E2E tests for user-facing behavior.</li>
      <li><strong>Documentation</strong> — updates to <code>AGENTS.md</code> for API changes, <code>CONVENTIONS.md</code> for convention changes, and <code>docs/</code> for user-facing features.</li>
      <li><strong>Convention validation</strong> — <code>webjs check</code> runs and violations are fixed.</li>
    </ol>
    <p>The user should never have to say "also write tests" or "also update the docs." That is the default behavior in a webjs project.</p>

    <h2>Agent Config Files</h2>
    <p>When you scaffold a project with <code>webjs create</code>, it generates config files for every major AI coding agent:</p>

    <table>
      <thead>
        <tr><th>File</th><th>Agent</th><th>Purpose</th></tr>
      </thead>
      <tbody>
        <tr><td><code>AGENTS.md</code></td><td>All agents</td><td>Framework API, conventions, recipes (the source of truth)</td></tr>
        <tr><td><code>CONVENTIONS.md</code></td><td>All agents</td><td>Project-specific overridable conventions</td></tr>
        <tr><td><code>CLAUDE.md</code></td><td>Claude Code</td><td>Points to AGENTS.md + CONVENTIONS.md</td></tr>
        <tr><td><code>.claude/settings.json</code></td><td>Claude Code</td><td>PreToolUse hook guarding git merge/push to main</td></tr>
        <tr><td><code>.cursorrules</code></td><td>Cursor</td><td>Workflow rules, git rules, framework patterns</td></tr>
        <tr><td><code>.windsurfrules</code></td><td>Windsurf</td><td>Same rules in Windsurf format</td></tr>
        <tr><td><code>.github/copilot-instructions.md</code></td><td>GitHub Copilot</td><td>Same rules in Copilot format</td></tr>
        <tr><td><code>.github/pull_request_template.md</code></td><td>All (via GitHub)</td><td>PR checklist: tests, docs, convention check</td></tr>
        <tr><td><code>.editorconfig</code></td><td>All editors</td><td>Consistent indent/encoding/line endings</td></tr>
      </tbody>
    </table>

    <p>All config files encode the same rules — the framework conventions, git workflow, and quality expectations. Each is formatted for its target agent's native config format.</p>

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

    <pre>webjs create my-app</pre>

    <p>This generates:</p>
    <ul>
      <li><code>app/</code> with root layout + page</li>
      <li><code>modules/</code> skeleton for feature-scoped code</li>
      <li><code>components/</code> with a theme toggle component</li>
      <li><code>test/unit/</code> and <code>test/browser/</code> with example tests</li>
      <li><code>CONVENTIONS.md</code> — editable project conventions</li>
      <li><code>AGENTS.md</code> — full framework API reference</li>
      <li><code>CLAUDE.md</code> — quick reminders for Claude Code</li>
      <li>Agent config files (<code>.cursorrules</code>, <code>.windsurfrules</code>, <code>.github/copilot-instructions.md</code>)</li>
      <li><code>.editorconfig</code> for consistent formatting</li>
      <li><code>package.json</code> with scripts and webjs conventions config</li>
    </ul>

    <p>Every file is ready to use immediately. The project works out of the box with <code>webjs dev</code>, and every AI agent that opens the project will automatically read the config files and follow the conventions.</p>

    <h2>The Complete Workflow</h2>
    <p>When a user tells an AI agent "add a contact page" in a webjs project, the agent automatically delivers:</p>

    <pre>app/contact/page.ts                           # the page
modules/contact/actions/send-message.server.ts # the server action
modules/contact/types.ts                       # type definitions
test/unit/contact.test.ts                      # unit test for the action
test/browser/contact.test.ts                       # E2E test for the form flow
AGENTS.md                                      # updated if new API/conventions
docs/app/docs/contact/page.ts                  # doc page (if docs/ exists)</pre>

    <p>Plus: a git commit with a meaningful message, passing tests, and valid conventions. The user never has to ask for tests, docs, or a commit — that is the default behavior.</p>

    <h2>Next Steps</h2>
    <ul>
      <li><a href="/docs/getting-started">Getting Started</a> — quick start guide</li>
      <li><a href="/docs/architecture">Architecture</a> — app layout, modules, and file conventions</li>
      <li><a href="/docs/testing">Testing</a> — detailed testing guide</li>
    </ul>
  `;
}
