/**
 * Page header: the page's title, its one-line explanation, and the actions that
 * act on the whole page. Tier-1 class helpers; compose with `<header>`.
 *
 * shadcn parity: shadcn's own site carries `components/page-header.tsx`, which
 * is not a registry item. Promoting it is the point: every application screen
 * needs one, and hand-rolling it per page is how two pages end up with
 * different title sizes and a third with no description at all.
 *
 * Design: this is where the page states what it is, so it holds the page's
 * ONLY `<h1>` and its highest-priority action. The reflex it replaces is a bare
 * title floating above content with the actions scattered next to whatever they
 * operate on. Actions here are page-scoped (create, import, export); an action
 * on one row belongs on that row. Keep to one primary action and push the rest
 * to secondary or a menu, because two primary buttons side by side means the
 * page has not decided what it wants the reader to do, and the reader will not
 * decide either.
 *
 * Design tokens used: --foreground, --muted-foreground, --border.
 *
 * A11y (required for accessible output):
 *   The title MUST be the page's `<h1>`, and there must be exactly one per
 *   page. This is the top of the heading outline a screen reader user navigates
 *   by, and two `<h1>`s or none both break that navigation.
 *   Use a real `<header>` element. It is a `banner` landmark ONLY at the top
 *   level of the document; nested inside `<main>` or an `<article>` it is a
 *   plain grouping element, which is what you want for a page header that sits
 *   inside the content area.
 *   `pageHeaderDescriptionClass()` is a description, not a subtitle: do not put
 *   it in an `<h2>`, which would insert a phantom level into the outline.
 *   If the actions are the page's primary controls, they follow the title in
 *   the DOM regardless of where they sit visually, so the reading order matches
 *   the announcement order.
 *
 * @example
 * ```html
 * <header class=${pageHeaderClass()}>
 *   <div>
 *     <h1 class=${pageHeaderTitleClass()}>Invoices</h1>
 *     <p class=${pageHeaderDescriptionClass()}>
 *       Everything you have sent, and whether it has been paid.
 *     </p>
 *   </div>
 *   <div class=${pageHeaderActionsClass()}>
 *     <button class=${buttonClass({ variant: 'secondary' })}>Export</button>
 *     <button class=${buttonClass()}>New invoice</button>
 *   </div>
 * </header>
 * ```
 */
import { cn } from '#lib/utils/cn.ts';

export interface PageHeaderClassOptions {
  /** `bordered` rules off the header from the content below it. */
  variant?: 'plain' | 'bordered';
}

/** The header row: title block on the left, actions on the right, stacked on narrow screens. */
export const pageHeaderClass = (opts: PageHeaderClassOptions = {}): string => {
  return cn(
      'flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between',
      opts.variant === 'bordered' && 'border-b',
    );
}

/** The page title. This is the `<h1>`, and there is one of it. */
export const pageHeaderTitleClass = (): string => 'text-2xl font-semibold tracking-tight';

/** One line saying what the page is for. A `<p>`, never a heading. */
export const pageHeaderDescriptionClass = (): string => 'mt-1 text-sm text-muted-foreground';

/** Page-scoped actions. One primary, the rest secondary. */
export const pageHeaderActionsClass = (): string => 'flex shrink-0 flex-wrap items-center gap-2';
