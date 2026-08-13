import { jsonForScriptTag } from '../script-tag-json.js';

/**
 * The `window.process.env` shim, kept in its own module because BOTH the head
 * builder and the render path emit it.
 *
 * It lived in `document.js` before, which made `head.js` import from
 * `document.js` while `document.js` imported from `head.js`. Nothing in
 * `document.js` used it, so the dependency was on the file rather than on the
 * code, and moving it here is what breaks that half of the ssr cycle.
 */

/**
 * Build an inline `<script>` that exposes server-side environment
 * variables to the browser via `window.process.env`. Two purposes:
 *
 *   1. App code can read `process.env.WEBJS_PUBLIC_X` directly in
 *      components (counterpart of Next.js's `NEXT_PUBLIC_` prefix,
 *      but without a build step).
 *   2. `process.env.NODE_ENV` is defined for vendor bundles that
 *      probe it (lit, react, etc.) so they do not throw
 *      ReferenceError in the browser.
 *
 * Only variables whose name starts with `WEBJS_PUBLIC_` are exposed.
 * Other server env vars stay on the server.
 *
 * `</...` sequences in stringified values are escaped so an env value
 * containing `</script>` cannot terminate the inline script tag.
 *
 * @param {{ dev: boolean, nonce?: string, env?: Record<string, string|undefined> }} opts
 *   `env` defaults to `process.env`. Override for tests.
 * @returns {string}
 */
export function publicEnvShim(opts) {
  const source = opts?.env || process.env;
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(source)) {
    if (k.startsWith('WEBJS_PUBLIC_') && v !== undefined) {
      env[k] = String(v);
    }
  }
  env.NODE_ENV = opts?.dev ? 'development' : 'production';
  const n = opts?.nonce ? ` nonce="${escapeAttr(opts.nonce)}"` : '';
  return `<script${n}>`
    + `window.process=window.process||{};`
    + `window.process.env=Object.assign(window.process.env||{},${jsonForScriptTag(env)});`
    + `</script>`;
}

/** @param {string} s */
function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
