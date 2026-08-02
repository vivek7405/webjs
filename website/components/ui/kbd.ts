/**
 * Kbd: keyboard chord display. Tier-1 class helpers; compose with the
 * native `<kbd>` element for correct semantics.
 *
 * shadcn parity:
 *   Kbd       → kbdClass()
 *   KbdGroup  → kbdGroupClass()
 *
 * Design tokens used: --muted, --muted-foreground, --background.
 *
 * @example
 * ```html
 * <kbd class=${kbdClass()}>⌘</kbd>
 * <kbd class=${kbdClass()}>K</kbd>
 *
 * <div class=${kbdGroupClass()}>
 *   <kbd class=${kbdClass()}>⌘</kbd>
 *   <kbd class=${kbdClass()}>Shift</kbd>
 *   <kbd class=${kbdClass()}>P</kbd>
 * </div>
 * ```
 */

export const kbdClass = (): string =>
  "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3 [[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10";

export const kbdGroupClass = (): string => 'inline-flex items-center gap-1';
