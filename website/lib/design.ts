import { html } from '@webjsdev/core';
import { NEW_TAB } from '#lib/links.ts';

/**
 * The design system's shared class recipes.
 *
 * These used to be copy-pasted per page, which is how the site drifted: the
 * home page, /why-webjs, /what-is-webjs, and /brand each carried their own
 * `BTN` string, so a change to the button shape landed on whichever page the
 * author happened to be editing. Anything that appears on more than one page
 * belongs here, and a page that needs a one-off composes on top rather than
 * restating the base.
 *
 * The rules encoded below:
 *
 * - Controls are compact. Size and colour are separate decisions: the primary
 *   button carries the brand amber, but at 42px with a 10px radius it reads as
 *   a tool rather than as a banner.
 * - The accent has exactly two jobs, the primary action and the closing CTA,
 *   plus live and focus state. It never tints a content panel, a section
 *   heading, or a label. Rationing it to the places that ask for a click is
 *   what keeps it meaningful.
 * - Type sizes come from the @theme scale (text-display / text-h2 / text-lede)
 *   rather than per-page pixel values, so the rhythm holds across pages.
 */

/**
 * The radius scale:
 *
 *   buttons            full pill   the free-standing actions
 *   28px copy button   7px         a control nested inside a surface
 *   52px install bar  16px         rounded-2xl
 *   cards, windows    16px
 *   full-width panels 20px, and 22px on the closing CTA
 *
 * Two rules. A free-standing action is a PILL, so its shape says "press me"
 * before its colour does; this is also what the live site does. Everything
 * that is a SURFACE takes a radius scaled to its own height, roughly a quarter
 * of it, because curvature is read relative to size. Holding one number across
 * different heights makes the taller element look squarer, which is what
 * happened when the 52px install bar was forced to a button's 10px: at 19% of
 * its height it looked pinched beside controls reading 24%.
 */

/** Shared control geometry. Compose with a surface, do not use bare. */
const BTN_BASE =
  'inline-flex items-center gap-2 h-[42px] px-5 rounded-full font-semibold text-sm leading-none no-underline border cursor-pointer transition-all duration-[140ms]';

/**
 * The single strongest action on a view. At most one per screen.
 *
 * Amber on a near-black page is the highest-energy pairing available, so the
 * glow is the mark of "this is the thing to click" rather than decoration.
 */
export const BTN_PRIMARY = `${BTN_BASE} bg-accent text-accent-fg border-transparent shadow-[var(--shadow-glow)] hover:bg-accent-hover hover:-translate-y-0.5`;

/** Every other action. Reads as secondary without competing for attention. */
export const BTN_GHOST = `${BTN_BASE} text-fg border-border-strong bg-[color-mix(in_oklch,var(--color-bg-elev)_55%,transparent)] hover:border-fg-subtle hover:bg-bg-subtle`;

/**
 * The copy-to-clipboard install command.
 *
 * The live site's proportions (generous padding, the backdrop blur and shadow
 * that lift it off the page), because this bar is a primary call to action in
 * its own right and a tightened version read as a caption. It keeps the 2xl
 * radius, which is softer than the buttons beside it in absolute terms but
 * proportionally right for something 10px taller.
 */
export const INSTALL =
  `flex items-center gap-2 w-fit max-w-full mx-auto px-[18px] py-3.5 text-left font-mono text-sm leading-[1.6] text-fg-muted rounded-2xl border border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_70%,transparent)] backdrop-blur-sm shadow-[var(--shadow-sm)]`;

/* ---------------------------------------------------------------------------
   Layout.

   Two widths and one vertical rhythm, so a new page does not invent its own.
   The widths exist because the site has two kinds of page and they want
   different measures: a marketing page lays things out across the viewport, a
   reading page wants a line length that stays comfortable, which is what caps
   READING at 840px (roughly 75 characters at the body size).
--------------------------------------------------------------------------- */

/** Full-width marketing content: the hero, feature grids, the stage. */
export const WIDE = 'max-w-6xl mx-auto px-6';

/** Long-form reading: the blog, articles, and comparison hubs and posts. */
export const READING = 'max-w-3xl mx-auto px-6';

