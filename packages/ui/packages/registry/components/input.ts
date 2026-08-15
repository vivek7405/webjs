/**
 * Input: styled native `<input>`. Tier-1 class helper. Works with every
 * input type (text, email, password, number, search, tel, url, date,
 * time, file, color, …). Form submission, autocomplete, browser
 * validation, and password managers all work because it IS the native
 * input.
 *
 * shadcn parity:
 *   Input  → inputClass()
 *
 * Pair with `<label class=${labelClass()} for="...">` and a hint paragraph
 * (`<p class=${hintClass()} id="...-hint">`). Wrap all three in
 * `<div class=${fieldClass()}>` for the canonical field rhythm.
 *
 * Design tokens used: --input, --background, --primary, --primary-foreground,
 * --muted-foreground, --foreground, --ring, --destructive.
 *
 * Design: The label is not optional, and a placeholder is not a label: it disappears the
 * moment someone types, so a form labelled only by placeholders is unreadable
 * exactly when the reader is checking their work. Size the field to the content
 * it expects, since a postcode field the width of the page tells the reader they
 * have got something wrong. Keep help text under the field rather than beside
 * it, and reserve the error space so a message does not shift the form.
 *
 * A11y (required for accessible output):
 *   LABEL IT. A `<label class=${labelClass()} for="<the input's id">` is the
 *   whole requirement, and the `for` / `id` pair is what links them. Without it
 *   the input has no accessible name and a screen reader announces only "edit
 *   text". A `placeholder` is NOT a label: it disappears the moment the user
 *   types, and some engines never expose it as a name at all.
 *   Every `aria-describedby` must point at an element that EXISTS on the page.
 *   A dangling id silently contributes nothing, so the hint or error text is
 *   never announced; the example below therefore renders the `#email-hint` node
 *   it references rather than assuming it.
 *   On a validation failure set `aria-invalid="true"` (the class styles the
 *   error ring off it) and point `aria-describedby` at the error text, so the
 *   reason is announced along with the field rather than only shown in red.
 *   Set the right `type` and `autocomplete`. Both are accessibility features:
 *   `type` picks the mobile keyboard and the native validation, and
 *   `autocomplete` is what lets a password manager or an autofill user avoid
 *   retyping. `type="search"` / `type="email"` also announce as such.
 *   A required field wants the native `required` attribute, not just an
 *   asterisk in the label, so the state reaches assistive tech.
 *
 * @example
 * ```html
 * <div class=${fieldClass()}>
 *   <label class=${labelClass()} for="email">Email</label>
 *   <input class=${inputClass()} type="email" name="email" id="email" required
 *          autocomplete="email" aria-describedby="email-hint">
 *   <p class=${hintClass()} id="email-hint">We never share it.</p>
 * </div>
 *
 * <!-- Failed validation: invalid state plus the reason, both announced. -->
 * <div class=${fieldClass()}>
 *   <label class=${labelClass()} for="email-2">Email</label>
 *   <input class=${inputClass()} type="email" name="email" id="email-2"
 *          aria-invalid="true" aria-describedby="email-2-error" value="nope">
 *   <p class=${errorClass()} id="email-2-error">Enter a valid email address.</p>
 * </div>
 * ```
 */
import { cn } from '../lib/utils.ts';

const INPUT_BASE =
  'h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-e1 transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30';

const INPUT_FOCUS =
  'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

const INPUT_INVALID =
  'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40';

/** Compose Tailwind classes for a native `<input>`. */
export function inputClass(): string {
  return cn(INPUT_BASE, INPUT_FOCUS, INPUT_INVALID);
}
