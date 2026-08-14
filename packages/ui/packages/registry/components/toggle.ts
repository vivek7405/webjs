/**
 * Toggle: pressable on / off button. Ships both as a Tier-1 class helper
 * (for callers that want to own pressed state on a native `<button>`)
 * and as the Tier-2 `<ui-toggle>` custom element (for callers that want
 * state managed for them).
 *
 * shadcn parity:
 *   Toggle (variant: default | outline)
 *          (size:    default | sm | lg)
 *                                 → toggleClass({ variant, size })  (class helper)
 *                                 → <ui-toggle pressed variant size>  (custom element)
 *
 * Attributes on <ui-toggle>:
 *   `pressed`:  boolean (reflected). Active state.
 *   `variant`:  "default" (default) | "outline".
 *   `size`:     "default" (default) | "sm" | "lg".
 *   `disabled`: boolean (reflected). Disables click + focus.
 *
 * Events:
 *   `ui-pressed-change` on <ui-toggle>: `{ detail: { pressed } }` after a click.
 *
 * Keyboard: native button. Enter / Space activates (via the inner <button>).
 *
 * A11y (required for accessible output):
 *   `<ui-toggle>` renders a native `<button>` inside itself, and that button is
 *   the focusable control whose accessible name a screen reader announces. An
 *   `aria-label` on the host would not reach it (a name on a generic-role
 *   element does not contribute to a descendant's name), so the element
 *   FORWARDS the host's `aria-label` / `aria-labelledby` onto the inner button.
 *   Put the name on the host, as the icon-only example below does, and the
 *   element wires the rest. An icon-only toggle needs one; a text toggle takes
 *   its name from the slotted text and needs nothing.
 *   Set the name as an ATTRIBUTE on the host in your markup
 *   (`aria-label="Toggle bold"`), not as a property.
 *   LIMITATION, and it is a real one: `aria-label` / `aria-labelledby` are not
 *   reactive properties of this element, so they are not observed attributes.
 *   The name is read during render(), which means markup present at first paint
 *   works, but a LATER `el.setAttribute('aria-label', ...)` does not re-render
 *   and so does not reach the inner button until something else happens to
 *   trigger a render. If your name is computed after mount, set it on the inner
 *   button yourself (`el.querySelector('button').setAttribute('aria-label',
 *   name)`). Do NOT reach for "flip a reactive prop to force a re-render":
 *   adding or removing the name switches which of the three templates below is
 *   used, and a template swap REBUILDS the button, so doing it on a click would
 *   destroy the control the user is focused on and drop focus to <body>.
 *   Using the Tier-1 `toggleClass()` helper on your own `<button>` instead? Then
 *   the name is entirely yours: give an icon-only button an `aria-label`, and
 *   carry the pressed state on `aria-pressed` + `data-state` as the example does.
 *
 * Design tokens used: --muted, --muted-foreground, --accent, --accent-foreground,
 * --input, --background, --ring, --destructive.
 *
 * @example
 * ```html
 * <!-- Tier-1 class helper, caller owns state. -->
 * <button class=${toggleClass()} data-state="off" aria-pressed="false"
 *         onclick="this.dataset.state = this.dataset.state==='on'?'off':'on'">
 *   <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 12a4 4 0 0 0 0-8H6v8" /><path d="M15 20a4 4 0 0 0 0-8H6v8Z" /></svg>
 * </button>
 *
 * <!-- Tier-2 custom element, state managed. -->
 * <ui-toggle aria-label="Toggle bold">
 *   <svg class="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 12a4 4 0 0 0 0-8H6v8" /><path d="M15 20a4 4 0 0 0 0-8H6v8Z" /></svg>
 * </ui-toggle>
 *
 * <!-- Controlled or initial state. -->
 * <ui-toggle variant="outline" size="sm" pressed>B</ui-toggle>
 * ```
 */
import { WebComponent, html, prop } from '@webjsdev/core';
import { cn } from '../lib/utils.ts';

