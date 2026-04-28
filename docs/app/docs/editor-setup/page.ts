import { html } from '@webjskit/core';

export const metadata = { title: 'Editor Setup — webjs' };

export default function EditorSetup() {
  return html`
    <h1>Editor Setup — Neovim &amp; VS Code</h1>
    <p>webjs ships a TypeScript overlay (<code>packages/core/index.d.ts</code> and <code>packages/core/src/component.d.ts</code>) so any editor that speaks the TypeScript Language Server (<code>tsserver</code>) gets autocomplete, hover documentation, and type-checking for the framework APIs with zero build step.</p>

    <p>This page covers two layers of intelligence:</p>
    <ol>
      <li><strong>Type-safe component internals</strong> — <code>this.student: Student</code> inside the class. Works out of the box once <code>tsconfig.json</code> is set up.</li>
      <li><strong>Template-literal intelligence</strong> — autocomplete, type-checking, and go-to-definition for <code>&lt;student-card student=\${...}&gt;</code> inside <code>html\`…\`</code> tags. Requires <code>ts-lit-plugin</code>.</li>
    </ol>
    <p>There's also an optional standard-TypeScript convention for typing <code>document.querySelector('student-card')</code> — briefly covered at the end.</p>

    <h2>Prerequisites</h2>
    <ul>
      <li><strong>Node 20.6+</strong> for the esbuild loader hook the dev server registers at startup.</li>
      <li><strong>TypeScript 5.6+</strong> as a dev dependency (<code>npm i -D typescript</code>). The framework itself has no TS dependency; you only need it for editor intellisense.</li>
      <li>A <code>tsconfig.json</code> in your app. The scaffold generates one.</li>
    </ul>

    <h2><code>tsconfig.json</code> — baseline</h2>
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
    "plugins": [{ "name": "ts-lit-plugin", "strict": true }]
  }
}</pre>
    <p>Key points:</p>
    <ul>
      <li><code>moduleResolution: "NodeNext"</code> — required for the framework's <code>exports</code> map to resolve correctly.</li>
      <li><code>allowImportingTsExtensions: true</code> — lets you write <code>import { x } from './foo.ts'</code>, matching how webjs serves them.</li>
      <li><code>noEmit: true</code> — TypeScript type-checks only; webjs transforms <code>.ts</code> via esbuild at import / request time.</li>
      <li><code>plugins: [{ name: 'ts-lit-plugin' }]</code> — enables template-literal intelligence (details below).</li>
    </ul>

    <h2>Layer 1 — Component internals (works everywhere)</h2>
    <p>Type each property with the two-line pattern. The runtime half goes in <code>static properties</code>; the compile-time half goes in a <code>declare</code> field that types the auto-generated accessor:</p>
    <pre>import { WebComponent, html } from '@webjskit/core';
import type { Student } from './student-types.ts';

export class StudentCard extends WebComponent {
  static properties = { student: { type: Object } };
  declare student: Student;
  render() {
    return html\`&lt;p&gt;\${this.student.name}&lt;/p&gt;\`;
  }
}
StudentCard.register('student-card');</pre>

    <p>Inside the class, <code>this.student</code> is a real <code>Student</code> — hover, autocomplete, type-checking all work. <code>this.setState</code>, <code>this.state</code>, <code>this.requestUpdate</code>, and all lifecycle hooks are typed by the framework's <code>.d.ts</code> overlay.</p>

    <h3>Why <code>declare</code> is required</h3>
    <p>The framework installs the reactive getter/setter on <code>this</code> via <code>Object.defineProperty</code> inside the constructor. Without <code>declare</code>, TypeScript emits a <code>student = undefined</code> class-field initializer that runs <em>after</em> <code>super()</code> and overwrites that accessor. <code>declare</code> tells TS "type this field for me, but don't emit any runtime assignment."</p>

    <h2>Layer 2 — <code>ts-lit-plugin</code> for <code>html\`…\`</code> intelligence</h2>
    <p>webjs's <code>html\`…\`</code> is Lit-compatible. Installing <a href="https://www.npmjs.com/package/ts-lit-plugin" target="_blank">ts-lit-plugin</a> unlocks:</p>
    <ul>
      <li><strong>Autocomplete</strong> custom-element tag names and their attributes inside <code>html\`…\`</code>.</li>
      <li><strong>Type-checking</strong> attribute / property values — <code>&lt;student-card student=\${42}&gt;</code> is flagged because <code>42</code> isn't a <code>Student</code>.</li>
      <li><strong>Unknown-tag warnings</strong> when you typo an element name.</li>
      <li><strong>Go-to-definition</strong> — <code>gd</code> / F12 / Ctrl+Click on <code>&lt;student-card&gt;</code> jumps to the <code>StudentCard</code> class. Same for attributes → jumps to the property declaration.</li>
      <li><strong>Rename-symbol</strong> works across <code>static tag</code>, <code>static properties</code> keys, and every <code>html\`…\`</code> usage.</li>
    </ul>

    <h3>Install</h3>
    <pre>npm i -D typescript ts-lit-plugin</pre>
    <p>Add the plugin to <code>tsconfig.json</code> (already shown in the baseline above):</p>
    <pre>{
  "compilerOptions": {
    "plugins": [{ "name": "ts-lit-plugin", "strict": true }]
  }
}</pre>

    <h3>VS Code</h3>
    <p>After installing, tell VS Code to use your workspace's TypeScript (so it picks up the plugin) — open any <code>.ts</code> file and:</p>
    <pre>Cmd/Ctrl+Shift+P  →  "TypeScript: Select TypeScript Version"  →  "Use Workspace Version"</pre>
    <p>Reload the window. Plugin is now active.</p>

    <h3>Neovim</h3>
    <p>Any LSP client that speaks tsserver will load the plugin automatically — the key is pointing the LSP at your <strong>workspace's</strong> <code>node_modules/typescript</code> so the plugin in <code>tsconfig.json</code> resolves.</p>

    <h4><code>nvim-lspconfig</code></h4>
    <pre>-- lua/plugins/tsserver.lua
return {
  'neovim/nvim-lspconfig',
  config = function()
    require('lspconfig').ts_ls.setup({
      init_options = {
        -- No extra config needed — tsserver picks up tsconfig.json's plugins
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

    <h3>Verify plugin loaded</h3>
    <p>In Neovim: <code>:LspInfo</code> should list <code>ts_ls</code> (or <code>typescript-tools</code>) attached to your <code>.ts</code> file. In VS Code: bottom-right status bar shows the TypeScript version — click it and confirm it matches your workspace version.</p>
    <p>Then write a deliberately wrong attribute:</p>
    <pre>html\`&lt;student-card student=\${42}&gt;&lt;/student-card&gt;\`
//                                    ^^^ squiggle: \`number\` is not assignable to \`Student\`.</pre>

    <h2>Optional: typed DOM queries</h2>
    <p>If you want <code>document.querySelector('student-card')</code> to return <code>StudentCard | null</code> instead of <code>Element | null</code>, augment TypeScript's built-in <code>HTMLElementTagNameMap</code> inside your component file. This is a <a href="https://developer.mozilla.org/docs/Web/API/Document/querySelector" target="_blank">standard TypeScript pattern</a> — the same one <a href="https://lit.dev" target="_blank">Lit</a> uses. Three lines per component; skip it if you don't need the DOM-query typing.</p>

    <h2>Editor actions — quick reference</h2>
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
      <li><strong>Layer 1</strong> — hover <code>this.student</code> inside <code>render()</code>: expect <code>(property) student: Student</code>. Type <code>this.</code> inside the class: expect autocomplete for <code>student</code>, <code>setState</code>, <code>requestUpdate</code>, <code>state</code>, <code>render</code>, etc.</li>
      <li><strong>Layer 2</strong> — inside an <code>html\`…\`</code> template, type <code>&lt;student-</code>: expect <code>student-card</code> in the completion list. On <code>&lt;student-card&gt;</code>, press <code>gd</code> / F12: jumps to the <code>StudentCard</code> class. Type <code>&lt;student-card x</code>: attribute completions from <code>static properties</code>.</li>
    </ol>
    <p>If any layer misbehaves, the most common cause is tsserver using a different TypeScript install than your workspace's. In Neovim run <code>:LspInfo</code>; in VS Code click the TypeScript version in the status bar. Both should point inside your project's <code>node_modules/</code>.</p>

    <h2>See also</h2>
    <ul>
      <li><a href="/docs/components">Components</a> — the full API surface.</li>
      <li><a href="/docs/typescript">TypeScript</a> — type safety end-to-end.</li>
      <li><a href="/docs/conventions">Conventions</a> — project layout + AI-agent workflow.</li>
    </ul>
  `;
}
