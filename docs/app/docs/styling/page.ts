import { html } from 'webjs';

export const metadata = { title: 'Styling — webjs' };

export default function Styling() {
  return html`
    <h1>Styling</h1>
    <p>webjs uses <strong>shadow DOM scoped CSS</strong> as its primary styling model. Each component defines its own styles that don't leak out and can't be overridden by the page. For cross-component design consistency, CSS custom properties inherit through shadow boundaries.</p>

    <h2>Component Styles</h2>
    <p>Use the <code>css</code> tagged template on the <code>static styles</code> property:</p>
    <pre>import { WebComponent, html, css } from 'webjs';

export class Card extends WebComponent {
  static tag = 'my-card';
  static styles = css\`
    :host {
      display: block;
      padding: 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
    h3 { margin: 0 0 8px; }
    p  { color: #666; margin: 0; }
  \`;
  render() {
    return html\`
      &lt;h3&gt;&lt;slot name="title"&gt;&lt;/slot&gt;&lt;/h3&gt;
      &lt;p&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/p&gt;
    \`;
  }
}
Card.register(import.meta.url);</pre>

    <p>Styles are encapsulated in the shadow root. <code>h3</code> inside this component won't affect <code>h3</code> elements anywhere else on the page.</p>

    <h2>How It Works</h2>
    <ul>
      <li><strong>Server SSR:</strong> styles are serialised as a <code>&lt;style&gt;</code> tag inside the Declarative Shadow DOM <code>&lt;template&gt;</code>. The browser paints them before any JS loads.</li>
      <li><strong>Client:</strong> styles are applied via <code>adoptedStyleSheets</code> (modern browsers) or a fallback <code>&lt;style&gt;</code> element. Shared across all instances of the same component.</li>
    </ul>

    <h2>Design Tokens via CSS Custom Properties</h2>
    <p>CSS custom properties (variables) <strong>inherit through shadow DOM boundaries</strong>. Define tokens on the page and every component can use them:</p>
    <pre>/* In your root layout */
:root {
  --accent: #dc2626;
  --bg: #fafaf9;
  --fg: #1c1917;
  --border: rgba(0, 0, 0, 0.08);
  --rad: 8px;
  --font-sans: system-ui, sans-serif;
}

/* In any component's static styles */
static styles = css\`
  :host {
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--rad);
    font-family: var(--font-sans);
  }
  a { color: var(--accent); }
\`;</pre>

    <p>This is how the blog example implements theming — the layout defines ~30 OKLCH tokens, and every component references them. Switching between light and dark mode is one <code>data-theme</code> attribute change on <code>&lt;html&gt;</code>.</p>

    <h2>The :host Selector</h2>
    <p><code>:host</code> targets the custom element itself (the outer tag). Use it for display, dimensions, and layout participation:</p>
    <pre>static styles = css\`
  :host { display: block; }            /* block by default */
  :host([hidden]) { display: none; }   /* respect hidden attr */
  :host(:hover) { border-color: var(--accent); }
\`;</pre>

    <h2>Styling Slotted Content</h2>
    <p>Light DOM children projected through <code>&lt;slot&gt;</code> keep their own styles, but you can target them with <code>::slotted()</code>:</p>
    <pre>static styles = css\`
  ::slotted(h1) { font-size: 2rem; margin: 0; }
  ::slotted(p)  { line-height: 1.7; }
  ::slotted(a)  { color: var(--accent); }
\`;</pre>

    <blockquote><strong>Limitation:</strong> <code>::slotted()</code> only targets direct children of the slot, not deeply nested descendants. For deep styling, use CSS custom properties.</blockquote>

    <h2>Multiple Style Sheets</h2>
    <p>Pass an array for composed styles:</p>
    <pre>const base = css\`
  :host { display: block; padding: 16px; }
\`;
const theme = css\`
  :host { background: var(--bg-elev); border: 1px solid var(--border); }
\`;

export class Panel extends WebComponent {
  static styles = [base, theme];
  // ...
}</pre>

    <h2>No Inline Styles</h2>
    <p>The webjs convention is: <strong>never use <code>style="..."</code> attributes</strong>. Every visual chunk that repeats should become a component with shadow-DOM-scoped CSS. The blog example has zero inline styles — <code>&lt;blog-shell&gt;</code>, <code>&lt;muted-text&gt;</code>, and <code>&lt;error-card&gt;</code> handle all structural styling via their shadow roots.</p>

    <h2>Global Styles</h2>
    <p>For truly global CSS (body resets, font loading, scrollbar styling), put a <code>&lt;style&gt;</code> tag in your root layout's template. It lands in the light DOM and applies to the whole document:</p>
    <pre>// app/layout.ts
export default function Layout({ children }) {
  return html\`
    &lt;style&gt;
      body { margin: 0; font: 16px/1.65 system-ui, sans-serif; }
      ::selection { background: var(--accent-tint); }
    &lt;/style&gt;
    \${children}
  \`;
}</pre>

    <h2>Dark Mode</h2>
    <p>The recommended pattern:</p>
    <ol>
      <li>Define light tokens as <code>:root</code> defaults.</li>
      <li>Override for dark via <code>@media (prefers-color-scheme: dark)</code> and <code>:root[data-theme="dark"]</code>.</li>
      <li>Use a <code>&lt;theme-toggle&gt;</code> component that sets <code>data-theme</code> on <code>&lt;html&gt;</code> + persists to localStorage.</li>
      <li>Add a synchronous <code>&lt;script&gt;</code> before your <code>&lt;style&gt;</code> to read localStorage before any paint (no FOUC).</li>
    </ol>
    <p>See the blog example for a complete implementation.</p>
  `;
}
