/**
 * NativeSelect: styled native `<select>`. Tier-1 class helpers. Uses
 * `appearance: none` to hide the platform chevron and overlays an SVG
 * chevron on top. Best mobile UX (native picker), full keyboard support,
 * form submission works natively. No JS.
 *
 * shadcn parity:
 *   NativeSelect             → nativeSelectClass()
 *   NativeSelect wrapper     → nativeSelectWrapperClass()
 *   NativeSelect chevron     → nativeSelectIconClass()
 *   NativeSelect option      → bare <option> (or nativeSelectOptionClass()
 *                              for explicit overrides, since the theme
 *                              stylesheet sets Canvas / CanvasText on
 *                              every <option> automatically)
 *
 * The theme stylesheet forces Canvas / CanvasText on every <option> so the
 * dropdown reads in both light and dark themes regardless of OS preference.
 * It arrives with the design tokens (`npx @webjsdev/ui init`, or `add`, which
 * writes the block when it is missing), so it is in the first paint and works
 * with JavaScript off. Advanced overrides use `nativeSelectOptionClass()` and
 * `nativeSelectOptGroupClass()`.
 *
 * Design tokens used: --input, --background, --primary, --primary-foreground,
 * --muted-foreground, --ring, --destructive.
 *
 * A11y (required for accessible output):
 *   LABEL IT. A `<label class=${labelClass()} for="<the select's id">` linked by
 *   the `for` / `id` pair is the whole requirement. A `<select>` with no label
 *   announces only its current value, so the user hears "Basic" with no idea it
 *   is the billing plan.
 *   The chevron is DECORATIVE and must stay `aria-hidden="true"`. It duplicates
 *   information the select's own role already conveys, and it sits outside the
 *   control, so without the attribute it is announced as a stray graphic.
 *   There is no placeholder option in a `<select>`. If you need one, use a
 *   `<option value="" disabled selected>` prompt, and keep `required` on the
 *   select so an empty submit is caught natively.
 *   Group long option lists with `<optgroup label="...">`; the label is
 *   announced, so it is real structure rather than only a visual break.
 *   Being native is the accessibility win here: the platform picker, the
 *   keyboard behaviour, and the mobile UX come for free. Do not rebuild it as a
 *   div-based listbox to gain styling.
 *
 * @example
 * ```html
 * <div class=${fieldClass()}>
 *   <label class=${labelClass()} for="plan">Billing plan</label>
 *   <div class=${nativeSelectWrapperClass()}>
 *     <select class=${nativeSelectClass()} name="plan" id="plan" required>
 *       <option value="" disabled selected>Choose a plan</option>
 *       <option value="basic">Basic</option>
 *       <option value="pro">Pro</option>
 *     </select>
 *     <!-- chevron icon, decorative -->
 *     <svg class="${nativeSelectIconClass()}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
 *   </div>
 * </div>
 * ```
 */
import { cn } from '../lib/utils.ts';

export type NativeSelectSize = 'default' | 'sm';

// The <option> / <optgroup> colour rule is NOT injected from here. It lives in
// the theme stylesheet the kit installs, so it is in the first paint, works
// with JavaScript off, and does not make this module client-effecting (a
// module-scope call pins every page that imports it, #1320). See the
// `select option, select optgroup` rule in the theme block.
//
// `nativeSelectOptionClass()` and `nativeSelectOptGroupClass()` stay exported
// for users who want to opt into the same colours via a class helper. They
// emit the same `bg-[Canvas] text-[CanvasText]` utilities: redundant when the
// theme block is present, harmless, and they match the broader shadcn
// convention that every part has a class helper.

export const nativeSelectWrapperClass = (): string =>
  'group/native-select relative w-fit has-[select:disabled]:opacity-50';

export function nativeSelectClass(): string {
  return cn(
    'h-9 w-full min-w-0 appearance-none rounded-md border border-input bg-transparent px-3 py-2 pr-9 text-sm shadow-e1 transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed data-[size=sm]:h-8 data-[size=sm]:py-1 dark:bg-input/30 dark:hover:bg-input/50',
    'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
    'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
  );
}

export const nativeSelectIconClass = (): string =>
  'pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-muted-foreground opacity-50 select-none';

/** Option / optgroup styling: forces themed background even in dark mode. */
export const nativeSelectOptionClass = (): string => 'bg-[Canvas] text-[CanvasText]';
export const nativeSelectOptGroupClass = (): string => 'bg-[Canvas] text-[CanvasText]';
