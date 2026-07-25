import { html } from '@webjsdev/core';

export const metadata = { title: 'Editor Setup | WebJs' };

export default function EditorSetup() {
  return html`
    <h1>Editor Setup for VS Code &amp; Neovim</h1>
    <p>WebJs ships a TypeScript overlay (<code>packages/core/index.d.ts</code> and <code>packages/core/src/component.d.ts</code>) so any editor that speaks the TypeScript Language Server (<code>tsserver</code>) gets autocomplete, hover documentation, and type-checking for the framework APIs with zero build step.</p>

    <div class="callout">
      <p><strong>VS Code, Cursor, Windsurf, VSCodium:</strong> install the <strong><code>webjs</code></strong> extension from the <a href="https://marketplace.visualstudio.com/items?itemName=webjsdev.webjs" target="_blank">VS Marketplace</a> or <a href="https://open-vsx.org/extension/webjsdev/webjs" target="_blank">Open VSX</a> (search "webjs"). It bundles the language-service plugin and registers it automatically (no <code>tsconfig.json</code> edit), and adds <code>html</code> / <code>css</code> template highlighting.</p>
      <p><strong>Neovim:</strong> install <a href="https://github.com/webjsdev/webjs.nvim" target="_blank"><code>webjsdev/webjs.nvim</code></a> via lazy.nvim (<code>{ 'webjsdev/webjs.nvim', opts = {} }</code>) for treesitter <code>html</code> / <code>css</code> / <code>svg</code> template highlighting, the <code>:WebjsCheck</code> diagnostics source, and an <code>init_options</code> helper for wiring the tsserver plugin into <code>ts_ls</code> (see the Neovim section below).</p>
      <p>The rest of this page is for wiring the plugin by hand and for understanding what it does.</p>
    </div>

    <p><strong><code>@webjsdev/intellisense</code> is editor-only, not required for the framework to run.</strong> It is <strong>standalone</strong> as of <code>@webjsdev/intellisense@0.5.0</code>: its own <code>html</code>-template parser drives all the in-template intelligence, with no Lit dependency.</p>

    <div class="callout">
      <p><strong>Two ways the intelligence reaches your editor</strong> (you can have both; <code>tsserver</code> dedupes, so there's no conflict):</p>
      <ul>
        <li><strong>From the app's <code>node_modules</code></strong>: the scaffold lists <code>{ "name": "@webjsdev/intellisense" }</code> in <code>tsconfig.json</code>, and tsserver editors load it from <code>node_modules</code> after <code>npm install</code>. This gives the intelligence with <em>no editor plugin installed</em> (VS Code with "Use Workspace Version", Neovim <code>ts_ls</code>, JetBrains). It does NOT provide template <strong>highlighting</strong> (a tsserver plugin can't).</li>
        <li><strong>From the editor plugin</strong>: the <code>webjs</code> VS Code extension and <code>webjs.nvim</code> <em>bundle</em> the plugin, so the intelligence works even <em>before <code>npm install</code></em>, and they add the template <strong>highlighting</strong> that <code>node_modules</code> can't.</li>
      </ul>
    </div>

    <p>This page covers two layers of intelligence:</p>
    <ol>
      <li><strong>Type-safe component internals</strong>: <code>this.student: Student</code> inside the class. Works out of the box once <code>tsconfig.json</code> is set up.</li>
      <li><strong>In-template intelligence</strong>: completions, diagnostics, go-to-definition, and hover for custom-element tags and bindings inside <code>html\`…\`</code> templates. Provided by <code>@webjsdev/intellisense</code>.</li>
    </ol>
    <p>There's also an optional standard-TypeScript convention for typing <code>document.querySelector('student-card')</code>, briefly covered at the end.</p>

    <h2>Prerequisites</h2>
    <ul>
      <li><strong>Node 24+</strong> for the built-in TypeScript type-stripping (<code>process.features.typescript === 'strip'</code>). The framework requires it via <code>engines</code>.</li>
      <li><strong>TypeScript 5.8+</strong> as a dev dependency (<code>npm i -D typescript</code>). Needed for the <code>erasableSyntaxOnly</code> compiler option that catches non-erasable syntax in the editor.</li>
      <li>A <code>tsconfig.json</code> in your app. The scaffold generates one.</li>
    </ul>

    <h2><code>tsconfig.json</code>: baseline</h2>
    <p>The scaffold writes this file. Manual apps should match it:</p>
    <pre>{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "erasableSyntaxOnly": true,
    "plugins": [
      { "name": "@webjsdev/intellisense" }
    ]
  }
}</pre>
    <p>Key points:</p>
    <ul>
      <li><code>moduleResolution: "NodeNext"</code>: required for the framework's <code>exports</code> map to resolve correctly.</li>
      <li><code>allowImportingTsExtensions: true</code>: lets you write <code>import { x } from './foo.ts'</code>, matching how WebJs serves them.</li>
      <li><code>noEmit: true</code>: TypeScript type-checks only. WebJs strips types at the runtime layer at import / request time (Node's built-in stripper, or <code>amaro</code> on Bun).</li>
      <li><code>erasableSyntaxOnly: true</code>: rejects non-erasable TypeScript (<code>enum</code>, <code>namespace</code> with values, parameter properties, legacy decorators). Required because Node's stripper only supports erasable TS. See the <a href="/docs/typescript">TypeScript</a> page for the erasable equivalents.</li>
      <li><code>plugins</code>: one entry. <code>@webjsdev/intellisense</code> is standalone (no separate <code>ts-lit-plugin</code> entry).</li>
    </ul>

    <h2>Layer 1: component internals (works everywhere)</h2>
    <p>Declare each property in the <code>WebComponent({ ... })</code> factory. The factory types each field for you (no <code>declare</code> line), and the <code>prop()</code> helper narrows the type when a bare constructor is not specific enough (<code>prop&lt;Student&gt;(Object)</code>):</p>
    <pre>import { WebComponent, html, prop } from '@webjsdev/core';
import type { Student } from './student-types.ts';

export class StudentCard extends WebComponent({
  student: prop&lt;Student&gt;(Object),
}) {
  render() {
    return html\`&lt;p&gt;\${this.student.name}&lt;/p&gt;\`;
  }
}
StudentCard.register('student-card');</pre>

    <p>Inside the class, <code>this.student</code> is a real <code>Student</code>. Hover, autocomplete, and type-checking all work. <code>this.requestUpdate</code>, signal helpers (<code>signal</code>, <code>computed</code>) imported from <code>@webjsdev/core</code>, and all lifecycle hooks are typed by the framework's <code>.d.ts</code> overlay.</p>

    <h3>Why the factory replaces declare</h3>
    <p>The framework installs the reactive getter/setter on <code>this</code> via <code>Object.defineProperty</code>. A plain class-field initializer (<code>student = undefined</code>) would run <em>after</em> <code>super()</code> and overwrite that accessor, which is why the old pattern needed <code>static properties</code> plus a separate <code>declare</code> line. The <code>WebComponent({ ... })</code> factory removes both: it derives the accessor type from the shape, so there is nothing to declare and no class-field initializer to clobber. Set a default via the <code>default</code> option or the constructor after <code>super()</code>.</p>

    <h2>Layer 2: in-template intelligence</h2>
    <p><code>@webjsdev/intellisense</code> parses the markup inside each <code>html\`…\`</code> template and contributes webjs-specific knowledge, all driven by the component's factory shape (the <code>WebComponent({ ... })</code> call and any <code>prop()</code> helpers):</p>
    <ul>
      <li><strong>Go-to-definition</strong>: F12 / Ctrl+Click on a WebJs tag jumps to its class; on an attribute / property / event name jumps to the class member; on a class name inside <code>html\`class="…"\`</code> jumps to the matching <code>css\`…\`</code> rule.</li>
      <li><strong>Completions</strong>: reachable custom-element tag names after <code>&lt;</code>, and binding-aware attributes: <code>.</code> offers property names, plain / <code>?</code> offer the hyphenated attribute names (<code>maxLength</code> becomes <code>max-length</code>), <code>@event</code> is permissive.</li>
      <li><strong>Diagnostics</strong>: <code>&lt;your-tag .count=\${expr}&gt;</code> assignability-checks <code>typeof expr</code> against the prop's factory-declared type (also for plain attributes; <code>@event</code> handlers must be callable). Quoted <code>@</code>/<code>.</code>/<code>?</code> bindings are flagged (the hole is dropped at SSR), as are expressionless <code>.prop</code> bindings. A custom-element tag registered more than once across the project is underlined where it is registered (SSR keeps the last registration, the browser keeps the first, so a duplicate resolves inconsistently; the <code>no-duplicate-tag</code> <code>webjs check</code> rule is the matching CI gate). Static (non-interpolated) attribute text like <code>mode="login"</code> is deliberately not checked.</li>
      <li><strong>Hover</strong>: a tag shows its component class; an attribute / property / event shows its declared type.</li>
    </ul>
    <p>There is deliberately <strong>no</strong> blanket "unknown tag / attribute" diagnostic: WebJs has no element type map, so flagging an unrecognised tag would false-positive on legitimate third-party custom elements.</p>

    <h3>Import-graph reachability</h3>
    <p>Completions and diagnostics are gated by reachability through the current file's import graph. A tag is "known here" only if the file that registers it is imported (directly or transitively) by the file you're editing. Otherwise the runtime would fail too, so the missing completion is the correct prompt to add the side-effect import. Go-to-definition is not gated, and neither is the duplicate-tag diagnostic (a collision is a runtime hazard whether or not the two files import each other, so it is checked project-wide).</p>
    <table>
      <thead><tr><th>Tag state</th><th>Completions</th><th>Value type-check</th></tr></thead>
      <tbody>
        <tr><td>Registered &amp; reachable</td><td>offered</td><td>runs</td></tr>
        <tr><td>Registered somewhere but not imported here</td><td>none</td><td>skipped</td></tr>
        <tr><td>Not registered anywhere in the program</td><td>none</td><td>skipped</td></tr>
      </tbody>
    </table>

    <h3>Install (manual)</h3>
    <pre>npm i -D typescript @webjsdev/intellisense</pre>
    <p>Then make sure the single plugin entry is in <code>tsconfig.json</code> (already in the baseline above):</p>
    <pre>{
  "compilerOptions": {
    "plugins": [{ "name": "@webjsdev/intellisense" }]
  }
}</pre>

    <h3>VS Code</h3>
    <p>Prefer the <code>webjs</code> extension (top of this page). To wire the plugin manually instead, tell VS Code to use your workspace's TypeScript so it picks up the plugin. Open any <code>.ts</code> file and:</p>
    <pre>Cmd/Ctrl+Shift+P  →  "TypeScript: Select TypeScript Version"  →  "Use Workspace Version"</pre>
    <p>Reload the window. The plugin is now active.</p>

    <h3>Neovim</h3>
    <p>Install <a href="https://github.com/webjsdev/webjs.nvim" target="_blank"><code>webjsdev/webjs.nvim</code></a> for treesitter template highlighting, <code>:WebjsCheck</code>, and <code>:checkhealth webjs</code>. It also gives you a helper to load the tsserver plugin without editing <code>tsconfig.json</code>:</p>
    <pre>require('lspconfig').ts_ls.setup({
  init_options = require('webjs').with_tsserver_plugin(),
})</pre>
    <p>Otherwise, any LSP client that speaks tsserver loads the plugin automatically from <code>tsconfig.json</code>. The key is pointing the LSP at your <strong>workspace's</strong> <code>node_modules/typescript</code> so the plugin resolves.</p>

    <h4><code>nvim-lspconfig</code></h4>
    <pre>-- lua/plugins/tsserver.lua
return {
  'neovim/nvim-lspconfig',
  config = function()
    require('lspconfig').ts_ls.setup({
      init_options = {
        -- No extra config needed: tsserver picks up tsconfig.json's plugins
        -- as long as typescript is installed in the workspace.
      },
    })
  end,
}</pre>

    <h4><code>typescript-tools.nvim</code> (recommended for large projects)</h4>
    <p>Faster for large projects. Plugin-loading works the same way:</p>
    <pre>return {
  'pmizio/typescript-tools.nvim',
  dependencies = { 'nvim-lua/plenary.nvim', 'neovim/nvim-lspconfig' },
  opts = {},
}</pre>

    <h3>Verify the plugin loaded</h3>
    <p>In Neovim: <code>:LspInfo</code> should list <code>ts_ls</code> (or <code>typescript-tools</code>) attached to your <code>.ts</code> file. In VS Code: the bottom-right status bar shows the TypeScript version; click it and confirm it matches your workspace version.</p>
    <p>Then write a deliberately wrong binding:</p>
    <pre>html\`&lt;student-card .student=\${42}&gt;&lt;/student-card&gt;\`
//                            ^^^ squiggle: \`number\` is not assignable to property 'student' of type \`Student\`.</pre>

    <h3>After upgrading the plugin</h3>
    <p>tsserver loads plugins on startup, so an editor restart is required to pick up new plugin code. In Neovim: <code>:LspRestart</code>. In VS Code: <code>Cmd/Ctrl+Shift+P</code> then "TypeScript: Restart TS Server".</p>

    <h2>Optional: typed DOM queries</h2>
    <p>If you want <code>document.querySelector('student-card')</code> to return <code>StudentCard | null</code> instead of <code>Element | null</code>, augment TypeScript's built-in <code>HTMLElementTagNameMap</code> inside your component file. This is a <a href="https://developer.mozilla.org/docs/Web/API/Document/querySelector" target="_blank">standard TypeScript pattern</a>. With <code>@webjsdev/intellisense</code> active you no longer need this for tag/attribute intelligence inside <code>html\`…\`</code> templates. The augmentation is purely about typing DOM-query call sites.</p>

    <h2>Editor actions: quick reference</h2>
    <table>
      <thead>
        <tr><th>Action</th><th>VS Code</th><th>Neovim</th></tr>
      </thead>
      <tbody>
        <tr><td>Hover type info</td><td>hover cursor</td><td><code>K</code></td></tr>
        <tr><td>Go to definition</td><td>F12 or Ctrl+Click</td><td><code>gd</code></td></tr>
        <tr><td>Find references</td><td>Shift+F12</td><td><code>gr</code></td></tr>
        <tr><td>Rename symbol</td><td>F2</td><td><code>&lt;leader&gt;rn</code></td></tr>
        <tr><td>Code actions</td><td>Ctrl+.</td><td><code>&lt;leader&gt;ca</code></td></tr>
      </tbody>
    </table>

    <h2>Verification walkthrough</h2>
    <p>After setup, open a component file and check each layer:</p>
    <ol>
      <li><strong>Layer 1</strong>: hover <code>this.student</code> inside <code>render()</code> and expect <code>(property) student: Student</code>. Type <code>this.</code> inside the class and expect autocomplete for <code>student</code>, <code>requestUpdate</code>, <code>render</code>, lifecycle hooks, etc.</li>
      <li><strong>Layer 2</strong>: write <code>&lt;student-card&gt;</code> with the side-effect import in place, position the cursor inside <code>&lt;student-card |&gt;</code>, and the completions list includes <code>student</code> (and any other key of the factory shape). Type <code>&lt;student-card .student=\${42}&gt;</code> and a WebJs diagnostic flags <code>'number' is not assignable to property 'student' of type 'Student'</code>. Then comment out the <code>import './student-card.ts'</code> at the top of the file: completions disappear and the value-check goes silent (the missing import is now the surfaced problem). The plugin requires reachability so a missing import always surfaces.</li>
    </ol>
    <p>If any layer misbehaves, the most common cause is tsserver using a different TypeScript install than your workspace's. In Neovim run <code>:LspInfo</code>; in VS Code click the TypeScript version in the status bar. Both should point inside your project's <code>node_modules/</code>.</p>

    <h2>See also</h2>
    <ul>
      <li><a href="/docs/components">Components</a>: the full API surface.</li>
      <li><a href="/docs/typescript">TypeScript</a>: type safety end-to-end.</li>
      <li><a href="/docs/conventions">Conventions</a>: project layout + AI-agent workflow.</li>
    </ul>
  `;
}
