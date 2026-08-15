/**
 * Skeleton: loading placeholder. Tier-1 class helper. Sizing comes from
 * caller-supplied utilities; `skeletonClass()` only provides the
 * animation + base look.
 *
 * shadcn parity:
 *   Skeleton  → skeletonClass()  (visual: animated rounded muted block)
 *
 * Design: A skeleton is a promise about shape, so it must match the content that
 * replaces it. One that settles into a different layout is worse than a spinner,
 * because the reader has already started reading the wrong thing. Use it where
 * the layout is known and the wait is short, and prefer real server-rendered
 * content wherever the framework can produce it, which in this framework is
 * most places.
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