// cursor-pointer + select-none on BASE for both call sites: the
// class-helper applied to a native <button> (where shadcn's upstream
// also omits it; see the same convention the button fix applies) and
// the <ui-toggle> custom element. select-none prevents drag-selecting
// icon/label glyphs that aren't meant to be selectable. disabled:
// pointer-events-none below already suppresses cursor for disabled buttons.
const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap select-none transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const VARIANTS = {
  default: 'bg-transparent',
  outline:
    'border border-input bg-transparent shadow-e1 hover:bg-accent hover:text-accent-foreground',
} as const;

const SIZES = {
  default: 'h-9 min-w-9 px-2',
  sm: 'h-8 min-w-8 px-1.5',
  lg: 'h-10 min-w-10 px-2.5',
} as const;

export type ToggleVariant = keyof typeof VARIANTS;
export type ToggleSize = keyof typeof SIZES;

export function toggleClass(opts: { variant?: ToggleVariant; size?: ToggleSize } = {}): string {
  return cn(BASE, VARIANTS[opts.variant ?? 'default'], SIZES[opts.size ?? 'default']);
}

// --------------------------------------------------------------------------
// <ui-toggle> wraps a native <button> and tracks pressed state. Native
// <button> handles Enter/Space → click + focus + disabled semantics for
// free; we only own the pressed-state toggle on click. Authored children
// project through the default slot inside the inner button.
// --------------------------------------------------------------------------

export class UiToggle extends WebComponent({
  pressed: prop(Boolean, { reflect: true }),
  variant: prop<ToggleVariant>(String, { reflect: true }),
  size: prop<ToggleSize>(String, { reflect: true }),
  disabled: prop(Boolean, { reflect: true }),
}) {
  constructor() {
    super();
    this.pressed = false;
    this.variant = 'default';
    this.size = 'default';
    this.disabled = false;
  }

  // Read a host attribute defensively. render() runs server-side too, where
  // webjs shims the attribute methods; the typeof guard stays for any other
  // renderer that does not.
  _hostAttr(name: string): string | null {
    if (typeof this.getAttribute !== 'function') return null;
    return this.getAttribute(name);
  }

  render() {
    // The focusable control is the inner <button>, so its accessible name is
    // what a screen reader announces. `aria-label` on the host cannot supply
    // that (the host has a generic role, and a name there does not contribute
    // to a descendant's name), and the documented icon-only shape slots an
    // aria-hidden SVG, which contributes nothing either. Forward the host's
    // name source onto the button so the documented shape ships named.
    //
    // The name is BRANCHED into three templates rather than carried in one
    // hole, because a null hole does NOT omit an attribute on the server: the
    // server renderer stringifies the value, so `aria-label=${null}` ships
    // `aria-label=""` while the client renderer removes it. On an unlabelled
    // toggle that would put an empty name on the very control whose name is
    // supposed to come from its slotted text, and disagree with the hydrated
    // DOM on the exact attribute this forwarding exists to get right.
    const labelledBy = this._hostAttr('aria-labelledby');
    const label = this._hostAttr('aria-label');
    const cls = toggleClass({ variant: this.variant, size: this.size });
    const pressed = String(this.pressed);
    const state = this.pressed ? 'on' : 'off';
    // aria-labelledby beats aria-label per accname, so it is checked first and
    // only ONE of the two is ever emitted.
    if (labelledBy) {
      return html`<button
        type="button"
        data-slot="toggle"
        class=${cls}
        aria-pressed=${pressed}
        aria-labelledby=${labelledBy}
        data-state=${state}
        ?disabled=${this.disabled}
        @click=${this._onClick}
      ><slot></slot></button>`;
    }
    if (label) {
      return html`<button
        type="button"
        data-slot="toggle"
        class=${cls}
        aria-pressed=${pressed}
        aria-label=${label}
        data-state=${state}
        ?disabled=${this.disabled}
        @click=${this._onClick}
      ><slot></slot></button>`;
    }
    return html`<button
      type="button"
      data-slot="toggle"
      class=${cls}
      aria-pressed=${pressed}
      data-state=${state}
      ?disabled=${this.disabled}
      @click=${this._onClick}
    ><slot></slot></button>`;
  }

  _onClick = (): void => {
    this.pressed = !this.pressed;
    this.dispatchEvent(
      new CustomEvent('ui-pressed-change', { detail: { pressed: this.pressed }, bubbles: true }),
    );
  };
}
UiToggle.register('ui-toggle');
