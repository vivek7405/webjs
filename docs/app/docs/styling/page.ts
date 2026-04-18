import { html } from 'webjs';

export const metadata = { title: 'Styling — webjs' };

export default function Styling() {
  return html`
    <h1>Styling</h1>
    <p>webjs ships two styling models and lets you pick per component. The <strong>default is light DOM</strong> with <strong>Tailwind CSS</strong> — the browser runtime with <code>@theme</code> design tokens. Shadow DOM is opt-in when you need truly scoped styles, real <code>&lt;slot&gt;</code> projection, or third-party-embed isolation.</p>

    <h2>The default: light DOM + Tailwind</h2>
    <p>Pages, layouts, and components render into the normal document tree. Tailwind utility classes apply directly — no <code>:host</code>, no <code>::part</code>, no CSS-variable plumbing. Design tokens live in a single <code>@theme</code> block in the root layout and become first-class Tailwind classes.</p>

    <pre>// app/layout.ts — excerpt
import { html } from 'webjs';

export default function RootLayout({ children }: { children: unknown }) {
  return html\`
    &lt;script src="/public/tailwind-browser.js"&gt;&lt;/script&gt;
    &lt;style type="text/tailwindcss"&gt;
      @theme {
        --color-fg:        var(--fg);
        --color-bg:        var(--bg);
        --color-accent:    var(--accent);
        --color-bg-elev:   var(--bg-elev);
        --font-serif:      var(--font-serif);
        --text-display:    clamp(2.6rem, 1.6rem + 3.2vw, 4.25rem);
        --duration-fast:   140ms;
      }
    &lt;/style&gt;
    &lt;style&gt;
      :root {
        --fg: oklch(0.96 0.015 60);
        --bg: oklch(0.14 0.01 55);
        --accent: oklch(0.78 0.14 55);
        /* …etc */
      }
    &lt;/style&gt;
    &lt;main class="max-w-[760px] mx-auto px-4 py-12"&gt;
      \${children}
    &lt;/main&gt;
  \`;
}</pre>

    <p>From any page or component you now write things like:</p>
    <pre>&lt;h1 class="font-serif text-display text-fg mb-6"&gt;Hello&lt;/h1&gt;
&lt;p class="text-fg-muted font-sans"&gt;Lede copy&lt;/p&gt;
&lt;a class="text-accent hover:underline duration-fast"&gt;Link&lt;/a&gt;</pre>

    <h2>Light-DOM components</h2>
    <p>Light DOM is the default for any <code>WebComponent</code>. Tailwind classes apply as they would on plain HTML:</p>
    <pre>import { WebComponent, html } from 'webjs';

export class Counter extends WebComponent {
  // static shadow = false is the default — no need to declare it.
  static properties = { count: { type: Number } };
  count = 0;

  render() {
    return html\`
      &lt;div class="inline-flex items-center gap-2 font-mono"&gt;
        &lt;button class="px-3 py-1 rounded border border-border" @click=\${() =&gt; { this.count--; this.requestUpdate(); }}&gt;−&lt;/button&gt;
        &lt;output class="min-w-[2ch] text-center"&gt;\${this.count}&lt;/output&gt;
        &lt;button class="px-3 py-1 rounded border border-border" @click=\${() =&gt; { this.count++; this.requestUpdate(); }}&gt;+&lt;/button&gt;
      &lt;/div&gt;
    \`;
  }
}
Counter.register('my-counter');</pre>

    <h2>Class-prefix rule for light-DOM custom CSS</h2>
    <p>Tailwind utilities are unique by construction, so most light-DOM components need zero custom CSS. But when you <em>do</em> reach for a <code>&lt;style&gt;</code> block or an imported stylesheet, <strong>every class selector MUST be prefixed with the component's tag name</strong>. Otherwise two components that both define <code>.card</code> or <code>.header</code> will style each other.</p>

    <pre>// Pattern A — BEM-ish class names prefixed with tag
class MyCard extends WebComponent {
  render() {
    return html\`
      &lt;style&gt;
        .my-card__body  { padding: 16px; }
        .my-card__title { font-weight: 600; }
      &lt;/style&gt;
      &lt;div class="my-card__body"&gt;
        &lt;h3 class="my-card__title"&gt;\${title}&lt;/h3&gt;
      &lt;/div&gt;
    \`;
  }
}

// Pattern B — descendant selector rooted at the tag
class MyCard extends WebComponent {
  render() {
    return html\`
      &lt;style&gt;
        my-card .body  { padding: 16px; }
        my-card .title { font-weight: 600; }
      &lt;/style&gt;
      &lt;div class="body"&gt;&lt;h3 class="title"&gt;\${title}&lt;/h3&gt;&lt;/div&gt;
    \`;
  }
}</pre>

    <p>Pick one pattern and stay consistent across a component.</p>

    <h2>Opting in to shadow DOM</h2>
    <p>Set <code>static shadow = true</code> when you want <code>adoptedStyleSheets</code>-scoped styles, real <code>&lt;slot&gt;</code> projection, or third-party-embed-proof CSS isolation:</p>

    <pre>import { WebComponent, html, css } from 'webjs';

export class Card extends WebComponent {
  static shadow = true;                  // opt in
  static styles = css\`
    :host { display: block; padding: 16px; border: 1px solid var(--border); border-radius: 8px; }
    h3 { margin: 0 0 8px; }
    p  { color: var(--fg-muted); margin: 0; }
  \`;
  render() {
    return html\`
      &lt;h3&gt;&lt;slot name="title"&gt;&lt;/slot&gt;&lt;/h3&gt;
      &lt;p&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/p&gt;
    \`;
  }
}
Card.register('my-card');

    <p>Shadow-DOM components are SSR'd via Declarative Shadow DOM — styles paint before JS loads, no hydration runtime, and the browser enforces the boundary. Light-DOM components are SSR'd as direct HTML with a <code>&lt;!--webjs-hydrate--&gt;</code> marker; client-side rendering replaces the marker without flash.</p>

    <h2>Design tokens via CSS custom properties</h2>
    <p>CSS custom properties <strong>inherit through shadow DOM boundaries</strong>. Define them once on <code>:root</code> (as the blog example does in its layout) and both light-DOM and shadow-DOM components can consume them via Tailwind classes (<code>text-fg</code>, <code>bg-bg-elev</code>) or bare CSS (<code>var(--fg)</code>).</p>

    <h2>DRY'ing up repeated Tailwind classes — JS helpers</h2>
    <p>When the same bundle of Tailwind classes appears in 2+ places, extract it into a JS helper in <code>app/_utils/ui.ts</code>. The helper runs at SSR time inside <code>html\`\`</code>, so the browser sees fully materialised HTML — no client-side runtime, no diff from inline classes.</p>

    <pre>// app/_utils/ui.ts
import { html } from 'webjs';

/** `● label` kicker — small caps, accent colour, above headings. */
export function rubric(label: string) {
  return html\`
    &lt;span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-accent mb-4"&gt;● \${label}&lt;/span&gt;
  \`;
}

/** "← label" back link. */
export function backLink(href: string, label: string) {
  return html\`
    &lt;a href=\${href} class="inline-block mb-12 text-fg-subtle no-underline font-mono text-[11px] uppercase tracking-[0.15em] duration-fast hover:text-fg"&gt;← \${label}&lt;/a&gt;
  \`;
}</pre>

    <p>Consume anywhere:</p>
    <pre>// app/blog/[slug]/page.ts
import { rubric, backLink } from '../../_utils/ui.ts';

export default function Post({ params }) {
  return html\`
    \${backLink('/', 'Posts')}
    \${rubric('post')}
    &lt;h1 class="font-serif text-display text-fg"&gt;Hello&lt;/h1&gt;
  \`;
}</pre>

    <p><strong>When to extract.</strong> Inline classes when they appear once. Extract when they repeat 2+ times identically, or vary only by 1–2 props (e.g. a margin size). Don't force-fit — radically different call sites should stay inline.</p>

    <p><strong>Why not <code>@apply</code>?</strong> <code>@apply</code> hides which utilities a class uses and creates a second source of truth. JS helpers keep the class bundle visible at the definition site and compose naturally with conditional classes and active states.</p>

    <h2>Global styles and pseudo-elements</h2>
    <p>Some CSS can't be expressed as utility classes — body defaults, <code>::selection</code>, <code>::-webkit-scrollbar</code>, <code>body::before</code> decorative overlays. Put these in a plain <code>&lt;style&gt;</code> block in the root layout:</p>

    <pre>// app/layout.ts — excerpt
&lt;style&gt;
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.65 var(--font-sans);
  }
  ::selection { background: var(--accent-tint); }
  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }
&lt;/style&gt;</pre>

    <h2>Dark mode</h2>
    <ol>
      <li>Define dark tokens in <code>:root { ... }</code> as the default.</li>
      <li>Override for light via <code>:root[data-theme='light']</code> and <code>@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) { ... } }</code>.</li>
      <li>Ship a <code>&lt;theme-toggle&gt;</code> component that sets <code>data-theme</code> on <code>&lt;html&gt;</code> + persists to localStorage.</li>
      <li>Add a synchronous <code>&lt;script&gt;</code> before your <code>&lt;style&gt;</code> block that reads localStorage and sets <code>data-theme</code> before any paint — no FOUC.</li>
    </ol>

    <h2>Custom CSS without Tailwind</h2>
    <p>The framework has no hard dependency on Tailwind. If you prefer CSS modules, vanilla CSS, or PostCSS, just omit the Tailwind script + <code>@theme</code> block and author styles the usual way. The class-prefix rule for light-DOM components still applies. The blog example is the convention, not the requirement.</p>

    <h2>How SSR works for each mode</h2>
    <ul>
      <li><strong>Light DOM:</strong> component content is serialised as direct children of the custom element with a leading <code>&lt;!--webjs-hydrate--&gt;</code> marker. Global stylesheets paint immediately. On connect the client renderer replaces the marker with rendered content (identical output for unchanged state, no flash).</li>
      <li><strong>Shadow DOM:</strong> component content is serialised inside a <code>&lt;template shadowrootmode="open"&gt;</code>. The browser attaches the shadow root automatically — styles paint before any JS loads. On connect the component upgrades and adopts the same stylesheet via <code>adoptedStyleSheets</code>, so SSR and client styles stay in sync.</li>
    </ul>
  `;
}
