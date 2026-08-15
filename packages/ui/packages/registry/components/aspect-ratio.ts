/**
 * AspectRatio: preserve a width:height ratio for its child. Tier-1
 * class helper over the modern CSS `aspect-ratio` property (Baseline
 * 2022). No JS, no custom element.
 *
 * shadcn parity:
 *   AspectRatio (Radix primitive)  → aspectRatioClass() + inline `aspect-ratio` style
 *
 * Design tokens used: none (layout only).
 *
 * A11y (required for accessible output):
 *   Layout only, so it adds no semantics and takes none away. What matters is
 *   the CONTENT you put inside it: an `<img>` still needs an `alt` (empty
 *   `alt=""` when it is purely decorative), an `<iframe>` still needs a `title`,
 *   and a `<video>` still needs its captions.
 *   Reserving the ratio IS the accessibility win: the box keeps its space before
 *   the media loads, so the page does not shift under someone who is already
 *   reading or aiming at a target (WCAG 2.4.x-adjacent).
 *   Do not clip meaningful content to make a ratio fit. If a crop would hide
 *   part of an image that carries information, put that information in the
 *   surrounding text too.
 *
 * @example
 * ```html
 * <div style="aspect-ratio: 16/9;" class="${aspectRatioClass()}">
 *   <img src="/hero.jpg" alt="Team offsite" class="h-full w-full object-cover rounded-md">
 * </div>
 *
 * <!-- Or with Tailwind's arbitrary aspect-ratio (no helper needed): -->
 * <div class="aspect-[16/9]">
 *   <img src="/hero.jpg" alt="Team offsite" class="h-full w-full object-cover rounded-md">
 * </div>
 * ```
 */

export const aspectRatioClass = (): string => 'relative w-full';
