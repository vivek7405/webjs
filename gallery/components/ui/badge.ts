/**
 * badgeClass: the gallery's badge/pill design token, built on @webjsdev/ui.
 *
 * A `@webjsdev/ui` tier-1 CLASS HELPER (like buttonClass): it returns a Tailwind
 * class string you spread onto a NATIVE inline element, almost always a `<span>`
 * (a static label) or an `<a>` (a linked tag). Native markup means no wrapper
 * component and correct semantics for free:
 *
 *   <span class=${badgeClass()}>Signed in</span>
 *   <span class=${badgeClass({ variant: 'outline' })}>Example app</span>
 *
 * OWN-AND-THEME: this is `@webjsdev/ui`'s badge THEMED to this scaffold's two
 * real uses, NOT the fuller shadcn badge (solid primary, secondary, destructive,
 * ghost, link). Keep only the variants you use, styled to your look. `default`
 * is a soft primary pill (a status chip); `outline` is a quiet muted tag.
 *
 * A11y: a static badge is a plain non-focusable `<span>`. Make it an `<a>` only
 * when it links somewhere.
 *
 * Design tokens used (app/layout.ts): --color-primary, --color-border,
 * --color-muted-foreground.
 */
import { cn } from '#lib/utils/cn.ts';

// Shared by every variant: an inline pill that hugs its content and never wraps.
const BASE = 'inline-flex w-fit shrink-0 items-center whitespace-nowrap';

const VARIANTS = {
  // A soft, tinted primary chip. Used for a status ("Signed in").
  default: 'rounded-full bg-primary/15 text-primary px-2.5 py-1 text-xs font-medium',
  // A tiny, quiet outline tag. Used to label a kind of thing ("Example app").
  outline:
    'rounded border border-border text-muted-foreground px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider',
} as const;

export type BadgeVariant = keyof typeof VARIANTS;

/** Compose the Tailwind classes for a badge/pill. Append your own layout as needed. */
export function badgeClass(opts: { variant?: BadgeVariant } = {}): string {
  return cn(BASE, VARIANTS[opts.variant ?? 'default']);
}
