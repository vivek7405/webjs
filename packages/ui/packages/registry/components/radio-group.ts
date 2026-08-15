/**
 * RadioGroup: group of native radio inputs. Tier-1 class helpers;
 * compose with native `<input type="radio" name="...">` sharing a name.
 * The browser handles keyboard nav (Arrow keys), single-selection, and
 * form submission. No JS.
 *
 * shadcn parity:
 *   RadioGroup (orientation: horizontal | vertical)
 *                          → radioGroupClass({ orientation }) on a <div role="radiogroup">
 *   RadioGroupItem         → radioClass() on a native <input type="radio">
 *
 * Design tokens used: --input, --primary, --ring, --destructive.
 *
 * Design: Radios are for a choice between mutually exclusive options where seeing all of
 * them matters, which is why they beat a select under about seven. The group
 * needs a legend, since without it a screen reader announces the options with no
 * idea what question they answer, and a sighted reader has the same problem in a
 * dense form. Preselect the safe or common default rather than leaving the group
 * empty, and keep the option order stable across visits.
 *
 * A11y (required for accessible output):
 *   `data-slot="radio"` is REQUIRED, not decoration. The injected stylesheet
 *   keys the indicator dot on it, and `radioClass()` carries no checked
 *   background fill, so without the attribute a SELECTED radio differs from an
 *   unselected one by border colour alone. That is both easy to miss and a
 *   WCAG 1.4.1 problem (state by colour only). Every example here carries it.
 *   NAME THE GROUP. A bare `<div role="radiogroup">` has no accessible name, so
 *   a screen reader announces "radio group" with no idea what is being chosen.
 *   Point `aria-labelledby` at the visible group label, as below, or use a
 *   `<fieldset>` + `<legend>` instead of the `role="radiogroup"` div.
 *   Give every input the SAME `name`, which is what makes the browser treat
 *   them as one set: it supplies single-selection, Arrow-key navigation, and a
 *   single tab stop for free. Different names produce N independent radios that
 *   can all be selected at once.
 *   Label each input with `<label for>` pointing at its `id`, and mark the
 *   group `aria-invalid="true"` plus an `aria-describedby` error element when
 *   the selection fails validation.
 *
 * @example
 * ```html
 * <div class=${fieldClass()}>
 *   <span class=${fieldLabelClass()} id="plan-label">Billing plan</span>
 *   <div role="radiogroup" aria-labelledby="plan-label" class=${radioGroupClass()}>
 *     <div class="flex items-center gap-2">
 *       <input type="radio" data-slot="radio" name="plan" value="basic" id="plan-basic" class=${radioClass()}>
 *       <label class=${labelClass()} for="plan-basic">Basic</label>
 *     </div>
 *     <div class="flex items-center gap-2">
 *       <input type="radio" data-slot="radio" name="plan" value="pro" id="plan-pro" class=${radioClass()}>
 *       <label class=${labelClass()} for="plan-pro">Pro</label>
 *     </div>
 *   </div>
 * </div>
 * ```
 */
import { cn } from '../lib/utils.ts';

// Two SVGs, one per theme. The dot needs to contrast with the radio's
// inner surface: and that surface flips between themes:
//
//   light: input bg is `bg-transparent` (so the page bg shows through;
//          page bg is near-white) → dot must be DARK to be visible.
//   dark : input bg is `dark:bg-input/30` (a translucent white over the
//          near-black page bg; resolves to near-black) → dot must be
//          LIGHT to be visible.
//
// Hardcoding a single dark-coloured dot (the original implementation)
// painted invisibly on the near-black dark-mode surface, making the
// :checked state indistinguishable from unchecked. Same pattern the
// checkbox fix uses (CHECKMARK_LIGHT / CHECKMARK_DARK): `currentColor`
// in a data:url SVG used as background-image does not inherit from the
// host element, so we ship two SVGs and toggle them via a theme
// selector.
const DOT_LIGHT =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><circle cx='10' cy='10' r='5' fill='oklch(0.205 0 0)'/></svg>\")";
const DOT_DARK =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><circle cx='10' cy='10' r='5' fill='oklch(0.985 0 0)'/></svg>\")";

const RADIO_CLASS =
  'aspect-square size-4 shrink-0 appearance-none rounded-full border border-input bg-transparent shadow-e1 transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 checked:border-primary checked:bg-no-repeat checked:bg-center dark:bg-input/30 dark:aria-invalid:ring-destructive/40';

// Three sibling rule blocks for theme selection: mirrors the
// checkbox.ts pattern in this same registry:
//   - prefers-color-scheme: dark (OS preference, gated by
//     :not([data-theme='light']):not(.light) so an explicit-light
//     toggle still wins over the OS)
//   - :root[data-theme='dark'] (explicit data-attribute toggle)
//   - :root.dark (explicit class toggle, shadcn convention)
const STYLES = `
input[type="radio"][data-slot="radio"]:checked {
  background-image: ${DOT_LIGHT};
  background-size: 100%;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']):not(.light) input[type="radio"][data-slot="radio"]:checked {
    background-image: ${DOT_DARK};
  }
}
:root[data-theme='dark'] input[type="radio"][data-slot="radio"]:checked,
:root.dark input[type="radio"][data-slot="radio"]:checked {
  background-image: ${DOT_DARK};
}
`;

let installed = false;
export function installRadioStyles(): void {
  if (installed || typeof document === 'undefined') return;
  if (document.getElementById('ui-radio-styles')) {
    installed = true;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ui-radio-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
  installed = true;
}

if (typeof document !== 'undefined') installRadioStyles();

/** Tailwind classes for a `<div role="radiogroup">` container. */
export type RadioGroupOrientation = 'vertical' | 'horizontal';

/**
 * Container for a group of native <input type="radio"> elements.
 *
 * Vertical (default): stacked column, gap-3. Matches Radix
 * RadioGroup.Root's default + the most common shadcn snippet.
 *
 * Horizontal: flex row that wraps. Picks `flex flex-wrap gap-x-6
 * gap-y-3` so multi-line wraps still have vertical breathing room.
 */
export function radioGroupClass(opts: { orientation?: RadioGroupOrientation } = {}): string {
  const orientation = opts.orientation ?? 'vertical';
  return orientation === 'horizontal'
    ? 'flex flex-wrap gap-x-6 gap-y-3'
    : 'grid gap-3';
}

/**
 * Tailwind classes for a styled `<input type="radio">`.
 *
 * PAIR THIS WITH `data-slot="radio"` ON THE SAME INPUT. The injected stylesheet
 * keys the indicator dot on that attribute, and this class deliberately carries
 * no checked background fill, so the class alone leaves a selected radio
 * differing from an unselected one by border colour and nothing else.
 */
export function radioClass(): string {
  return cn(RADIO_CLASS);
}
