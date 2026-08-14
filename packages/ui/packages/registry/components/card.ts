/**
 * Card: visual container. Tier-1 class helpers; compose with `<div>`
 * (or any element) for each subpart.
 *
 * shadcn parity:
 *   Card (size: default | sm)  → cardClass({ size })
 *   CardHeader                 → cardHeaderClass()
 *   CardTitle                  → cardTitleClass()
 *   CardDescription            → cardDescriptionClass()
 *   CardAction                 → cardActionClass()
 *   CardContent                → cardContentClass()
 *   CardFooter                 → cardFooterClass()
 *
 * Design tokens used: --card, --card-foreground, --muted-foreground, --border.
 *
 * A11y (required for accessible output):
 *   Use a REAL HEADING for `cardTitleClass()` whenever the card has a
 *   meaningful title. The helper only styles text, so on a `<div>` the title is
 *   invisible to the heading outline a screen reader user navigates by, and on a
 *   page of cards they get an unstructured wall. Pick the level that fits the
 *   surrounding document (`<h2>` under the page `<h1>`, `<h3>` inside a
 *   sectioned region); do not pick it for the font size, which the class sets.
 *   The card root is a plain `<div>` with no role, which is correct: it is a
 *   visual container. Give it a role only when it really is one thing, and then
 *   name it, e.g. `<section aria-labelledby="<the title's id">` for a landmark,
 *   or `role="listitem"` inside a `role="list"` for a card grid.
 *   A WHOLE-CARD LINK is the trap. Do not wrap the card in an `<a>` around a
 *   header, body, and buttons: it swallows the nested controls and gives a
 *   screen reader user one enormous link whose name is the entire card text.
 *   Put the link on the title instead and let the card be a container.
 *   Keep the reading order of the DOM matching the visual order.
 *   `cardActionClass()` places an action at the top right, but it stays after
 *   the title and description in the markup, which is what you want announced.
 *
 * @example
 * ```html
 * <div class=${cardClass()}>
 *   <div class=${cardHeaderClass()}>
 *     <h3 class=${cardTitleClass()}>Notifications</h3>
 *     <div class=${cardDescriptionClass()}>You have 3 unread messages.</div>
 *     <div class=${cardActionClass()}>
 *       <button class=${buttonClass({ variant: 'ghost', size: 'sm' })}>Mark all read</button>
 *     </div>
 *   </div>
 *   <div class=${cardContentClass()}>
 *     <p class="text-sm">Your weekly digest is ready to review.</p>
 *   </div>
 *   <div class=${cardFooterClass()}>
 *     <button class=${buttonClass()}>Save</button>
 *   </div>
 * </div>
 * ```
 */

export type CardSize = 'default' | 'sm';

/**
 * Card root. shadcn ships `size?: "default" | "sm"` on Card across
 * 14/15 style families (only new-york-v4 omits it). The class string
 * uses `group/card` so the header / title / content / footer helpers
 * can read the parent card's data-size and adjust their own padding
 * + gap.
 *
 * USAGE: pass size to cardClass AND set data-size="<size>" on the
 * same host element so the group-data-[size=...]/card child rules
 * fire. Set `data-slot="card"` for shadcn parity.
 *
 *   <div class=${cardClass({ size: 'sm' })} data-slot="card" data-size="sm">
 *     <div class=${cardHeaderClass()}>...</div>
 *     ...
 *   </div>
 *
 * Sizes:
 *   default: gap-6 / py-6 (shadcn new-york-v4 default)
 *   sm:     gap-3 / py-3 (shadcn radix-nova + base-* defaults)
 */
export const cardClass = (opts: { size?: CardSize } = {}): string => {
  const size = opts.size ?? 'default';
  const base =
    'group/card flex flex-col rounded-xl border bg-card text-card-foreground shadow-e1';
  return size === 'sm' ? base + ' gap-3 py-3' : base + ' gap-6 py-6';
};

/**
 * Card header: supports an optional `CardAction` slot via grid layout.
 * group-data-[size=sm]/card rules pick up the compact layout when the
 * root card carries data-size="sm".
 */
export const cardHeaderClass = (): string =>
  '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6 group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:gap-1 group-data-[size=sm]/card:[.border-b]:pb-3';

/** Card title: heading text within the header. Smaller when card is data-size="sm". */
export const cardTitleClass = (): string =>
  'leading-none font-semibold group-data-[size=sm]/card:text-sm';

/** Card description: subdued caption beneath the title. */
export const cardDescriptionClass = (): string => 'text-sm text-muted-foreground';

/** Card action: right-aligned controls inside the header (matches shadcn CardAction). */
export const cardActionClass = (): string =>
  'col-start-2 row-span-2 row-start-1 self-start justify-self-end';

/** Card content: the main body region. Tighter padding when card is data-size="sm". */
export const cardContentClass = (): string =>
  'px-6 group-data-[size=sm]/card:px-4';

/** Card footer: trailing controls or actions. Tighter padding when card is data-size="sm". */
export const cardFooterClass = (): string =>
  'flex items-center px-6 [.border-t]:pt-6 group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:[.border-t]:pt-3';
