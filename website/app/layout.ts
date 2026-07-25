import { html, cspNonce } from '@webjsdev/core';
import '#components/theme-toggle.ts';
import { DOCS_URL, UI_URL, EXAMPLE_BLOG_URL, GH_URL, NEW_TAB } from '#lib/links.ts';
import { siteFooter } from '#lib/site-footer.ts';

/**
 * Root layout for the redesigned marketing site.
 *
 * Styling is Tailwind-first: chrome and structure use utility classes,
 * with the design tokens declared once in the foundation <style> below
 * and exposed to Tailwind via @theme in public/input.css. Only the
 * genuinely un-utility-expressible pieces stay as CSS: the prefers-reduced-motion
 * clamp, the fixed static glow layer, the hover-only scrollbar (`.scroll-thin`),
 * and the <details> icon swap. Everything else is Tailwind.
 *
 * Shared link config (DOCS_URL / UI_URL / EXAMPLE_BLOG_URL / GH_URL / NEW_TAB) lives in
 * lib/links.ts, imported here and by app/page.ts.
 */

const TITLE = 'WebJs - The Web Framework for AI Agents';
const DESCRIPTION = 'A model-agnostic full-stack web framework that needs no training data. An agent reads the whole stack end to end, so small models and large ones both ship production-ready architecture and a design system from the very first line of code. Web components, SSR, progressive enhancement, file-based routing, and server actions, with zero build step. Runs on Node 24+ or Bun.';
// Describes what the social card itself SAYS (public/og.png), which is the
// benefit-led line, not the page title. Kept in lockstep with the headline in
// scripts/generate-og.mjs.
const OG_IMAGE_ALT = 'WebJs, any AI model produces production-ready code';

const NAV = [
  { label: 'Docs', href: DOCS_URL + '/docs/getting-started', ext: true },
  { label: 'Why WebJs', href: '/why', ext: false },
  { label: 'UI', href: UI_URL, ext: true },
  { label: 'Demo', href: EXAMPLE_BLOG_URL, ext: true },
  { label: 'Blog', href: '/blog', ext: false },
  { label: 'Compare', href: '/compare', ext: false },
  { label: 'Changelog', href: '/changelog', ext: false },
  { label: 'GitHub', href: GH_URL, ext: true },
];