/** One section's vertical rhythm. Every marketing section uses this, not its own. */
export const SECTION = 'py-16';

/**
 * A small uppercase label: window chrome, card kickers, sidebar section names.
 *
 * Built from Tailwind's own steps rather than a custom size. A token one pixel
 * below text-xs existed here and no reader could perceive the difference,
 * which is also why shadcn ships no type tokens at all.
 */
export const LABEL = 'text-xs font-semibold uppercase tracking-widest text-fg-subtle';

/** Small supporting text that is not a label: dates, counts, captions. */
export const META = 'text-xs text-fg-subtle';

/** Section heading, and the paragraph that follows it. */
export const H2 = 'font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance';
export const PROSE = 'text-fg-muted text-[1.05rem] leading-[1.6] m-0';

/**
 * The header at the top of a long-form hub or index page.
 *
 * This existed three times, byte for byte apart from its words, on /blog,
 * /articles, and /compare. Each copy also carried an uppercase mono eyebrow
 * over the title, the device that was removed from every other page, so the
 * three pages that shared a header were also the three still carrying a
 * pattern the rest of the site had dropped. One function makes that class of
 * drift impossible: there is nowhere left for a fourth variant to appear.
 */
export function pageHeader(title: string, lede: string) {
  return html`
    <header class="mb-10">
      <h1 class="font-serif text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-tight text-fg mb-3">${title}</h1>
      <p class="text-fg-muted text-sm leading-relaxed max-w-2xl">${lede}</p>
    </header>
  `;
}

/**
 * The closing call to action, the one panel that is allowed to glow.
 *
 * It earns the glow because it is the only panel on a page whose entire job is
 * to be clicked. Everything above it stays neutral, which is precisely what
 * makes this one land when the reader reaches it.
 *
 * The FILL is a token rather than a literal because the two themes want
 * different things from it. On light, a faint accent tint separates the panel
 * from the page. On dark it did the opposite: over a black page the same tint
 * turned the panel muddy, the same reason the backdrop wash read as brown. So
 * dark takes the plain elevated surface and lets the glow alone do the work.
 * See --cta-surface in app/layout.ts.
 */
export const PANEL_CTA =
  'rounded-[22px] border border-border-strong bg-[var(--cta-surface)] shadow-[var(--shadow-glow)]';

/**
 * The closing call to action, composed rather than assembled per page.
 *
 * Three pages built this out of the same parts by hand, which is how the panel,
 * the install bar, and the two buttons drifted out of step with each other.
 * Passing the words in leaves nothing per-page to get wrong.
 *
 * `install` is opt-in because /why-webjs closes on the docs link alone, without
 * the command.
 */
export function ctaPanel(opts: {
  title: string;
  lede: string;
  install?: boolean;
  primary: { href: string; label: string };
  secondary?: { href: string; label: string; ext?: boolean };
}) {
  return html`
    <section class="${SECTION} text-center" id="get-started">
      <div class="${WIDE}">
        <div class="max-w-3xl mx-auto p-[clamp(32px,5vw,64px)] ${PANEL_CTA}">
          <h2 class="font-display font-extrabold text-h2 leading-[1.1] tracking-[-0.03em] mt-0 mb-3">${opts.title}</h2>
          <p class="text-fg-muted mx-auto mb-8 max-w-[52ch]">${opts.lede}</p>
          ${opts.install === false ? '' : html`
            <div class=${INSTALL}>
              <span class="text-accent select-none" aria-hidden="true">$</span><copy-cmd>npm create webjs@latest my-app</copy-cmd>
            </div>
          `}
          <div class="flex gap-3 justify-center flex-wrap mt-7">
            <a class=${BTN_PRIMARY} href=${opts.primary.href}>
              ${opts.primary.label}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </a>
            ${opts.secondary ? html`
              <a class=${BTN_GHOST} href=${opts.secondary.href}
                 target=${opts.secondary.ext ? '_blank' : '_self'}
                 rel=${opts.secondary.ext ? 'noopener noreferrer' : ''}>${opts.secondary.label}${opts.secondary.ext ? NEW_TAB : ''}</a>
            ` : ''}
          </div>
        </div>
      </div>
    </section>
  `;
}

