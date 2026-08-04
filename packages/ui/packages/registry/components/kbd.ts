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
 * A11y (required for accessible output):
 *   SYMBOL-ONLY KEYS NEED A SPOKEN NAME. A screen reader reads a bare glyph
 *   however its speech engine happens to handle that codepoint, so a key shown
 *   as a symbol can be announced as a meaningless character name or skipped
 *   entirely. Give each one an `aria-label` naming the key the way a person says
 *   it: `⌘` is "Command", `⇧` "Shift", `⌥` "Option", `⌃` "Control", `⏎`
 *   "Enter", `⌫` "Backspace", `␣` "Space", `⎋` "Escape", and the arrows are
 *   "Up arrow" and friends. A key already spelled in words ("Shift", "K") reads
 *   correctly as-is and needs nothing.
 *   NAME THE CHORD, not just the keys. A group of three `<kbd>` elements is
 *   announced as three separate things with no indication they are pressed
 *   together. Label the group with the whole chord ("Command Shift P") and mark
 *   the individual keys `aria-hidden="true"` so it is announced once, cleanly,
 *   instead of twice.
 *   Keep the native `<kbd>` element. The class is styling only; `<kbd>` is what
 *   carries the "this is keyboard input" semantic.
 *   `<kbd>` DOCUMENTS a shortcut, it does not create one. If the shortcut is
 *   real, it also needs a keyboard handler, must not clash with an assistive-tech
 *   or browser binding, and per WCAG 2.1.4 a single-character shortcut has to be
 *   remappable or disableable.
 *
 * @example
 * ```html
 * <!-- A symbol key needs a spoken name; a spelled-out key does not. -->
 * <kbd class=${kbdClass()} aria-label="Command">⌘</kbd>
 * <kbd class=${kbdClass()}>K</kbd>
 *
 * <!-- A chord: name the group once, hide the individual glyphs. -->
 * <div class=${kbdGroupClass()} role="group" aria-label="Command Shift P">
 *   <kbd class=${kbdClass()} aria-hidden="true">⌘</kbd>
 *   <kbd class=${kbdClass()} aria-hidden="true">Shift</kbd>
 *   <kbd class=${kbdClass()} aria-hidden="true">P</kbd>
 * </div>
 * ```
 */

export const kbdClass = (): string =>
  "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3 [[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10";

export const kbdGroupClass = (): string => 'inline-flex items-center gap-1';
