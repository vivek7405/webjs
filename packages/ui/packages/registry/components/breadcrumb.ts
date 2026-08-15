/**
 * Breadcrumb: semantic nav with breadcrumb list. Tier-1 class helpers;
 * compose with native `<nav>` + `<ol>` + `<li>` + `<a>` / `<span>`.
 *
 * shadcn parity:
 *   Breadcrumb           → <nav aria-label="breadcrumb" data-slot="breadcrumb">
 *   BreadcrumbList       → breadcrumbListClass()
 *   BreadcrumbItem       → breadcrumbItemClass()
 *   BreadcrumbLink       → breadcrumbLinkClass()
 *   BreadcrumbPage       → breadcrumbPageClass() (with aria-current="page")
 *   BreadcrumbSeparator  → breadcrumbSeparatorClass() (aria-hidden + role="presentation")
 *   BreadcrumbEllipsis   → breadcrumbEllipsisClass()
 *
 * A11y (required for accessible output): wrap the list in <nav
 * aria-label="breadcrumb">, set aria-current="page" on the current-page
 * element, and mark each separator role="presentation" aria-hidden="true".
 * The class helpers emit none of these.
 *
 * Design tokens used: --muted-foreground, --foreground.
 *
 * @example
 * ```html
 * <nav aria-label="breadcrumb" data-slot="breadcrumb">
 *   <ol class=${breadcrumbListClass()}>
 *     <li class=${breadcrumbItemClass()}>
 *       <a class=${breadcrumbLinkClass()} href="/">Home</a>
 *     </li>
 *     <li class=${breadcrumbSeparatorClass()} role="presentation" aria-hidden="true">
 *       <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
 *     </li>
 *     <li class=${breadcrumbItemClass()}>
 *       <span class=${breadcrumbPageClass()} aria-current="page">Posts</span>
 *     </li>
 *   </ol>
 * </nav>
 * ```
 */

export const breadcrumbListClass = (): string =>
  'flex flex-wrap items-center gap-1.5 text-sm break-words text-muted-foreground sm:gap-2.5';

export const breadcrumbItemClass = (): string => 'inline-flex items-center gap-1.5';

export const breadcrumbLinkClass = (): string => 'transition-colors hover:text-foreground';

export const breadcrumbPageClass = (): string => 'font-normal text-foreground';

export const breadcrumbSeparatorClass = (): string => '[&>svg]:size-3.5';

export const breadcrumbEllipsisClass = (): string => 'flex size-9 items-center justify-center';
