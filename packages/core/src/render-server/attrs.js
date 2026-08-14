import { escapeAttr } from '../escape.js';
import { readAttributeValue, resolveAttributeProperty } from '../attribute-reader.js';
import { parse } from '../serialize.js';
import { camelCase, decodeAttrEntities } from './text.js';

/**
 * Applying source attributes to a component instance during SSR, and writing
 * the instance's own attributes back onto its opening tag.
 *
 * The instance-facing half of what `dsd.js` used to hold. It reaches the
 * component through the standard `getAttribute` / `setAttribute` API, so it
 * works against both the server element shim and a real `HTMLElement`.
 */

/**
 * Minimal attribute string parser.
 * @param {string} attrStr
 * @returns {Record<string,string>}
 */
export function parseAttrs(attrStr) {
  /** @type {Record<string,string>} */
  const out = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(attrStr)) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/**
 * Seed the element's attributes from the source opening tag so reads like
 * `this.getAttribute(name)` / `this.hasAttribute(name)` inside willUpdate /
 * render return the real value during SSR. Goes through `setAttribute`, which
 * both the server element shim (Node SSR) and a real `HTMLElement`
 * (renderToString called in a browser, e.g. tests) implement, so the path
 * does not depend on the shim's internal store. A bare Base-extending kit
 * component without `setAttribute` is skipped.
 *
 * @param {any} instance
 * @param {Record<string,string>} attrs  parsed source attributes (data-webjs-prop-* already removed)
 */
export function seedServerAttrs(instance, attrs) {
  if (!instance || typeof instance.setAttribute !== 'function') return;
  for (const [name, raw] of Object.entries(attrs)) {
    instance.setAttribute(name, decodeAttrEntities(raw));
  }
}

/**
 * Add the component host marker (`data-wj-host`) to an opening tag, unless it
 * is already present. Insert before the closing `>` the same way
 * `appendReflectedAttrs` does. Idempotent so a re-processed tag is unchanged.
 * @param {string} opening  the element's opening tag, ending in `>`
 * @returns {string}
 */
export function withHostMarker(opening) {
  if (/\sdata-wj-host(?=[\s>=])/i.test(opening)) return opening;
  return `${opening.slice(0, -1)} data-wj-host>`;
}

/**
 * Append attributes the component set before render (reflected reflect:true
 * properties, or an explicit `this.setAttribute` in the constructor /
 * willUpdate) to the element's opening tag, skipping any name already present
 * in the source tag. Reads via the standard `getAttributeNames` /
 * `getAttribute` API so it works whether the instance is the server shim or a
 * real `HTMLElement`. Returns the opening tag unchanged when there is nothing
 * to add, so existing SSR output stays byte-identical when no component
 * reflects, which preserves the elision on-vs-off differential invariant.
 *
 * @param {string} opening  the element's opening tag, ending in `>`
 * @param {any} instance
 * @param {Set<string>} presentAttrNames  lowercased names already in the source tag
 * @returns {string}
 */
export function appendReflectedAttrs(opening, instance, presentAttrNames) {
  if (!instance || typeof instance.getAttributeNames !== 'function') return opening;
  let extra = '';
  for (const rawName of instance.getAttributeNames()) {
    const name = String(rawName).toLowerCase();
    if (presentAttrNames.has(name)) continue;
    const value = instance.getAttribute(rawName);
    extra += value === '' ? ` ${name}` : ` ${name}="${escapeAttr(String(value))}"`;
  }
  if (!extra) return opening;
  // Insert before the closing `>` (the opening tag is normalised to end in
  // `>`; a self-closing source tag was already rewritten without the slash).
  return `${opening.slice(0, -1)}${extra}>`;
}

/**
 * Coerce attribute strings to typed properties on a component instance
 * based on its static `properties` declaration.
 */
export function applyAttrsToInstance(instance, attrs, Cls) {
  for (const [sourceName, sourceValue] of Object.entries(attrs)) {
    // The browser LOWERCASES every attribute name while parsing an HTML
    // document, so `cfgData="x"` reaches the client reader as `cfgdata` and a
    // camelCase name can never match anything in `observedAttributes`.
    // Resolving the source case here made SSR read a name the platform cannot
    // deliver, which is the divergence, not the fix (#1341).
    const resolved = resolveAttributeProperty(Cls, sourceName.toLowerCase());
    // An attribute mapping to no attribute-backed property is IGNORED, exactly
    // as `attributeChangedCallback` ignores it and as lit's reader does. This
    // used to assign it as an instance property (`instance[propName] = raw`),
    // which no browser upgrade ever reproduces, and which on a real
    // HTMLElement could mutate DOM state through `id` / `hidden` / `slot`.
    // `seedServerAttrs` has already applied every source attribute properly,
    // so nothing needs the copy (#1341).
    if (resolved === undefined) continue;
    const { propName, def } = resolved;
    // A browser decodes every character reference BEFORE any reader sees the
    // value, so decode once here, for every branch, and hand the shared reader
    // an already-decoded string exactly as the DOM hands the client one. It
    // used to be a `decode` argument the reader applied on the JSON and
    // converter branches alone, which left a `String`-typed prop holding the
    // raw source text while `getAttribute()` on the client returned the decoded
    // one (#1341).
    //
    // One reader for both sides (#1340): `readAttributeValue` in
    // `attribute-reader.js` is the same function `attributeChangedCallback` in
    // `component.js` calls, so a custom `converter.fromAttribute` runs here
    // too, ahead of type coercion, and the #1253 unparseable-JSON fallback is
    // shared rather than mirrored.
    //
    // A converter that THROWS is not caught here. It lands in the
    // per-component error isolation below, which is deliberate: an author who
    // supplies a converter owns the read, the same rule `_reflectAttribute`
    // states for `toAttribute`. See the comment on `readAttributeValue`.
    instance[propName] = readAttributeValue(def, decodeAttrEntities(sourceValue));
  }
}

/**
 * Decode `data-webjs-prop-<kebab>` attributes from a parsed attribute
 * map, returning a map of camelCase property name to decoded value.
 * Mutates `attrs` by deleting the consumed entries so they do not
 * appear in the rendered output a second time.
 *
 * @param {Record<string,string>} attrs
 * @returns {Record<string, unknown>}
 */
export function consumePropAttrs(attrs) {
  /** @type {Record<string, unknown>} */
  const props = {};
  for (const key of Object.keys(attrs)) {
    if (!key.startsWith('data-webjs-prop-')) continue;
    const propName = camelCase(key.slice('data-webjs-prop-'.length));
    try {
      props[propName] = parse(decodeAttrEntities(attrs[key]));
    } catch {
      // Malformed payload. Skip silently so the rest of the component
      // can still render. The client-side hydration will also try and
      // fail, which is fine: undefined-prop semantics.
    }
    delete attrs[key];
  }
  return props;
}
