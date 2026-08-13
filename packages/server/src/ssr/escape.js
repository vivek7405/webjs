/**
 * The HTML escapers the SSR render and head paths use, in one place.
 *
 * Not quite the only pair in the package: `importmap.js` keeps a private,
 * byte-identical `escapeAttr` for the one attribute it writes itself, on the
 * stated ground that one small helper is not worth a cross-file dependency.
 * That one is in step with these and has to stay so.
 *
 * `main` had a single pair serving every call site. The split produced three
 * copies, in the render path, the head builder and the env shim, and two of
 * them widened to also escape `>` and to coerce with `?? ''`. That is not a
 * cosmetic difference: these decide served bytes, so a widened copy moves every
 * ETag it touches, and the head copy serves `<title>`, every `<meta content>`,
 * every `<link href>` and `integrity=`.
 *
 * Kept deliberately narrow, matching `main`: `&`, `"` and `<` for an attribute,
 * `&` and `<` for text. A `>` in text or in a quoted attribute value is not
 * markup, so escaping it only changes bytes.
 */

/** @param {string} s */
export function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** @param {string} s */
export function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
