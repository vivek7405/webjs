/**
 * Label: styled native `<label>`. Tier-1 class helper. Compose with a
 * real `<label for="...">` so click-to-focus, `htmlFor` / `for` linking,
 * and screen-reader association all work natively (no Radix Label needed).
 *
 * shadcn parity:
 *   Label  → labelClass()
 *
 * Disabled-state inheritance: when the label is inside a container with
 * `data-disabled="true"` (the "field" pattern), or next to a peer-disabled
 * control, it dims automatically.
 *
 * Design tokens used: none (typography only).
 *
 * Design: Every control gets one, and it is bound with `for` rather than merely placed
 * nearby, which makes it a click target as well as a name. Keep labels short and
 * in the reader's words rather than the schema's: `Business name` beats
 * `company_name`. Do not mark every field required; mark the optional ones
 * instead when most are required, which is the shorter list and the more useful
 * one.
 *
 * A11y (required for accessible output):
 *   Put this on a REAL `<label>`, and link it to its control, either with `for`
 *   pointing at the control's `id` (below) or by nesting the control inside the
 *   `<label>`. That link is the entire point of the element: it supplies the
 *   control's accessible name and makes clicking the text focus the control.
 *   The same classes on a `<span>` or `<div>` look identical and name nothing.
 *   One label, one control. `for` takes a single id, so a label cannot name a
 *   group; use `<fieldset>` + `<legend>`, or a heading referenced by
 *   `aria-labelledby`, for that.
 *   Do not use a label as a heading for a non-control region. A label with no
 *   control is inert; if it is really a section title, use a heading element.
 *   The dimmed disabled look is presentational only (it keys on a parent's
 *   `data-disabled` or a `peer-disabled:` sibling). Actually disable the
 *   CONTROL: styling the label alone leaves a control that still takes input.
 *
 * @example
 * ```html
 * <label class=${labelClass()} for="email">Email</label>
 * <input class=${inputClass()} id="email" name="email" type="email">
 *
 * <!-- Nesting works too, and needs no id / for pair. -->
 * <label class=${labelClass()}>
 *   <input type="checkbox" data-slot="checkbox" class=${checkboxClass()}>
 *   Email me a receipt
 * </label>
 * ```
 */

/** Compose Tailwind classes for a native `<label>`. */
export function labelClass(): string {
  return 'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50';
}
