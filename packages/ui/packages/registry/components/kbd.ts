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
 * Design: A keyboard hint is for a shortcut that exists, shown next to the thing it
 * does, so the reader learns it in passing. It is quiet by construction: this is
 * reference, not instruction. Match the platform's own notation and modifier
 * order, and do not invent a shortcut in the copy that the app does not
 * actually implement.
 *
 * A11y (required for accessible output):
 *   SYMBOL-ONLY KEYS NEED A SPOKEN NAME. A screen reader reads a bare glyph
 *   however its speech engine happens to handle that codepoint, so a key shown
 *   as a symbol can be announced as a meaningless character name or skipped
 *   entirely. Spell the name the way a person says it: `⌘` is "Command", `⇧`
 *   "Shift", `⌥` "Option", `⌃` "Control", `⏎` "Enter", `⌫` "Backspace", `␣`
 *   "Space", `⎋` "Escape", and the arrows are "Up arrow" and friends. A key
 *   already spelled in words ("Shift", "K") reads correctly and needs nothing.
 *   DO NOT put `aria-label` on the `<kbd>` itself. `<kbd>` maps to
 *   `role=generic`, where a name is prohibited and browsers ignore it, so it
 *   would silently do nothing. Supply the name as TEXT instead: hide the glyph
 *   with `aria-hidden="true"` and put the spoken form in a visually-hidden
 *   sibling (`sr-only`), which every screen reader reads.
 *   NAME THE CHORD, not just the keys, since three `<kbd>` elements are
 *   otherwise announced as three separate things with no hint they are pressed
 *   together. Wrap the group in an element with `role="img"` and an
 *   `aria-label` of the whole chord: `role="img"` both SUPPORTS a name (unlike
 *   generic) and makes its children presentational, so the chord is announced
 *   once as one thing. Do not use `role="group"` + `aria-hidden` children for
 *   this: that leaves the group with nothing to announce.
 *   Keep the native `<kbd>` element. The class is styling only; `<kbd>` is what
 *   carries the "this is keyboard input" semantic.
 *   `<kbd>` DOCUMENTS a shortcut, it does not create one. If the shortcut is
 *   real, it also needs a keyboard handler, must not clash with an assistive-tech
 *   or browser binding, and per WCAG 2.1.4 a single-character shortcut has to be
 *   remappable or disableable.
 *
 * @example
 * ```html
 * <!-- A symbol key: hide the glyph, supply the spoken form as text. An
 *      aria-label on the <kbd> itself would be ignored (role=generic). -->
 * <kbd class=${kbdClass()} aria-hidden="true">⌘</kbd><span class="sr-only">Command</span>
 *
 * <!-- A spelled-out key needs nothing. -->
 * <kbd class=${kbdClass()}>K</kbd>
 *
 * <!-- A chord, announced once as one thing. role="img" supports a name AND
 *      makes its children presentational, so the glyphs are not read twice. -->
 * <div class=${kbdGroupClass()} role="img" aria-label="Command Shift P">
 *   <kbd class=${kbdClass()}>⌘</kbd>
 *   <kbd class=${kbdClass()}>Shift</kbd>
 *   <kbd class=${kbdClass()}>P</kbd>
 * </div>
 * ```
 */

export const kbdClass = (): string =>
  "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3 [[data-slot=tooltip-content]_&]:bg-background/20 [[data-slot=tooltip-content]_&]:text-background dark:[[data-slot=tooltip-content]_&]:bg-background/10";

export const kbdGroupClass = (): string => 'inline-flex items-center gap-1';
