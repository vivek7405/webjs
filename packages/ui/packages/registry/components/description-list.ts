/**
 * Description list: labelled values, the right way. Tier-1 class helpers;
 * compose with native `<dl>` / `<dt>` / `<dd>`.
 *
 * shadcn parity: none. This has no shadcn equivalent and exists because the
 * pattern it replaces is the single most common generated-screen defect.
 *
 * Design: `Label: ${value}` prints a field name and its content at the same
 * weight, on one line, so a detail panel becomes a wall of undifferentiated
 * text and the reader has to parse every line to find the one they wanted.
 * Splitting them into a term and a detail lets the label go quiet and small
 * while the value stays at reading weight, which is what makes a panel of
 * twelve fields scannable. The `stacked` layout puts the label above its value
 * for a narrow column; `inline` puts them side by side with the labels sharing
 * a column edge, which only works when the labels are short and the values are
 * short. When in doubt use `stacked`, since it degrades to narrow screens
 * without truncating either half.
 *
 * Design tokens used: --muted-foreground, --foreground, --border.
 *
 * A11y (required for accessible output):
 *   Use the real elements. `<dl>` with `<dt>` and `<dd>` is what associates
 *   each label with its value; the same text in `<div>`s is announced as one
 *   unstructured run and the reader loses which value belongs to which field.
 *   One `<dt>` may be followed by several `<dd>`s (a field with several values),
 *   which is exactly what the element is for. Do not instead repeat the `<dt>`.
 *   Wrap each pair in a `<div>` when using the row helper. A `<dl>` permits
 *   `<div>` as a wrapper around its pairs, so the grouping stays valid.
 *   An EMPTY value still needs a `<dd>`. Omitting it silently shifts every
 *   later value up onto the wrong label. Render an explicit placeholder.
 *
 * @example
 * ```html
 * <dl class=${descriptionListClass({ layout: 'stacked' })}>
 *   <div class=${descriptionRowClass()}>
 *     <dt class=${descriptionTermClass()}>Carrier</dt>
 *     <dd class=${descriptionDetailsClass()}>Northwind Freight</dd>
 *   </div>
 *   <div class=${descriptionRowClass()}>
 *     <dt class=${descriptionTermClass()}>Tracking</dt>
 *     <dd class=${descriptionDetailsClass()}>NW-4471-QT</dd>
 *   </div>
 * </dl>
 * ```
 */
import { cn } from '../lib/utils.ts';

export interface DescriptionListClassOptions {
  /**
   * `stacked` puts each label above its value, `inline` puts them side by side
   * on a shared label column. Defaults to `stacked`, which survives a narrow
   * viewport without truncating either half.
   */
  layout?: 'stacked' | 'inline';
}

/** The list. Use a real `<dl>`. */
export const descriptionListClass = (opts: DescriptionListClassOptions = {}): string => {
  return cn('grid gap-4', opts.layout === 'inline' && 'sm:gap-x-6');
}

/** One label-and-value pair. A `<div>` inside the `<dl>`, which is valid. */
export const descriptionRowClass = (opts: DescriptionListClassOptions = {}): string => {
  return cn(
      'grid gap-1',
      opts.layout === 'inline' && 'sm:grid-cols-[minmax(8rem,max-content)_1fr] sm:items-baseline sm:gap-x-4 sm:gap-y-0',
    );
}

/** The label. Quiet and small. Use a `<dt>`. */
export const descriptionTermClass = (): string => 'text-sm font-medium text-muted-foreground';

/** The value. Reading weight. Use a `<dd>`. */
export const descriptionDetailsClass = (): string => 'text-sm';
