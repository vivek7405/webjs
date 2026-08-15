/**
 * Badge: small visual label. Tier-1 class helper; compose with any
 * inline element (commonly `<span>` or `<a>` for linked badges).
 *
 * shadcn parity:
 *   Badge (variant: default | secondary | destructive | outline | ghost | link)
 *                                  → badgeClass({ variant })
 *
 * The `[a&]:hover:...` hover styles only apply when the element is an `<a>`,
 * so a static `<span>` doesn't pick up an unwanted hover.
 *
 * A11y (required for accessible output): render a static badge as a plain
 * <span> (not focusable, no tabindex). Only an interactive badge (an <a>
 * or <button>) is focusable, and an icon-only one needs an aria-label.
 *
 * Design tokens used: --primary, --secondary, --destructive, --foreground,
 * --accent, --border, --ring.
 *
 * @example
 * ```html
 * <span class=${badgeClass()}>New</span>
 * <span class=${badgeClass({ variant: 'destructive' })}>Error</span>
 * <a class=${badgeClass({ variant: 'link' })} href="/profile">@vivek</a>
 * ```
 */
import { cn } from '../lib/utils.ts';

const BASE =
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3';

const VARIANTS = {
  default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
  secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
  destructive:
    'bg-destructive text-white focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40 [a&]:hover:bg-destructive/90',
  outline:
    'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
  ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 [a&]:hover:underline',
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

export function badgeClass(opts: { variant?: BadgeVariant } = {}): string {
  return cn(BASE, VARIANTS[opts.variant ?? 'default']);
}
