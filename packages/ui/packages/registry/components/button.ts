/**
 * Button: styled native `<button>`. Tier-1 class helper. Compose with a
 * real `<button>` (or `<a>` for link-styled buttons) so form submission,
 * focus, keyboard activation, and screen-reader semantics all "just work".
 *
 * shadcn parity:
 *   Button (variant: default | destructive | outline | secondary | ghost | link)
 *         (size:    default | xs | sm | lg | icon | icon-xs | icon-sm | icon-lg)
 *                                            → buttonClass({ variant, size })
 *
 * shadcn React's `asChild` (Slot) prop has no equivalent here: just call
 * `buttonClass(...)` and spread the classes onto whatever element you want.
 *
 * A11y (required for accessible output): an icon-only button (the `icon`,
 * `icon-xs`, `icon-sm`, `icon-lg` sizes) has no visible text, so it MUST
 * carry an accessible name via aria-label (or aria-labelledby). A button
 * that opens an overlay should also set aria-haspopup and aria-expanded.
 * Native <button> focus and keyboard activation are already correct.
 *
 * Design tokens used: --primary, --primary-foreground, --destructive,
 * --secondary, --secondary-foreground, --accent, --accent-foreground,
 * --background, --input, --ring.
 *
 * @example
 * ```html
 * <button class=${buttonClass()} type="submit">Save</button>
 * <button class=${buttonClass({ variant: 'outline', size: 'sm' })}>Cancel</button>
 * <button class=${buttonClass({ size: 'icon' })} aria-label="Settings">⚙</button>
 * <a class=${buttonClass({ variant: 'link' })} href="/about">About</a>
 * ```
 */
import { cn } from '../lib/utils.ts';

// cursor-pointer is on the BASE so every variant (default, outline,
// ghost, link, …) gets the right hover affordance. Native <button>
// defaults to the OS arrow cursor in Chromium and Firefox: fine for
// native chrome but unusual for app buttons; shadcn's modern Button
// has long since gravitated toward an explicit cursor-pointer in the
// real world (see the open issue shadcn-ui/ui#1791). disabled:pointer-
// events-none below already suppresses cursor on disabled buttons by
// virtue of the element not receiving pointer events at all.
const BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const VARIANTS = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive:
    'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
  outline:
    'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
  link: 'text-primary underline-offset-4 hover:underline',
} as const;

const SIZES = {
  default: 'h-9 px-4 py-2 has-[>svg]:px-3',
  xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
  sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
  lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
  icon: 'size-9',
  'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
  'icon-sm': 'size-8',
  'icon-lg': 'size-10',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Compose Tailwind classes for a button. Stable shape: object-arg, both optional. */
export function buttonClass(opts: ButtonClassOptions = {}): string {
  const variant = opts.variant ?? 'default';
  const size = opts.size ?? 'default';
  return cn(BASE, VARIANTS[variant], SIZES[size]);
}
