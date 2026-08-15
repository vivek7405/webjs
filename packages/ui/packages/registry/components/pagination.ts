/**
 * Pagination: page navigation. Tier-1 class helpers; compose with native
 * `<nav>` + `<ul>` + `<li>` + `<a>`. Links route through `buttonClass()`
 * so the visual matches the rest of the button vocabulary exactly.
 *
 * shadcn parity:
 *   Pagination           → <nav aria-label="pagination" class=${paginationClass()}>
 *   PaginationContent    → paginationContentClass()
 *   PaginationItem       → <li> (no helper needed)
 *   PaginationLink       → paginationLinkClass({ isActive, size })
 *   PaginationPrevious   → paginationPreviousClass()
 *   PaginationNext       → paginationNextClass()
 *   PaginationEllipsis   → paginationEllipsisClass()
 *
 * A11y (required for accessible output): wrap the list in <nav
 * aria-label="pagination">, set aria-current="page" on the active page
 * link, give an icon-only Previous / Next control an aria-label, and mark
 * the ellipsis aria-hidden="true". The class helpers emit none of these.
 *
 * Design tokens used: inherited from buttonClass.
 *
 * @example
 * ```html
 * <nav role="navigation" aria-label="pagination" class=${paginationClass()}>
 *   <ul class=${paginationContentClass()}>
 *     <li><a class=${paginationPreviousClass()} href="?page=1">‹ Previous</a></li>
 *     <li><a class=${paginationLinkClass({ isActive: false })} href="?page=2">2</a></li>
 *     <li><a class=${paginationLinkClass({ isActive: true })} aria-current="page">3</a></li>
 *     <li class=${paginationEllipsisClass()} aria-hidden="true">
 *       <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></svg>
 *     </li>
 *     <li><a class=${paginationNextClass()} href="?page=4">Next ›</a></li>
 *   </ul>
 * </nav>
 * ```
 */
import { cn } from '../lib/utils.ts';
import { buttonClass, type ButtonSize } from './button.ts';

export const paginationClass = (): string => 'mx-auto flex w-full justify-center';

export const paginationContentClass = (): string => 'flex flex-row items-center gap-1';

export function paginationLinkClass(opts: { isActive?: boolean; size?: ButtonSize } = {}): string {
  return cn(buttonClass({ variant: opts.isActive ? 'outline' : 'ghost', size: opts.size ?? 'icon' }));
}

export const paginationPreviousClass = (): string =>
  cn(buttonClass({ variant: 'ghost', size: 'default' }), 'gap-1 px-2.5 sm:pl-2.5');

export const paginationNextClass = (): string =>
  cn(buttonClass({ variant: 'ghost', size: 'default' }), 'gap-1 px-2.5 sm:pr-2.5');

export const paginationEllipsisClass = (): string => 'flex size-9 items-center justify-center';
