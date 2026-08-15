/**
 * Empty state: what a region says when it has nothing to show. Tier-1 class
 * helpers; compose with a `<div>` and a real heading.
 *
 * shadcn parity:
 *   Empty             → emptyStateClass()
 *   EmptyMedia        → emptyStateMediaClass()
 *   EmptyTitle        → emptyStateTitleClass()
 *   EmptyDescription  → emptyStateDescriptionClass()
 *   EmptyContent      → emptyStateActionsClass()
 *
 * shadcn's `EmptyHeader` has no equivalent: it exists to carry React
 * composition and would be an empty `<div>` here. The actions slot is explicit
 * instead, because the whole point of an empty state is the thing it offers to
 * do next.
 *
 * Design: this is the highest-leverage primitive in the kit, because the
 * failure it prevents is invisible in development. A list rendered against
 * seeded data looks finished; the same list renders as blank space for every
 * user who has not created anything yet, which is every user on their first
 * day. An empty region reads as broken rather than as empty, so it must say
 * what belongs here, why it is not here, and offer the one action that fills
 * it. That is also the hierarchy: ONE primary action, and the description is
 * secondary text rather than a second heading. Reach for it in the same breath
 * as the list, not after someone reports the blank screen.
 *
 * Design tokens used: --muted-foreground, --border, --foreground.
 *
 * A11y (required for accessible output):
 *   `emptyStateTitleClass()` styles text and nothing else, so put it on a REAL
 *   HEADING at the level the surrounding document calls for. An empty state
 *   replacing a region that would have had a heading needs that same level.
 *   Decorative artwork under `emptyStateMediaClass()` MUST be `aria-hidden="true"`
 *   (or an empty `alt`), since an icon of an empty box adds nothing to the title
 *   that follows it and only makes the region longer to listen to.
 *   When the empty state REPLACES live content that updates (a search result
 *   list, a filtered table), put `aria-live="polite"` on the enclosing region so
 *   the transition from results to none is announced. Do not put it on the empty
 *   state itself, which is inserted and removed rather than updated.
 *
 * @example
 * ```html
 * <div class=${emptyStateClass()}>
 *   <svg class=${emptyStateMediaClass()} aria-hidden="true" viewBox="0 0 24 24">
 *     <path d="M4 7h16v13H4z" fill="none" stroke="currentColor" stroke-width="1.5" />
 *   </svg>
 *   <h2 class=${emptyStateTitleClass()}>No invoices yet</h2>
 *   <p class=${emptyStateDescriptionClass()}>
 *     Invoices you send appear here, with their payment status.
 *   </p>
 *   <div class=${emptyStateActionsClass()}>
 *     <button class=${buttonClass()}>Create invoice</button>
 *     <a class=${buttonClass({ variant: 'ghost' })} href="/docs/invoices">Learn more</a>
 *   </div>
 * </div>
 * ```
 */
import { cn } from '../lib/utils.ts';

export interface EmptyStateClassOptions {
  /** `bordered` draws the dashed container that marks a droppable or fillable region. */
  variant?: 'plain' | 'bordered';
}

/** The empty-state container: centred, generously padded, its own vertical rhythm. */
export const emptyStateClass = (opts: EmptyStateClassOptions = {}): string => {
  return cn(
      'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
      opts.variant === 'bordered' && 'rounded-lg border border-dashed',
    );
}

/** Decorative artwork above the title. Must be aria-hidden. */
export const emptyStateMediaClass = (): string =>
  'mb-1 size-10 text-muted-foreground [&_svg]:size-full';

/** The title. Put it on a real heading. */
export const emptyStateTitleClass = (): string => 'text-base font-medium';

/** One or two lines saying what belongs here and why it is not here yet. */
export const emptyStateDescriptionClass = (): string =>
  'max-w-sm text-sm text-muted-foreground';

/** The action row. One primary action, at most one secondary beside it. */
export const emptyStateActionsClass = (): string =>
  'mt-2 flex flex-wrap items-center justify-center gap-2';
