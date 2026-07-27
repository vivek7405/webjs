import { html, cspNonce, type Metadata, type LayoutProps } from '@webjsdev/core';
import '#components/theme-toggle.ts';

const navLink = (href: string, label: string) => html`
  <a href=${href} class="text-muted-foreground no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-fast hover:text-foreground">${label}</a>
`;

const footerLink = (href: string, label: string) => html`
  <a href=${href} class="text-inherit no-underline transition-colors duration-fast hover:text-muted-foreground">${label}</a>
`;

const TITLE = 'WebJs Blog - Live Demo';
const DESCRIPTION = 'A live, full-stack webjs example: posts, comments, auth, and WebSocket chat.';

// NOTE: no `cacheControl` here on purpose. This app is per-user (pages read
// `currentUser()` to render the signed-in state), so its HTML must NOT be
// CDN-cached or one visitor's page would be served to another. It stays the
// default `no-store`. The static sites (website / docs / ui) set a public
// `cacheControl` on their root layout because they are visitor-identical.
export function generateMetadata(ctx: { url: string }): Metadata {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/og.png`;
  return {
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
      'image:alt': 'WebJs Blog - Live Demo',
      'site_name': 'WebJs · blog',
    },
    twitter: {
      card: 'summary_large_image',
      title: TITLE,
      description: DESCRIPTION,
      image,
    },
  };
}

/**
 * Root layout: globals + chrome.
 *
 * Three concerns, in document order:
 *  1. Inline `<script>` that syncs `<html data-theme>` from localStorage
 *     BEFORE any style applies (no FOUC).
 *  2. Generated Tailwind stylesheet (`public/tailwind.css`): compiled
 *     once in prod via `npm run start` or on-file-change in dev via
 *     `npm run dev`. The input lives in `public/input.css` and includes
 *     the `@theme` block that maps our design tokens into Tailwind's
 *     palette (so classes like `text-foreground`, `bg-card`, `text-display`,
 *     `font-serif`, `duration-fast` resolve).
 *  3. Shell markup styled with Tailwind utility classes.
 *
 * Non-Tailwind CSS is kept to the minimum that utility classes can't
 * express: `:root` design tokens (consumed by `@theme`), body defaults
 * that can't live on a classable element, and selection/scrollbar
 * pseudo-elements.
 */
export default function RootLayout({ children }: LayoutProps) {
  // CSP nonce for inline scripts. Empty when no nonce in CSP.
  const nonce = cspNonce();
  return html`
    <link rel="icon" href="/public/favicon.svg" type="image/svg+xml" sizes="any">
    <link rel="icon" href="/public/favicon.png" type="image/png" sizes="32x32">
    <link rel="apple-touch-icon" href="/public/favicon.png">
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
          var mq = window.matchMedia('(prefers-color-scheme: light)');
          function apply(){
            var t = null;
            try { t = localStorage.getItem('webjs_theme'); } catch (_) {}
            var el = document.documentElement;
            if (t === 'light' || t === 'dark') el.dataset.theme = t;
            else delete el.dataset.theme;
            // data-theme drives the app palette blocks; the .dark class is what
            // the @webjsdev/ui kit's dark: variants read. Keep both in sync (see
            // the skill's references/styling.md "two signals").
            var dark = t === 'dark' || (t !== 'light' && !mq.matches);
            el.classList.toggle('dark', dark);
          }
          apply();
          mq.addEventListener('change', apply);
        } catch (_) {}
      })();
      // #610: keep --header-h equal to the fixed header's real height. The
      // :root default is a sane SSR first-paint value; this refines it once the
      // header exists and on any resize, so the content offset never drifts
      // (responsive headers, font swaps, a wrapped nav). Degrades fine with no
      // JS (the :root default holds).
      (function(){
        function measure(){
          try {
            var hdr = document.querySelector('.site-header');
            if (!hdr) return;
            var apply = function(){
              document.documentElement.style.setProperty('--header-h', hdr.offsetHeight + 'px');
            };
            apply();
            if (window.ResizeObserver) new ResizeObserver(apply).observe(hdr);
          } catch (_) {}
        }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', measure);
        else measure();
      })();
      // Mobile menu auto-close: close on link click (inside the panel)
      // AND on any click outside the menu. Delegated on document so
      // it survives client-router navigations without rebinding.
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
    <link rel="stylesheet" href="/public/tailwind.css">
    <style>
      :root {
        color-scheme: light dark;
        --header-h: 61px; /* #610 fixed-header offset, kept exact by the ResizeObserver below */

        /* dark (default). shadcn token names, the same vocabulary the scaffold
           and the @webjsdev/ui kit use. --primary is the orange BRAND color;
           --accent is a NEUTRAL hover tint (shadcn model). */
        --background:             oklch(0 0 0);
        --foreground:             oklch(0.96 0 0);
        --card:                   oklch(0.135 0 0);
        --card-foreground:        oklch(0.96 0 0);
        --popover:                oklch(0.135 0 0);
        --popover-foreground:     oklch(0.96 0 0);
        --primary:                oklch(0.7 0.16 52);
        --primary-foreground:     oklch(0.1 0.01 52);
        --secondary:              oklch(0 0 0);
        --secondary-foreground:   oklch(0.96 0 0);
        --muted:                  oklch(0.09 0 0);
        --muted-foreground:       oklch(0.74 0 0);
        --accent:                 oklch(0.20 0 0);
        --accent-foreground:      oklch(0.96 0 0);
        --destructive:            oklch(0.7 0.19 25);
        --destructive-foreground: oklch(0.96 0 0);
        --border:                 oklch(0.32 0 0 / 0.9);
        --input:                  oklch(0.32 0 0 / 0.9);
        --ring:                   oklch(0.7 0.16 52);
        --success:                oklch(0.72 0.15 145);

        /* Decorative, derived from --primary so it tracks light/dark: a
           translucent brand tint for focus rings and the logo glow (the same
           pattern the scaffold's --primary-tint uses). Plus the logo mark
           gradient, the exact warm-orange stops webjs.dev uses, so the brand
           mark reads identically here and on the main site (dark stops here,
           the light overrides below carry the light stops). */
        --primary-tint:   color-mix(in oklch, var(--primary) 14%, transparent);
        --logo-from:      oklch(0.8 0.16 58);
        --logo-to:        oklch(0.62 0.18 44);
        --glow-a:         oklch(0.63 0.17 44);
        --glow-strength:  0.16;

        --font-display: 'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif;
        --font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        --font-serif:  ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, Cambria, serif;
        --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      /* light: explicit toggle */
      :root[data-theme='light'] {
        --background:             oklch(0.985 0.008 75);
        --foreground:             oklch(0.20 0.018 60);
        --card:                   oklch(1 0 0);
        --card-foreground:        oklch(0.20 0.018 60);
        --popover:                oklch(1 0 0);
        --popover-foreground:     oklch(0.20 0.018 60);
        --primary:                oklch(0.54 0.16 52);
        --primary-foreground:     oklch(1 0 0);
        --secondary:              oklch(0.93 0.01 70);
        --secondary-foreground:   oklch(0.20 0.018 60);
        --muted:                  oklch(0.96 0.008 75);
        --muted-foreground:       oklch(0.44 0.02 60);
        --accent:                 oklch(0.94 0.008 75);
        --accent-foreground:      oklch(0.20 0.018 60);
        --border:                 oklch(0.88 0.012 70 / 0.9);
        --input:                  oklch(0.88 0.012 70 / 0.9);
        --ring:                   oklch(0.54 0.16 52);
        --logo-from:              oklch(0.63 0.17 50);
        --logo-to:                oklch(0.44 0.11 52);
      }

      /* light: OS preference */
      @media (prefers-color-scheme: light) {
        :root:not([data-theme='dark']) {
          --background:             oklch(0.985 0.008 75);
          --foreground:             oklch(0.20 0.018 60);
          --card:                   oklch(1 0 0);
          --card-foreground:        oklch(0.20 0.018 60);
          --popover:                oklch(1 0 0);
          --popover-foreground:     oklch(0.20 0.018 60);
          --primary:                oklch(0.54 0.16 52);
          --primary-foreground:     oklch(1 0 0);
          --secondary:              oklch(0.93 0.01 70);
          --secondary-foreground:   oklch(0.20 0.018 60);
          --muted:                  oklch(0.96 0.008 75);
          --muted-foreground:       oklch(0.44 0.02 60);
          --accent:                 oklch(0.94 0.008 75);
          --accent-foreground:      oklch(0.20 0.018 60);
          --border:                 oklch(0.88 0.012 70 / 0.9);
          --input:                  oklch(0.88 0.012 70 / 0.9);
          --ring:                   oklch(0.54 0.16 52);
          --logo-from:              oklch(0.63 0.17 50);
          --logo-to:                oklch(0.44 0.11 52);
        }
      }

      /* Body defaults. The <body> tag is emitted by the framework and can't
         be reached by utility classes. A tiny decorative overlay, scrollbar
         colours, and selection tint also live here (no utility equivalent). */
      html, body { margin: 0; }
      html { scroll-behavior: smooth; }
      body {
        /* #610: the header is position:fixed (NOT sticky), because iOS WebKit
           (every iOS browser) flickers a sticky header's background for one
           frame on a client-router forward nav (the scroll-to-top drives a
           sticky stuck-to-static recompute WebKit mis-repaints, iOS-only, fine
           on desktop and Android, confirmed on-device). fixed leaves normal
           flow, so offset the content by the header height. --header-h is the
           single source of truth: a sane SSR first-paint default in :root,
           kept exact and responsive by the ResizeObserver inline script. */
        padding-top: var(--header-h);
        background: var(--background);
        color: var(--foreground);
        font: 16px/1.65 var(--font-sans);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
        font-feature-settings: 'ss01', 'cv02';
        transition: background var(--duration-slow) cubic-bezier(0.3, 0, 0.3, 1),
                    color var(--duration-slow) cubic-bezier(0.3, 0, 0.3, 1);
      }
      /* A single static gradient glow layer, a faint warm top-edge wash.
         Fixed at z-0; the page content sits above it at z-1 so text and
         cards stay crisp. --glow-strength is 0.16 in both modes. */
      .glow-layer { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
      .glow-layer::before {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(58% 44% at 50% -4%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 100%), transparent), transparent 72%),
          radial-gradient(40% 36% at 88% 8%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 60%), transparent), transparent 70%);
      }
      ::selection { background: var(--primary-tint); color: var(--foreground); }
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
      ::-webkit-scrollbar-track { background: transparent; }

      /* Mobile menu: native <details>/<summary>, same shape as
         webjs.dev and ui.webjs.dev. Strip the disclosure triangle and
         swap the hamburger / close icons on toggle. */
      .mobile-menu > summary { list-style: none; }
      .mobile-menu > summary::-webkit-details-marker { display: none; }
      .mobile-menu > summary .close-icon { display: none; }
      .mobile-menu[open] > summary .open-icon { display: none; }
      .mobile-menu[open] > summary .close-icon { display: inline-block; }
    </style>

    <div class="glow-layer" aria-hidden="true"></div>

    <header class="site-header fixed inset-x-0 top-0 z-20 flex items-center justify-between gap-4 px-4 sm:px-6 pr-[calc(1rem+var(--wj-scrollbar-compensation,0px))] sm:pr-[calc(1.5rem+var(--wj-scrollbar-compensation,0px))] py-3 border-b border-border bg-[color-mix(in_oklch,var(--background)_75%,transparent)] backdrop-blur-[18px] backdrop-saturate-[180%]">
      <a href="/" class="inline-flex items-center gap-2 no-underline text-foreground font-semibold text-[15px] leading-none tracking-tight">
        <span class="inline-block w-[22px] h-[22px] rounded-[7px] bg-gradient-to-br from-[var(--logo-from)] to-[var(--logo-to)] shadow-[inset_0_0_0_1px_oklch(1_0_0/0.15),0_2px_10px_var(--primary-tint)]"></span>
        <span>webjs</span>
        <span class="text-muted-foreground/70 mx-1 font-normal">/</span>
        <span>blog</span>
      </a>

      <!-- Inline nav, sm and up. -->
      <nav class="hidden sm:flex gap-4 items-center">
        ${navLink('/', 'Posts')}
        ${navLink('/search', 'Search')}
        ${navLink('/stream-demo', 'Stream')}
        ${navLink('/seeded', 'Seeded')}
        ${navLink('/about', 'About')}
        ${navLink('/dashboard', 'Dashboard')}
        <a href="https://github.com/webjsdev/webjs/tree/main/examples/blog" target="_blank" rel="noopener" class="text-muted-foreground no-underline font-medium text-[13px] leading-none tracking-[0.005em] transition-colors duration-fast hover:text-foreground">GitHub</a>
        <theme-toggle></theme-toggle>
      </nav>

      <!-- Mobile cluster: hamburger LEFT, theme-toggle RIGHT. Native
           <details>/<summary>, dropdown style matching webjs.dev and
           ui.webjs.dev. -->
      <div class="flex items-center gap-2 sm:hidden">
        <details class="mobile-menu relative">
          <summary class="list-none cursor-pointer w-9 h-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-fast" aria-label="Toggle navigation">
            <svg class="open-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>
            </svg>
            <svg class="close-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </summary>
          <nav class="absolute right-0 top-[calc(100%+8px)] min-w-[200px] flex flex-col gap-1 bg-card border border-border rounded-lg shadow-lg p-2 z-50">
            <a class="text-muted-foreground no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-muted hover:text-foreground transition-colors duration-fast" href="/">Posts</a>
            <a class="text-muted-foreground no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-muted hover:text-foreground transition-colors duration-fast" href="/search">Search</a>
            <a class="text-muted-foreground no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-muted hover:text-foreground transition-colors duration-fast" href="/about">About</a>
            <a class="text-muted-foreground no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-muted hover:text-foreground transition-colors duration-fast" href="/dashboard">Dashboard</a>
            <a class="text-muted-foreground no-underline font-medium text-sm px-3 py-2 rounded-md hover:bg-muted hover:text-foreground transition-colors duration-fast" href="https://github.com/webjsdev/webjs/tree/main/examples/blog" target="_blank" rel="noopener">GitHub</a>
          </nav>
        </details>
        <theme-toggle></theme-toggle>
      </div>
    </header>

    <div class="relative z-[1]">
      <div class="max-w-[760px] mx-auto px-4 sm:px-6 pt-4 text-[11px] leading-snug text-muted-foreground/70 font-mono tracking-wide">
        Demo app. Data will be wiped between redeploys.
      </div>

      <main class="block max-w-[760px] mx-auto px-4 sm:px-6 pt-4 pb-12 min-h-screen">
        ${children}
      </main>

      <footer class="max-w-[760px] mx-auto px-4 sm:px-6 pt-12 pb-[72px] border-t border-border flex justify-between flex-wrap gap-3 text-muted-foreground/70 font-mono text-[11px] leading-[1.4] tracking-[0.12em] uppercase">
        <span><span class="text-primary">&#9679;</span>&nbsp; webjs / demo</span>
        <span>
          ${footerLink('/api/posts', 'api')}
          &nbsp;&middot;&nbsp;
          ${footerLink('/__webjs/health', 'health')}
        </span>
      </footer>
    </div>
  `;
}

// Touch to force a Railway redeploy of this app for the workspace router fixes in #151 and #157 (the watch path skips framework-only changes in packages/core).