export function generateMetadata(ctx: { url: string }) {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/og.png`;
  // Site-wide canonical, derived here so EVERY page gets one from a single
  // place (the site had none at all, on any page). Built from origin +
  // pathname, so tracking query strings and a stray trailing slash all collapse
  // onto one canonical URL instead of splitting ranking signals across
  // near-duplicate addresses. A page that needs a different canonical overrides
  // `alternates` in its own generateMetadata (metadata merges layout then page).
  const { pathname } = new URL(ctx.url);
  const canonical = origin + (pathname === '/' ? '' : pathname.replace(/\/+$/, ''));
  return {
    alternates: { canonical },
    // The marketing site is identical for every visitor (no per-user / session
    // reads), so it is safe to cache at the CDN. Set on the root layout so it
    // applies to every page (a per-user page could override with no-store).
    // `s-maxage` is the edge cache; `max-age=0` keeps the browser revalidating;
    // `stale-while-revalidate` serves instantly while refreshing.
    cacheControl: 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    title: TITLE,
    description: DESCRIPTION,
    openGraph: {
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      url: origin,
      image,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': OG_IMAGE_ALT,
      'site_name': 'WebJs',
    },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, image },
  };
}

const navLink = 'text-fg-muted no-underline font-medium text-sm px-[11px] py-2 rounded-lg transition-colors duration-[140ms] hover:text-fg hover:bg-bg-subtle';
const panelLink = 'text-fg-muted no-underline font-medium text-sm px-3 py-[10px] rounded-[9px] hover:text-fg hover:bg-bg-subtle';

export default function RootLayout({ children }: { children: unknown }) {
  const nonce = cspNonce();
  return html`
    <!-- Favicons, ordered raster first on purpose. Google's favicon crawler takes
         the first usable icon and wants a SQUARE raster whose side is a multiple
         of 48px. This previously declared sizes="32x32" on an asset that is
         really 512x512: the claim was both wrong and under Google's 48px floor,
         which is why webjs.dev showed no icon in search results. 192 is used
         because it is a clean multiple of 48 (512 is not, 512 % 48 = 32).
         /favicon.ico is served from public/favicon.ico at the origin root and
         stays as the fallback for crawlers that read no markup at all. -->
    <link rel="icon" href="/public/favicon-192.png" type="image/png" sizes="192x192">
    <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" sizes="any">
    <link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png">

    <!-- Self-hosted fonts (declared via @font-face in input.css), preloaded so
         they fetch in parallel with the stylesheet instead of being discovered
         only after the CSS parses. The display face (Inter Tight, hero
         headline) and the body face (Inter) are the LCP text faces. JetBrains
         Mono is preloaded too: the hero install command is above-the-fold
         monospace text and the primary CTA, and a trace of the live site showed
         the un-preloaded mono file as the tail of the critical request chain
         (document, then tailwind.css, then the font, discovered late via its
         @font-face). Preloading it drops that hop so the command paints its
         final face without the late swap. Each family is one variable file
         covering every weight, so three small woff2 files over h2 is a cheap
         preload budget. -->
    <link rel="preload" href="/public/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/public/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/public/fonts/jetbrains-mono.woff2" as="font" type="font/woff2" crossorigin>

    <!-- Warm the analytics connection so the async gtag handshake (and the
         beacon to google-analytics.com it then opens) overlaps head parse
         instead of starting cold when the script tag is discovered. -->
    <link rel="preconnect" href="https://www.googletagmanager.com" crossorigin>
    <link rel="dns-prefetch" href="https://www.google-analytics.com">

    <!-- Google tag (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-3RC87HXJ3P" nonce="${nonce}"></script>
    <script nonce="${nonce}">
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-3RC87HXJ3P');
    </script>

    <script nonce="${nonce}">
      (function(){
        try {
          var t = localStorage.getItem('webjs_theme');
          if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
        } catch (_) {}
      })();
      // #610: the header uses position fixed (not sticky, which flickers on iOS
      // WebKit during a client-router nav). --header-h reserves the header
      // height, measured here so it tracks the real height, with a :root
      // default for no-JS / first paint.
      (function(){
        function measure(){
          try {
            var bar = document.querySelector('.site-top');
            if (!bar) return;
            var apply = function(){ document.documentElement.style.setProperty('--header-h', bar.offsetHeight + 'px'); };
            apply();
            if (window.ResizeObserver) new ResizeObserver(apply).observe(bar);
          } catch (_) {}
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', measure);
        else measure();
      })();
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var a = t.closest('.mobile-menu a');
        if (a) { var d = a.closest('details'); if (d) d.removeAttribute('open'); return; }
        var open = document.querySelectorAll('.mobile-menu[open]');
        for (var i = 0; i < open.length; i++) if (!open[i].contains(t)) open[i].removeAttribute('open');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        var open = document.querySelectorAll('.mobile-menu[open]');
        for (var i = 0; i < open.length; i++) {
          open[i].removeAttribute('open');
          var s = open[i].querySelector('summary');
          if (s) s.focus();
        }
      });
    </script>

    <link rel="stylesheet" href="/public/tailwind.css">
    <style>
      /* Foundation tokens + effects that Tailwind utilities cannot express. */
      /* A single static gradient glow layer. It used to breathe (two layers
         cross-faded on a 16s loop), removed so nothing animates on the page. */
      :root {
        color-scheme: light dark;
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
        --heart:         oklch(0.64 0.22 6);
        --accent-live:   oklch(0.63 0.17 50);
        --glow-a:        oklch(0.63 0.17 44);
        --accent-tint:   color-mix(in oklch, var(--accent-live) 14%, transparent);
        --logo-from:     oklch(0.63 0.17 50);
        --logo-to:       oklch(0.44 0.11 52);
        --accent-text:    var(--accent);
        --accent-surface: color-mix(in oklch, var(--accent-live) 12%, transparent);
        --accent-border:  color-mix(in oklch, var(--accent-live) 28%, transparent);
        --glow-strength: 0.16;
        --font-display: 'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif;
        --font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        --font-serif:   ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, Cambria, serif;
        --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        --shadow-sm: 0 1px 2px oklch(0.5 0.06 55 / 0.08);
        --shadow:    0 8px 30px oklch(0.5 0.08 55 / 0.10), 0 2px 6px oklch(0.5 0.06 55 / 0.06);
        --shadow-glow: 0 0 0 1px var(--accent-tint), 0 14px 50px color-mix(in oklch, var(--accent-live) 18%, transparent);
        --t: 240ms;
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) {
          --heart: oklch(0.74 0.18 6);
          --fg: oklch(0.96 0 0); --fg-muted: oklch(0.74 0 0); --fg-subtle: oklch(0.62 0 0);
          --bg: oklch(0 0 0); --bg-elev: oklch(0.135 0 0); --bg-subtle: oklch(0.09 0 0); --bg-sunken: oklch(0 0 0);
          --border: oklch(0.32 0 0 / 0.9); --border-strong: oklch(0.44 0 0 / 0.92);
          --accent: oklch(0.7 0.16 52); --accent-hover: oklch(0.75 0.16 52); --accent-fg: oklch(0.17 0.02 52); --logo-from: oklch(0.8 0.16 58); --logo-to: oklch(0.62 0.18 44);
          --glow-strength: 0.16;
          --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.4);
          --shadow: 0 10px 40px oklch(0 0 0 / 0.5), 0 2px 6px oklch(0 0 0 / 0.35);
        }
      }
      :root[data-theme='dark'] {
        color-scheme: dark;
        --heart: oklch(0.74 0.18 6);
        --fg: oklch(0.96 0 0); --fg-muted: oklch(0.74 0 0); --fg-subtle: oklch(0.62 0 0);
        --bg: oklch(0 0 0); --bg-elev: oklch(0.135 0 0); --bg-subtle: oklch(0.09 0 0); --bg-sunken: oklch(0 0 0);
        --border: oklch(0.32 0 0 / 0.9); --border-strong: oklch(0.44 0 0 / 0.92);
        --accent: oklch(0.7 0.16 52); --accent-hover: oklch(0.75 0.16 52); --accent-fg: oklch(0.17 0.02 52); --logo-from: oklch(0.8 0.16 58); --logo-to: oklch(0.62 0.18 44);
        --glow-strength: 0.16;
        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.4);
        --shadow: 0 10px 40px oklch(0 0 0 / 0.5), 0 2px 6px oklch(0 0 0 / 0.35);
      }
      :root[data-theme='light'] { color-scheme: light; }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; scroll-behavior: auto !important; }
      }
      html, body { margin: 0; }
      :root { --header-h: 59px; } /* #610 fixed header offset (no banner); kept exact by the script above */
      body {
        padding-top: var(--header-h);
        background: var(--bg); color: var(--fg);
        font: 400 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; overflow-x: hidden;
        transition: background var(--t) cubic-bezier(0.3,0,0.3,1), color var(--t) cubic-bezier(0.3,0,0.3,1);
      }
      ::selection { background: var(--accent-tint); color: var(--fg); }
      .heart {
        display: inline-block; width: 1.15em; height: 1.15em;
        vertical-align: -0.18em; color: var(--heart);
      }
      .glow-layer { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
      .glow-layer::before {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(58% 44% at 50% -4%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 100%), transparent), transparent 72%),
          radial-gradient(40% 36% at 88% 8%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 60%), transparent), transparent 70%);
      }
      .scroll-thin { scrollbar-width: thin; scrollbar-color: transparent transparent; transition: scrollbar-color var(--t); }
      .scroll-thin:hover { scrollbar-color: color-mix(in oklch, var(--fg-subtle) 70%, transparent) transparent; }
      .scroll-thin::-webkit-scrollbar { height: 8px; width: 8px; }
      .scroll-thin::-webkit-scrollbar-track { background: transparent; }
      .scroll-thin::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; transition: background var(--t); }
      .scroll-thin:hover::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--fg-subtle) 60%, transparent); }
      .scroll-thin::-webkit-scrollbar-thumb:hover { background: var(--fg-muted); }
      .mobile-menu > summary { list-style: none; }
      .mobile-menu > summary::-webkit-details-marker { display: none; }
      .mobile-menu .close-icon { display: none; }
      .mobile-menu[open] .open-icon { display: none; }
      .mobile-menu[open] .close-icon { display: inline-block; }
      /* Host sizing for the copy-cmd custom element (utilities cannot
         target the host from inside the component). Everything else in
         copy-cmd is Tailwind. The tag name is written without angle
         brackets on purpose: a literal element tag inside this style
         block is rendered as a real component by the SSR pass. */
      copy-cmd { display: block; flex: 1; min-width: 0; max-width: 100%; }
      /* Template-card commands hide the horizontal scrollbar entirely (no
         track, no gutter, even on hover), so all three sit flush at the same
         bottom baseline with no reserved strip. The command stays scrollable
         (wheel / touch / drag) and the copy button copies the full text. */
      .cmd-foot copy-cmd [data-copy-text] { overflow-x: auto; scrollbar-width: none; }
      .cmd-foot copy-cmd [data-copy-text]::-webkit-scrollbar { display: none; }
    </style>

    <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-accent-fg focus:shadow-[var(--shadow)]">Skip to content</a>

    <div class="glow-layer" aria-hidden="true"></div>

    <div class="site-top fixed inset-x-0 top-0 z-20">
    <header class="backdrop-blur-md bg-[color-mix(in_oklch,var(--color-bg)_78%,transparent)] border-b border-border">
      <div class="max-w-[1240px] mx-auto px-6 py-[11px] flex items-center justify-between gap-4">
        <a class="inline-flex items-center gap-[9px] no-underline text-fg font-display font-extrabold text-[17px] leading-none tracking-[-0.02em] shrink-0" href="/">
          <span class="w-[22px] h-[22px] rounded-[7px] bg-gradient-to-br from-[var(--logo-from)] to-[var(--logo-to)] shadow-[0_2px_10px_var(--accent-tint)]"></span>
          webjs
        </a>

        <nav class="hidden md:flex items-center gap-0.5 justify-center flex-1 mx-4" aria-label="Primary">
          ${NAV.map(n => html`<a class=${navLink} href=${n.href} target=${n.ext ? '_blank' : '_self'} rel=${n.ext ? 'noopener noreferrer' : ''}>${n.label}${n.ext ? NEW_TAB : ''}</a>`)}
        </nav>

        <div class="flex items-center gap-2.5 shrink-0">
          <theme-toggle></theme-toggle>

          <details class="mobile-menu relative md:hidden">
            <summary class="cursor-pointer w-[38px] h-[38px] inline-flex items-center justify-center rounded-[9px] text-fg-muted hover:bg-bg-subtle hover:text-fg" aria-label="Toggle navigation">
              <svg class="open-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>
              <svg class="close-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </summary>
            <nav class="absolute right-0 top-[calc(100%+10px)] min-w-[210px] flex flex-col gap-0.5 bg-bg-elev border border-border rounded-[14px] shadow-[var(--shadow)] p-2 z-50" aria-label="Mobile">
              ${NAV.map(n => html`<a class=${panelLink} href=${n.href} target=${n.ext ? '_blank' : '_self'} rel=${n.ext ? 'noopener noreferrer' : ''}>${n.label}${n.ext ? NEW_TAB : ''}</a>`)}
            </nav>
          </details>
        </div>
      </div>
    </header>
    </div>

    <div class="relative z-1">
      ${children}

      ${siteFooter()}
    </div>
  `;
}
