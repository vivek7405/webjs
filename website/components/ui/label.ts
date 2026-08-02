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
 * @example
 * ```html
 * <label class=${labelClass()} for="email">Email</label>
 * <input class=${inputClass()} id="email" name="email" type="email">
 * ```
 */

/** Compose Tailwind classes for a native `<label>`. */
export function labelClass(): string {
  return 'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50';
}
