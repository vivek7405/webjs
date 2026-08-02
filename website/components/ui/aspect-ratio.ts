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
