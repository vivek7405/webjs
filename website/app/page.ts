import { html } from '@webjsdev/core';
import '#components/copy-cmd.ts';
import '#components/like-button.ts';
import { COMPONENT_SAMPLE, ACTION_SAMPLE, PAGE_SAMPLE, USAGE_SAMPLE } from '#lib/samples.ts';
import { DOCS_PATH, DOCS_START_PATH, GH_URL, NEW_TAB } from '#lib/links.ts';
// highlight() runs only at SSR (codeWindow renders its output into the served
// HTML), but it does ship to the client as a small dead module: the page loads
// in the browser to register copy-cmd, and that pulls in its
// top-level imports. This is an accepted cost. It cannot move to a .server.ts
// util (a server-only stub throws at load, and this is a page top-level import)
// and it is not elision-eligible (only display-only components are elided, and
// an elision-eligible component cannot take a reactive property, so routing the
// code through one would just duplicate the raw sample in the HTML). Its only
// dependency, html, is already loaded by the components, so the real cost is a
// single tiny module fetch.
import { highlight } from '#lib/highlight.ts';
import { BTN_PRIMARY, BTN_GHOST, INSTALL, ctaPanel } from '#lib/design.ts';

// The home page intentionally sets NO title/description/og here. The root
// layout's generateMetadata is the single source for the <title>, description,
// and the og/twitter tags, so they stay consistent (a page-level title override
// would win for <title> but leave og:/twitter: showing the layout's title,
// splitting the canonical share target's name across the tab and the social
// card). It DOES contribute site-level JSON-LD (WebSite + Organization +
// SoftwareApplication): metadata is shallow-merged layout-then-page, so adding
// only `jsonLd` leaves the layout's title/og untouched while emitting the
// structured data on the site's most-linked page.
const SITE_URL = 'https://webjs.dev';
export const metadata = {
  jsonLd: [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'WebJs',
      url: SITE_URL,
      description: 'An AI-first, web-components-first full-stack web framework with no build step.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'WebJs',
      url: SITE_URL,
      logo: `${SITE_URL}/public/favicon.png`,
      sameAs: ['https://github.com/webjsdev/webjs', 'https://discord.gg/qZScjWWNA8'],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'WebJs',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Node.js 24+, Bun',
      url: SITE_URL,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    },
  ],
};

// Framework-weight stats. Measured: gzipped production browser bundle,
// npm package metadata, and framework source line counts. Kept honest
// and comparative against a Next.js app's first-load JS (react + react-dom
// alone is ~44 KB. The ~99 KB is the full Next baseline, react + react-dom
// plus the Next runtime plus the app-router client).
const STATS = [
  { big: '~29 KB', label: 'Client runtime, gzipped', sub: 'A minimal Next.js client bundle is ~99 KB gzipped including React. WebJs is self-sufficient at ~29 KB, 3.4x lighter on the wire.' },
  { big: '0 build', label: 'Instant agent loops', sub: 'No compilation, no bundler. Agents edit, run tests, and verify in the browser in milliseconds.' },
  { big: '100%', label: 'Web standards', sub: 'Standard-aligned Web Component lifecycles, so models write components reliably.' },
  { big: '~16k', label: 'LLM-context friendly', sub: 'Under 6.5k lines of client runtime, ~16k for the whole stack, small enough to fit an LLM context window.' },
];

// The interactive component / server action / page samples live in
// #lib/samples.ts and render through codeWindow() in "Show, don't tell".

// Chips for the progressive-enhancement section: the concrete things that
// keep working with JavaScript disabled, because the server sends real HTML.
const PE_CHIPS = ['No hydration runtime', 'Content reads', 'Links navigate', 'Forms submit', 'Display components ship 0 KB'];

// A self-contained component for the progressive-enhancement pair. The
// reactive `count` prop reflects to an attribute, which is why the rendered
// output below carries count="3". Plain strings keep backticks / ${...}
// literal so the SSR highlighter colors them.
const PE_COMPONENT = `class LikeButton extends WebComponent({ count: Number }) {
  render() {
    return html\`<button @click=\${() => this.count++}>
      ♥ \${this.count}
    </button>\`;
  }
}
LikeButton.register('like-button');`;

const SSR_OUTPUT = `<like-button count="3">
  <button>♥ 3</button>
</like-button>`;

