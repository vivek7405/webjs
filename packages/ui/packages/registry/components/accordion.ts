/**
 * Accordion: vertical collapsible list built on native <details>/<summary>.
 *
 * Tier-1 (no custom element). Exclusive open behaviour (Radix's
 * `type="single"`) comes from giving every <details> the same
 * `name="..."` attribute. Independent open (`type="multiple"`) is the
 * default when `name` is omitted. Both modes give `collapsible` for
 * free: clicking the open <summary> closes it.
 *
 * shadcn parity:
 *   <Accordion type="single" collapsible> → <div class=${accordionClass()}> wrapping
 *                                            <details name="..."> items
 *   <Accordion type="multiple">           → same, omit `name`
 *   <AccordionItem>                       → <details class=${accordionItemClass()}>
 *   <AccordionTrigger>                    → <summary class=${accordionTriggerClass()}>
 *   <AccordionContent>                    → <div class=${accordionContentClass()}>
 *
 * Initial state: add `open` on the <details> that should render expanded
 * on first paint. Programmatic toggling: `el.open = true | false`.
 *
 * `<details name="X">` is the platform's exclusive-accordion primitive:
 * Chrome 120+, Safari 17.2+, Firefox 130+. Migrated from the prior
 * <ui-accordion> custom element set.
 *
 * Design tokens used: --border, --ring, --foreground.
 *
 * Design: Use this to make a long page shorter, never to hide something the reader
 * needs. Collapsed content is content most people will not read, so an
 * accordion is right for reference material a few readers want (a FAQ, advanced
 * settings) and wrong for anything on the main path. Default the first panel
 * open when one panel is clearly the common case, and leave them all closed when
 * they are equals, since an arbitrary open panel reads as more important than
 * its siblings.
 *
 * A11y (mostly handled by the native primitives):
 *   Build it on `<details>` + `<summary>`, which is where nearly all of this
 *   comes from: the browser supplies the button semantics, the expanded state,
 *   Enter / Space activation, and focus, with no ARIA to hand-write. Do not
 *   reimplement it with a `<div>` and `aria-expanded`.
 *   Put the trigger classes on the `<summary>` ITSELF, not on a `<button>` or
 *   `<div>` nested inside it. A nested interactive element inside a `<summary>`
 *   is the #1078-class bug: the focusable thing and the labelled thing come
 *   apart, and the summary's own name goes empty.
 *   The chevron is decorative, so keep it `aria-hidden="true"`.
 *   `name` on `<details>` is what gives exclusive-open behaviour natively, so
 *   prefer it over JS that closes siblings.
 *   Use a real heading inside the `<summary>` when the section title belongs in
 *   the document outline, and pick its level from the surrounding page.
 *   Never rely on the collapsed state to HIDE something that must stay
 *   available: collapsed content is not reachable by find-in-page on every
 *   engine, so nothing essential should live only there.
 *
 * @example
 * ```html
 * <div class=${accordionClass()}>
 *   <details name="faq" class=${accordionItemClass()} open>
 *     <summary class=${accordionTriggerClass()}>
 *       <span>Is it accessible?</span>
 *       <svg class="size-4 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
 *     </summary>
 *     <div class=${accordionContentClass()}>Yes, it uses a native disclosure widget.</div>
 *   </details>
 *   <details name="faq" class=${accordionItemClass()}>
 *     <summary class=${accordionTriggerClass()}>
 *       <span>Is it styled?</span>
 *       <svg class="size-4 shrink-0 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
 *     </summary>
 *     <div class=${accordionContentClass()}>Yes, with the shadcn design tokens.</div>
 *   </details>
 * </div>
 * ```
 */

/** Root wrapper. Holds the column-of-items rhythm; no display: rules. */
export const accordionClass = (): string => 'w-full';

/**
 * Item: each <details>. The `group` utility lets the trigger's chevron
 * rotate on open via `group-open:rotate-180`. `last:border-b-0` cleans
 * the trailing edge.
 */
export const accordionItemClass = (): string => 'group border-b last:border-b-0';

/**
 * Trigger: applied to <summary>. Hides the native disclosure triangle so
 * authors can compose their own chevron icon (typical pattern: trailing
 * lucide chevron with `group-open:rotate-180`).
 *
 * `disabled: true` returns the visual disabled state (greyed out,
 * not-allowed cursor, no pointer events). For true keyboard prevention
 *, the native disabled-disclosure-widget gap, add the standard
 * `inert` attribute to the <details> element. shadcn's React `disabled`
 * prop combines both; native HTML has no `disabled` on <details>.
 */
export const accordionTriggerClass = (opts: { disabled?: boolean } = {}): string => {
  const base = 'flex w-full cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-sm font-medium outline-none transition-all hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 marker:hidden [&::-webkit-details-marker]:hidden';
  if (opts.disabled) return `${base} pointer-events-none cursor-not-allowed opacity-50`;
  return base;
};

/**
 * Content: <details> hides this entirely when not [open], so all we add
 * is the typography rhythm matching shadcn (bottom padding, small text).
 */
export const accordionContentClass = (): string => 'pb-4 text-sm';
