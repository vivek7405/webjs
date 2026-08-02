/**
 * Collapsible: togglable content panel built on native <details>/<summary>.
 *
 * Tier-1 (no custom element). The browser handles open/close state,
 * keyboard activation (Enter / Space on <summary>), focus management,
 * and disclosure-widget accessibility, nothing to ship in JS.
 *
 * shadcn parity:
 *   Collapsible         → <details class=${collapsibleClass()}>
 *   CollapsibleTrigger  → <summary class=${collapsibleTriggerClass()}>
 *   CollapsibleContent  → <div class=${collapsibleContentClass()}>
 *
 * Initial state: add `open` on <details> to render expanded on first
 * paint. Programmatic toggling: `el.open = true | false`. Migrated from
 * the prior <ui-collapsible> custom element; the trigger class hides
 * the native disclosure marker so callers can render their own chevron.
 *
 * Design tokens used: --border, --ring, --foreground.
 *
 * @example
 * ```html
 * <details class=${collapsibleClass()}>
 *   <summary class=${collapsibleTriggerClass()}>
 *     Show details
 *     <svg class="size-4 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
 *   </summary>
 *   <div class=${collapsibleContentClass()}>
 *     Hidden until <summary> is clicked, Enter / Space pressed, or the
 *     <details> element's `open` property is set via JS.
 *   </div>
 * </details>
 * ```
 */

/**
 * Root: marks the disclosure widget as a `group` so descendants can use
 * Tailwind's `group-open:` variant to react to the `[open]` attribute
 * (which `<details>` sets natively). No visual styling of its own.
 */
export const collapsibleClass = (): string => 'group';

/**
 * Trigger: hides the native ::marker (and the WebKit -details-marker shim)
 * so the disclosure triangle does not appear; callers wrap their own
 * chevron icon and rotate it on open via `group-open:rotate-180`.
 *
 * `disabled: true` returns the visual disabled state. Native <details>
 * has no `disabled` attribute, so for full keyboard prevention add the
 * standard `inert` attribute on the <details> element. shadcn's React
 * `disabled` prop combines both visual and behavior; we split them.
 */
export const collapsibleTriggerClass = (opts: { disabled?: boolean } = {}): string => {
  const base = 'flex w-full cursor-pointer list-none items-center justify-between gap-2 rounded-md text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50 marker:hidden [&::-webkit-details-marker]:hidden';
  if (opts.disabled) return `${base} pointer-events-none cursor-not-allowed opacity-50`;
  return base;
};

/**
 * Content: <details> already hides children other than <summary> when
 * not [open], so this is purely typographic spacing. No display rules.
 */
export const collapsibleContentClass = (): string => 'text-sm';
