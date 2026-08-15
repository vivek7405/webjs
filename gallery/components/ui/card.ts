/**
 * cardClass: the gallery's panel-surface design token, built on @webjsdev/ui.
 *
 * A `@webjsdev/ui` tier-1 CLASS HELPER for the "card" surface every demo panel
 * sits on. It owns only the SURFACE (radius, border, background), NOT the
 * padding or inner layout, because those genuinely differ per panel (a form
 * grid, a centered card, a tight toolbar). So you compose:
 *
 *   <div class="${cardClass()} p-5 grid gap-4">...</div>
 *   <div class="${cardClass()} p-2 flex items-center gap-2">...</div>
 *
 * WHY split surface from layout: the surface is the thing that MUST be identical
 * everywhere (so all panels read as one system), while padding and layout are a
 * per-panel decision. Centralizing only the surface gives consistency without
 * flattening intentional layout differences. Contrast the fuller shadcn Card
 * (header / title / content / footer subparts) that `webjs ui add card` ships:
 * this scaffold's panels are simple containers, so it keeps only what it uses.
 *
 * OWN-AND-THEME: this is `@webjsdev/ui`'s card THEMED to this scaffold (a
 * `rounded-2xl` panel on `bg-card` with a hairline border). Change the surface
 * here and every panel updates at once. When you build a real app on
 * `@webjsdev/ui`, do the same: pull the primitive, keep the parts you use, and
 * theme it to your brand.
 */
import { cn } from '#lib/utils/cn.ts';

// The shared panel surface. Padding + inner layout stay on the call site.
const SURFACE = 'rounded-2xl border border-border bg-card';

/**
 * Compose the Tailwind classes for a card/panel surface. Append the panel's own
 * padding + layout: `class="${cardClass()} p-5 grid gap-4 max-w-[460px]"`.
 */
export function cardClass(extra?: string): string {
  return cn(SURFACE, extra);
}
