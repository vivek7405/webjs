import { html, asset } from '@webjsdev/core';
import '#components/theme-toggle.ts';

export const metadata = {
  title: 'WebJs Gallery',
  description: 'Interactive showcase and single-concept feature gallery for WebJs applications.',
  // The WebJs brand mark, byte-identical to what webjs.dev serves, so the
  // gallery reads as the same product in a tab strip rather than as a
  // separate site. Declared here and never as a hand-written <link>: the
  // framework emits `<link rel="icon">` only from metadata.icons, which is
  // also what the scaffold's generated layout does.
  //
  // Raster is declared FIRST on purpose. Google's favicon crawler takes the
  // first usable icon and wants a square raster whose side is a multiple of
  // 48px, which is why the 192 exists (512 % 48 is 32, so the full-size mark
  // does not qualify). public/favicon.ico rides along unlinked: the framework
  // serves it at the origin root as the fallback for crawlers that read no
  // markup at all.
  icons: {
    icon: [
      { url: '/public/favicon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/public/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
    ],
    apple: { url: '/public/apple-touch-icon.png', sizes: '180x180' },
  },
};

export default function RootLayout({ children }: { children: unknown }) {
  return html`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>WebJs Gallery</title>
      <script>
        (function(){
          try {
            var t = localStorage.getItem('webjs_theme');
            if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
          } catch (_) {}
        })();
        (function(){
          function measure(){
            try {
              var hdr = document.querySelector('header');
              if (!hdr || getComputedStyle(hdr).position !== 'fixed') return;
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
      </script>
      <meta name="color-scheme" content="light dark">
      <!-- Self-hosted fonts, declared via @font-face in public/input.css.
           All three are preloaded so they are requested with the document
           rather than discovered late through the stylesheet. Mono earns its
           slot here because the gallery puts it above the fold: the demo count
           and every card badge are monospace on the home page. Bare paths, and
           deliberately NOT asset(): the bytes are fetched by a CSS url(), so a
           hashed preload could never match the request and each file would be
           downloaded twice. -->
      <link rel="preload" href="/public/fonts/inter-tight.woff2" as="font" type="font/woff2" crossorigin>
      <link rel="preload" href="/public/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
      <link rel="preload" href="/public/fonts/jetbrains-mono.woff2" as="font" type="font/woff2" crossorigin>
      <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
      <style>
        :root {
          /* The website's stack, self-hosted in public/fonts/, so both origins
             render the same faces. */
          --font-sans:    'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
          --font-display: 'Inter Tight', 'Inter', system-ui, -apple-system, sans-serif;
          --font-serif:   ui-serif, 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, Cambria, serif;
          --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
          /* A real default so no-JS and first paint reserve the header height
             before the measure script above runs. h-14 plus the 1px border. */
          --header-h: 57px;

          color-scheme: light dark;
          /* The shadcn token NAMES are kept and only their VALUES move to the
             website's warm oklch palette. Every demo under app/features/ and
             every component under components/ui/ is scaffold payload written
             against this vocabulary, so renaming would mean editing payload,
             which is the one thing this app must not do. */
          --background:         light-dark(oklch(0.985 0.008 75), oklch(0.08 0.012 60));
          --foreground:         light-dark(oklch(0.20 0.018 60), oklch(0.96 0.01 60));
          --card:               light-dark(oklch(1 0 0), oklch(0.14 0.015 60));
          --card-foreground:    light-dark(oklch(0.20 0.018 60), oklch(0.96 0.01 60));
          --popover:            light-dark(oklch(1 0 0), oklch(0.14 0.015 60));
          --popover-foreground: light-dark(oklch(0.20 0.018 60), oklch(0.96 0.01 60));
          --primary:            light-dark(oklch(0.54 0.16 52), oklch(0.78 0.18 58));
          --primary-foreground: light-dark(oklch(1 0 0), oklch(0 0 0));
          --secondary:          light-dark(oklch(0.96 0.008 75), oklch(0.11 0.014 60));
          --secondary-foreground: light-dark(oklch(0.20 0.018 60), oklch(0.96 0.01 60));
          --muted:              light-dark(oklch(0.96 0.008 75), oklch(0.11 0.014 60));
          --muted-foreground:   light-dark(oklch(0.44 0.02 60), oklch(0.78 0.015 60));
          /* shadcn's --accent is a neutral HOVER SURFACE, not the brand accent.
             It shares a name with the website's --accent and means the opposite
             thing, so it stays neutral. Mapping it to the brand orange would
             turn every hover surface in every payload demo orange. */
          --accent:             light-dark(oklch(0.96 0.008 75), oklch(0.11 0.014 60));
          --accent-foreground:  light-dark(oklch(0.20 0.018 60), oklch(0.96 0.01 60));
          --border:             light-dark(oklch(0.88 0.012 70 / 0.9), oklch(0.24 0.015 60 / 0.9));
          --border-strong:      light-dark(oklch(0.78 0.014 70 / 0.95), oklch(0.36 0.02 60 / 0.95));
          --input:              light-dark(oklch(0.88 0.012 70 / 0.9), oklch(0.24 0.015 60 / 0.9));
          --ring:               light-dark(oklch(0.63 0.17 50), oklch(0.78 0.18 58));
          /* public/input.css maps --color-destructive, and the demos use
             text-destructive for validation errors and hover:bg-destructive/10
             on the destructive button, but nothing ever DEFINED it. An
             undefined var() left every error message painting in the ordinary
             foreground colour and the button's hover fill absent. Value follows
             the @webjsdev/ui registry theme, warmed a few degrees of hue to sit
             in this palette rather than beside it. Only this one token: the
             matching -foreground is mapped but read by nothing here, since the
             destructive variant is deliberately transparent at rest and colours
             its TEXT, so defining it would be dead weight. */
          --destructive:            light-dark(oklch(0.58 0.22 27), oklch(0.70 0.19 22));

          --primary-tint:   color-mix(in oklch, var(--ring) 22%, transparent);
          --accent-tint:    color-mix(in oklch, var(--ring) 14%, transparent);
          --glow-a:         light-dark(oklch(0.63 0.17 44), oklch(0.78 0.18 58));
          --glow-strength:  0.16;
        }
        :root[data-theme='light'] { color-scheme: light; }
        :root[data-theme='dark']  { color-scheme: dark; }
        /* --glow-strength is a NUMBER and light-dark() carries colours only, so
           it is the one token here that needs an explicit per-theme pair. Every
           colour above already resolves through color-scheme. */
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme='light']) { --glow-strength: 0.08; }
        }
        :root[data-theme='dark'] { --glow-strength: 0.08; }
        html, body { margin: 0; }
        body {
          padding-top: var(--header-h);
          background: var(--background);
          color: var(--foreground);
          font: 400 16px/1.65 var(--font-sans);
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
        ::selection { background: var(--accent-tint); color: var(--foreground); }
        /* Background glow, three soft radial gradients. Fixed and
           pointer-events:none so it never intercepts a click, and z-0 so the
           content wrapper sits on top of it. */
        .glow-layer { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
        .glow-layer::before {
          content: ''; position: absolute; inset: 0;
          background:
            radial-gradient(60% 48% at 50% -5%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 100%), transparent), transparent 75%),
            radial-gradient(45% 40% at 85% 10%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 60%), transparent), transparent 70%),
            radial-gradient(50% 50% at 15% 85%, color-mix(in oklch, var(--glow-a) calc(var(--glow-strength) * 40%), transparent), transparent 70%);
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
        }
      </style>
    </head>
    <body>
      <div class="glow-layer" aria-hidden="true"></div>
      <!-- position:fixed, never sticky. A sticky header flickers on iOS WebKit
           during a client-router nav (#610). Fixed goes on the <header> itself
           rather than a wrapper, because the measure script above queries
           document.querySelector('header') and bails unless THAT element
           computes to fixed. -->
      <header class="fixed inset-x-0 top-0 z-20 backdrop-blur-md bg-[color-mix(in_oklch,var(--color-background)_50%,transparent)] border-b border-border">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <a href="/" aria-label="WebJs Gallery home" class="inline-flex items-center gap-3 no-underline text-foreground shrink-0 transition-opacity duration-150 hover:opacity-80">
            <!-- Two files swapped by the dark: variant rather than one file
                 inverted, because invert() flips the paper along with the ink
                 and the mark stops sitting on the page. Intrinsic box is
                 722 x 190, so a 26px height is 99px wide. -->
            <img src=${asset('/public/brand/webjs-lockup-on-dark.svg')} alt="WebJs" width="99" height="26" class="w-auto hidden dark:block" style="height:26px" />
            <img src=${asset('/public/brand/webjs-lockup-on-light.svg')} alt="WebJs" width="99" height="26" class="w-auto block dark:hidden" style="height:26px" />
            <span class="text-sm text-muted-foreground font-medium">Gallery</span>
          </a>
          <nav class="flex items-center gap-4 text-sm" aria-label="Primary">
            <a href="https://webjs.dev/docs" target="_blank" rel="noopener" class="hidden sm:inline text-muted-foreground hover:text-foreground no-underline transition-colors">Docs</a>
            <a href="https://github.com/webjsdev/webjs" target="_blank" rel="noopener" class="hidden sm:inline text-muted-foreground hover:text-foreground no-underline transition-colors">GitHub</a>
            <theme-toggle></theme-toggle>
          </nav>
        </div>
      </header>
      <!-- Explicit z-1: a relative element with no z-index does not reliably
           sit above the fixed glow layer. -->
      <div class="relative z-1">
        <main class="min-h-[calc(100dvh-3.5rem)] max-w-5xl mx-auto px-4 sm:px-6 py-8">
          ${children}
        </main>
        <!-- Written inline rather than extracted to lib/ui/, because
             gallery/lib/ is scaffold payload and a footer module there would
             ship the WebJs footer into every generated app. Every href is
             absolute: the gallery is a separate origin, so a relative /docs
             would 404 against its own router. -->
        <!-- The inner box repeats main's max-w-5xl mx-auto px-4 sm:px-6 exactly
             rather than putting the padding on the footer element. Padding
             outside the max-width box shrinks the centring container first,
             which left the footer content 24px off the column above it. -->
        <footer class="mt-24 border-t border-border py-12 bg-secondary/30">
          <div class="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div class="flex flex-col gap-3">
              <a href="https://webjs.dev" aria-label="WebJs home" class="no-underline text-foreground inline-flex w-fit transition-opacity duration-150 hover:opacity-80">
                <img src=${asset('/public/brand/webjs-lockup-on-dark.svg')} alt="" width="99" height="26" class="w-auto hidden dark:block" style="height:26px" />
                <img src=${asset('/public/brand/webjs-lockup-on-light.svg')} alt="" width="99" height="26" class="w-auto block dark:hidden" style="height:26px" />
              </a>
              <p class="m-0 text-xs text-muted-foreground leading-relaxed">The web framework for AI agents. Full-stack web components, SSR, zero build step.</p>
            </div>
            <nav class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label="Footer">
              <a class="text-muted-foreground hover:text-primary no-underline transition-colors" href="https://webjs.dev/docs">Docs</a>
              <a class="text-muted-foreground hover:text-primary no-underline transition-colors" href="https://webjs.dev/ui">UI components</a>
              <a class="text-muted-foreground hover:text-primary no-underline transition-colors" href="https://webjs.dev/blog">Blog</a>
              <a class="text-muted-foreground hover:text-primary no-underline transition-colors" href="https://github.com/webjsdev/webjs" target="_blank" rel="noopener noreferrer">GitHub</a>
            </nav>
          </div>
        </footer>
      </div>
    </body>
    </html>
  `;
}
