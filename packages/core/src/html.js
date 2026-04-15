/**
 * Tagged template literal producing a {@link TemplateResult}.
 *
 * A TemplateResult is an isomorphic description of HTML: the static string
 * pieces plus the dynamic values. Server and client renderers both consume it.
 *
 * @typedef {{ _$webjs: 'template', strings: TemplateStringsArray | string[], values: unknown[] }} TemplateResult
 *
 * @param {TemplateStringsArray | string[]} strings
 * @param {...unknown} values
 * @returns {TemplateResult}
 */
export function html(strings, ...values) {
  return { _$webjs: 'template', strings, values };
}

/**
 * Identity check for TemplateResult.
 * @param {unknown} x
 * @returns {x is TemplateResult}
 */
export function isTemplate(x) {
  return !!x && typeof x === 'object' && /** @type {any} */ (x)._$webjs === 'template';
}

/**
 * Marker used in the DOM to find hydration points.
 * Same marker emitted by server and client so hydration can align.
 */
export const MARKER = 'w$';
