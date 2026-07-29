import { html } from '@webjsdev/core';
import '#components/copy-cmd.ts';
import { DOCS_START_PATH, GH_URL } from '#lib/links.ts';

/**
 * /brand
 *
 * Official Brand Guidelines & Assets Portal for WebJs.
 * Displays logo specifications, clear-space rules, color tokens,
 * presentation templates, and downloadable SVG brand assets.
 */

export function generateMetadata(ctx: { url: string }) {
  const origin = new URL(ctx.url).origin;
  const image = `${origin}/public/velocity-wordmark.svg`;
  const title = 'WebJs Brand Guidelines & Logo Assets';
  const description =
    'Official brand guidelines, logo assets, design tokens, color palette, and clear-space rules for WebJs.';
  return {
    title,
    description,
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${origin}/brand`,
      image,
      'site_name': 'WebJs',
    },
    twitter: { card: 'summary_large_image', title, description, image },
  };
}

const KICKER = 'inline-flex flex-wrap justify-center gap-[10px] font-mono font-semibold text-[12px] leading-[1.4] tracking-[0.18em] uppercase text-[var(--accent-text)]';
const BTN = 'inline-flex items-center gap-2 px-[22px] py-[13px] rounded-full font-semibold text-[15px] leading-none no-underline border cursor-pointer transition-all duration-[140ms]';
const CARD = 'p-6 bg-bg-elev border border-border rounded-2xl flex flex-col justify-between h-full shadow-sm';

export default function BrandPage() {
  return html`
    <main id="main" tabindex="-1" class="focus:outline-none">

    <!-- Hero Section -->
    <section class="text-center px-6 pt-[clamp(48px,7vw,80px)] pb-12 md:pb-16 border-b border-border">
      <h1 class="font-display font-extrabold text-display leading-[1.04] tracking-[-0.035em] mx-auto mt-4 mb-4 max-w-[18ch] text-balance">
        WebJs Brand Guidelines & Assets
      </h1>
      <p class="text-lede leading-[1.6] text-fg-muted max-w-[58ch] mx-auto mb-8 text-pretty">
        Official logos, SVG vector files, color system tokens, typography rules, and trademark guidelines for presenting WebJs in talks, articles, and community projects.
      </p>
      <div class="flex gap-3 justify-center flex-wrap">
        <a class="${BTN} bg-accent text-accent-fg border-transparent shadow-[var(--shadow-glow)] hover:bg-accent-hover hover:-translate-y-0.5" href="/public/velocity-wordmark.svg" download="webjs-wordmark.svg">
          Download Logos (SVG)
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
        <a class="${BTN} text-fg border-border-strong bg-[color-mix(in_oklch,var(--color-bg-elev)_60%,transparent)] hover:border-fg-muted hover:-translate-y-0.5" href="#misuse">Usage Guidelines</a>
      </div>
    </section>

    <!-- Section 1: Primary Brand Logos & Assets -->
    <section class="py-16 px-6 max-w-[1140px] mx-auto">
      <div class="max-w-[720px] mb-12">
        <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3">Logo Assets & Monogram</h2>
        <p class="text-fg-muted text-[1.05rem] leading-[1.6]">
          The WebJs brand identity is powered by the <strong>Velocity Lockup</strong>—a forward-leaning geometric <em>W</em> with a hairline negative-space slice flowing into italicized letterforms.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-stretch mb-12">
        <!-- Velocity Full Wordmark -->
        <div class="${CARD}">
          <div class="w-full h-48 mb-6 rounded-2xl overflow-hidden border border-border bg-[#0b0b0f] flex items-center justify-center p-8 shadow-inner">
            <img src="/public/velocity-wordmark.svg" alt="WebJs Velocity Full Wordmark" class="w-full max-h-20 object-contain invert dark:invert-0" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xl font-bold text-fg">Full Velocity Wordmark</h3>
              <span class="font-mono text-xs px-2 py-1 rounded bg-accent-surface text-accent font-semibold">Primary</span>
            </div>
            <p class="text-sm text-fg-muted leading-relaxed mb-6">
              Use for primary headers, website footers, keynote title slides, and official announcements. Contains the complete Velocity W emblem and typography.
            </p>
          </div>
          <div class="flex gap-3 pt-4 border-t border-border">
            <a href="/public/velocity-wordmark.svg" download="webjs-velocity-wordmark.svg" class="font-mono text-xs text-accent font-semibold hover:underline flex items-center gap-1">
              Download SVG ↓
            </a>
          </div>
        </div>

        <!-- Velocity Monogram Badge -->
        <div class="${CARD}">
          <div class="w-full h-48 mb-6 rounded-2xl overflow-hidden border border-border bg-[#0b0b0f] flex items-center justify-center p-8 shadow-inner">
            <img src="/public/velocity-favicon.svg" alt="WebJs Velocity Monogram Badge" class="w-28 h-28 object-contain" />
          </div>
          <div>
            <div class="flex items-center justify-between mb-2">
              <h3 class="text-xl font-bold text-fg">Velocity W Monogram</h3>
              <span class="font-mono text-xs px-2 py-1 rounded bg-bg-subtle text-fg-subtle font-semibold">Icon & Badge</span>
            </div>
            <p class="text-sm text-fg-muted leading-relaxed mb-6">
              Use for favicons, mobile app icons, laptop stickers, social media avatars, and compact UI headers where full wordmark space is limited.
            </p>
          </div>
          <div class="flex gap-3 pt-4 border-t border-border">
            <a href="/public/velocity-favicon.svg" download="webjs-velocity-favicon.svg" class="font-mono text-xs text-accent font-semibold hover:underline flex items-center gap-1">
              Download SVG ↓
            </a>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 2: Clear Space & Misuse Guidelines -->
    <section class="py-16 px-6 bg-bg-subtle/40 border-y border-border" id="misuse">
      <div class="max-w-[1140px] mx-auto">
        <div class="max-w-[720px] mb-12">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3">Logo Clear Space & Misuse Rules</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6]">
            To preserve visual legibility and brand recognition across digital and print media, always maintain adequate clear space around the logo and follow these usage constraints.
          </p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div class="p-6 bg-bg-elev border border-border rounded-xl">
            <div class="w-8 h-8 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center font-bold mb-4">✕</div>
            <h4 class="font-bold text-fg mb-2">Do Not Distort</h4>
            <p class="text-xs text-fg-muted leading-relaxed">Never stretch, compress, skew, or rotate the Velocity W mark or wordmark lettering.</p>
          </div>

          <div class="p-6 bg-bg-elev border border-border rounded-xl">
            <div class="w-8 h-8 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center font-bold mb-4">✕</div>
            <h4 class="font-bold text-fg mb-2">Do Not Recolor</h4>
            <p class="text-xs text-fg-muted leading-relaxed">Do not apply unauthorized gradients or change the negative-space hairline slice color.</p>
          </div>

          <div class="p-6 bg-bg-elev border border-border rounded-xl">
            <div class="w-8 h-8 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center font-bold mb-4">✕</div>
            <h4 class="font-bold text-fg mb-2">Maintain Contrast</h4>
            <p class="text-xs text-fg-muted leading-relaxed">Never place dark logos on low-contrast backgrounds or busy image overlays.</p>
          </div>

          <div class="p-6 bg-bg-elev border border-border rounded-xl">
            <div class="w-8 h-8 rounded-full bg-red-500/10 text-red-400 flex items-center justify-center font-bold mb-4">✕</div>
            <h4 class="font-bold text-fg mb-2">No Misleading Endorsement</h4>
            <p class="text-xs text-fg-muted leading-relaxed">Do not use the WebJs logo to suggest official sponsorship or partnership without permission.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 3: Color Tokens -->
    <section class="py-16 px-6 max-w-[1140px] mx-auto">
      <div class="max-w-[720px] mb-12">
        <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3">Color System & Palette</h2>
        <p class="text-fg-muted text-[1.05rem] leading-[1.6]">
          The official WebJs color palette built on high-contrast obsidian dark surfaces, crisp white typography, and vibrant electric cyan accents.
        </p>
      </div>

      <div class="mb-8">
        <h3 class="font-mono text-xs text-accent font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-accent"></span> Dark Theme Palette
        </h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <!-- Void Black -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#000000] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Void Black</h4>
            <p class="font-mono text-xs text-fg-muted">--bg (#000000)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Canvas Background</p>
          </div>

          <!-- Elevated Surface -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#222222] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Elevated Surface</h4>
            <p class="font-mono text-xs text-fg-muted">--bg-elev (#222222)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Cards & Windows</p>
          </div>

          <!-- Muted Surface -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#171717] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Muted Surface</h4>
            <p class="font-mono text-xs text-fg-muted">--bg-subtle (#171717)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Headers & Code Bars</p>
          </div>

          <!-- Amber Accent -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#E59500] mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Warm Amber</h4>
            <p class="font-mono text-xs text-fg-muted">--accent (#E59500)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Primary Active Accent</p>
          </div>

          <!-- Foreground White -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#F5F5F5] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Foreground Text</h4>
            <p class="font-mono text-xs text-fg-muted">--fg (#F5F5F5)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Primary Headlines</p>
          </div>
        </div>
      </div>

      <div>
        <h3 class="font-mono text-xs text-accent font-semibold uppercase tracking-wider mb-4 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-accent"></span> Light Theme Palette
        </h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <!-- Canvas Light -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#F9FAF6] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Off-White Canvas</h4>
            <p class="font-mono text-xs text-fg-muted">--bg (#F9FAF6)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Canvas Background</p>
          </div>

          <!-- White Elevated -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#FFFFFF] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Pure White Card</h4>
            <p class="font-mono text-xs text-fg-muted">--bg-elev (#FFFFFF)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Cards & Windows</p>
          </div>

          <!-- Muted Light -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#F3F4EF] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Muted Surface</h4>
            <p class="font-mono text-xs text-fg-muted">--bg-subtle (#F3F4EF)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Sunken Sections</p>
          </div>

          <!-- Bronze Accent -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#C25E00] mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Deep Bronze</h4>
            <p class="font-mono text-xs text-fg-muted">--accent (#C25E00)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Primary Active Accent</p>
          </div>

          <!-- Dark Charcoal Text -->
          <div class="p-4 bg-bg-elev border border-border rounded-xl">
            <div class="w-full h-16 rounded-lg bg-[#2D2B26] border border-border mb-3"></div>
            <h4 class="font-bold text-sm text-fg">Charcoal Text</h4>
            <p class="font-mono text-xs text-fg-muted">--fg (#2D2B26)</p>
            <p class="text-[11px] text-fg-subtle mt-1">Primary Headlines</p>
          </div>
        </div>
      </div>
    </section>

    <!-- Section 4: Typography -->
    <section class="py-16 px-6 bg-bg-subtle/40 border-t border-border">
      <div class="max-w-[1140px] mx-auto">
        <div class="max-w-[720px] mb-12">
          <h2 class="font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3">Type Family Specifications</h2>
          <p class="text-fg-muted text-[1.05rem] leading-[1.6]">
            WebJs pairs clean geometric sans-serif faces for headlines and reading prose with precision monospace fonts for terminal output.
          </p>
        </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div class="p-6 bg-bg-elev border border-border rounded-2xl">
              <span class="font-mono text-xs text-accent font-semibold uppercase tracking-wider mb-2 block">Display Face</span>
              <h3 class="font-display text-3xl font-extrabold text-fg mb-3">Inter Tight</h3>
              <p class="text-sm text-fg-muted leading-relaxed">Used for hero headlines, major section H2s, and key callouts with tight character tracking (<code class="font-mono text-xs bg-bg-subtle px-1.5 py-0.5 rounded text-fg">tracking-[-0.035em]</code>).</p>
            </div>

            <div class="p-6 bg-bg-elev border border-border rounded-2xl">
              <span class="font-mono text-xs text-accent font-semibold uppercase tracking-wider mb-2 block">Body Face</span>
              <h3 class="font-sans text-3xl font-bold text-fg mb-3">Inter Sans</h3>
              <p class="text-sm text-fg-muted leading-relaxed">Used for body prose, documentation articles, lede paragraphs, and navigation links (<code class="font-mono text-xs bg-bg-subtle px-1.5 py-0.5 rounded text-fg">leading-[1.6]</code>).</p>
            </div>

            <div class="p-6 bg-bg-elev border border-border rounded-2xl">
              <span class="font-mono text-xs text-accent font-semibold uppercase tracking-wider mb-2 block">Monospace</span>
              <h3 class="font-mono text-2xl font-bold text-fg mb-3">JetBrains Mono</h3>
              <p class="text-sm text-fg-muted leading-relaxed">Used for code windows, inline code tags, terminal setup commands (<code class="font-mono text-xs bg-bg-subtle px-1.5 py-0.5 rounded text-fg">$ npm create</code>), and release tags.</p>
            </div>
          </div>
      </div>
    </section>

    <!-- Closing CTA Section -->
    <section class="py-16 text-center">
      <div class="max-w-[1080px] mx-auto px-6">
        <div class="max-w-[760px] mx-auto p-[clamp(32px,5vw,64px)] rounded-[22px] border border-border-strong bg-[color-mix(in_oklch,var(--accent-live)_7%,var(--color-bg-elev))] shadow-[var(--shadow-glow)]">
          <h2 class="font-display font-extrabold text-h2 leading-[1.1] tracking-[-0.03em] mt-0 mb-3">Presenting WebJs at a Talk or Conference?</h2>
          <p class="text-fg-muted mx-auto mb-8 max-w-[48ch]">Download the official brand package and presentation slide guidelines for your keynote or community meetup.</p>
          <div class="flex gap-3 justify-center flex-wrap">
            <a class="${BTN} bg-accent text-accent-fg border-transparent shadow-[var(--shadow-glow)] hover:bg-accent-hover hover:-translate-y-0.5" href="/public/velocity-wordmark.svg" download="webjs-wordmark.svg">
              Download Brand Package
            </a>
            <a class="${BTN} text-fg border-border-strong bg-[color-mix(in_oklch,var(--color-bg-elev)_60%,transparent)] hover:border-fg-muted hover:-translate-y-0.5" href=${GH_URL} target="_blank" rel="noopener noreferrer">View on GitHub</a>
          </div>
        </div>
      </div>
    </section>

    </main>
  `;
}
