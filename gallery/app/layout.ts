import { html, asset } from '@webjsdev/core';
import '#components/theme-toggle.ts';

export const metadata = {
  title: 'WebJs Gallery',
  description: 'Interactive showcase and single-concept feature gallery for WebJs applications.',
  // app/icon.ts SERVES the favicon at /icon, but a metadata route is not
  // auto-linked: the framework emits `<link rel="icon">` only from
  // metadata.icons. Without this the head pointed at nothing and the browser
  // fell back to /favicon.ico, which the gallery does not ship, so the tab
  // showed no mark at all. Declare it here, never as a hand-written <link>,
  // so the URL stays in one place.
  icons: { icon: { url: '/icon', type: 'image/svg+xml', sizes: 'any' } },
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
            var t = localStorage.getItem('theme');
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
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=JetBrains+Mono:wght@400;500;700&display=swap">
      <link rel="stylesheet" href=${asset('/public/tailwind.css')}>
      <style>
        :root {
          --font-sans:  'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
          --font-serif: ui-serif, 'Iowan Old Style', Palatino, Georgia, serif;
          --font-mono:  'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
          --font-display: 'Bricolage Grotesque', 'JetBrains Mono', ui-sans-serif, system-ui, sans-serif;
          --header-h: 0px;

          color-scheme: light dark;
          --background:         light-dark(#ffffff, #1e2226);
          --foreground:         light-dark(#191c20, #dee2e6);
          --card:               light-dark(#f7f8fa, #313539);
          --card-foreground:    light-dark(#191c20, #dee2e6);
          --popover:            light-dark(#ffffff, #313539);
          --popover-foreground: light-dark(#191c20, #dee2e6);
          --primary:            light-dark(#1e2226, #dee2e6);
          --primary-foreground: light-dark(#ffffff, #1e2226);
          --secondary:          light-dark(#eef0f2, #363a3e);
          --secondary-foreground: light-dark(#191c20, #dee2e6);
          --muted:              light-dark(#eef0f2, #313539);
          --muted-foreground:   light-dark(#565c64, #94989c);
          --accent:             light-dark(#e9ebef, #363a3e);
          --accent-foreground:  light-dark(#191c20, #f7fbff);
          --border:             light-dark(#e2e5e9, #3d434b);
          --border-strong:      light-dark(#ccd1d7, #454b51);
          --input:              light-dark(#e2e5e9, #34393e);
          --ring:               light-dark(#8b9198, #6b7075);
          --primary-tint: color-mix(in srgb, var(--primary) 22%, transparent);
        }
        :root[data-theme='light'] { color-scheme: light; }
        :root[data-theme='dark']  { color-scheme: dark; }
        html, body { margin: 0; }
        body {
          padding-top: var(--header-h);
          background: var(--background);
          color: var(--foreground);
          font: 15px/1.6 var(--font-sans);
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
        }
      </style>
    </head>
    <body>
      <header class="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <a href="/" class="inline-flex items-center gap-2 no-underline text-foreground font-bold tracking-tight" style="font-family: var(--font-display)">
          <span class="w-[22px] h-[22px] rounded-[7px] bg-gradient-to-br from-foreground to-muted-foreground" aria-hidden="true"></span>
          WebJs Gallery
        </a>
        <nav class="flex items-center gap-4 text-sm" aria-label="Primary">
          <a href="https://webjs.dev/docs" target="_blank" rel="noopener" class="hidden sm:inline text-muted-foreground hover:text-foreground no-underline transition-colors">Docs</a>
          <a href="https://github.com/webjsdev/webjs" target="_blank" rel="noopener" class="hidden sm:inline text-muted-foreground hover:text-foreground no-underline transition-colors">GitHub</a>
          <theme-toggle></theme-toggle>
        </nav>
      </header>
      <main class="min-h-[calc(100dvh-3.5rem)] max-w-5xl mx-auto px-4 sm:px-6 py-8">
        ${children}
      </main>
    </body>
    </html>
  `;
}
