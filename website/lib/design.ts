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
 *   button carries the brand amber, but it stays a small control rather than a
 *   large pill, which is what keeps it reading as a tool.
 * - The accent has exactly two jobs, the primary action and the closing CTA,
 *   plus live and focus state. It never tints a content panel, a section
 *   heading, or a label. Rationing it to the places that ask for a click is
 *   what keeps it meaningful.
 * - Type sizes come from the @theme scale (text-display / text-h2 / text-lede)
 *   rather than per-page pixel values, so the rhythm holds across pages.
 */

/**
 * The radius scale. Three steps, chosen by what a thing IS, not by its size:
 *
 *   RADIUS_CONTROL (10px)  things you click: buttons, the install bar, inputs
 *   rounded-2xl    (16px)  cards and code windows
 *   rounded-[20px]         full-width panels, the closing CTA
 *
 * A control and a card sitting side by side at different radii is the tell
 * that a scale is missing, which is exactly what happened when the install bar
 * was restored from the live site: there the buttons were full pills, so its
 * 16px looked right next to them, and here it did not.
 */
export const RADIUS_CONTROL = 'rounded-[10px]';

/** Shared control geometry. Compose with a surface, do not use bare. */
const BTN_BASE =
  `inline-flex items-center gap-2 h-[42px] px-[18px] ${RADIUS_CONTROL} font-semibold text-[14.5px] leading-none no-underline border cursor-pointer transition-all duration-[140ms]`;

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
 * its own right and a tightened version read as a caption. But it takes the
 * CONTROL radius, not the card radius it carries in production: it sits inches
 * from the buttons, and matching them is what makes the group read as one set
 * of controls rather than three unrelated shapes.
 */
export const INSTALL =
  `flex items-center gap-2 w-fit max-w-full mx-auto px-[18px] py-[14px] text-left font-mono text-sm leading-[1.6] text-fg-muted ${RADIUS_CONTROL} border border-border bg-[color-mix(in_oklch,var(--color-bg-sunken)_70%,transparent)] backdrop-blur-sm shadow-[var(--shadow-sm)]`;

/** Section heading, and the paragraph that follows it. */
export const H2 = 'font-display font-bold text-h2 leading-[1.12] tracking-[-0.03em] my-3 text-balance';
export const PROSE = 'text-fg-muted text-[1.05rem] leading-[1.6] m-0';

/** The centred intro block above a section's content. */
export const SECTION_HEAD = 'max-w-[720px] mx-auto mb-12 text-center';

/** A plain elevated panel, for content that is not asking for a click. */
export const PANEL = 'rounded-[20px] border border-border bg-bg-elev shadow-[var(--shadow-sm)]';

/**
 * The closing call to action, the one panel that is allowed to glow.
 *
 * It earns the accent because it is the only panel on a page whose entire job
 * is to be clicked. Everything above it stays neutral, which is precisely what
 * makes this one land when the reader reaches it.
 */
export const PANEL_CTA =
  'rounded-[22px] border border-border-strong bg-[color-mix(in_oklch,var(--accent-live)_7%,var(--color-bg-elev))] shadow-[var(--shadow-glow)]';

/** The small label that names a code window or a paired example. */
export const MICRO_LABEL = 'text-[13px] font-medium leading-[1.4] text-fg-subtle mb-[10px] ml-1';
