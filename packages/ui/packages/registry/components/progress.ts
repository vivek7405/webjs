/**
 * Progress: progress bar. Tier-1 class helper over the native
 * `<progress>` element. The native element supplies the `progressbar`
 * role and `aria-valuenow` automatically from its `value` / `max`
 * attributes, so no JS, no custom element.
 *
 * shadcn parity:
 *   Progress  → progressClass()  (visual: 2px track + animated fill,
 *                                 styled via `::-webkit-progress-bar`,
 *                                 `::-webkit-progress-value`, and
 *                                 `::-moz-progress-bar`)
 *
 * A11y (required for accessible output): give the <progress> an accessible
 * name with aria-label (or a <label for>), e.g. aria-label="Upload
 * progress". The native element supplies the role and value; only the name
 * is the author's responsibility.
 *
 * Design tokens used: --primary.
 *
 * @example
 * ```html
 * <progress value="42" max="100" class=${progressClass()}></progress>
 *
 * <!-- Indeterminate state, with no value attribute. -->
 * <progress class=${progressClass()}></progress>
 * ```
 */

/**
 * Class for the native `<progress>` element. The track + fill colours
 * come from Tailwind utilities. The browser handles the actual bar
 * rendering through the `::-webkit-progress-value` and
 * `::-moz-progress-bar` pseudo-elements. We expose them via the
 * `[&::-webkit-progress-value]:bg-primary` and
 * `[&::-moz-progress-bar]:bg-primary` Tailwind variants.
 *
 * Indeterminate state (no `value` attribute on the element) gets a
 * pulse animation via `:indeterminate { animate-pulse }`.
 */
export const progressClass = (): string =>
  [
    // Reset native styling. WebKit / Blink draw a default 3D bar that we
    // strip via appearance-none + classic clear of border/bg.
    'block h-2 w-full overflow-hidden rounded-full',
    'appearance-none border-0 bg-primary/20 [&::-webkit-progress-bar]:bg-primary/20',
    // Bar fill: blink/webkit + firefox both via Tailwind 4's arbitrary-
    // pseudo variant. Smooth animation on width change matches shadcn.
    "[&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:transition-all",
    "[&::-moz-progress-bar]:bg-primary",
    // Indeterminate state animates the track itself (no value -> no bar
    // to color, so we pulse the bg).
    'indeterminate:animate-pulse',
  ].join(' ');