// The hero stage shows this source beside the very component it declares,
// running. Keep the two in step: the panel to its right is a real
// <like-button>, so an edit here that drifts from components/like-button.ts
// turns the page's central claim into a lie.
const HERO_SAMPLE = `class LikeButton extends WebComponent({ count: Number }) {
  render() {
    return html\`<button @click=\${() => this.count++}>
      ♥ \${this.count}
    </button>\`;
  }
}
LikeButton.register('like-button');

// No build step. No bundler. No virtual DOM.
// The panel to the right is this file, server-rendered
// and upgraded in place. Click it.`;

const WIN = 'flex flex-col flex-1 m-0 min-w-0 max-w-full rounded-2xl overflow-hidden border border-border bg-bg-elev shadow-[var(--shadow)]';
const WINBAR = 'flex items-center gap-1.5 h-[42px] px-3.5 border-b border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,var(--color-bg-elev))]';
const WINNAME = 'ml-2 font-mono font-medium text-xs leading-none text-fg-subtle';
const DOTS = html`<span class="w-2.5 h-2.5 rounded-full bg-[#ff5f57]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#febc2e]"></span><span class="w-2.5 h-2.5 rounded-full bg-[#28c840]"></span>`;
// Bento-grid card wrapper, shared by the "Why webjs" and "Small by design" cells.
const CARD = 'p-6 bg-bg-elev hover:bg-[color-mix(in_oklch,var(--bg-elev)_92%,var(--fg))] transition-colors duration-200 flex flex-col justify-between h-full';

function codeWindow(title: string, sample: string) {
  return html`
    <figure class=${WIN}>
      <figcaption class=${WINBAR}>${DOTS}<span class=${WINNAME}>${title}</span></figcaption>
      <pre class="scroll-thin m-0 p-[18px] overflow-x-auto font-mono text-sm leading-[1.7] [tab-size:2] flex-1" tabindex="0" aria-label=${title + ' code sample'}><code>${highlight(sample)}</code></pre>
    </figure>
  `;
}

