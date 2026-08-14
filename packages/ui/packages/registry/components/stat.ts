/**
 * Stat: a single number with its label, and an optional change indicator.
 * Tier-1 class helpers; compose with `<dl>` / `<dt>` / `<dd>`.
 *
 * shadcn parity: none. shadcn has no registry stat; the closest are `item.tsx`
 * and the `dashboard-01` block's section cards, which compose one by hand each
 * time. This promotes it, because a dashboard is mostly stats and getting the
 * label-to-value relationship wrong is the defining dashboard defect.
 *
 * Design: the label and the value are NOT equal partners, and the reflex to
 * print them as `Label: value` at one weight is the thing this replaces. A
 * reader scans a dashboard for numbers, so the value carries the size and the
 * weight, and the label sits quiet above or below it. That inversion is the
 * whole primitive. `statDeltaClass({ direction })` then colours the change
 * through the semantic roles rather than a raw green or red, so an app that
 * rethemes gets a consistent one. A stat group is a grid rather than a flex
 * row so the numbers line up on a common baseline across wrapped rows, which
 * is what makes a row of them scannable rather than merely adjacent.
 *
 * Design tokens used: --muted-foreground, --success, --destructive, --border,
 * --card.
 *
 * A11y (required for accessible output):
 *   Use a REAL `<dl>` with `<dt>` for the label and `<dd>` for the value. The
 *   description-list association is the only thing that tells a screen reader
 *   which label belongs to which number; a pile of `<div>`s reads as
 *   disconnected text, and on a dashboard of eight stats that is unusable.
 *   A DELTA NEEDS WORDS. Colour and an arrow glyph are not available to a
 *   screen reader user or to anyone who cannot distinguish the hues, so the
 *   delta's accessible text must say the direction, e.g. `up 12% from last
 *   week` with the arrow itself `aria-hidden="true"`.
 *   A stat that updates live belongs in a region with `aria-live="polite"`.
 *   Do not mark each stat individually, or a refresh announces all of them.
 *
 * @example
 * ```html
 * <div class=${statGroupClass({ columns: 3 })}>
 *   <dl class=${statClass()}>
 *     <dt class=${statLabelClass()}>Delivered today</dt>
 *     <dd class=${statValueClass()}>1,284</dd>
 *     <dd class=${statDeltaClass({ direction: 'up' })}>
 *       <span aria-hidden="true">↑</span> up 12% from yesterday
 *     </dd>
 *   </dl>
 * </div>
 * ```
 */
import { cn } from '../lib/utils.ts';

export interface StatGroupClassOptions {
  /** How many stats sit on a row at the widest breakpoint. Defaults to 3. */
  columns?: 2 | 3 | 4;
}

const GROUP_COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
  4: 'sm:grid-cols-2 lg:grid-cols-4',
} as const;

/** A row of stats. A grid, so values share a baseline across wrapped rows. */
export const statGroupClass = (opts: StatGroupClassOptions = {}): string => {
  return cn('grid grid-cols-1 gap-4', GROUP_COLUMNS[opts.columns ?? 3]);
}

export interface StatClassOptions {
  /** `card` gives the stat its own surface. Plain by default. */
  variant?: 'plain' | 'card';
}

/** One stat. Use a `<dl>`. */
export const statClass = (opts: StatClassOptions = {}): string => {
  return cn('grid gap-1', opts.variant === 'card' && 'rounded-lg border bg-card p-4 shadow-e1');
}

/** The label. Quiet, and it sits above the value. Use a `<dt>`. */
export const statLabelClass = (): string => 'text-sm font-medium text-muted-foreground';

/** The number. This is what the reader came for. Use a `<dd>`. */
export const statValueClass = (): string => 'text-3xl font-semibold tabular-nums';

export interface StatDeltaClassOptions {
  /** Which way the number moved. `flat` is the neutral case, not an absent one. */
  direction?: 'up' | 'down' | 'flat';
}

/**
 * The change indicator.
 *
 * Note that `up` is not always good: churn going up is bad. The direction here
 * is the ARITHMETIC one, and an app where up is bad should pass the direction
 * that matches its meaning rather than the one that matches the arrow.
 */
export const statDeltaClass = (opts: StatDeltaClassOptions = {}): string => {
  const direction = opts.direction ?? 'flat';
  return cn(
    'flex items-center gap-1 text-sm font-medium',
    direction === 'up' && 'text-success',
    direction === 'down' && 'text-destructive',
    direction === 'flat' && 'text-muted-foreground',
  );
};
