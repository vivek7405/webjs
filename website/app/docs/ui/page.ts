import { html } from '@webjsdev/core';

export const metadata = { title: '@webjsdev/ui: AI-first component library' };

export default function UiDocs() {
  return html`
    <h1>@webjsdev/ui</h1>
    <p>
      An <strong>AI-first component library</strong> with two-tier composition: pure class-helper
      functions (<code>buttonClass</code>, <code>cardClass</code>, <code>inputClass</code>) for
      visual primitives, plus a small set of stateful custom elements
      (<code>&lt;ui-dialog&gt;</code>, <code>&lt;ui-tabs&gt;</code>, <code>&lt;ui-dropdown-menu&gt;</code>, etc.)
      where state matters. Source-copied into your project so you own the code and edit it freely.
      Variant names, sizes, and data attributes mirror shadcn so existing shadcn knowledge maps
      directly. Works in any project with Tailwind v4 and the small <code>@webjsdev/core</code>
      runtime: webjs, Next, Astro, Vite, SvelteKit, Lit, vanilla HTML.
    </p>

    <h2>For WebJs users</h2>
    <p>
      Nothing to install. <code>@webjsdev/ui</code> is a hard dependency of <code>@webjsdev/cli</code>, so a global
      WebJs install already includes it, and <code>webjs ui add</code> resolves the kit from there. A
      scaffolded app does NOT pin <code>@webjsdev/ui</code>: <code>webjs ui add</code> copies the component
      source into <code>components/ui/</code> (those files import <code>@webjsdev/core</code>, not the kit).
    </p>
    <pre>webjs ui init
webjs ui add button card dialog input label</pre>

    <h2>For everyone else (Next, Astro, Vite, SvelteKit, Lit, vanilla, …)</h2>
    <p>Two npm installs (the CLI and the runtime base class), then run the CLI:</p>
    <pre>npm install -D @webjsdev/ui
npm install @webjsdev/core
npx webjsui init
npx webjsui add button card dialog</pre>
    <p>
      The <code>webjsui</code> binary is standalone. It does NOT require <code>@webjsdev/cli</code>.
      It auto-detects your project type (Next / Astro / Vite / Lit / plain) and picks sensible defaults.
    </p>

    <h2>Commands</h2>
    <table>
      <thead><tr><th>Command</th><th>What it does</th></tr></thead>
      <tbody>
        <tr><td><code>init</code></td><td>Writes <code>components.json</code>, copies <code>lib/utils.ts</code>, installs the theme tokens (exits non-zero if they cannot be written)</td></tr>
        <tr><td><code>add &lt;names...&gt;</code></td><td>Copy components in, install needed deps, self-heal the theme tokens (Tier-1 files keep the helpers plus a pointer, not the worked example)</td></tr>
        <tr><td><code>list</code></td><td>List all components in the registry</td></tr>
        <tr><td><code>view &lt;name&gt;</code></td><td>Print a component's projected view (helpers plus the paste-ready example) and full source</td></tr>
        <tr><td><code>diff [name]</code></td><td>Show differences between your local copy and the live registry</td></tr>
        <tr><td><code>info</code></td><td>Project diagnostics</td></tr>
      </tbody>
    </table>
    <p>
      Resolution is local-first: <code>init</code> / <code>add</code> / <code>list</code> / <code>view</code>
      read the registry that ships inside the installed <code>@webjsdev/ui</code> package, so they need no
      network. A Tier-1 component's worked structural example is served on demand by
      <code>webjsui view &lt;name&gt;</code> (and the read-only MCP <code>ui</code> tool), not copied into your file.
    </p>

    <h2>Usage</h2>
    <p>Every component is a standards-compliant custom element. Tag convention: single <code>ui-</code> prefix, sub-components hyphenated.</p>
    <pre>&lt;ui-card&gt;
  &lt;ui-card-header&gt;
    &lt;ui-card-title&gt;Hello&lt;/ui-card-title&gt;
    &lt;ui-card-description&gt;A web component card.&lt;/ui-card-description&gt;
  &lt;/ui-card-header&gt;
  &lt;ui-card-content&gt;
    &lt;ui-input placeholder="Type here..." /&gt;
  &lt;/ui-card-content&gt;
  &lt;ui-card-footer&gt;
    &lt;ui-button variant="default"&gt;Save&lt;/ui-button&gt;
  &lt;/ui-card-footer&gt;
&lt;/ui-card&gt;</pre>

    <h2>Migrating from shadcn-react</h2>
    <p>Translation is mechanical: <code>&lt;Button&gt;</code> → <code>&lt;ui-button&gt;</code>, <code>&lt;DialogContent&gt;</code> → <code>&lt;ui-dialog-content&gt;</code>. Variant and size props match exactly. Components project children via DOM nesting. There is no <code>asChild</code> / Radix Slot pattern, so wrap an element directly instead.</p>

    <h2>What's in the registry?</h2>
    <p>~55 components matching shadcn's new-york-v4 style:</p>
    <p>
      accordion, alert, alert-dialog, aspect-ratio, avatar, badge, breadcrumb, button, button-group,
      calendar, card, carousel, chart, checkbox, collapsible, combobox, command, context-menu,
      dialog, direction, drawer, dropdown-menu, empty, field, form, hover-card, input, input-group,
      input-otp, item, kbd, label, menubar, native-select, navigation-menu, pagination, popover,
      progress, radio-group, resizable, scroll-area, select, separator, sheet, sidebar, skeleton,
      slider, sonner, spinner, switch, table, tabs, textarea, toggle, toggle-group, tooltip.
    </p>

    <h2>Why web components?</h2>
    <p>Standards. Custom elements work in every framework that supports them: webjs, Next.js, Astro, Vite, Remix, SvelteKit, Nuxt, SolidStart, Lit projects, and plain HTML. One library, every host.</p>

    <h2>For AI agents</h2>
    <p>
      The whole point is rapid scaffolding. Instead of generating 200 lines of Tailwind for a login form,
      an agent can call <code>webjs ui add button card input label</code> and compose 15 lines of tag soup.
      Visual consistency comes for free; the agent makes zero design decisions.
    </p>
  `;
}
