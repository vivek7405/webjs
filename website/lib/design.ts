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
 * - Controls are compact. A large pill with a coloured glow reads as an
 *   advert; a small high-contrast control reads as a tool.
 * - The primary action is foreground on background, never the brand accent.
 *   That is the highest contrast pairing in the palette, and rationing the
 *   accent is what keeps the few accented things on a page meaningful.
 * - Type sizes come from the @theme scale (text-display / text-h2 / text-lede)
 *   rather than per-page pixel values, so the rhythm holds across pages.
 */

/** Shared control geometry. Compose with a surface, do not use bare. */
const BTN_BASE =
  'inline-flex items-center gap-2 h-[42px] px-[18px] rounded-[10px] font-semibold text-[14.5px] leading-none no-underline border cursor-pointer transition-all duration-[140ms]';

/** The single strongest action on a view. At most one per screen. */
export const BTN_PRIMARY = `${BTN_BASE} bg-fg text-bg border-transparent hover:opacity-[0.88]`;

/** Every other action. Reads as secondary without competing for attention. */
export const BTN_GHOST = `${BTN_BASE} text-fg border-border-strong bg-[color-mix(in_oklch,var(--color-bg-elev)_55%,transparent)] hover:border-fg-subtle hover:bg-bg-subtle`;

/** The copy-to-clipboard install command. */
export const INSTALL =
  'inline-flex items-center gap-2.5 max-w-full px-[15px] py-[11px] text-left font-mono text-[13.5px] leading-none text-fg-muted rounded-[10px] border border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_60%,transparent)]';

/** Section heading, and the paragraph that follows it. */
export const H2 = 'font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance';
export const PROSE = 'text-fg-muted text-[1.05rem] leading-[1.6] m-0';

/** The centred intro block above a section's content. */
export const SECTION_HEAD = 'max-w-[720px] mx-auto mb-12 text-center';

/**
 * A plain elevated panel. Neutral by design: a tinted or glowing panel was
 * the old closing-CTA treatment, and it made the last thing on every page the
 * loudest thing on it.
 */
export const PANEL = 'rounded-[20px] border border-border bg-bg-elev shadow-[var(--shadow-sm)]';

/** The small label that names a code window or a paired example. */
export const MICRO_LABEL = 'text-[13px] font-medium leading-[1.4] text-fg-subtle mb-[10px] ml-1';
