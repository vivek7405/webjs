import { tagOf } from '../registry.js';

/**
 * Default change detection: strict inequality.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function defaultHasChanged(a, b) {
  return a !== b;
}

/**
 * `String(v)` that cannot itself throw.
 *
 * A rejection reason is whatever the author rejected with, and not every value
 * converts to a primitive: `Object.create(null)` has no `toString`, and a
 * revoked Proxy throws on any operation. Coercing one in an error-reporting
 * path turned a reportable failure into a second, unreported one.
 *
 * @param {unknown} v
 * @returns {string}
 */
export function safeString(v) {
  try {
    return String(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

/**
 * Warn that a function value was dropped rather than reflected (#1169).
 *
 * A silently missing attribute is its own confusion, so say what went and why.
 * The message deliberately does NOT include the value: printing the source is
 * the leak this guard exists to prevent, and a server log is not always a
 * private place.
 *
 * UNCONDITIONAL, matching the `.prop=${fn}` unserializable-value drop in
 * `render-server.js`, which is the sibling path this guard mirrors. Two
 * reasons not to gate it on a dev flag. It fires only on a genuine mistake (a
 * function is never a meaningful attribute value), so there is no volume to
 * suppress, and reflection runs per assignment rather than per frame.
 *
 * More decisively, a `NODE_ENV` gate does not survive the dist build.
 * `scripts/build-framework-dist.js` runs esbuild with `platform: 'browser'`
 * and `minify: true`, which substitutes `process.env.NODE_ENV` with
 * `"production"` and folds the check to a constant. The SSR half of the
 * warning would then be unreachable in every published build, which is how
 * every installed app runs, and SSR is the half that matters most, since that
 * is where the leaked source reached visitors.
 *
 * @param {{ constructor: unknown, tagName?: string }} host
 * @param {string} propName
 * @param {string} attrName
 */
export function warnFunctionReflection(host, propName, attrName) {
  if (typeof console === 'undefined' || !console.warn) return;
  const tag = tagOf(/** @type any */ (host.constructor)) || host.tagName?.toLowerCase() || 'unknown';
  console.warn(
    `[webjs] reflect:true property "${propName}" on <${tag}> holds a function `
    + `(or an array carrying one), which has no HTML attribute representation. `
    + `Removing "${attrName}" instead of stringifying it (a stringified function `
    + `writes its source into the page, so a server action's body would ship to `
    + `the browser). Pass a string, or drop reflect on this property.`
  );
}

/**
 * Warn that a value with no JSON representation was dropped rather than
 * reflected (#1253).
 *
 * `JSON.stringify` throws for three reasons an app hits in practice: a cycle,
 * a `BigInt`, and an author `toJSON()` that throws. All three mean the same
 * thing here, that there is no string to put in the attribute, so all three
 * get the same answer as a function does.
 *
 * The caught message IS included, unlike `warnFunctionReflection`, which
 * withholds its value on purpose. A function's string form is its source,
 * which is the leak that guard exists to prevent; `JSON.stringify`'s own
 * message names the property path rather than a value, and the sibling
 * `.prop=${val}` SSR drop in `render-server.js` already ends the same way.
 *
 * UNCONDITIONAL, for the reason recorded on `warnFunctionReflection` above: a
 * `NODE_ENV` gate is folded to a constant by the dist build, which would make
 * the SSR half unreachable in every published build, and the SSR half is where
 * the component silently vanishes.
 *
 * @param {{ constructor: unknown, tagName?: string }} host
 * @param {string} propName
 * @param {string} attrName
 * @param {string} [detail] the message `JSON.stringify` threw
 */
export function warnUnserializableReflection(host, propName, attrName, detail) {
  if (typeof console === 'undefined' || !console.warn) return;
  const tag = tagOf(/** @type any */ (host.constructor)) || host.tagName?.toLowerCase() || 'unknown';
  console.warn(
    `[webjs] reflect:true property "${propName}" on <${tag}> holds a value `
    + `JSON.stringify cannot serialize (a cycle, a BigInt, or a throwing `
    + `toJSON), so it has no HTML attribute representation. Removing `
    + `"${attrName}" instead. Detail: ${detail}`
  );
}

/**
 * A minimal base for HTML Custom Elements that mirrors Lit's ergonomics
 * while staying JSDoc-only and no-build.
 *
 * Subclasses declare:
 *  - `static properties`: attribute/property declarations with type info,
 *    reflection, custom converters, and internal-state mode
 *  - `static styles`: CSSResult or array thereof (only meaningful with
 *    `static shadow = true`; light-DOM components inherit global CSS)
 *  - `static shadow`: set `true` to opt in to shadow DOM (default: `false`
 *    → light DOM, so Tailwind / global CSS apply directly)
 *  - `render()`: returns a TemplateResult
 *
 * The tag name is not a static field: pass it to `.register('tag-name')`
 * at the bottom of the file. Tag must contain a hyphen (HTML spec).
 *
 * Lifecycle (lit-aligned, called in order during each update cycle):
 *  1. `shouldUpdate(changedProperties)`. Skip update if false.
 *  2. `willUpdate(changedProperties)`. Safe to set properties; folds into this cycle.
 *  3. controllers' `hostUpdate()`
 *  4. `update(changedProperties)`. Default impl calls `render()` + commits.
 *  5. controllers' `hostUpdated()`
 *  6. `firstUpdated(changedProperties)`: once, on the first render only
 *  7. `updated(changedProperties)`: every render commit
 *  8. `updateComplete` promise resolves
 *
 * `changedProperties` is a `Map<string, unknown>` where each entry maps
 * a property name to its previous value.
 *
 * MAINTAINER NOTE. Adding a new overridable lifecycle hook here means
 * the display-only component elision analyser must learn about it too,
 * or it will wrongly elide a component that now does client work. Add
 * the hook name to `CLIENT_LIFECYCLE_HOOKS` in
 * `packages/server/src/component-elision.js`. The guard test at
 * `packages/server/test/elision/lifecycle-coverage.test.js` introspects
 * this prototype and fails until you do.
 *
 * Usage:
 * ```js
 * import { signal } from '@webjsdev/core';
 *
 * const count = signal(0);
 *
 * class MyCounter extends WebComponent {
 *   render() {
 *     return html`<button @click=${() => count.set(count.get() + 1)}>${count.get()}</button>`;
 *   }
 * }
 * MyCounter.register('my-counter');
 * ```
 */

/**
 * Helper to define properties with custom options.
 *
 * @param {any} [type]
 * @param {any} [opts]
 * @returns {any}
 */
export function prop(type, opts = {}) {
  if (type && typeof type === 'object' && !('call' in type)) {
    opts = type;
    type = undefined;
  }
  return { ...(type ? { type } : {}), ...opts };
}
