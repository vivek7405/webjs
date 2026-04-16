/**
 * Built-in directives for the webjs `html` tagged template system.
 *
 * webjs follows a "less is more" philosophy: only directives that solve
 * problems with NO native alternative are included. AI agents don't need
 * syntax sugar — they can write ternaries, string concatenation, and
 * lifecycle hooks just fine.
 *
 * **What's here:**
 * - `unsafeHTML(str)` — render trusted raw HTML (no alternative in templates)
 *
 * **What's NOT here (and why):**
 * - classMap → use `class=${'btn ' + (active ? 'active' : '')}`
 * - styleMap → use `style=${'color:' + color}`
 * - ifDefined → use `attr=${val ?? null}` (null removes the attribute)
 * - when/choose → use ternary `${cond ? a : b}` or if/else before the template
 * - guard → memoize in `willUpdate()` lifecycle hook
 * - ref → use `this.query('#el')` in `firstUpdated()` or `updated()`
 * - cache → use CSS `display:none` to preserve DOM instead of removing
 * - until → use the `Task` controller for component-scoped async data
 * - live → set `.value` via property binding `.value=${val}` and handle
 *   input events with `@input=${e => this.setState({val: e.target.value})}`
 *
 * `repeat()` is in its own file (`./repeat.js`) — it's essential for keyed
 * list reconciliation and has no native alternative.
 *
 * @module directives
 */

/* ================================================================
 * unsafeHTML
 * ================================================================ */

/**
 * Render a raw HTML string without escaping. The string is injected
 * directly into the DOM as parsed HTML nodes.
 *
 * **When to use (AI hint):** Use ONLY for trusted HTML — CMS content,
 * markdown-to-HTML output, or sanitized rich text. NEVER use for
 * user-supplied input — this is an XSS vector.
 *
 * ```js
 * import { html } from 'webjs';
 * import { unsafeHTML } from 'webjs/directives';
 *
 * // Good: trusted markdown output
 * html`<article>${unsafeHTML(markdownToHtml(post.body))}</article>`;
 *
 * // DANGEROUS: user input — use ${text} instead (auto-escaped)
 * // html`<p>${unsafeHTML(userInput)}</p>`;  // ← XSS!
 * ```
 *
 * @param {string | null | undefined} htmlString
 *   Trusted HTML string to render without escaping.
 * @returns {{ _$webjs: 'unsafe-html', value: string }}
 */
export function unsafeHTML(htmlString) {
  return { _$webjs: 'unsafe-html', value: String(htmlString ?? '') };
}

/**
 * Type guard: returns `true` if `x` is a marker produced by `unsafeHTML()`.
 * @param {unknown} x
 * @returns {x is { _$webjs: 'unsafe-html', value: string }}
 */
export function isUnsafeHTML(x) {
  return !!x && typeof x === 'object' && /** @type {any} */ (x)._$webjs === 'unsafe-html';
}

/* ================================================================
 * live
 * ================================================================ */

/**
 * Dirty-check a value against the **live DOM value** instead of the
 * last rendered value. Essential for `<input>` two-way binding where
 * the user can modify the DOM value between renders.
 *
 * **When to use (AI hint):** Use `live()` on `.value` or `.checked`
 * bindings for `<input>`, `<textarea>`, `<select>` elements where the
 * user types/selects between renders. Without `live()`, the renderer
 * skips the update because its cached value matches — even though the
 * DOM value has changed.
 *
 * ```js
 * import { html } from 'webjs';
 * import { live } from 'webjs/directives';
 *
 * html`<input .value=${live(this.state.query)}
 *             @input=${e => this.setState({ query: e.target.value })}>`;
 * ```
 *
 * On the server, `live()` is a no-op — it unwraps to the inner value.
 *
 * @param {unknown} value  The value to set on the element.
 * @returns {{ _$webjs: 'live', value: unknown }}
 */
export function live(value) {
  return { _$webjs: 'live', value };
}

/**
 * Type guard: returns `true` if `x` is a marker produced by `live()`.
 * @param {unknown} x
 * @returns {x is { _$webjs: 'live', value: unknown }}
 */
export function isLive(x) {
  return !!x && typeof x === 'object' && /** @type {any} */ (x)._$webjs === 'live';
}
