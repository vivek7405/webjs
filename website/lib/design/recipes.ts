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
 *   button carries the brand amber, but at 42px tall it reads as a control
 *   rather than as a banner.
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
  'inline-flex items-center gap-2 h-10 px-5 rounded-full font-semibold text-sm leading-none no-underline border cursor-pointer transition-all duration-[140ms]';

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
  `flex items-center gap-2 w-fit max-w-full mx-auto px-4 py-3.5 text-left font-mono text-sm leading-[1.6] text-fg-muted rounded-2xl border border-border bg-[color-mix(in_oklch,var(--color-bg-subtle)_70%,transparent)] backdrop-blur-sm shadow-[var(--shadow-sm)]`;

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
export const READING = 'max-w-210 mx-auto px-6';

/** One section's vertical rhythm. Every marketing section uses this, not its own. */
export const SECTION = 'py-16';

/**
 * The marketing section's vertical rhythm, in one place because it is four
 * numbers that have to agree across every section on a page and there is no
 * single element that owns them.
 *
 *   section padding      py-16   64px, the SECTION recipe above
 *   heading to lede      my-3    12px, from the H2 recipe's own margin
 *   header to artifact   mb-12   48px, on the centered header block
 *   artifact to closer   mt-8    32px, the FIRST trailing paragraph
 *   closer to closer     mt-6    24px, every one after that
 *
 * The last two are the ones that drift, because a closing sentence is added
 * one section at a time and each author picks a margin by eye. The landing
 * page had 16, 24, 32 and 24 across four closers before this was written down.
 * If a section needs a different value, it needs a reason in a comment.
 *
 * Deliberate exception: a closing line that sits INSIDE the header block,
 * above the artifact rather than below it, is not this pattern. The landing
 * page's JavaScript-off P.S. is the only one, at mt-5.
 */
export const CLOSER = 'mt-8';
export const CLOSER_NEXT = 'mt-6';

/**
 * A small uppercase label: window chrome, card kickers, sidebar section names.
 *
 * Built from Tailwind's own steps rather than a custom size. A token one pixel
 * below text-xs existed here and no reader could perceive the difference,
 * which is also why shadcn ships no type tokens at all.
 */
export const LABEL = 'text-xs font-semibold uppercase tracking-widest text-fg-subtle';

/**
 * A tag chip on a post or article card.
 *
 * Deliberately the quietest thing on the card: it sits in a row of up to six
 * above a headline and must not compete with the title it annotates.
 *
 * It stays on text-xs. Tailwind has no step below 12px, and that is a
 * deliberate floor rather than an omission, so the chip is made smaller
 * through the properties that DO have steps: padding, leading, and tracking.
 * An arbitrary 10px was tried here and reverted, because minting an off-scale
 * size for one component is how a scale stops being one.
 */
export const BADGE =
  'bg-fg-subtle/10 text-fg-subtle font-mono text-xs leading-none uppercase tracking-wide px-1.5 py-1 rounded';

/** Small supporting text that is not a label: dates, counts, captions. */
export const META = 'text-xs text-fg-subtle';

/** Section heading, and the paragraph that follows it. */
export const H2 = 'font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance';
export const PROSE = 'text-fg-muted text-base leading-[1.6] m-0';

/**
 * The accent eyebrow above a hub title.
 *
 * This is the ONE uppercase label the site keeps, and the accent is what earns
 * it: it names the section a reader has landed in, at the top of the page,
 * once. The grey uppercase labels that used to sit above every section heading
 * were a different thing wearing the same clothes, and they are gone.
 */
export const EYEBROW = 'font-mono text-xs uppercase tracking-widest text-accent font-semibold mb-2';

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
  'rounded-3xl border border-border-strong bg-[var(--cta-surface)] shadow-[var(--shadow-glow)]';

