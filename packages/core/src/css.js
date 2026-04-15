/**
 * Tagged template literal producing a {@link CSSResult}.
 *
 * @typedef {{ _$webjsCss: true, text: string }} CSSResult
 *
 * @param {TemplateStringsArray | string[]} strings
 * @param {...unknown} values
 * @returns {CSSResult}
 */
export function css(strings, ...values) {
  let text = strings[0];
  for (let i = 1; i < strings.length; i++) {
    text += String(values[i - 1] ?? '') + strings[i];
  }
  return { _$webjsCss: true, text };
}

/** @param {unknown} x @returns {x is CSSResult} */
export function isCSS(x) {
  return !!x && typeof x === 'object' && /** @type {any} */ (x)._$webjsCss === true;
}

/**
 * Apply an array of CSSResults to a shadow root (client-side only).
 * Uses adoptedStyleSheets when available, falls back to <style>.
 *
 * @param {ShadowRoot | Document} root
 * @param {CSSResult[]} styles
 */
export function adoptStyles(root, styles) {
  if (!styles || !styles.length) return;
  if ('adoptedStyleSheets' in root && typeof CSSStyleSheet !== 'undefined') {
    const sheets = styles.map((s) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(s.text);
      return sheet;
    });
    /** @type {any} */ (root).adoptedStyleSheets = sheets;
  } else {
    const host = /** @type {any} */ (root);
    const el = document.createElement('style');
    el.textContent = styles.map((s) => s.text).join('\n');
    host.appendChild(el);
  }
}

/**
 * Serialise styles to a <style> tag string (server-side).
 * @param {CSSResult[]} styles
 */
export function stylesToString(styles) {
  if (!styles || !styles.length) return '';
  return `<style>${styles.map((s) => s.text).join('\n')}</style>`;
}
