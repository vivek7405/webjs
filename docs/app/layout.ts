import { html, cspNonce } from '@webjsdev/core';

/**
 * Root layout for the docs site: Tailwind CSS browser runtime +
 * @theme design tokens. Light DOM everywhere. Shell chrome (sidebar +
 * content) lives in app/docs/layout.ts so the sidebar only renders on
 * documentation pages.
 */

const TITLE = 'WebJs - Documentation';
const DESCRIPTION = 'Getting started, routing, components, server actions, deployment, and more.';

export function generateMetadata(ctx: { url: string }) {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/og.png`;
  // Site-wide canonical, derived here so every docs page gets one from a single
  // place (the docs site had none at all). Built from origin plus pathname, so
  // tracking query strings and a stray trailing slash collapse onto one URL
  // instead of splitting ranking signals across near-duplicate addresses.
  // Mirrors website/app/layout.ts.
  const { pathname } = new URL(ctx.url);
  const canonical = origin + (pathname === '/' ? '' : pathname.replace(/\/+$/, ''));
  return {
    // Docs pages are identical for every visitor, so cache at the CDN. Set on
    // the root layout so it applies to every doc page (a page could override).
    cacheControl: 'public, max-age=0, s-maxage=600, stale-while-revalidate=86400',
    alternates: { canonical },
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
      'image:alt': 'WebJs documentation',
      'site_name': 'WebJs · docs',
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      image,
    },
  };
}

export default function RootLayout({ children }: { children: unknown }) {
  const nonce = cspNonce();
  return html`
    <!-- Raster first: Google's favicon crawler takes the first usable icon and
         wants a square whose side is a multiple of 48px. This previously
         declared sizes="32x32" for an asset that is really 512x512, which was
         both wrong and under the 48px floor. 192 is used because it is a clean
         multiple of 48 and 512 is not (512 % 48 = 32). See website/app/layout.ts,
         which carries the same fix. -->
    <link rel="icon" href="/public/favicon-192.png" type="image/png" sizes="192x192">
    <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" sizes="any">
    <link rel="apple-touch-icon" sizes="180x180" href="/public/apple-touch-icon.png">
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
          if (t === 'light' || t === 'dark') {
            document.documentElement.dataset.theme = t;
          }
        } catch (_) {}
      })();
    </script>
    <script nonce="${nonce}">
      // #647: the docs mobile header is position:fixed; measure it so --header-h
      // reserves the exact height. No-op when absent (the homepage has no header),
      // which leaves the :root media-query default for the mobile first paint.
      (function () {
        function measure() {
          try {
            var bar = document.querySelector('header');
            if (!bar) return;
            var apply = function () {
              document.documentElement.style.setProperty('--header-h', bar.offsetHeight + 'px');
            };
            apply();
            if (window.ResizeObserver) new ResizeObserver(apply).observe(bar);
          } catch (_) {}
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', measure);
        else measure();
      })();
    </script>
    <link rel="stylesheet" href="/public/tailwind.css">
    <style>
      :root {
        color-scheme: light dark;

        /* Light theme (default for docs) */
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
        --accent-text:   var(--accent);
        --accent-surface: color-mix(in oklch, var(--accent-live) 12%, transparent);
        --accent-border:  color-mix(in oklch, var(--accent-live) 28%, transparent);
        /* Dedicated logo-mark gradient stops, shared with website/app/layout.ts.
           Do NOT derive the mark from --accent mixed toward --fg: in dark mode
           --fg is near-white so the top stop washes out and diverges from the
           website mark. Keep these two orange stops per theme instead. */
        --logo-from:     oklch(0.63 0.17 50);
        --logo-to:       oklch(0.44 0.11 52);
        --glow-a:        oklch(0.63 0.17 44);
        --glow-strength: 0.16;

        --font-display: 'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif;
        --font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        --font-serif: ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, Cambria, serif;
        --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;

        /* spacing + radii + shadows: referenced by individual doc pages */
        --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
        --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 72px;
        --rad-sm: 4px; --rad: 8px; --rad-lg: 12px; --rad-xl: 16px;
        --shadow-sm: 0 1px 2px oklch(0 0 0 / 0.05);
        --shadow:    0 4px 24px oklch(0 0 0 / 0.06), 0 1px 2px oklch(0 0 0 / 0.04);

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
          --accent-fg:     oklch(0.17 0.02 52);
          --logo-from:     oklch(0.8 0.16 58);
          --logo-to:       oklch(0.62 0.18 44);
          --glow-strength: 0.16;
        }
      }
      /* Explicit dark toggle MUST also flip color-scheme so the browser
         paints UA-controlled chrome (native select popups, scrollbars,
         system-color keywords Canvas/CanvasText/Highlight, native
         validation bubbles) in dark. Without this the page-level CSS
         tokens darken but every browser-painted UI element stays in the
         OS-preferred scheme. */
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
        --accent-fg:     oklch(0.17 0.02 52);
        --logo-from:     oklch(0.8 0.16 58);
        --logo-to:       oklch(0.62 0.18 44);
        --glow-strength: 0.16;
      }

      /* Explicit light toggle on a dark OS: same UA-chrome problem in
         the other direction. */
      :root[data-theme='light'] {
        color-scheme: light;
      }

      html, body { margin: 0; }
      /* #610/#647: the docs mobile header is position:fixed (sticky flickers on
         iOS WebKit during a client-router nav). --header-h reserves the bar's
         height on the /docs content. It is 0 by default (the homepage has no
         header, and the bar is display:none on desktop), the mobile bar height
         under the breakpoint, then measured exactly by the script in <head>. */
      :root { --header-h: 0px; }
      @media (max-width: 860px) { :root { --header-h: 61px; } }
      body {
        background: var(--bg);
        color: var(--fg);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        transition: background var(--t) cubic-bezier(0.3, 0, 0.3, 1),
                    color var(--t) cubic-bezier(0.3, 0, 0.3, 1);
      }
      ::selection { background: var(--accent-tint); color: var(--fg); }

      /* Faint warm glow at the top edge, behind all content (z-0). */
      .glow-layer { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
      .glow-layer::before {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(58% 44% at 50% -4%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 100%), transparent), transparent 72%),
          radial-gradient(40% 36% at 88% 8%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 60%), transparent), transparent 70%);
      }

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
    ${children}
    <script src="/public/code-highlight.js" defer></script>
  `;
}
