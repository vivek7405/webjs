/**
 * Field group: grouped form fields, inputs with addons, and where the error
 * goes. Tier-1 class helpers; compose with `<fieldset>` / `<legend>`.
 *
 * shadcn parity:
 *   FieldSet          → fieldSetClass()
 *   FieldLegend       → fieldLegendClass()
 *   FieldGroup        → fieldGroupClass()
 *   FieldError        → fieldErrorClass()
 *   InputGroup        → inputGroupClass()
 *   InputGroupAddon   → inputGroupAddonClass({ side })
 *   InputGroupText    → inputGroupTextClass()
 *
 * This file adds the GROUPING and ADDON shapes only. `lib/utils.ts` already
 * exports `fieldClass()`, `fieldRowClass()`, `fieldLabelClass()`, `hintClass()`
 * and `errorClass()` for a single field, and this must not duplicate or shadow
 * any of them. Note the pair that reads alike and is not: `errorClass()` styles
 * the error TEXT, while `fieldErrorClass()` here is the reserved SPACE the text
 * appears in.
 *
 * Design: a long form is not a list of inputs, it is a few groups of related
 * inputs, and the grouping is what makes it fillable. Four sections with legends
 * beats sixteen fields in a column, because the reader can skip the three
 * sections that do not apply to them. The addon shape then keeps a unit or a
 * prefix visually INSIDE the control instead of floating beside it, so the
 * control still reads as one thing. The error placement is the part most often
 * got wrong: reserve the space under the field rather than inserting on
 * validation, or the whole form jumps down a line the moment someone makes a
 * mistake, which moves the thing they were about to click.
 *
 * Design tokens used: --border, --input, --muted, --muted-foreground,
 * --destructive, --ring.
 *
 * A11y (required for accessible output):
 *   A group of related controls MUST be a real `<fieldset>` with a `<legend>`,
 *   and for radios and checkboxes this is not optional: the legend is the only
 *   thing that gives the group a name, so without it a screen reader announces
 *   each option with no idea what question it answers.
 *   The `<legend>` must be the FIRST child of the `<fieldset>`.
 *   An ADDON IS NOT A LABEL. A currency symbol or a `.com` suffix in an addon
 *   is decoration; the field still needs its own `<label for>`. Mark a purely
 *   visual addon `aria-hidden="true"`, and if it carries real information put
 *   that information in the label or a hint the field points at.
 *   Wire the error with `aria-describedby` on the control pointing at the error
 *   element's id, plus `aria-invalid="true"` while invalid. Put `aria-live="polite"`
 *   on the error element so a message appearing after submit is announced;
 *   without it the reader is told nothing and simply sees the form not submit.
 *
 * @example
 * ```html
 * <fieldset class=${fieldSetClass()}>
 *   <legend class=${fieldLegendClass()}>Billing</legend>
 *   <div class=${fieldGroupClass()}>
 *     <div class=${fieldClass()}>
 *       <label class=${fieldLabelClass()} for="price">Price</label>
 *       <div class=${inputGroupClass()}>
 *         <span class=${inputGroupAddonClass({ side: 'start' })} aria-hidden="true">$</span>
 *         <input id="price" class=${inputClass()} aria-describedby="price-error" aria-invalid="true">
 *       </div>
 *       <div class=${fieldErrorClass()}>
 *         <p id="price-error" class=${errorClass()} aria-live="polite">Enter an amount.</p>
 *       </div>
 *     </div>
 *   </div>
 * </fieldset>
 * ```
 */
import { cn } from '#lib/utils/cn.ts';

/** A section of related fields. Use a real `<fieldset>`. */
export const fieldSetClass = (): string => 'grid gap-4 border-0 p-0';

/** The section's name. Use a real `<legend>`, first child of the fieldset. */
export const fieldLegendClass = (): string => 'mb-1 text-base font-medium';

/** The fields inside a section. */
export const fieldGroupClass = (): string => 'grid gap-4';

export interface InputGroupAddonClassOptions {
  /** Which end of the control the addon sits on. */
  side?: 'start' | 'end';
}

/**
 * A control with something attached to it.
 *
 * The focus ring is drawn on the GROUP rather than the inner input, so the
 * whole control lights up as one thing. That needs the inner input to drop its
 * own ring, which the example does with `focus-visible:ring-0`.
 */
export const inputGroupClass = (): string => {
  return cn(
      'flex items-stretch rounded-md border border-input shadow-e1',
      'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
      'has-[[aria-invalid=true]]:border-destructive has-[[aria-invalid=true]]:ring-destructive/20',
      '[&>input]:border-0 [&>input]:shadow-none [&>input]:focus-visible:ring-0',
    );
}

/** The attached prefix or suffix. Decorative addons must be aria-hidden. */
export const inputGroupAddonClass = (opts: InputGroupAddonClassOptions = {}): string => {
  return cn(
      'flex select-none items-center bg-muted px-3 text-sm text-muted-foreground',
      opts.side === 'end' ? 'rounded-r-md border-l' : 'rounded-l-md border-r',
    );
}

/** Text inside an addon, when the addon holds more than a glyph. */
export const inputGroupTextClass = (): string => 'text-sm text-muted-foreground';

/**
 * The reserved space an error message appears in.
 *
 * `min-h` is the whole point: the space exists before there is an error, so the
 * form does not jump when one arrives. This is the SPACE; `errorClass()` from
 * `lib/utils.ts` styles the text that goes in it.
 */
export const fieldErrorClass = (): string => 'min-h-5';