export default function LandingPage() {
  return html`
    <style>
      /* Editor + code tokens for the Show-dont-tell code windows and the
         Why-webjs code cards. The editor surfaces reference the theme's own
         semantic tokens, so they track light/dark with no duplication; only
         the three syntax hues need a dark override. */
      :root {
        --editor-bg: var(--bg-elev);
        --editor-sidebar-bg: var(--bg-sunken);
        --editor-tab-bg: var(--bg-sunken);
        --editor-active-tab-bg: var(--bg-elev);
        --editor-status-bg: var(--bg-sunken);
        --editor-border: var(--border);
        --editor-fg: var(--fg);
        --editor-gutter-fg: var(--fg-subtle);
        --editor-gutter-border: var(--border);
        --code-tag: oklch(0.55 0.13 250);
        --code-attr: oklch(0.52 0.16 150);
        --code-str: oklch(0.55 0.13 145);
        --code-text: var(--fg);
        --code-punc: var(--fg-muted);
      }
      :root[data-theme='dark'] {
        --code-tag: oklch(0.78 0.13 250); --code-attr: oklch(0.66 0.16 150); --code-str: oklch(0.80 0.15 145);
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) { --code-tag: oklch(0.78 0.13 250); --code-attr: oklch(0.66 0.16 150); --code-str: oklch(0.80 0.15 145); }
      }
      /* Syntax-highlight token colors (.t-kw / .t-str / ...) are defined
         globally in public/input.css so every surface (this page and the
         blog code fences) shares one palette. */
      /* The live like-button demo: a bare light-DOM button the page styles
         into a pill (tag-prefixed, per the light-DOM CSS rule). */
      like-button button {
        display: inline-flex; align-items: center; gap: 0.375rem;
        padding: 0.375rem 0.75rem;
        border: 1px solid var(--border);
        border-radius: 0.5rem;
        background: var(--bg-elev);
        color: var(--fg);
        font-size: 13px; font-weight: 500; line-height: 1;
        cursor: pointer;
        transition: border-color 140ms, background-color 140ms;
      }
      like-button button:hover { border-color: var(--border-strong); }
      /* The hero copy of the same element, scaled up. It is the one thing on
         the page a reader is invited to click, so it is sized as a control
         rather than as an inline badge, and it is the single surface where the
         brand accent appears as a hover state. */
      .hero-stage like-button button {
        gap: 0.5rem;
        padding: 0.7rem 1.25rem;
        border-radius: 0.75rem;
        font-size: 16px;
        font-weight: 600;
      }
      .hero-stage like-button button:hover {
        border-color: var(--accent);
        background: color-mix(in oklch, var(--accent) 10%, var(--bg-elev));
      }
      .hero-stage like-button button:active { transform: translateY(1px); }
    </style>

    <main id="main" tabindex="-1" class="focus:outline-none">
    <section class="px-6 pt-[clamp(52px,7.5vw,112px)] pb-[clamp(40px,6vw,72px)]">
      <div class="text-center">
        <h1 class="font-display font-extrabold text-display leading-[0.98] tracking-[-0.042em] mx-auto mt-2 mb-6 max-w-[16ch] text-balance">
          The web framework for AI agents
        </h1>
        <p class="text-lede leading-[1.55] text-fg-muted max-w-[62ch] mx-auto mb-9 text-pretty">
          WebJs is a full-stack framework built on <span class="text-fg font-medium">web components</span>, SSR, and
          progressive enhancement with <span class="text-fg font-medium">zero build step</span>.
          Lean enough for an agent to read end to end. Runs on Node 24+ or Bun.
        </p>
        <div class="flex gap-3 justify-center flex-wrap items-center">
          <a class=${BTN_PRIMARY} href=${DOCS_START_PATH}>
            Get started
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
          </a>
          <a class=${BTN_GHOST} href=${GH_URL} target="_blank" rel="noopener noreferrer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.37.5 0 5.78 0 12.29c0 5.2 3.44 9.6 8.21 11.16.6.11.82-.25.82-.58l-.01-2.03c-3.34.71-4.04-1.58-4.04-1.58-.55-1.36-1.34-1.72-1.34-1.72-1.09-.73.08-.72.08-.72 1.2.08 1.84 1.22 1.84 1.22 1.07 1.8 2.81 1.28 3.5.98.11-.76.42-1.28.76-1.58-2.67-.3-5.47-1.31-5.47-5.83 0-1.29.47-2.34 1.23-3.17-.12-.3-.53-1.51.12-3.15 0 0 1-.32 3.3 1.21a11.5 11.5 0 0 1 6 0c2.3-1.53 3.3-1.21 3.3-1.21.65 1.64.24 2.85.12 3.15.77.83 1.23 1.88 1.23 3.17 0 4.53-2.81 5.53-5.49 5.82.43.37.81 1.1.81 2.22l-.01 3.29c0 .33.22.7.83.58A12.01 12.01 0 0 0 24 12.29C24 5.78 18.63.5 12 .5z"/></svg>
            Star on GitHub${NEW_TAB}
          </a>
        </div>
        <div class="mt-6 flex justify-center">
          <div class=${INSTALL}>
            <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
          </div>
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Real HTML first. JavaScript only when it earns it.</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0">
            Pages and components render to real HTML on the server, so the page
            reads, links navigate, and forms submit before a single script loads.
            There is no hydration runtime to pay for, and dead JavaScript is
            statically elided, never shipped.
          </p>
        </div>

        <div class="hero-stage max-w-6xl mx-auto grid grid-cols-1 min-[880px]:grid-cols-[1.12fr_0.88fr] rounded-[16px] overflow-hidden border border-border-strong bg-bg-sunken shadow-[var(--shadow)]">
          <div class="min-w-0 border-b min-[880px]:border-b-0 min-[880px]:border-r border-border">
            <div class=${WINBAR}>${DOTS}<span class=${WINNAME}>components/like-button.ts</span></div>
            <pre class="scroll-thin m-0 p-5 overflow-x-auto font-mono text-xs leading-[1.72] [tab-size:2] text-left" tabindex="0" aria-label="like-button component source"><code>${highlight(HERO_SAMPLE)}</code></pre>
          </div>
          <div class="flex flex-col min-w-0 bg-bg">
            <input type="checkbox" id="stage-usage" class="sr-only peer" />
            <div class="flex items-center justify-between gap-2 h-[42px] px-3.5 border-b border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,var(--color-bg-elev))]">
              <span class="inline-flex items-center gap-1.5 font-mono text-2xs text-fg-subtle">
                <span class="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)] peer-checked:opacity-0"></span>live
              </span>
              <label for="stage-usage" class="cursor-pointer select-none font-mono font-semibold text-2xs tracking-[0.08em] uppercase text-fg-subtle hover:text-fg transition-colors px-2 py-1 -mr-1 rounded-[7px] hover:bg-[var(--hover-surface)]">
                <span class="peer-checked:hidden">Show usage</span>
                <span class="hidden peer-checked:inline">Show rendered</span>
              </label>
            </div>
            <div class="flex-1 grid place-items-center px-6 py-10 peer-checked:hidden">
              <like-button count="3"></like-button>
            </div>
            <pre class="hidden peer-checked:block flex-1 m-0 p-5 overflow-x-auto font-mono text-xs leading-[1.72] text-left" aria-label="like-button usage"><code>${highlight(USAGE_SAMPLE)}</code></pre>
            <div class="px-4 py-3 border-t border-border text-center font-mono text-2xs leading-[1.5] text-fg-subtle">
              Server-rendered first, then upgraded. Click it.
            </div>
          </div>
        </div>

        <div class="flex flex-wrap gap-2.5 justify-center mt-8">
          ${PE_CHIPS.map(c => html`<span class="text-xs font-medium leading-none text-fg-muted px-3.5 py-2 rounded-full border border-border bg-bg-elev/40 backdrop-blur-sm shadow-[var(--shadow-sm)] hover:border-border-strong hover:bg-bg-subtle transition-all duration-[140ms]">${c}</span>`)}
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-7xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">The whole stack, in three files</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0">A component, a server action, and a page. No build, no boilerplate, all web standards.</p>
        </div>
        <div class="grid gap-4 grid-cols-1 max-w-2xl mx-auto min-[900px]:grid-cols-3 min-[900px]:max-w-none">
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">Interactive component</p>
            ${codeWindow('components/like-button.ts', COMPONENT_SAMPLE)}
          </div>
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">Server action (RPC)</p>
            ${codeWindow('actions/get-post.server.ts', ACTION_SAMPLE)}
          </div>
          <div class="flex flex-col min-w-0">
            <p class="text-sm font-medium leading-[1.4] text-fg-subtle mb-2.5 ml-1">SSR page</p>
            ${codeWindow('app/posts/[id]/page.ts', PAGE_SAMPLE)}
          </div>
        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Modern full-stack, on web standards</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0">Everything you need to ship, none of the build toolchain you don't.</p>
        </div>
        <div class="grid gap-px overflow-hidden rounded-2xl border border-border bg-border grid-cols-1 min-[560px]:grid-cols-2 min-[900px]:grid-cols-3 shadow-[var(--shadow-sm)]">

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-[1.05rem] leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Zero build step</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Source files run as-is, so what you write is exactly what the browser serves. An AI agent debugs against the real served code, never a bundled or minified artifact.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 font-mono text-2xs leading-[1.6] text-[var(--editor-fg)]">
              <div class="flex items-center gap-1.5 text-fg-subtle mb-2 border-b border-[var(--editor-border)] pb-1.5 select-none">
                <span class="w-2 h-2 rounded-full bg-[#28c840]"></span><span>bun dev</span>
              </div>
              <div><span class="text-fg-subtle">$</span> bun run dev<br><span class="text-fg-subtle">Ready on http://localhost:5001</span><br><span class="text-fg-muted">page.ts reloaded in 3ms</span></div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-[1.05rem] leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Light DOM web components</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Web components that render to light DOM, so Tailwind and global CSS just work, no shadow plumbing.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 font-mono text-2xs leading-[1.5] select-none text-[var(--editor-fg)]">
              <div class="text-[var(--code-punc)]">&lt;<span class="text-[var(--code-tag)]">like-button</span>&gt;</div>
              <div class="pl-4 text-[var(--code-punc)]">&lt;<span class="text-[var(--code-tag)]">button</span> <span class="text-[var(--code-attr)]">class</span>=<span class="text-[var(--code-str)]">"px-3 rounded bg-accent"</span>&gt;</div>
              <div class="pl-8 text-[var(--code-text)]">&hearts; Like</div>
              <div class="pl-4 text-[var(--code-punc)]">&lt;/<span class="text-[var(--code-tag)]">button</span>&gt;</div>
              <div class="text-[var(--code-punc)]">&lt;/<span class="text-[var(--code-tag)]">like-button</span>&gt;</div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-[1.05rem] leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Server actions (RPC)</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Mark a file <code class="font-mono text-[0.9em]">'use server'</code> and import it. Date, Map, Set, BigInt, and Blob all round-trip across the wire with real http verbs (GET, POST, PUT, PATCH, DELETE).</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 flex items-center justify-between text-2xs font-mono select-none text-[var(--editor-fg)]">
              <div class="text-fg-subtle px-2 py-1 bg-[var(--editor-bg)] rounded border border-[var(--editor-border)]">Client</div>
              <div class="flex-1 flex items-center justify-center relative"><span class="h-px bg-[var(--editor-border)] flex-1 mx-2"></span><span class="absolute text-2xs bg-[var(--editor-sidebar-bg)] text-[var(--accent-text)] px-1 border border-[var(--editor-border)] rounded">RPC</span></div>
              <div class="text-fg-subtle px-2 py-1 bg-[var(--editor-bg)] rounded border border-[var(--editor-border)]">Server action</div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-[1.05rem] leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Streaming Suspense</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Stream slow regions progressively. The shell paints instantly, fallbacks render, and async data fills in as it resolves.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 flex flex-col gap-2 text-[var(--editor-fg)]">
              <div class="h-3 w-1/3 bg-[var(--editor-border)] rounded"></div>
              <div class="h-8 w-full bg-[var(--editor-bg)] rounded border border-[var(--editor-border)] flex items-center px-3 gap-2 select-none">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-text)]"></span><span class="text-2xs font-mono text-fg-subtle">streaming data chunk...</span>
              </div>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-[1.05rem] leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Progressive enhancement</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Real HTML first. Links navigate, forms submit, and pages read before JavaScript loads. No hydration overhead.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-3.5 flex flex-wrap gap-1.5 justify-center select-none text-[var(--editor-fg)]">
              <span class="px-2 py-1 bg-bg-subtle border border-border text-fg-muted text-2xs font-mono rounded">No hydration lock</span>
              <span class="px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] text-fg-subtle text-2xs font-mono rounded">Static elision</span>
            </div>
          </div>

          <div class="${CARD}">
            <div class="mb-6">
              <h3 class="font-display font-bold text-[1.05rem] leading-[1.3] tracking-[-0.02em] mt-0 mb-2">Built-in essentials</h3>
              <p class="m-0 text-sm leading-[1.6] text-fg-muted">Auth, sessions, cache, rate limits, and websockets are built right in. Pluggable adapters, zero glue.</p>
            </div>
            <div class="bg-[var(--editor-sidebar-bg)] border border-[var(--editor-border)] rounded-xl p-2.5 flex flex-col gap-1.5 font-mono text-2xs text-[var(--editor-fg)] select-none">
              <div class="flex justify-between items-center px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] rounded"><span>Auth &amp; sessions</span> <span class="text-[var(--accent-text)]">&check;</span></div>
              <div class="flex justify-between items-center px-2 py-1 bg-[var(--editor-bg)] border border-[var(--editor-border)] rounded"><span>Rate limiting</span> <span class="text-[var(--accent-text)]">&check;</span></div>
            </div>
          </div>

        </div>
      </div>
    </section>

    <section class="py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Light enough for AI</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6] m-0">A zero build step means the source you read is what runs. Because the framework ships without compilation layers, an AI agent can read and reason about the entire WebJs source end to end, straight from node_modules.</p>
        </div>
        <div class="grid gap-px bg-border grid-cols-1 min-[560px]:grid-cols-2 min-[900px]:grid-cols-4 rounded-2xl border border-border overflow-hidden shadow-[var(--shadow-sm)]">
          ${STATS.map(s => html`
            <div class="p-8 text-center bg-bg-elev hover:bg-[color-mix(in_oklch,var(--bg-elev)_92%,var(--fg))] transition-colors">
              <div class="font-display font-extrabold leading-none tracking-[-0.03em] text-[clamp(1.9rem,1.3rem+1.6vw,2.7rem)] text-fg">${s.big}</div>
              <div class="mt-3 font-semibold text-[0.95rem]">${s.label}</div>
              <p class="mt-1.5 m-0 text-sm leading-[1.55] text-fg-muted">${s.sub}</p>
            </div>
          `)}
        </div>
        <p class="mt-8 mx-auto max-w-3xl text-center text-[1.02rem] leading-[1.6] text-fg-muted">Familiar from day one. WebJs uses Next.js-style file-based routing and lit-style web components, conventions both people and agents already know.</p>
        <p class="mt-6 mx-auto max-w-3xl text-center text-fg-subtle text-xs leading-[1.5]">Gzipped production sizes. A Next.js app ships a client bundle around ~99 KB gzipped (react, react-dom, and the Next runtime); <code class="font-mono">@webjsdev/core</code> is self-sufficient at ~29 KB gzipped with zero runtime dependencies and no build step.</p>
      </div>
    </section>

    <section id="templates" class="scroll-mt-24 py-16">
      <div class="max-w-6xl mx-auto px-6">
        <div class="max-w-3xl mx-auto mb-12 text-center">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance">Start where you are</h2>
        </div>
        <div class="grid gap-4 grid-cols-1 max-w-2xl mx-auto min-[900px]:grid-cols-2 min-[900px]:max-w-3xl">
          <div class="flex flex-col gap-3 p-6 min-w-0 rounded-2xl border border-border bg-bg-elev">
            <span class="text-xs font-medium leading-none text-fg-subtle">Full-stack</span>
            <h3 class="font-display font-bold text-[1.15rem] leading-[1.25] m-0">Pages + API + components</h3>
            <p class="m-0 text-sm leading-[1.6] text-fg-muted">SSR pages, web components, server actions, Drizzle, streaming, and a browsable feature gallery. Auth (login, sessions, a protected route) ships as a gallery card. The default.</p>
            <pre class="scroll-thin m-0 px-3.5 py-3 overflow-x-auto rounded-[10px] border border-border bg-bg-sunken font-mono text-xs leading-[1.6] text-fg-muted" tabindex="0" aria-label="Example files">app/page.ts
components/counter.ts
actions/posts.server.ts</pre>
            <div class="cmd-foot pt-2 mt-auto font-mono text-xs leading-[1.6] text-fg-muted max-w-full min-w-0"><copy-cmd>npm create webjs@latest my-app</copy-cmd></div>
          </div>
          <div class="flex flex-col gap-3 p-6 min-w-0 rounded-2xl border border-border bg-bg-elev">
            <span class="text-xs font-medium leading-none text-fg-subtle">Backend (API)</span>
            <h3 class="font-display font-bold text-[1.15rem] leading-[1.25] m-0">Route handlers + Database</h3>
            <p class="m-0 text-sm leading-[1.6] text-fg-muted">A backend-only app, no UI or SSR. File-based route handlers, modules, middleware, rate limiting, WebSockets, a database, and a backend-features gallery.</p>
            <pre class="scroll-thin m-0 px-3.5 py-3 overflow-x-auto rounded-[10px] border border-border bg-bg-sunken font-mono text-xs leading-[1.6] text-fg-muted" tabindex="0" aria-label="Example files">app/api/users/route.ts
app/api/chat/route.ts
middleware.ts</pre>
            <div class="cmd-foot pt-2 mt-auto font-mono text-xs leading-[1.6] text-fg-muted max-w-full min-w-0"><copy-cmd>npm create webjs@latest my-api -- --template api</copy-cmd></div>
          </div>
        </div>
        <p class="mt-8 mx-auto max-w-3xl text-center text-fg-subtle text-sm leading-[1.55]">Prefer Bun? Add <code class="font-mono">--runtime bun</code> to either template, or run <code class="font-mono">bun create webjs my-app</code> to flavor the scaffold for Bun automatically.</p>
      </div>
    </section>

    ${ctaPanel({
      title: 'Start building with AI',
      lede: 'Run the command below in your terminal, launch your AI coding agent from the app folder, and tell it what you would like to build.',
      primary: { href: DOCS_START_PATH, label: 'Get started' },
      secondary: { href: DOCS_PATH, label: 'Read the docs' },
    })}

    </main>
  `;
}
