/**
 * Table: semantic data table with shadcn styling. Tier-1 class helpers;
 * compose with native `<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `<tr>`,
 * `<th>`, `<td>`, `<caption>`. Native semantics + accessibility tree
 * work out of the box.
 *
 * shadcn parity:
 *   Table container (scroll wrapper)  → tableContainerClass()
 *   Table                             → tableClass()
 *   TableHeader / TableBody / TableFooter
 *                                     → tableHeaderClass() / tableBodyClass() / tableFooterClass()
 *   TableRow                          → tableRowClass()
 *   TableHead / TableCell / TableCaption
 *                                     → tableHeadClass() / tableCellClass() / tableCaptionClass()
 *
 * A11y (required for accessible output): every header cell needs a scope
 * (scope="col" on a column header, scope="row" on a row header) so screen
 * readers map cells to their headers. Add a <caption> naming the table's
 * purpose (it can be visually hidden if a heading already names it).
 *
 * Design tokens used: --muted, --muted-foreground, --foreground.
 *
 * @example
 * ```html
 * <div class=${tableContainerClass()}>
 *   <table class=${tableClass()}>
 *     <thead class=${tableHeaderClass()}>
 *       <tr class=${tableRowClass()}>
 *         <th scope="col" class=${tableHeadClass()}>Name</th>
 *         <th scope="col" class=${tableHeadClass()}>Status</th>
 *       </tr>
 *     </thead>
 *     <tbody class=${tableBodyClass()}>
 *       <tr class=${tableRowClass()}>
 *         <td class=${tableCellClass()}>Vivek</td>
 *         <td class=${tableCellClass()}>Active</td>
 *       </tr>
 *     </tbody>
 *     <caption class=${tableCaptionClass()}>Users</caption>
 *   </table>
 * </div>
 * ```
 */

export const tableContainerClass = (): string => 'relative w-full overflow-x-auto';

export const tableClass = (): string => 'w-full caption-bottom text-sm';

export const tableHeaderClass = (): string => '[&_tr]:border-b';

export const tableBodyClass = (): string => '[&_tr:last-child]:border-0';

export const tableFooterClass = (): string =>
  'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0';

export const tableRowClass = (): string =>
  'border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted';

export const tableHeadClass = (): string =>
  'h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]';

export const tableCellClass = (): string =>
  'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]';

export const tableCaptionClass = (): string => 'mt-4 text-sm text-muted-foreground';
