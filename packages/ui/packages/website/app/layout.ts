import { html, cspNonce } from '@webjsdev/core';
import './_components/theme-toggle.ts';

/**
 * Sibling-app URLs are read from env so the same code works in
 * `webjs dev` (localhost) and in deployment (real hosts). Fallbacks
 * are the canonical localhost dev ports (matching the matching apps'
 * `webjs:dev --port` flags). Deploy by overriding WEBSITE_URL in the
 * service env (Railway, etc.); `.env.example` in this directory
 * documents the same defaults for visibility.
 *
 * Guarded against `process` being undefined: this file also loads
 * on the client during hydration.
 */
const env = (globalThis as any).process?.env ?? {};
const WEBSITE_URL = env.WEBSITE_URL || 'http://localhost:5001';
// The docs are a path on the website now, so this is derived rather than
// configured. One less service env var, and it cannot drift from WEBSITE_URL.
const DOCS_URL = WEBSITE_URL + '/docs';

const TITLE = 'WebJs UI - The AI-First Component Library for WebJs';
const DESCRIPTION =
  'The AI-first component library for WebJs. Two-tier composition: class-helper functions for visuals, custom elements only where state matters. Source-copied into your project, styled with Tailwind v4.';

// Per-request metadata so the OG image URL can be absolute (scrapers
// require http(s)). Mirrors website/app/layout.ts's generateMetadata
// pattern verbatim: same shape, same fields, content swapped for UI.
export function generateMetadata(ctx: { url: string }) {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/og.png`;
  // Site-wide canonical, derived here so every page gets one from a single
  // place (this site had none at all). Built from origin plus pathname, so
  // tracking query strings and a stray trailing slash collapse onto one URL
  // instead of splitting ranking signals. Mirrors website/app/layout.ts.
  const { pathname } = new URL(ctx.url);
  const canonical = origin + (pathname === '/' ? '' : pathname.replace(/\/+$/, ''));
  return {
    // The component showcase is identical for every visitor, so cache at the
    // CDN. Set on the root layout so it applies to every page.
    cacheControl: 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    alternates: { canonical },
    title: TITLE,
    description: DESCRIPTION,
    themeColor: '#1c1613',
    openGraph: {
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      url: origin,
      image,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': 'WebJs UI - AI-First Component Library',
      'site_name': 'WebJs UI',
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      image,
    },
  };
}

export default function Layout({ children }: { children: any }) {
  // Don't wrap in <!doctype><html><head><body>: the framework's SSR pipeline
  // emits those + hoists <link>/<style>/<meta>/<script> from this output into
  // the real <head>. Other markup goes into <body>.
  const nonce = cspNonce();
  return html`
    <!-- Raster first: Google's favicon crawler takes the first usable icon and
         wants a square whose side is a multiple of 48px. This previously
         declared sizes="32x32" for an asset that is really 512x512, which was
         both wrong and under the 48px floor. 192 is a clean multiple of 48,
         512 is not (512 % 48 = 32). Same fix as website/app/layout.ts. -->
    <link rel="icon" href="/public/favicon-192.png" type="image/png" sizes="192x192" />
    <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" sizes="any" />
    <link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png" />
    <link rel="stylesheet" href="/public/tailwind.css" />
    <!-- Synchronous theme bootstrap: mirrors webjs.dev so saved themes
         apply before first paint and avoid FOUC. -->
    <script nonce="${nonce}">
      (function(){
        try {
          var t = localStorage.getItem('webjs_theme');
          if (t === 'light' || t === 'dark') {
            document.documentElement.dataset.theme = t;
          }
        } catch (_) {}
      })();
      // Mobile menu auto-close: close on link click (inside the panel)
      // AND on any click outside the menu. Same handler as webjs.dev
      // and the example blog.
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var a = t.closest('.mobile-menu a');
        if (a) {
          var d = a.closest('details');
          if (d) d.removeAttribute('open');
          return;
        }
        var open = document.querySelectorAll('.mobile-menu[open]');
        for (var i = 0; i < open.length; i++) {
          if (!open[i].contains(t)) open[i].removeAttribute('open');
        }
      });
    </script>
    <style>
      :root {
        color-scheme: light dark;

        /* Light theme (default): canonical webjs design-system tokens */
        --fg:            oklch(0.20 0.018 60);
        --fg-muted:      oklch(0.44 0.02 60);
        --fg-subtle:     oklch(0.50 0.02 65);
        --bg:            oklch(0.985 0.008 75);
        --bg-elev:       oklch(1 0 0);
        --bg-subtle:     oklch(0.96 0.008 75);
        --bg-sunken:     oklch(0.93 0.01 70);
        --border:        oklch(0.88 0.012 70 / 0.9);
        --border-strong: oklch(0.78 0.014 70 / 0.95);
        --accent:        oklch(0.54 0.16 52);
        --accent-hover:  oklch(0.5 0.16 52);
        --accent-fg:     oklch(1 0 0);
        --accent-live:   oklch(0.63 0.17 50);
        --accent-tint:   color-mix(in oklch, var(--accent-live) 14%, transparent);
        --accent-text:    var(--accent);
        --accent-surface: color-mix(in oklch, var(--accent-live) 12%, transparent);
        --accent-border:  color-mix(in oklch, var(--accent-live) 28%, transparent);
        /* Logo mark gradient: the exact warm-orange stops webjs.dev uses, so
           the brand mark reads identically across the site, the docs and the
           example blog. NOT a color-mix with --fg (that muddied the mark). */
        --logo-from:     oklch(0.63 0.17 50);
        --logo-to:       oklch(0.44 0.11 52);
        --glow-a:        oklch(0.63 0.17 44);
        --glow-strength: 0.16;

        --font-display: 'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif;
        --font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        --font-serif: ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, Cambria, serif;
        --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

        /* Spacing + radii + shadows: same scale as webjs.dev */
        --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
        --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 72px;
        --rad-sm: 4px; --rad: 8px; --rad-lg: 12px; --rad-xl: 16px;
        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.05);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04);

        /* Fluid type tokens */
        --fs-display: clamp(2.6rem, 1.6rem + 3vw, 4rem);
        --fs-h1:      clamp(2rem, 1.5rem + 1.6vw, 2.6rem);
        --fs-h2:      clamp(1.3rem, 1.1rem + 0.7vw, 1.6rem);
        --fs-lede:    clamp(1.05rem, 0.95rem + 0.3vw, 1.18rem);

        --t-fast: 140ms;
        --t:      220ms;
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) {
          --fg:            oklch(0.96 0 0);
          --fg-muted:      oklch(0.74 0 0);
          --fg-subtle:     oklch(0.62 0 0);
          --bg:            oklch(0 0 0);
          --bg-elev:       oklch(0.135 0 0);
          --bg-subtle:     oklch(0.09 0 0);
          --bg-sunken:     oklch(0 0 0);
          --border:        oklch(0.32 0 0 / 0.9);
          --border-strong: oklch(0.44 0 0 / 0.92);
          --accent:        oklch(0.7 0.16 52);
          --accent-hover:  oklch(0.75 0.16 52);
          --accent-fg:     oklch(0.1 0.01 52);
          --logo-from:     oklch(0.8 0.16 58);
          --logo-to:       oklch(0.62 0.18 44);
          --glow-strength: 0.16;
          --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.3);
          --shadow:    0 4px 24px oklch(0 0 0 / 0.4);
        }
      }
      /* Explicit dark toggle MUST also flip color-scheme so the browser
         paints UA-controlled chrome (native select popups, scrollbars,
         system-color keywords Canvas/CanvasText/Highlight, native
         validation bubbles) in dark. Without this the page-level CSS
         tokens darken but every browser-painted UI element stays in the
         OS-preferred scheme, most visibly with the native-select dropdown
         paints near-white and bg-[Canvas] options blend invisibly into
         it (only the hover/selected option shows up). The :root default
         declares color-scheme: light dark, so this override is required
         only when the OS preference disagrees with the explicit toggle. */
      :root[data-theme='dark'] {
        color-scheme: dark;
        --fg:            oklch(0.96 0 0);
        --fg-muted:      oklch(0.74 0 0);
        --fg-subtle:     oklch(0.62 0 0);
        --bg:            oklch(0 0 0);
        --bg-elev:       oklch(0.135 0 0);
        --bg-subtle:     oklch(0.09 0 0);
        --bg-sunken:     oklch(0 0 0);
        --border:        oklch(0.32 0 0 / 0.9);
        --border-strong: oklch(0.44 0 0 / 0.92);
        --accent:        oklch(0.7 0.16 52);
        --accent-hover:  oklch(0.75 0.16 52);
        --accent-fg:     oklch(0.1 0.01 52);
        --logo-from:     oklch(0.8 0.16 58);
        --logo-to:       oklch(0.62 0.18 44);
        --glow-strength: 0.16;
        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.3);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.4);
      }

      /* Explicit light toggle on a dark OS: same UA-chrome problem in
         the other direction. Without color-scheme: light here, a user
         on a dark OS who picks the light theme gets light page tokens
         but dark browser chrome (dark scrollbars, dark native popups). */
      :root[data-theme='light'] {
        color-scheme: light;
      }

      html, body { margin: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        transition: background var(--t) cubic-bezier(0.3, 0, 0.3, 1),
                    color var(--t) cubic-bezier(0.3, 0, 0.3, 1);
      }
      /* A single static gradient glow layer, the warm top-edge wash that
         matches webjs.dev. Faint by design; page content sits above it. */
      .glow-layer { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
      .glow-layer::before {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(58% 44% at 50% -4%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 100%), transparent), transparent 72%),
          radial-gradient(40% 36% at 88% 8%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 60%), transparent), transparent 70%);
      }
      /* Global selection: warm orange tint on chrome. Note we DO NOT
         force a color here. The earlier rule forced selected text to
         var(--fg) (dark in light mode), which collided with the bare
         pre rule below: that block paints code blocks always-dark
         regardless of theme, so its content uses a light cream
         foreground. Forcing dark fg on selected pre text in light
         mode painted dark-on-dark and the selection appeared empty.
         Letting the browser keep each element's native fg colour
         on selection works against both the light chrome and the
         dark code-block surface.

         IMPORTANT: do NOT wrap the identifiers above in U+0060
         (the GRAVE ACCENT character). This CSS comment lives inside
         an html tagged template literal, and that character here closes
         the template at JS-parse time, before the HTML parser ever
         sees the style block. It caused a prod 500 once; don't
         re-introduce it. (Caught via
         [[feedback_html_template_no_backticks]].) */
      ::selection { background: var(--accent-tint); }

      /* Code-block selection needs a much stronger tint because the
         pre surface is always dark (~oklch 0.18), so --accent-tint at
         8% alpha is invisible composited over it. A 35% mix reads
         cleanly on the dark surface while keeping the light cream
         text legible. Targets pre ::selection (descendants) so it
         applies to text wrapped in <code> / <span> inside the
         pre, which is the common Highlight.js / Shiki output. */
      pre ::selection, pre::selection {
        background: color-mix(in oklch, var(--accent) 35%, transparent);
      }

      /* Prose links inside .prose blocks get the brand-warm accent.
         Note: do NOT add unscoped 'a { color: ... }' rules here -
         they would override Tailwind utility classes (utilities live
         inside @layer utilities; outside-layer rules win), silently
         breaking every text-fg / text-fg-muted class on the chrome
         (header logo, nav links, footer links). */
      .prose a { color: var(--accent); text-decoration: none; }
      .prose a:hover { color: var(--accent-hover); text-decoration: underline; }

      /* Code-block surface, always dark regardless of theme (mirrors how
         the shadcn website renders <pre> blocks: a dedicated dark surface
         that reads consistently against any page background). Padding +
         radius are part of the surface, not the wrapper. Without them
         the dark rectangle bleeds to the card edges in light mode. */
      .bg-code, pre.bg-muted, pre {
        background: oklch(0.18 0.01 55);
        color: oklch(0.92 0.008 80);
        border: 1px solid color-mix(in oklch, oklch(0.18 0.01 55) 80%, var(--border));
        border-radius: 8px;
        padding: 16px;
        overflow-x: auto;
      }
      pre code { color: inherit; font-family: var(--font-mono); font-size: 12.5px; }

      /* Homepage Install + "How agents write it" samples sit flush on their
         card surface (no nested code-block tint). Higher specificity than the
         unlayered pre rule above so it wins without a cascade-layer fight. */
      pre.pre-bare { background: transparent; color: var(--fg); border: 0; padding: 0; }

      /* Default border-color for chrome-level .border / .border-b / .border-t
         elements. Wrapped in @layer base so it sits BELOW Tailwind v4's
         @layer utilities, so any Tailwind color utility (border-transparent,
         border-input, etc.) wins via the cascade layer order
         (theme < base < components < utilities), regardless of source
         position or selector specificity. Without this wrapping, the
         broad rule was unlayered and therefore stronger than every
         Tailwind utility: tabs triggers using "border border-transparent"
         couldn't override the chrome's border colour.

         (Do not put U+0060 GRAVE ACCENT characters in this comment -
         this is inside the layout's html tagged template. See
         [[feedback-html-template-no-backticks]].) */
      @layer base {
        .border, .border-b, .border-t { border-color: var(--border); border-style: solid; border-width: 0; }
        .border { border-width: 1px; }
        .border-b { border-bottom-width: 1px; }
        .border-t { border-top-width: 1px; }
      }

      /* Docs prose: serif headings + body, matching webjs's editorial tone. */
      .prose h1 { font: 700 var(--fs-h1)/1.15 var(--font-serif); letter-spacing: -0.025em; color: var(--accent); margin: 0 0 16px; }
      .prose h2 { font: 700 var(--fs-h2)/1.2 var(--font-serif); margin: 40px 0 12px; padding-top: 24px; border-top: 1px solid var(--border); }
      .prose p, .prose li { color: var(--fg); margin: 12px 0; }
      .prose code { font-family: var(--font-mono); font-size: 0.9em; padding: 1px 5px; background: var(--bg-subtle); border-radius: 4px; }
      .prose pre { background: var(--bg-sunken); padding: 16px; border-radius: 8px; overflow-x: auto; }
      .prose pre code { background: transparent; padding: 0; }

      /* Thin themed horizontal scrollbar: only visible when content overflows. */
      .scrollbar-thin { scrollbar-width: thin; scrollbar-color: transparent transparent; }
      .scrollbar-thin:hover, .scrollbar-thin:focus-within { scrollbar-color: var(--border-strong) transparent; }
      .scrollbar-thin::-webkit-scrollbar { height: 8px; width: 8px; }
      .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
      .scrollbar-thin::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; transition: background 120ms ease; }
      .scrollbar-thin:hover::-webkit-scrollbar-thumb,
      .scrollbar-thin:focus-within::-webkit-scrollbar-thumb { background: var(--border-strong); }
      .scrollbar-thin::-webkit-scrollbar-thumb:hover { background: var(--fg-subtle); }

      /* Announce strip: matches webjs.dev exactly. */
      .announce {
        background: var(--accent-tint);
        border-bottom: 1px solid var(--border);
        color: var(--fg);
        font: 500 13px/1.4 var(--font-sans);
        text-align: center;
        padding: 8px 16px;
      }
      .announce a { color: var(--accent); text-decoration: none; font-weight: 600; }
      .announce a:hover { text-decoration: underline; }
      .announce .tag {
        display: inline-block;
        font: 700 10px/1 var(--font-mono);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--accent);
        background: color-mix(in oklch, var(--accent) 15%, transparent);
        padding: 3px 7px;
        border-radius: 999px;
        margin-right: 8px;
        vertical-align: middle;
      }

      /* Mobile menu: native <details>/<summary>, same shape as webjs.dev
         and the docs / blog apps. Strip the disclosure triangle and
         swap the hamburger / close icons on toggle. */
      .mobile-menu > summary { list-style: none; }
      .mobile-menu > summary::-webkit-details-marker { display: none; }
      .mobile-menu > summary .close-icon { display: none; }
      .mobile-menu[open] > summary .open-icon { display: none; }
      .mobile-menu[open] > summary .close-icon { display: inline-block; }

      /* Cool, theme-aware syntax-highlight palette (matches the website).
         Applied on the client by /public/code-highlight.js, which tokenizes
         each server-rendered <pre> and wraps tokens in these classes. */
      .t-com { color: var(--fg-subtle); font-style: italic; }
      .t-str { color: oklch(0.52 0.13 150); }
      .t-kw  { color: oklch(0.52 0.16 295); font-weight: 600; }
      .t-fn  { color: oklch(0.52 0.15 250); }
      .t-type{ color: oklch(0.52 0.10 200); }
      .t-num { color: oklch(0.55 0.12 215); }
      :root[data-theme='dark'] .t-str { color: oklch(0.80 0.14 150); }
      :root[data-theme='dark'] .t-kw  { color: oklch(0.76 0.14 295); }
      :root[data-theme='dark'] .t-fn  { color: oklch(0.75 0.13 250); }
      :root[data-theme='dark'] .t-type{ color: oklch(0.80 0.10 200); }
      :root[data-theme='dark'] .t-num { color: oklch(0.82 0.12 215); }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) .t-str { color: oklch(0.80 0.14 150); }
        :root:not([data-theme='light']) .t-kw  { color: oklch(0.76 0.14 295); }
        :root:not([data-theme='light']) .t-fn  { color: oklch(0.75 0.13 250); }
        :root:not([data-theme='light']) .t-type{ color: oklch(0.80 0.10 200); }
        :root:not([data-theme='light']) .t-num { color: oklch(0.82 0.12 215); }
      }
    </style>

    <div class="glow-layer" aria-hidden="true"></div>

    <div class="relative z-[1]">
    <div class="announce">
      <span class="tag">v1</span>
      <a href=${WEBSITE_URL} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1.5">
        Part of Webjs, an AI-first framework
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14"></path><path d="m12 5 7 7-7 7"></path>
        </svg>
      </a>
    </div>

    <header class="flex items-center justify-between gap-4 max-w-5xl mx-auto px-4 sm:px-8 py-4">
      <a class="flex items-center gap-2 no-underline text-fg font-bold text-base leading-none tracking-tight" href="/">
        <span class="w-[22px] h-[22px] rounded-[7px] bg-gradient-to-br from-[var(--logo-from)] to-[var(--logo-to)] shadow-[0_2px_10px_var(--accent-tint)]"></span>
        Webjs UI
      </a>

      <!-- Inline nav, md and up -->
      <nav class="hidden md:flex items-center gap-4">
        <a class="text-fg-muted no-underline font-medium text-[13px] leading-none transition-colors duration-fast hover:text-fg" href="/docs/components/accordion">Components</a>
        <a class="text-fg-muted no-underline font-medium text-[13px] leading-none transition-colors duration-fast hover:text-fg" href="/docs">Docs</a>
        <a class="text-fg-muted no-underline font-medium text-[13px] leading-none transition-colors duration-fast hover:text-fg" href=${WEBSITE_URL} target="_blank">Webjs</a>
        <a class="text-fg-muted no-underline font-medium text-[13px] leading-none transition-colors duration-fast hover:text-fg" href="https://github.com/webjsdev/webjs" target="_blank">GitHub</a>
        <theme-toggle></theme-toggle>
      </nav>

      <!-- Mobile cluster: hamburger LEFT, theme-toggle RIGHT (uniform
           with webjs.dev and the blog example). -->
      <div class="flex items-center gap-2 md:hidden">
        <details class="mobile-menu relative">
          <summary class="list-none cursor-pointer w-9 h-9 inline-flex items-center justify-center rounded-md text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors duration-fast" aria-label="Toggle navigation">
            <svg class="open-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>
            </svg>
            <svg class="close-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </summary>
          <nav class="absolute right-0 top-[calc(100%+8px)] min-w-[200px] flex flex-col gap-1 bg-bg-elev border border-border rounded-lg shadow-lg p-2 z-50">
            <a class="text-fg-muted no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-bg-subtle hover:text-fg transition-colors duration-fast" href="/docs/components/accordion">Components</a>
            <a class="text-fg-muted no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-bg-subtle hover:text-fg transition-colors duration-fast" href="/docs">Docs</a>
            <a class="text-fg-muted no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-bg-subtle hover:text-fg transition-colors duration-fast" href=${WEBSITE_URL} target="_blank">Webjs</a>
            <a class="text-fg-muted no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-bg-subtle hover:text-fg transition-colors duration-fast" href="https://github.com/webjsdev/webjs" target="_blank">GitHub</a>
          </nav>
        </details>
        <theme-toggle></theme-toggle>
      </div>
    </header>

    <main class="max-w-5xl mx-auto px-6 sm:px-8 py-10">${children}</main>

    <footer class="border-t mt-20 py-8 text-center" style="color: var(--fg-subtle); font-size: 13px">
      <div class="max-w-5xl mx-auto px-6 sm:px-8">
        <a class="text-brand no-underline hover:underline" href=${WEBSITE_URL} target="_blank">Webjs</a> ·
        <a class="text-brand no-underline hover:underline" href=${DOCS_URL} target="_blank">Docs</a> ·
        <a class="text-brand no-underline hover:underline" href="https://github.com/webjsdev/webjs" target="_blank">GitHub</a>
      </div>
    </footer>
    </div>
    <script src="/public/code-highlight.js" defer></script>
  `;
}

// Touch to force a Railway redeploy of this app for the workspace router fixes in #151 and #157 (the watch path skips framework-only changes in packages/core).
