import { html, cspNonce, asset } from '@webjsdev/core';
import type { LayoutProps } from '@webjsdev/core';
import '#components/theme-toggle.ts';
import '#components/site-nav-menu.ts';
import { DOCS_START_PATH, UI_PATH, GALLERY_URL, GH_URL, NEW_TAB } from '#lib/links.ts';
import { THEME_STORAGE_KEY, FORCED_THEMES } from '#lib/theme.ts';
import { siteFooter } from '#lib/ui/site-footer.ts';
import { brandLockup } from '#lib/design/brand.ts';

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
 * Shared link config (DOCS_START_PATH / UI_PATH / GH_URL / NEW_TAB) lives in
 * lib/links.ts, imported here and by app/page.ts.
 */

// The title carries the CATEGORY, because that is what people type. The old
// one named neither "web components" nor "build step", so the phrase this
// whole site is built around matched nothing in the strongest on-page signal
// there is. The H1 stays the positioning claim: it is a minor ranking signal
// and the only line that differentiates us, and the definition sentence sits
// in bold directly beneath it either way. 56 characters, inside the SERP
// truncation limit, brand first. The separator is a colon rather than the
// spaced hyphen the old title used, per invariant 11.
const TITLE = 'WebJs: Full-stack web components framework, no build step';
// 155 characters, against 256 before. Google renders about 160, so a third of
// the old one was never shown to anyone.
//
// It also carried a false claim: "Lean enough for AI agents to read end to
// end". packages/core/src alone is 23,465 lines and core plus server is
// 50,511, so nothing reads it end to end and none of it "fits in context".
// That sentence outlived the "Light enough for AI" section it was written for,
// because a section gets reviewed and metadata does not, and it was live in
// every search result.
//
// The true version of that idea is about LOCATION, not volume: the source sits
// in the app's own node_modules at the installed version, so an agent opens
// the file it needs instead of recalling an API from training data.
const DESCRIPTION = 'A full-stack web components framework with no build step, built for AI agents. Server-rendered pages, server actions, and file-based routing. Node 24+ or Bun.';

const NAV = [
  { label: 'Docs', href: DOCS_START_PATH, ext: false },
  { label: 'UI', href: UI_PATH, ext: false },
  { label: 'Blog', href: '/blog', ext: false },
  { label: 'Compare', href: '/compare', ext: false },
  { label: 'Changelog', href: '/changelog', ext: false },
  { label: 'Gallery', href: GALLERY_URL, ext: true },
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
    // `s-maxage` is the edge cache; `stale-while-revalidate` serves instantly
    // while refreshing. `max-age=60` is the browser copy: the previous `0` meant
    // a page was NEVER reusable from disk, so every view paid a round trip even
    // when nothing had changed. 60s is the smallest value that yields real
    // browser cache hits (back/forward, repeat visits, a second tab) while
    // bounding how long a reader can hold pre-deploy HTML to one minute.
    // The client router revalidates its own fetches (#1131), so soft navs and
    // prefetches always see live `x-webjs-build` ids and deploy detection is
    // unaffected by this max-age; with stable page ETags the revalidation is a
    // cheap 304. Document navigations (new tab, back/forward) still serve
    // straight from disk within the window.
    cacheControl: 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400',
    title: TITLE,
    description: DESCRIPTION,
    // Favicons, ordered raster first on purpose. Google's favicon crawler takes
    // the first usable icon and wants a SQUARE raster whose side is a multiple
    // of 48px. This once declared sizes="32x32" on an asset that is really
    // 512x512: the claim was both wrong and under Google's 48px floor, which is
    // why webjs.dev showed no icon in search results. 192 is used because it is
    // a clean multiple of 48 (512 is not, 512 % 48 = 32).
    //
    // Declared here rather than hand-written into the shell below, which is the
    // way the framework documents and the way every other app in the repo does
    // it. A hand-written tag only works because this is the ROOT layout, the
    // one layout allowed to write a shell at all (invariant 8), so it was a
    // pattern no other layout could copy.
    //
    // /favicon.ico is absent on purpose: it is served from public/favicon.ico
    // at the origin root and stays the fallback for crawlers that read no
    // markup, so linking it would add a tag nothing reads.
    icons: {
      icon: [
        { url: '/public/favicon-192.png', type: 'image/png', sizes: '192x192' },
        { url: '/public/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
      ],
      apple: { url: '/public/apple-touch-icon.png', sizes: '180x180' },
    },
    openGraph: {
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      url: origin,
      image,
      'image:width': '1200',
      'image:height': '630',
      'image:alt': TITLE,
      'site_name': 'WebJs',
    },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, image },
  };
}

