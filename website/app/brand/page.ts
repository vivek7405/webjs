import { html } from '@webjsdev/core';
import { BTN_PRIMARY, BTN_GHOST, H2, PROSE } from '#lib/design.ts';
import { brandMark } from '#lib/brand.ts';
import { SWATCHES, ACCENTS, type Swatch } from '#lib/brand-tokens.ts';

/**
 * /brand
 *
 * The brand guidelines and the downloadable marks.
 *
 * Two things this page must keep doing, because both were wrong in its first
 * draft and neither is caught by a test:
 *
 * 1. The swatches PAINT the token values from lib/brand-tokens.ts. They do not
 *    restate a colour in prose. The draft captioned the palette "electric
 *    cyan" beside amber chips, which is the failure mode a page like this
 *    invites.
 * 2. The clear-space and minimum-size rules are drawn, not described. A rule
 *    stated only in a sentence is a rule nobody follows.
 */

export function generateMetadata(ctx: { url: string }) {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/og.png`;
  const title = 'Brand and logo assets';
  const description =
    'The WebJs marks, palette, and typography, with clear-space rules, naming guidance, and downloadable SVG assets for light and dark backgrounds.';
  return {
    title,
    description,
    openGraph: { type: 'article', title, description, url: `${origin}/brand`, image, 'site_name': 'WebJs' },
    twitter: { card: 'summary_large_image', title, description, image },
  };
}

const ASSETS = [
  {
    file: 'webjs-lockup-on-dark.svg',
    name: 'Lockup',
    use: 'The default. Use it wherever there is room for the full name: headers, footers, title slides, README banners.',
    on: 'dark' as const,
  },
  {
    file: 'webjs-lockup-on-light.svg',
    name: 'Lockup, light backgrounds',
    use: 'The same drawing with the ink flipped for a light surface. Use this file rather than a CSS invert, which flips the paper along with the ink.',
    on: 'light' as const,
  },
  {
    file: 'webjs-monogram.svg',
    name: 'Monogram',
    use: 'For square and cramped placements: avatars, favicons, app icons, stickers, a multi-brand logo row.',
    on: 'dark' as const,
  },
  {
    file: 'webjs-monogram-on-light.svg',
    name: 'Monogram, light backgrounds',
    use: 'The same tile inverted, for a light surface. Bare W files with no tile at all are in the download, for placing on a background of your own.',
    on: 'light' as const,
  },
];

const MISUSE = [
  ['Do not distort', 'Scale proportionally. Never stretch, squash, skew, or rotate the mark, and never adjust the lean, which is already part of the drawing.'],
  ['Do not recolour', 'Use a supplied variant. Do not apply your own gradient, drop shadow, or outline, and do not repaint the slice as a solid bar.'],
  ['Do not redraw', 'Do not set the name in another typeface and call it the lockup, and do not rebuild the W from a font glyph.'],
  ['Do not imply endorsement', 'The marks may not suggest that WebJs sponsors, reviews, or is affiliated with your project without written permission.'],
];

function swatchRow(s: Swatch, theme: 'dark' | 'light') {
  const value = theme === 'dark' ? s.dark : s.light;
  return html`
    <div class="flex items-center gap-3 py-2">
      <span class="w-9 h-9 rounded-lg shrink-0 border border-border" style="background:${value}"></span>
      <span class="min-w-0">
        <span class="block text-sm font-semibold text-fg leading-tight">${s.name}</span>
        <code class="block font-mono text-2xs text-fg-subtle truncate">${s.token}</code>
      </span>
    </div>
  `;
}

export default function BrandPage() {
  return html`
    <style>
      /* The clear-space diagram. Drawn with real boxes rather than an image so
         it stays crisp at any zoom and follows the theme. */
      .cs-guide { outline: 1px dashed color-mix(in oklch, var(--fg) 40%, transparent); }
      .cs-pad { background: color-mix(in oklch, var(--fg) 7%, transparent); }
    </style>

    <main id="main" tabindex="-1" class="focus:outline-none">

    <section class="px-6 pt-[clamp(48px,7vw,88px)] pb-12 border-b border-border">
      <div class="max-w-[1120px] mx-auto">
        <h1 class="font-display font-extrabold text-display leading-[1.0] tracking-[-0.04em] mb-5 max-w-[13ch] text-balance">
          Brand and logo assets
        </h1>
        <p class="text-lede leading-[1.55] text-fg-muted max-w-[62ch] mb-8 text-pretty">
          The marks, the palette, and the rules for using them. Everything here is
          free to use for editorial, educational, and community purposes under the
          terms further down the page.
        </p>
        <div class="flex gap-3 flex-wrap">
          <a class=${BTN_PRIMARY} href="/public/brand/webjs-brand-assets.zip" download>
            Download all assets
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
          <a class=${BTN_GHOST} href="#usage">Usage rules</a>
        </div>
        <p class="mt-4 font-mono text-xs text-fg-subtle">SVG, 6 files, light and dark variants</p>
      </div>
    </section>

    <section class="py-16 px-6">
      <div class="max-w-[1120px] mx-auto">
        <div class="max-w-[720px] mb-10">
          <h2 class=${H2}>The marks</h2>
          <p class=${PROSE}>
            The identity is a forward-leaning W cut by a band of negative space,
            set against an italic wordmark that leans with it. The monogram is
            not a badge beside the name, it is the W of WebJs, and one slice cuts
            the whole lockup as a single object. Every mark is greyscale.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          ${ASSETS.map(a => html`
            <div class="flex flex-col rounded-2xl border border-border bg-bg-elev overflow-hidden">
              <div class="h-36 flex items-center justify-center px-7 ${a.on === 'dark' ? 'bg-[oklch(0_0_0)]' : 'bg-[oklch(0.985_0.008_75)]'}">
                <img src="/public/brand/${a.file}" alt=${a.name} class="max-h-12 w-auto" />
              </div>
              <div class="flex flex-col flex-1 p-5 border-t border-border">
                <h3 class="text-sm font-bold text-fg mb-1.5">${a.name}</h3>
                <p class="text-sm text-fg-muted leading-relaxed flex-1">${a.use}</p>
                <a href="/public/brand/${a.file}" download class="mt-4 font-mono text-xs text-fg hover:text-accent transition-colors no-underline">
                  ${a.file} &darr;
                </a>
              </div>
            </div>
          `)}
        </div>
      </div>
    </section>

    <section class="py-16 px-6 bg-bg-subtle/40 border-y border-border" id="usage">
      <div class="max-w-[1120px] mx-auto">
        <div class="max-w-[720px] mb-10">
          <h2 class=${H2}>Clear space and minimum size</h2>
          <p class=${PROSE}>
            Both rules are expressed in one unit, the height of the monogram in
            the lockup. Call it <strong class="text-fg font-semibold">W</strong>.
            Measuring against the mark itself means the rules hold at any scale
            without a table of pixel values.
          </p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          <div class="rounded-2xl border border-border bg-bg-elev p-8 flex flex-col">
            <div class="flex-1 flex items-center justify-center">
              <div class="cs-pad cs-guide p-[34px] rounded">
                <img src="/public/brand/webjs-lockup-on-dark.svg" alt="Clear space around the lockup" class="h-[34px] w-auto hidden dark:block" />
                <img src="/public/brand/webjs-lockup-on-light.svg" alt="Clear space around the lockup" class="h-[34px] w-auto dark:hidden" />
              </div>
            </div>
            <div class="mt-7 pt-5 border-t border-border">
              <h3 class="text-sm font-bold text-fg mb-1.5">Keep 1 W clear on every side</h3>
              <p class="text-sm text-fg-muted leading-relaxed">
                Nothing enters the shaded zone: no text, no rules, no other logo,
                no busy part of a photograph. When in doubt, give it more.
              </p>
            </div>
          </div>

          <div class="rounded-2xl border border-border bg-bg-elev p-8 flex flex-col">
            <div class="flex-1 flex items-end justify-center gap-12 pb-2">
              <div class="text-center flex flex-col items-center">
                ${brandMark('cs-a', { height: 24 })}
                <p class="mt-3 font-mono text-2xs leading-[1.5] text-fg-subtle">24 px<br>monogram floor</p>
              </div>
              <div class="text-center flex flex-col items-center">
                <img src="/public/brand/webjs-lockup-on-dark.svg" alt="" class="w-24 h-auto hidden dark:block" />
                <img src="/public/brand/webjs-lockup-on-light.svg" alt="" class="w-24 h-auto dark:hidden" />
                <p class="mt-3 font-mono text-2xs leading-[1.5] text-fg-subtle">96 px wide<br>lockup floor</p>
              </div>
            </div>
            <div class="mt-7 pt-5 border-t border-border">
              <h3 class="text-sm font-bold text-fg mb-1.5">Below the floor, switch marks</h3>
              <p class="text-sm text-fg-muted leading-relaxed">
                The lockup stops being readable under 96 px wide. Use the monogram
                instead of shrinking it further. The slice through the W thins out
                below 24 px and the mark degrades to a plain W, which is intended.
              </p>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          ${MISUSE.map(([t, d]) => html`
            <div class="p-5 rounded-xl border border-border bg-bg-elev">
              <div class="w-7 h-7 rounded-full bg-bg-subtle text-fg-muted flex items-center justify-center mb-3.5" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </div>
              <h4 class="text-sm font-bold text-fg mb-1.5">${t}</h4>
              <p class="text-sm text-fg-muted leading-relaxed">${d}</p>
            </div>
          `)}
        </div>
      </div>
    </section>

    <section class="py-16 px-6">
      <div class="max-w-[1120px] mx-auto">
        <div class="max-w-[720px] mb-10">
          <h2 class=${H2}>Colour</h2>
          <p class=${PROSE}>
            Dark is the primary theme and light is a translation of it, not a
            separate design. Neutrals carry the page: they hold a trace of warmth
            and nothing more. The marks are greyscale, so the palette below is
            the product's, not the identity's. Every chip is painted with the
            token it names.
          </p>
        </div>

        <div class="rounded-2xl border border-border bg-bg-elev overflow-hidden mb-5">
          <div class="grid grid-cols-1 md:grid-cols-2">
            <div class="p-7 md:border-r border-b md:border-b-0 border-border">
              <p class="text-sm font-semibold text-fg mb-4">Dark, the primary theme</p>
              ${SWATCHES.map(s => swatchRow(s, 'dark'))}
            </div>
            <div class="p-7">
              <p class="text-sm font-semibold text-fg mb-4">Light, the translation</p>
              ${SWATCHES.map(s => swatchRow(s, 'light'))}
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-border bg-bg-elev p-7">
          <p class="text-sm font-semibold text-fg mb-1">One accent, spent where it counts</p>
          <p class="text-sm text-fg-muted leading-relaxed max-w-[62ch] mb-6">
            A single warm amber fills the primary button and the closing call to
            action, and marks live and focus state. Those are the surfaces asking
            for a click. Everything else stays neutral, which is what makes them
            land. The marks themselves carry no colour at all, so the identity
            survives wherever the accent cannot go.
          </p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1 mb-7">
            <div>
              <p class="text-xs font-semibold text-fg-subtle mb-2">Dark</p>
              ${ACCENTS.map(s => swatchRow(s, 'dark'))}
            </div>
            <div>
              <p class="text-xs font-semibold text-fg-subtle mb-2">Light</p>
              ${ACCENTS.map(s => swatchRow(s, 'light'))}
            </div>
          </div>

          <div class="pt-6 border-t border-border">
            <p class="text-xs font-semibold text-fg-subtle mb-4">Where it is allowed to appear</p>
            <div class="flex flex-wrap items-center gap-4">
              <span class="${BTN_PRIMARY} pointer-events-none">Primary action</span>
              <span class="${BTN_GHOST} pointer-events-none">Everything else</span>
              <span class="inline-flex items-center gap-1.5 font-mono text-xs text-fg-subtle">
                <span class="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--accent)]"></span>live state
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="py-16 px-6 bg-bg-subtle/40 border-y border-border">
      <div class="max-w-[1120px] mx-auto">
        <div class="max-w-[720px] mb-10">
          <h2 class=${H2}>Typography</h2>
          <p class=${PROSE}>
            Three faces, each with one job. All are variable, self-hosted, and
            already loaded by this page.
          </p>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div class="p-7 rounded-2xl border border-border bg-bg-elev">
            <p class="font-display text-[2.4rem] font-extrabold tracking-[-0.035em] leading-none text-fg mb-4">Ag</p>
            <h3 class="text-sm font-bold text-fg mb-1.5">Inter Tight</h3>
            <p class="text-sm text-fg-muted leading-relaxed">Headlines and section headings, at weight 700 to 800 with tracking pulled to <code class="font-mono text-xs">-0.03em</code>.</p>
          </div>
          <div class="p-7 rounded-2xl border border-border bg-bg-elev">
            <p class="font-sans text-[2.4rem] font-semibold leading-none text-fg mb-4">Ag</p>
            <h3 class="text-sm font-bold text-fg mb-1.5">Inter</h3>
            <p class="text-sm text-fg-muted leading-relaxed">Body prose, ledes, navigation, and everything in the documentation, at <code class="font-mono text-xs">1.6</code> line height.</p>
          </div>
          <div class="p-7 rounded-2xl border border-border bg-bg-elev">
            <p class="font-mono text-[2.4rem] font-medium leading-none text-fg mb-4">Ag</p>
            <h3 class="text-sm font-bold text-fg mb-1.5">JetBrains Mono</h3>
            <p class="text-sm text-fg-muted leading-relaxed">Code, terminal commands, token names, and version tags. Never used for running prose.</p>
          </div>
        </div>
      </div>
    </section>

    <section class="py-16 px-6">
      <div class="max-w-[1120px] mx-auto">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <div>
            <h2 class=${H2}>Writing the name</h2>
            <p class="${PROSE} mb-6">
              The name is a proper noun and takes one capitalisation,
              <strong class="text-fg font-semibold">WebJs</strong>, everywhere it
              appears in prose. It stays lowercase only as a literal code token.
            </p>
            <div class="rounded-2xl border border-border bg-bg-elev">
              <div class="p-5 border-b border-border">
                <p class="text-sm font-semibold text-fg mb-2.5">Correct</p>
                <p class="text-sm text-fg-muted leading-relaxed">WebJs ships without a build step.<br>Most WebJs apps run on Node 24+ or Bun.<br>Run <code class="font-mono text-sm bg-bg-subtle px-1.5 py-0.5 rounded">webjs dev</code> to start.</p>
              </div>
              <div class="p-5 border-b border-border">
                <p class="text-sm font-semibold text-fg mb-2.5">Incorrect</p>
                <p class="text-sm text-fg-subtle leading-relaxed line-through decoration-1">WEBJS, WebJS, Webjs, web.js, Web JS</p>
              </div>
              <div class="p-5">
                <p class="text-sm font-semibold text-fg mb-2.5">Lowercase is correct here</p>
                <p class="text-sm text-fg-muted leading-relaxed">
                  The CLI (<code class="font-mono text-sm bg-bg-subtle px-1.5 py-0.5 rounded">webjs create</code>),
                  the packages (<code class="font-mono text-sm bg-bg-subtle px-1.5 py-0.5 rounded">@webjsdev/core</code>),
                  the domain (webjs.dev), and the repository path. The lockup
                  itself is set as WebJs, matching the prose.
                </p>
              </div>
            </div>
          </div>

          <div>
            <h2 class=${H2}>Permission and trademark</h2>
            <p class="${PROSE} mb-6">
              The framework is MIT licensed. The marks are not covered by that
              licence, because a logo has to keep meaning one thing to be worth
              anything.
            </p>
            <div class="rounded-2xl border border-border bg-bg-elev p-6">
              <h3 class="text-sm font-bold text-fg mb-1.5">You may, without asking</h3>
              <p class="text-sm text-fg-muted leading-relaxed mb-5">
                Use the marks unmodified to refer to WebJs in articles, talks,
                documentation, courses, and comparisons; state that your project
                is built with WebJs; and link to this site.
              </p>
              <h3 class="text-sm font-bold text-fg mb-1.5">Please ask first</h3>
              <p class="text-sm text-fg-muted leading-relaxed mb-5">
                Merchandise, a modified mark, a name or logo confusingly similar
                to this one, or any use that implies partnership, sponsorship, or
                official status.
              </p>
              <p class="pt-5 border-t border-border text-xs text-fg-subtle leading-relaxed">
                If you are unsure, open a discussion on GitHub and ask. The answer
                is usually yes.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    </main>
  `;
}
