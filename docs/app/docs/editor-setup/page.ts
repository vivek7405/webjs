import { html } from 'webjs';

export const metadata = { title: 'Editor Setup — webjs' };

export default function EditorSetup() {
  return html`
    <h1>Editor Setup — Neovim &amp; VS Code</h1>
    <p>webjs ships a TypeScript overlay (<code>packages/core/index.d.ts</code> and <code>packages/core/src/component.d.ts</code>) so any editor that speaks the TypeScript Language Server (<code>tsserver</code>) gets full autocomplete, hover documentation, and type-checking for framework APIs — component properties, template results, server actions — with zero build step.</p>

    <h2>Prerequisites</h2>
    <ul>
      <li><strong>Node 23.6+</strong> for native TypeScript type-stripping at runtime.</li>
      <li><strong>TypeScript 5.6+</strong> as a dev dependency in your app (<code>npm i -D typescript</code>). The framework itself has no TS dependency — you only need it for editor intellisense.</li>
      <li>A <code>tsconfig.json</code> in your app. The scaffold generates one.</li>
    </ul>

    <h2><code>tsconfig.json</code> — recommended baseline</h2>
    <p>The scaffold writes this file for you. Manual apps should match:</p>
    <pre>{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true
  }
}</pre>
    <p>Key points:</p>
    <ul>
      <li><code>moduleResolution: "NodeNext"</code> — required for the framework's <code>exports</code> map to resolve correctly.</li>
      <li><code>allowImportingTsExtensions: true</code> — lets you write <code>import { x } from './foo.ts'</code> in pages and components, matching how webjs actually serves them.</li>
      <li><code>noEmit: true</code> — TypeScript is used for type-checking only; the webjs dev server strips types via Node / esbuild at request time.</li>
    </ul>

    <h2>VS Code</h2>
    <p>Works out of the box. The bundled TypeScript extension picks up your <code>tsconfig.json</code> and the framework's <code>.d.ts</code> overlay automatically. Optional extras:</p>
    <ul>
      <li><strong><a href="https://marketplace.visualstudio.com/items?itemName=runem.lit-plugin" target="_blank">lit-plugin</a></strong> — extends syntax highlighting and offers autocomplete inside <code>html\`\`</code> tagged templates. webjs's template dialect is compatible with Lit's; this plugin works with no configuration.</li>
      <li><strong>Tailwind CSS IntelliSense</strong> — suggests utility classes inside <code>class="..."</code> attributes.</li>
    </ul>

    <h2>Neovim</h2>
    <p>Any TypeScript LSP client will work — the configuration is identical to any other TypeScript project.</p>

    <h3>Option A — <code>nvim-lspconfig</code></h3>
    <pre>-- lua/plugins/tsserver.lua (lazy.nvim)
return {
  'neovim/nvim-lspconfig',
  config = function()
    local lspconfig = require('lspconfig')
    lspconfig.ts_ls.setup({
      settings = {
        typescript = { preferences = { importModuleSpecifier = 'non-relative' } },
        javascript = { preferences = { importModuleSpecifier = 'non-relative' } },
      },
    })
  end,
}</pre>

    <h3>Option B — <code>typescript-tools.nvim</code> (recommended)</h3>
    <p>Faster for large projects because it talks to <code>tsserver</code> directly instead of going through <code>tsserver.js</code> over stdin. Setup:</p>
    <pre>return {
  'pmizio/typescript-tools.nvim',
  dependencies = { 'nvim-lua/plenary.nvim', 'neovim/nvim-lspconfig' },
  opts = {
    settings = {
      tsserver_file_preferences = {
        importModuleSpecifier = 'non-relative',
        includeCompletionsForModuleExports = true,
      },
    },
  },
}</pre>

    <h3>Autocomplete + hover bindings</h3>
    <p>Once the LSP is attached (check with <code>:LspInfo</code>), the standard keymaps from your LSP setup apply — commonly:</p>
    <pre>K       -- show hover doc (types + JSDoc)
gd      -- go to definition
gr      -- list references
&lt;leader&gt;ca -- code actions
&lt;leader&gt;rn -- rename symbol</pre>

    <h3>Completing in <code>html\`\`</code> templates</h3>
    <p>Standard <code>tsserver</code> doesn't look inside tagged template literals. For element/attribute autocomplete inside <code>html\`\`</code> strings, install the <strong>lit-plugin</strong> TypeScript plugin, which works in any tsserver-backed editor (VS Code, Neovim, etc.):</p>
    <pre># In your app root
npm i -D typescript ts-lit-plugin

# Add to tsconfig.json compilerOptions:
"plugins": [{ "name": "ts-lit-plugin", "strict": true }]</pre>
    <p>Neovim users also need to tell <code>tsserver</code> to load plugins from the workspace — <code>nvim-lspconfig</code> does this by default when you have a local <code>node_modules/typescript</code>.</p>

    <h2>Verifying your setup</h2>
    <p>Create <code>components/hello.ts</code>:</p>
    <pre>import { defineComponent, html } from 'webjs';

class Hello extends defineComponent({
  name: { type: String },
  times: { type: Number },
}) {
  static tag = 'hello-card';
  render() {
    return html\`&lt;p&gt;Hello \${this.name} — \${this.times} times&lt;/p&gt;\`;
  }
}
Hello.register(import.meta.url);</pre>

    <p>In your editor:</p>
    <ul>
      <li>Hover <code>this.name</code> → should show <code>(property) name: string</code>.</li>
      <li>Hover <code>this.times</code> → should show <code>(property) times: number</code>.</li>
      <li>Type <code>this.</code> → autocomplete lists <code>name</code>, <code>times</code>, <code>setState</code>, <code>requestUpdate</code>, <code>state</code>, etc.</li>
      <li>Change a property usage to the wrong type (e.g. <code>this.name.toFixed(2)</code>) → red underline with <code>Property 'toFixed' does not exist on type 'string'.</code></li>
    </ul>
    <p>If any of these don't work, check <code>:checkhealth</code> (Neovim) or the TypeScript status bar (VS Code) — the most common issue is <code>tsserver</code> picking up a different <code>tsconfig.json</code> than the app's.</p>

    <h2>See also</h2>
    <ul>
      <li><a href="/docs/components">Components</a> — <code>defineComponent</code> API details.</li>
      <li><a href="/docs/typescript">TypeScript</a> — type safety end-to-end.</li>
      <li><a href="/docs/conventions">Conventions</a> — project layout + AI-agent workflow.</li>
    </ul>
  `;
}
