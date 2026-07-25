import { html } from '@webjsdev/core';

export const metadata = { title: 'Styling | WebJs' };

export default function Styling() {
  return html`
    <h1>Styling</h1>
    <p>WebJs ships two styling models and lets you pick per component. The <strong>default is light DOM</strong> with <strong>Tailwind CSS</strong>: a static compiled stylesheet (so it works with JavaScript off) with <code>@theme</code> design tokens. Shadow DOM is opt-in when you need truly scoped styles or third-party-embed isolation. <code>&lt;slot&gt;</code> projection works identically in both modes (light DOM uses framework projection), so slot usage is not a reason to opt into shadow.</p>

    <h2>The default: light DOM + Tailwind</h2>
    <p>Pages, layouts, and components render into the normal document tree. Tailwind utility classes apply directly: no <code>:host</code>, no <code>::part</code>, no CSS-variable plumbing. Design tokens live in a single <code>@theme</code> block in <code>public/input.css</code>, which <code>css:build</code> compiles to a static <code>public/tailwind.css</code> the layout links, so the app is fully styled with JavaScript disabled (a real stylesheet, not an in-browser compile). The token VALUES stay inline in the layout as plain CSS custom properties, so they resolve with JS off too.</p>

    <p>In dev the scaffold keeps that stylesheet fresh with an on-request recompile (a <code>webjs.dev.regenerate</code> rule), not a background <code>tailwindcss --watch</code>. When a source changes, the dev server recompiles <code>public/tailwind.css</code> before serving it, so a newly added utility class is never rendered unstyled and there is no watch process that can die or lag. Prod builds the same file once before serving, so dev and prod share the identical compile.</p>

    <pre>// public/input.css (compiled to a static public/tailwind.css by css:build,
// which the dev / start tasks run automatically). The @theme maps live here.
@import "tailwindcss";
@theme {
  --color-background:       var(--background);
  --color-foreground:       var(--foreground);
  --color-primary:          var(--primary);
  --color-muted-foreground: var(--muted-foreground);
  --font-serif:             var(--font-serif);
  --text-display:           clamp(2.6rem, 1.6rem + 3.2vw, 4.25rem);
  --duration-fast:          140ms;
}

// app/layout.ts excerpt
import { html } from '@webjsdev/core';

export default function RootLayout({ children }: { children: unknown }) {
  return html\`
    &lt;link rel="stylesheet" href="/public/tailwind.css"&gt;
    &lt;style&gt;
      /* Token VALUES: plain CSS custom properties, so they resolve with JS off. */
      :root {
        --background: oklch(0.14 0.01 55);
        --foreground: oklch(0.96 0.015 60);
        --primary:    oklch(0.78 0.14 55);
        /* …etc */
      }
    &lt;/style&gt;
    &lt;main class="max-w-[760px] mx-auto px-4 py-12"&gt;
      \${children}
    &lt;/main&gt;
  \`;
}</pre>

    <p>From any page or component you now write things like:</p>
    <pre>&lt;h1 class="font-serif text-display text-foreground mb-6"&gt;Hello&lt;/h1&gt;
&lt;p class="text-muted-foreground font-sans"&gt;Lede copy&lt;/p&gt;
&lt;a class="text-primary hover:underline duration-fast"&gt;Link&lt;/a&gt;</pre>

    <h2>Light-DOM components</h2>
    <p>Light DOM is the default for any <code>WebComponent</code>. Tailwind classes apply as they would on plain HTML:</p>
    <pre>import { WebComponent, html, signal } from '@webjsdev/core';

export class Counter extends WebComponent {
  // static shadow = false is the default, no need to declare it.
  // Instance signal carries component-local state. SignalWatcher
  // (built into WebComponent) auto-tracks .get() reads.
  count = signal(0);

  render() {
    return html\`
      &lt;div class="inline-flex items-center gap-2 font-mono"&gt;
        &lt;button class="px-3 py-1 rounded border border-border" @click=\${() =&gt; this.count.set(this.count.get() - 1)}&gt;−&lt;/button&gt;
        &lt;output class="min-w-[2ch] text-center"&gt;\${this.count.get()}&lt;/output&gt;
        &lt;button class="px-3 py-1 rounded border border-border" @click=\${() =&gt; this.count.set(this.count.get() + 1)}&gt;+&lt;/button&gt;
      &lt;/div&gt;
    \`;
  }
}
Counter.register('my-counter');</pre>

    <h2>Class-prefix rule for light-DOM custom CSS</h2>
    <p>Tailwind utilities are unique by construction, so most light-DOM components need zero custom CSS. But when you <em>do</em> reach for a <code>&lt;style&gt;</code> block or an imported stylesheet, <strong>every class selector MUST be prefixed with the component's tag name</strong>. Otherwise two components that both define <code>.card</code> or <code>.header</code> will style each other.</p>

    <pre>// Pattern A: BEM-ish class names prefixed with tag
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

// Pattern B: descendant selector rooted at the tag
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

    <h2>Layout: block hosts and even grids (the CSS traps)</h2>
    <p>Two layout defects ship silently because the checker and the type-checker are static (they never render the pixels), so both only show once you render and interact. Both have a one-line fix.</p>
    <p><strong>Light-DOM component hosts are <code>display: block</code> by default.</strong> A custom element is <code>display: inline</code> in plain CSS, which would collapse a light-DOM component used as a block container (a board, a card, a panel) to its content size. The framework marks every light host <code>data-wj-host</code> and injects one rule in a low-priority cascade layer, <code>@layer webjs-host &#123; :where([data-wj-host]) &#123; display: block &#125; &#125;</code>, so a container fills its parent. The layer keeps it overridable by any author style, including Tailwind utilities (<code>class="flex"</code>, <code>grid</code>, <code>hidden</code>) whose layer wins; a <code>[hidden]</code> carve-out keeps <code>?hidden</code> working. Want an inline light component? Opt out with <code>my-badge &#123; display: inline &#125;</code>.</p>
    <p><strong>Shadow-DOM hosts are NOT marked.</strong> A document rule targeting the host would override the shadow tree's own <code>:host</code> display, so the framework leaves shadow hosts alone. A shadow-DOM component sets its host display the idiomatic way, <code>:host &#123; display: block &#125;</code> (or <code>flex</code> / <code>grid</code>) in <code>static styles</code>, which is fully respected. Set it for a shadow block container (an unstyled shadow host stays <code>display: inline</code>).</p>
    <p><strong>Size the HOST, not just an inner wrapper.</strong> The host custom element is the box the parent lays out. <code>display: block</code> stops the inline-collapse, but a host that is a flex/grid item in a centering parent (<code>flex justify-center</code>, <code>grid place-items-center</code>) is still sized to its content unless it carries width itself. Put <code>w-full max-w-[...]</code> on the host, not only on an inner <code>&lt;div&gt;</code> (an inner <code>w-full</code> resolves against a collapsed host and the whole component shrinks). Symptom: a board or card renders tiny even though its inner grid says <code>w-full max-w-[400px]</code>.</p>
    <p><strong>An even grid uses <code>1fr</code> tracks, never <code>auto</code> rows.</strong> The reflow bug (a cell grows when it gets content while the others shrink) comes from <code>auto</code>-sized rows. Put <code>aspect-ratio</code> on the CONTAINER, size the tracks explicitly, and cap the cells:</p>

    <pre>&lt;!-- a 3x3 board whose cells stay equal and square as it fills --&gt;
&lt;div class="grid gap-2 aspect-square [grid-template-columns:repeat(3,1fr)] [grid-template-rows:repeat(3,1fr)]"&gt;
  \${cells.map((c) =&gt; html\`
    &lt;button class="grid place-items-center min-h-0 overflow-hidden text-[clamp(1rem,8cqi,3rem)]"&gt;\${c}&lt;/button&gt;
  \`)}
&lt;/div&gt;</pre>

    <ul>
      <li><code>aspect-square</code> on the CONTAINER plus <code>repeat(N,1fr)</code> columns AND rows makes every cell an equal square that does not resize as marks land. Putting <code>aspect-square</code> on the CELLS is the common mistake that produces uneven rows.</li>
      <li><code>min-h-0</code> + <code>overflow-hidden</code> on a cell stops its content from forcing the track taller (a grid child's implicit <code>min-height: auto</code> otherwise lets content push past its track).</li>
      <li>Size text relative to the cell (<code>clamp()</code>, container-query units <code>cqi</code>) so the glyph scales with the board, not the reverse.</li>
    </ul>
    <p><strong>Verify by USING it.</strong> A layout bug only shows mid-interaction. Render the app, play through every state (fill the board, win, draw, reload), and confirm nothing resizes and the cells stay equal.</p>

    <h2>Opting in to shadow DOM</h2>
    <p>Set <code>static shadow = true</code> when you want <code>adoptedStyleSheets</code>-scoped styles, real <code>&lt;slot&gt;</code> projection, or third-party-embed-proof CSS isolation:</p>

    <pre>import { WebComponent, html, css } from '@webjsdev/core';

export class Card extends WebComponent {
  static shadow = true;                  // opt in
  static styles = css\`
    :host { display: block; padding: 16px; border: 1px solid var(--border); border-radius: 8px; }
    h3 { margin: 0 0 8px; }
    p  { color: var(--muted-foreground); margin: 0; }
  \`;
  render() {
    return html\`
      &lt;h3&gt;&lt;slot name="title"&gt;&lt;/slot&gt;&lt;/h3&gt;
      &lt;p&gt;&lt;slot&gt;&lt;/slot&gt;&lt;/p&gt;
    \`;
  }
}
Card.register('my-card');</pre>

    <p>Shadow-DOM components are SSR'd via Declarative Shadow DOM. Styles paint before JS loads, no hydration runtime, and the browser enforces the boundary. Light-DOM components are SSR'd as direct HTML with a <code>&lt;!--webjs-hydrate--&gt;</code> marker, and client-side rendering replaces the marker without flash.</p>

    <h2>Design tokens via CSS custom properties</h2>
    <p>CSS custom properties <strong>inherit through shadow DOM boundaries</strong>. Define them once on <code>:root</code> (as the blog example does in its layout) and both light-DOM and shadow-DOM components can consume them via Tailwind classes (<code>text-foreground</code>, <code>bg-card</code>) or bare CSS (<code>var(--foreground)</code>).</p>

    <h2>Gotcha: an animated <code>@property</code> paints its <code>var()</code> fallback inside a link (Chromium)</h2>
    <p>An element that paints a registered <code>@property</code> custom property directly, for example <code>background: var(--brand-cycle, &lt;fallback&gt;)</code>, paints the <strong>fallback</strong> instead of the live animated value whenever it has an <code>&lt;a href&gt;</code> ancestor, when <code>--brand-cycle</code> is a registered <code>@property</code> animated by <code>@keyframes</code> on <code>:root</code>. A registered <code>@property</code> always has a valid computed value, so it must never paint its <code>var()</code> fallback; that it does here is a Chromium paint bug (confirmed headless and headed; other engines are unaffected).</p>
    <p>The tell that it is a PAINT bug, not a style bug: <code>getComputedStyle</code> returns the correct live animated value, only the painted pixels are stale. So verify with a screenshot or pixel sample, never with <code>getComputedStyle</code> (it lies here). The trigger is specifically an <code>&lt;a&gt;</code> with an <code>href</code> (a real link). The same subtree under a <code>&lt;div&gt;</code>, a <code>&lt;button&gt;</code>, or an <code>&lt;a&gt;</code> with no <code>href</code> animates correctly, which points at Chromium's visited-link paint isolation (links paint through a separate path, for <code>:visited</code> history-sniffing defense, that does not invalidate on a registered-custom-property animation). Neither <code>isolation: isolate</code>, <code>will-change</code>, <code>content-visibility</code>, a self-<code>animation</code>, nor re-declaring the property fixes it.</p>
    <p><strong>The fix is to route the value through <code>color</code> + <code>currentColor</code></strong> instead of a direct <code>var()</code> paint reference. Chromium's link paint path does invalidate <code>color</code>, so this sidesteps the bug with no JavaScript:</p>
    <pre>/* BROKEN inside &lt;a href&gt;: paints the fallback, not the animated color */
.wordmark { background: var(--brand-cycle, #ebeff2); }

/* WORKS: the animated property rides color, the paint reads currentColor */
.logo-link { color: var(--brand-cycle, #ebeff2); }   /* the &lt;a&gt; (or the element) */
.wordmark  { background: currentColor; }             /* the painted descendant */</pre>

    <h2>DRY'ing up repeated Tailwind classes via JS helpers</h2>
    <p>When the same bundle of Tailwind classes appears in 2+ places, extract it into a JS helper in <code>lib/utils/ui.ts</code>. The helper runs at SSR time inside <code>html\`\`</code>, so the browser sees fully materialised HTML. No client-side runtime, no diff from inline classes.</p>

    <pre>// lib/utils/ui.ts
import { html } from '@webjsdev/core';

/** \`label\` kicker: small caps, accent colour, above headings. */
export function rubric(label: string) {
  return html\`
    &lt;span class="block font-mono text-[11px] leading-none font-semibold tracking-[0.2em] uppercase text-primary mb-4"&gt;● \${label}&lt;/span&gt;
  \`;
}

/** "← label" back link. */
export function backLink(href: string, label: string) {
  return html\`
    &lt;a href=\${href} class="inline-block mb-12 text-muted-foreground/70 no-underline font-mono text-[11px] uppercase tracking-[0.15em] duration-fast hover:text-foreground"&gt;← \${label}&lt;/a&gt;
  \`;
}</pre>

    <p>Consume anywhere:</p>
    <pre>// app/blog/[slug]/page.ts
import { rubric, backLink } from '#lib/utils/ui.ts';

export default function Post({ params }) {
  return html\`
    \${backLink('/', 'Posts')}
    \${rubric('post')}
    &lt;h1 class="font-serif text-display text-foreground"&gt;Hello&lt;/h1&gt;
  \`;
}</pre>

    <p><strong>When to extract.</strong> Inline classes when they appear once. Extract when they repeat 2+ times identically, or vary only by 1–2 props (e.g. a margin size). Don't force-fit. Radically different call sites should stay inline.</p>

    <p><strong>Why not <code>@apply</code>?</strong> <code>@apply</code> hides which utilities a class uses and creates a second source of truth. JS helpers keep the class bundle visible at the definition site and compose naturally with conditional classes and active states.</p>

    <h2>Global styles and pseudo-elements</h2>
    <p>Some CSS can't be expressed as utility classes: body defaults, <code>::selection</code>, <code>::-webkit-scrollbar</code>, <code>body::before</code> decorative overlays. Put these in a plain <code>&lt;style&gt;</code> block in the root layout:</p>

    <pre>// app/layout.ts excerpt
&lt;style&gt;
  html, body { margin: 0; }
  body {
    background: var(--background);
    color: var(--foreground);
    font: 16px/1.65 var(--font-sans);
  }
  ::selection { background: var(--primary-tint); }
  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
&lt;/style&gt;</pre>

    <h2>Dark mode</h2>
    <ol>
      <li>Define dark tokens in <code>:root { ... }</code> as the default.</li>
      <li>Override for light via <code>:root[data-theme='light']</code> and <code>@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) { ... } }</code>.</li>
      <li>Ship a <code>&lt;theme-toggle&gt;</code> component that sets <code>data-theme</code> on <code>&lt;html&gt;</code> + persists to localStorage.</li>
      <li>Add a synchronous <code>&lt;script&gt;</code> before your <code>&lt;style&gt;</code> block that reads localStorage and sets <code>data-theme</code> before any paint. No FOUC.</li>
    </ol>

    <h2>Vanilla CSS end-to-end (opt out of Tailwind)</h2>
    <p>Tailwind is the default but not a requirement. If you prefer hand-written CSS everywhere, drop the <code>&lt;link&gt;</code> to <code>public/tailwind.css</code> (and <code>public/input.css</code> + the <code>css:build</code> script) and follow the <strong>wrapper-scoping convention</strong> below so generic class names (<code>.btn</code>, <code>.input</code>, <code>.header</code>) can't collide across pages, layouts, and components in the global light-DOM namespace.</p>

    <h3>Three scopes, one rule each</h3>
    <table>
      <thead><tr><th>Scope</th><th>Wrapper selector</th><th>Derived from</th></tr></thead>
      <tbody>
        <tr><td><strong>Component</strong></td><td>Custom-element tag</td><td>Already unique via <code>customElements.define</code></td></tr>
        <tr><td><strong>Page</strong></td><td><code>.page-&lt;route&gt;</code></td><td><code>app/dashboard/page.ts</code> → <code>.page-dashboard</code>. <code>app/blog/[slug]/page.ts</code> → <code>.page-blog-slug</code>. Route groups <code>(marketing)</code> drop. Root <code>app/page.ts</code> → <code>.page-home</code>.</td></tr>
        <tr><td><strong>Layout</strong></td><td><code>.layout-&lt;name&gt;</code></td><td><code>app/layout.ts</code> → <code>.layout-root</code>. <code>app/admin/layout.ts</code> → <code>.layout-admin</code>.</td></tr>
      </tbody>
    </table>

    <p>Every page wraps its output in <code>&lt;div class="page-&lt;route&gt;"&gt;</code>. Every layout wraps in <code>&lt;div class="layout-&lt;name&gt;"&gt;</code>. Components scope via their tag name. Styles colocate with the markup as <code>const STYLES = css\`…\`</code> and interpolate via <code>&lt;style&gt;\${STYLES.text}&lt;/style&gt;</code>. The standalone <code>@webjsdev/intellisense</code> (and the <code>webjs</code> editor extension) resolves class go-to-definition inside those blocks.</p>

    <h3>Page scope</h3>
    <pre>// app/dashboard/page.ts
import { html, css } from '@webjsdev/core';

const STYLES = css\`
  .page-dashboard {
    .actions     { display: flex; gap: 12px; }
    .btn         { padding: 12px 24px; border-radius: 999px; }
    .btn-primary { background: var(--primary); color: var(--primary-foreground); }
  }
\`;

export default function Dashboard() {
  return html\`
    &lt;style&gt;\${STYLES.text}&lt;/style&gt;
    &lt;div class="page-dashboard"&gt;
      &lt;div class="actions"&gt;
        &lt;a class="btn btn-primary" href="/new"&gt;+ New&lt;/a&gt;
      &lt;/div&gt;
    &lt;/div&gt;
  \`;
}</pre>

    <h3>Layout scope</h3>
    <pre>// app/layout.ts
import { html, css } from '@webjsdev/core';

const STYLES = css\`
  .layout-root {
    .header { position: fixed; inset-inline: 0; top: 0; } /* fixed, NOT sticky (see note) */
    .nav    { display: flex; gap: 16px; }
  }
\`;

export default function RootLayout({ children }: { children: unknown }) {
  return html\`
    &lt;style&gt;\${STYLES.text}&lt;/style&gt;
    &lt;div class="layout-root"&gt;
      &lt;header class="header"&gt;
        &lt;nav class="nav"&gt;…&lt;/nav&gt;
      &lt;/header&gt;
      &lt;main&gt;\${children}&lt;/main&gt;
    &lt;/div&gt;
  \`;
}</pre>

    <p><strong>Pin a header with <code>position: fixed</code>, never <code>position: sticky</code>.</strong> A sticky header flickers its background for one frame on iOS WebKit (every iOS browser) during a client-router navigation: the preserved header plus the scroll-to-top trips a WebKit sticky-repaint bug, and the GPU-promotion hacks (<code>translateZ</code>, <code>will-change</code>) do not fix it. Use <code>position: fixed</code> and reserve the header height on the content with a <code>--header-height</code> CSS variable (kept exact by a <code>ResizeObserver</code>). It is iOS-only and invisible on desktop, Android, and in DevTools emulation, so it shows only on a real device.</p>

    <h3>Component scope</h3>
    <pre>// components/my-card.ts
import { WebComponent, html, css } from '@webjsdev/core';

const STYLES = css\`
  my-card {
    .body  { padding: 16px; border: 1px solid var(--border); }
    .title { font-weight: 600; }
  }
\`;

export class MyCard extends WebComponent {
  render() {
    return html\`
      &lt;style&gt;\${STYLES.text}&lt;/style&gt;
      &lt;div class="body"&gt;
        &lt;h3 class="title"&gt;\${this.title}&lt;/h3&gt;
      &lt;/div&gt;
    \`;
  }
}
MyCard.register('my-card');</pre>

    <h3>Primitives stay intentionally global</h3>
    <p>A small curated set of design-system classes (<code>rubric</code>, <code>banner</code>, <code>accent-link</code>, <code>display-h1</code>, <code>code-chip</code>, …) lives once in the root layout and is intentionally global. These are your design system, treated the way Bootstrap treats <code>.btn</code>. Everything else is scoped.</p>

    <h3>Tradeoffs vs Tailwind</h3>
    <ul>
      <li><strong>More per-file CSS to write</strong>: no utility ecosystem.</li>
      <li><strong>Wrapper discipline</strong>: every page and every layout remembers to wrap.</li>
      <li><strong>Rename cost</strong>: moving <code>app/dashboard/</code> → <code>app/admin/</code> is 2 textual edits in one file: the <code>.page-dashboard</code> selector in the <code>css\`…\`</code> block and the matching <code>class="page-dashboard"</code> on the wrapper div.</li>
    </ul>
    <p>You get in return: no browser-runtime script, no <code>@theme</code> block, idiomatic CSS you can debug with plain DevTools, and a cascade that works exactly the way you read it.</p>

    <p><strong>Pick one styling convention per project and stay consistent.</strong> The default is Tailwind. The scoped-wrapper convention above is the supported alternative when you want plain CSS end-to-end.</p>

    <h2>How SSR works for each mode</h2>
    <ul>
      <li><strong>Light DOM:</strong> component content is serialised as direct children of the custom element with a leading <code>&lt;!--webjs-hydrate--&gt;</code> marker. Global stylesheets paint immediately. On connect the client renderer replaces the marker with rendered content (identical output for unchanged state, no flash).</li>
      <li><strong>Shadow DOM:</strong> component content is serialised inside a <code>&lt;template shadowrootmode="open"&gt;</code>. The browser attaches the shadow root automatically, so styles paint before any JS loads. On connect the component upgrades and adopts the same stylesheet via <code>adoptedStyleSheets</code>, so SSR and client styles stay in sync.</li>
    </ul>
  `;
}
