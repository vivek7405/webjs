/**
 * Textarea: styled native `<textarea>`. Tier-1 class helper. Real
 * multi-line input: form submission, autosize via `field-sizing:
 * content`, and native validation all work.
 *
 * shadcn parity:
 *   Textarea  → textareaClass()
 *
 * Pair with `<label class=${labelClass()} for="...">` and wrap in
 * `<div class=${fieldClass()}>` for the canonical field rhythm.
 *
 * Design tokens used: --input, --background, --muted-foreground, --ring,
 * --destructive.
 *
 * A11y (required for accessible output):
 *   LABEL IT. A `<label class=${labelClass()} for="<the textarea's id">` linked
 *   by the `for` / `id` pair is the whole requirement. The `placeholder` in the
 *   old example was doing that job and cannot: it vanishes as soon as the user
 *   types, and it is not reliably exposed as a name.
 *   Point `aria-describedby` at a hint or a character counter that EXISTS on the
 *   page, and on a validation failure set `aria-invalid="true"` plus an
 *   `aria-describedby` error element so the reason is announced with the field.
 *   If you show a live character count, put it in an `aria-live="polite"`
 *   region, otherwise the number updates silently for a screen reader user.
 *   Leave the textarea RESIZABLE. The class autosizes via `field-sizing:
 *   content`, which is fine, but do not add `resize-none` on top: a user who
 *   needs more room to read their own text has no other way to get it (WCAG
 *   1.4.4-adjacent).
 *
 * @example
 * ```html
 * <div class=${fieldClass()}>
 *   <label class=${labelClass()} for="message">Message</label>
 *   <textarea class=${textareaClass()} name="message" id="message" rows="4"
 *             aria-describedby="message-hint"></textarea>
 *   <p class=${hintClass()} id="message-hint">Markdown is supported.</p>
 * </div>
 * ```
 */
import { cn } from '../lib/utils.ts';

const TEXTAREA_BASE =
  'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-e1 transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40';

/** Compose Tailwind classes for a native `<textarea>`. */
export function textareaClass(): string {
  return cn(TEXTAREA_BASE);
}
