/**
 * Skeleton: loading placeholder. Tier-1 class helper. Sizing comes from
 * caller-supplied utilities; `skeletonClass()` only provides the
 * animation + base look.
 *
 * shadcn parity:
 *   Skeleton  → skeletonClass()  (visual: animated rounded muted block)
 *
 * A11y (required for accessible output): a skeleton is a decorative
 * placeholder, so hide it from assistive tech with aria-hidden="true" (or
 * mark the loading region aria-busy="true"). Announce the real content
 * once it replaces the skeleton.
 *
 * Design tokens used: --accent.
 *
 * @example
 * ```html
 * <div class=${cn(skeletonClass(), 'h-4 w-32')}></div>
 * <div class=${cn(skeletonClass(), 'h-12 w-12 rounded-full')}></div>
 * ```
 */

export const skeletonClass = (): string => 'animate-pulse rounded-md bg-accent';
