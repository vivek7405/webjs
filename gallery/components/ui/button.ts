/**
 * buttonClass: the gallery's button design token, built on @webjsdev/ui.
 *
 * This is a `@webjsdev/ui` tier-1 CLASS HELPER (the shadcn model): instead of a
 * `<ui-button>` wrapper element, it returns a Tailwind class string you spread
 * onto a NATIVE `<button>` (or `<a>` for a link-styled button). Native markup
 * means form submission, focus, keyboard activation, and screen-reader
 * semantics all work with no extra wiring:
 *
 *   <button class=${buttonClass()} @click=${...}>Save</button>
 *   <button class=${buttonClass({ variant: 'secondary', size: 'sm' })}>Cancel</button>
 *   <a      class=${buttonClass({ variant: 'link', size: 'none' })} href="/x">More</a>
 *
 * WHY a helper and not a component: the class helper adds NO indirection, so a
 * demo's real markup (the `@click`, the `?disabled`, the concept it teaches)
 * stays fully visible, while every button in the gallery shares one source of
 * truth for its look. That is also why the #1057-style "one button forgot
 * cursor-pointer" gap cannot happen: `cursor-pointer` lives on BASE.
 *
 * OWN-AND-THEME your copy: this file is `webjs ui add button` output THEMED to
 * this scaffold's look (rounded-xl, the primary / card / muted-link styles the
 * gallery uses). That is the intended `@webjsdev/ui` workflow: you own the
 * component file and tune its class values to your brand. Run
 * `webjs ui add button` (or edit here) to change the button system app-wide.
 *
 * A11y: an icon-only button has no visible text, so give it an `aria-label`.
 * Native `<button>` focus + keyboard activation are already correct.
 *
 * Design tokens used (defined in app/layout.ts): --color-primary,
 * --color-primary-foreground, --color-card, --color-border, --color-foreground,
 * --color-muted-foreground, --color-accent, --color-ring.
 */
import { cn } from '#lib/utils/cn.ts';

// BASE: shared by every variant + size, so a fix here (e.g. the focus ring, or
// cursor-pointer) applies to the whole button system at once.
// Focus is handled ONCE by the design system's global :focus-visible ring (the
// ui theme's @layer base in public/input.css), so buttons need no per-element
// focus style here.
const BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap text-sm transition-all disabled:pointer-events-none disabled:opacity-60';

// VARIANTS carry COLOR + weight + hover (what the button IS). Add a variant here
// and it is instantly available to every demo.
const VARIANTS = {
  // The filled call-to-action (Send, Upload, Stream tokens, Greet).
  default: 'bg-primary text-primary-foreground font-semibold hover:bg-primary/90 active:scale-[0.97]',
  // The quieter card-surfaced action (Reset, Read once, secondary controls).
  secondary: 'bg-card border border-border text-foreground font-medium hover:border-border-strong',
  // Transparent until hovered (a toolbar / menu action, e.g. Log out).
  ghost: 'bg-transparent text-foreground font-medium hover:bg-accent',
  // A button that reads as an inline text link (navigate, toggle, reveal).
  link: 'text-muted-foreground font-medium underline decoration-dotted underline-offset-4 hover:text-foreground',
  // A subtle destructive action (a delete icon / a remove control): transparent
  // and muted at rest, turning red on hover. NOT a loud solid-red button; theme
  // it to a filled `bg-destructive` variant if you want a prominent confirm.
  destructive: 'bg-transparent text-muted-foreground font-medium hover:text-destructive hover:bg-destructive/10',
} as const;

// SIZES carry SHAPE (padding + radius). `none` is for the link variant, which
// is inline text and takes no box padding.
const SIZES = {
  default: 'px-4 py-2 rounded-xl',
  sm: 'px-3.5 py-1.5 rounded-xl',
  xs: 'px-3 py-1 rounded-lg',
  none: '',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;
export type ButtonSize = keyof typeof SIZES;

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/**
 * Compose the Tailwind classes for a button. Both options are optional
 * (`buttonClass()` is the primary call-to-action). `cn` de-duplicates, so you
 * can append your own layout classes: `class="${buttonClass()} w-full"`.
 */
export function buttonClass(opts: ButtonClassOptions = {}): string {
  const variant = opts.variant ?? 'default';
  const size = opts.size ?? 'default';
  return cn(BASE, VARIANTS[variant], SIZES[size]);
}