const navLink = 'text-fg-muted no-underline font-medium text-sm px-3 py-2 rounded-lg transition-colors duration-[140ms] hover:text-fg hover:bg-[var(--hover-surface)]';
const panelLink = 'text-fg-muted no-underline font-medium text-sm px-3 py-2.5 rounded-lg hover:text-fg hover:bg-[var(--hover-surface)]';

export default function RootLayout({ children }: LayoutProps) {
  const nonce = cspNonce();
  return html`
    <!-- Favicons are declared in generateMetadata above (metadata.icons), not
         written here. The framework splices them into <head>. -->

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

    <!-- The theme bootstrap stays an INLINE script, and stays here in the head,
         because it has to run before first paint: a reader who chose dark would
         otherwise see the light palette flash before a module could load and
         correct it. An inline script cannot import, so the storage key is
         interpolated from lib/theme.ts rather than written out a second time.
         components/theme-toggle.ts reads the same export, which is what stops
         the two from drifting (renaming the key in one place used to leave the
         other silently reading nothing). -->
    <script nonce="${nonce}">
      (function(){
        try {
          var t = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
          if (${JSON.stringify(FORCED_THEMES)}.indexOf(t) !== -1) document.documentElement.dataset.theme = t;
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
      // #1428, TEMPORARY: capture the back-swipe A/B levers off the query
      // string into window.__webjsDiag, so a real iPhone can compare the
      // candidate paint timings against the current one. Captured ONCE here
      // rather than read per navigation, because the flag is gone from the URL
      // the moment the first soft nav replaces it, and the run needs the lever
      // to hold for the whole session. Inline and in the head so it lands
      // before the router boots (a module script is deferred). Removed with
      // the levers once the device has answered.
      (function(){
        try {
          var p = new URLSearchParams(location.search);
          if (p.has('raf') || p.has('raf2') || p.has('scrolllast')) {
            window.__webjsDiag = { raf: p.has('raf'), raf2: p.has('raf2'), scrolllast: p.has('scrolllast') };
          }
        } catch (_) {}
      })();
    </script>

    <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
    <style>
      /* Foundation tokens + effects that Tailwind utilities cannot express. */
      /* A single static gradient glow layer. It used to breathe (two layers
         cross-faded on a 16s loop), removed so nothing animates on the page. */
      /* Colour is rationed, not absent.
         Neutrals carry the page, and they are WARM: a real chroma on hue
         60..75 rather than a trace of one. A near-zero-chroma version of this
         palette was tried and read cold and clinical in light mode, where the
         warmth is doing most of the work. The accent then appears in exactly
         the places that ask for a click, the primary button and the closing
         CTA, plus live and focus state. It never tints a content panel or a
         heading, which is what keeps those few amber surfaces meaningful
         instead of decorative. */
      /* Every per-theme COLOUR is declared ONCE, as light-dark(LIGHT, DARK),
         and the color-scheme declarations below pick the side. This is the
         rule the framework teaches its own users (the skill's
         references/styling.md, and the palette webjs create generates), and
         the site had been the counter-example: the dark half was written
         twice, once under the OS media query and once under the toggle's
         attribute, so an edit to either block silently drifted the two paths
         apart. There is no cascade trick here, just the three color-scheme
         declarations at the bottom of this block feeding the one function. */
      :root {
        --fg:            light-dark(oklch(0.20 0.018 60),    oklch(0.96 0.01 60));
        --fg-muted:      light-dark(oklch(0.44 0.02 60),     oklch(0.78 0.015 60));
        --fg-subtle:     light-dark(oklch(0.50 0.02 65),     oklch(0.66 0.02 65));
        --bg:            light-dark(oklch(0.985 0.008 75),   oklch(0.08 0.012 60));
        --bg-elev:       light-dark(oklch(1 0 0),            oklch(0.14 0.015 60));
        --bg-subtle:     light-dark(oklch(0.96 0.008 75),    oklch(0.11 0.014 60));
        --bg-sunken:     light-dark(oklch(0.93 0.01 70),     oklch(0.06 0.01 60));
        --border:        light-dark(oklch(0.88 0.012 70 / 0.9),  oklch(0.24 0.015 60 / 0.9));
        --border-strong: light-dark(oklch(0.78 0.014 70 / 0.95), oklch(0.36 0.02 60 / 0.95));
        --accent:        light-dark(oklch(0.54 0.16 52),     oklch(0.78 0.18 58));
        --accent-hover:  light-dark(oklch(0.5 0.16 52),      oklch(0.83 0.17 58));
        --accent-fg:     light-dark(oklch(1 0 0),            oklch(0 0 0));
        --heart:         light-dark(oklch(0.64 0.22 6),      oklch(0.74 0.18 6));
        --accent-live:   light-dark(oklch(0.63 0.17 50),     oklch(0.78 0.18 58));
        --glow-a:        light-dark(oklch(0.63 0.17 44),     oklch(0.78 0.18 58));
        --logo-from:     light-dark(oklch(0.63 0.17 50),     oklch(0.82 0.17 58));
        --logo-to:       light-dark(oklch(0.44 0.11 52),     oklch(0.64 0.18 44));
        /* Hover lift for nav links and other bare targets. An ALPHA overlay,
           not a solid colour, for two reasons. It composes over the header's
           translucent blurred background instead of fighting it, and it gives
           the same perceived step in both themes: the solid --bg-subtle was a
           0.09 lift on a black page, which is real in numbers and invisible to
           the eye, while the same token in light was a 0.025 step that read
           clearly because the eye is adapted to a bright field. */
        --hover-surface: light-dark(oklch(0 0 0 / 0.055),    oklch(1 0 0 / 0.09));

        /* Derived tokens. Each one reads a light-dark() token above, so it
           tracks BOTH themes with no override of its own. */
        --accent-text:    var(--accent);
        --accent-tint:    color-mix(in oklch, var(--accent-live) 14%, transparent);
        --accent-surface: color-mix(in oklch, var(--accent-live) 12%, transparent);
        --accent-border:  color-mix(in oklch, var(--accent-live) 28%, transparent);
        --shadow-glow:    0 0 0 1px var(--accent-tint), 0 14px 50px color-mix(in oklch, var(--accent-live) 18%, transparent);
        /* The closing CTA's fill. Light keeps a faint accent tint, which
           separates the panel from the page. Dark pulls the tint back toward
           the plain elevated surface: over black the same amount went muddy
           rather than warm, so the glow does more of the work there. The two
           sides differ by the MIX RATIO, which is a number rather than a
           colour, so the ratio is the token that varies. */
        --cta-mix:     7%;
        --cta-surface: color-mix(in oklch, var(--accent-live) var(--cta-mix), var(--bg-elev));

        /* Shadows. --shadow-sm keeps the same geometry in both themes, so its
           colour is the only per-theme part and rides light-dark() inline.
           --shadow's SPREAD also changes (a wider, softer cast reads as depth
           over black, where the light spread disappears), and light-dark() is
           colour-only, so the spread is its own token in the block below. */
        --shadow-sm:      0 1px 2px light-dark(oklch(0.5 0.06 55 / 0.08), oklch(0 0 0 / 0.4));
        --shadow-cast:    light-dark(oklch(0.5 0.08 55 / 0.10), oklch(0 0 0 / 0.5));
        --shadow-ambient: light-dark(oklch(0.5 0.06 55 / 0.06), oklch(0 0 0 / 0.35));
        --shadow-spread:  0 8px 30px;
        --shadow:         var(--shadow-spread) var(--shadow-cast), 0 2px 6px var(--shadow-ambient);

        --glow-strength: 0.16;
        --font-display: 'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif;
        --font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        --font-serif:   ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, Cambria, serif;
        --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
        --t: 240ms;

        color-scheme: light dark;   /* the default: follow the OS */
      }
      /* The three tokens above that are NOT colours, so light-dark() cannot
         carry them. Per the styling reference these keep an explicit pair:
         the media query for the OS default, the attribute rule for the
         toggle. Colours must never be added here. */
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme='light']) { --glow-strength: 0.08; --cta-mix: 6%; --shadow-spread: 0 10px 40px; }
      }
      :root[data-theme='dark']  { --glow-strength: 0.08; --cta-mix: 6%; --shadow-spread: 0 10px 40px; }
      /* The toggle forces a scheme, which is what re-points every
         light-dark() above. Nothing else needs to change per theme. */
      :root[data-theme='dark']  { color-scheme: dark; }
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
      /* #1144: while a modal holds the page scroll lock, an engine that ignores
         scrollbar-gutter widens the viewport, and .site-top is position: fixed so
         it lays out against the viewport and cannot be reached by the padding
         that holds in-flow content still. The opt-in goes on the HEADER, which is
         the element that is both viewport-width and painting. Both properties are
         load-bearing. Viewport-width means insetting its content box undoes the
         widening exactly, for left-aligned children as much as centred ones (the
         centring bar is capped by max-width, so insetting THAT moved the nav but
         left the logo shifting the full amount). Painting means the background
         still covers the inset, since backgrounds fill the border box, so the
         chrome stays edge to edge. Measured at a 1400px viewport with a 15px
         scrollbar and the gutter suppressed: logo 0.0, nav 0.0, chrome 0..1400.
         A transparent border rather than padding-right, because it composes with
         whatever padding is already there instead of restating it. The child
         selector outranks the border-* utilities that also set
         border-right-color, so cascade order does not matter. */
      .site-top > header { border-right: var(--wj-scrollbar-compensation, 0px) solid transparent; }
      /* Background glow layer with soft radial ambient glow */
      .glow-layer { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
      .glow-layer::before {
        content: ''; position: absolute; inset: 0;
        background:
          radial-gradient(60% 48% at 50% -5%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 100%), transparent), transparent 75%),
          radial-gradient(45% 40% at 85% 10%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 60%), transparent), transparent 70%),
          radial-gradient(50% 50% at 15% 85%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 40%), transparent), transparent 70%);
      }
      .scroll-thin { scrollbar-width: thin; scrollbar-color: transparent transparent; transition: scrollbar-color var(--t); }
      .scroll-thin:hover { scrollbar-color: color-mix(in oklch, var(--fg-subtle) 70%, transparent) transparent; }
      .scroll-thin::-webkit-scrollbar { height: 8px; width: 8px; }
      .scroll-thin::-webkit-scrollbar-track { background: transparent; }
      .scroll-thin::-webkit-scrollbar-thumb { background: transparent; border-radius: 999px; transition: background var(--t); }
      .scroll-thin:hover::-webkit-scrollbar-thumb { background: color-mix(in oklch, var(--fg-subtle) 60%, transparent); }
      .scroll-thin::-webkit-scrollbar-thumb:hover { background: var(--fg-muted); }
      /* Tag-prefixed per invariant 7, since site-nav-menu is a light-DOM
         component. The icon swap keys off the DETAILS element rather than the
         reflected host attribute on purpose: the host only carries the open attribute once
         the component has hydrated, while details[open] is set by the browser
         itself, so the icons stay correct with JavaScript off. */
      site-nav-menu > details > summary { list-style: none; }
      site-nav-menu > details > summary::-webkit-details-marker { display: none; }
      site-nav-menu .close-icon { display: none; }
      site-nav-menu details[open] .open-icon { display: none; }
      site-nav-menu details[open] .close-icon { display: inline-block; }
      /* Host sizing for the copy-cmd custom element (utilities cannot
         target the host from inside the component). Everything else in
         copy-cmd is Tailwind. The tag name is written without angle
         brackets on purpose: a literal element tag inside this style
         block is rendered as a real component by the SSR pass. */
      copy-cmd { display: block; flex: 1; min-width: 0; max-width: 100%; }
      /* The in-a-sentence variant. The block host above would break the
         sentence around the command; this puts it back in the text flow.
         copy-cmd[inline] is one specificity point above the bare tag, so it
         wins without !important and without reordering. */
      copy-cmd[inline] { display: inline; flex: none; max-width: none; }
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
    <header class="backdrop-blur-md bg-[color-mix(in_oklch,var(--color-bg)_50%,transparent)] border-b border-border">
      <div class="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <a class="inline-flex items-center no-underline text-fg shrink-0 transition-opacity duration-150 hover:opacity-80" href="/" aria-label="WebJs home">
          ${brandLockup('hdr', { height: 26 })}
        </a>

        <nav class="hidden md:flex items-center gap-0.5 justify-center flex-1 mx-4" aria-label="Primary">
          ${NAV.map(n => html`<a class=${navLink} href=${n.href} target=${n.ext ? '_blank' : '_self'} rel=${n.ext ? 'noopener noreferrer' : ''}>${n.label}${n.ext ? NEW_TAB : ''}</a>`)}
        </nav>

        <div class="flex items-center gap-2.5 shrink-0">
          <theme-toggle></theme-toggle>

          <site-nav-menu class="md:hidden" label="Toggle navigation">
            ${NAV.map(n => html`<a class=${panelLink} href=${n.href} target=${n.ext ? '_blank' : '_self'} rel=${n.ext ? 'noopener noreferrer' : ''}>${n.label}${n.ext ? NEW_TAB : ''}</a>`)}
          </site-nav-menu>
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
