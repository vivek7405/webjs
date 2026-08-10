/**
 * THE attribute reader, singular.
 *
 * `attributeChangedCallback` in `component.js` and `applyAttrsToInstance` in
 * `render-server.js` are both thin callers of the two functions below, so the
 * client and the SSR pass cannot drift on precedence, on a fallback, or on
 * which attributes they read at all. They had drifted four ways before this
 * module existed: the unparseable-JSON fallback (#1253), a missing converter
 * arm (#1340), and three name-resolution gaps plus the entity decoding (#1341).
 *
 * The split between the two exports is the one place the sides legitimately
 * differ. `resolveAttributeProperty` takes the name the PLATFORM would deliver,
 * so the SSR caller lowercases its source name first and the client passes the
 * browser's name straight through. Everything after that is common.
 *
 * WHY ITS OWN MODULE, rather than living beside the declaration semantics it
 * interprets in `component.js`. That was the first shape, and `component.d.ts`
 * cannot carry the declaration for it: `index.d.ts` re-exports that overlay
 * with a bare `export *`, so a value declared there joins the ROOT public type
 * surface of `@webjsdev/core` while `index.js` exports no such runtime value.
 * An app writing `import { readAttributeValue } from '@webjsdev/core'` would
 * then type-check and crash at load, which is exactly the phantom the #1031
 * guard in `test/types/dts-no-phantom-exports.test.mjs` exists to catch, and it
 * caught this one. Re-exporting the function from `index.js` would silence the
 * guard by making an internal framework seam app-facing API, which is the wrong
 * trade. A module with no `.d.ts` overlay keeps the seam internal and typed
 * from its own JSDoc, which is how `escape.js` and `binding-prefixes.js`
 * already work.
 *
 * It also drops an edge rather than adding one: `render-server.js` reaches the
 * reader without importing `component.js` at all.
 *
 * lit solves the same problem structurally, though in the other direction.
 * `@lit-labs/ssr`'s LitElementRenderer forwards its `attributeChangedCallback`
 * into the element's own `_$attributeToProperty` through
 * `lit-element/private-ssr-support.js`, so its server pass runs the browser's
 * reader rather than a copy of it. lit can reach INTO the element because its
 * elements are TypeScript with a generated declaration; WebJs ships buildless
 * JS under a hand-written overlay, so the shared code moves out instead.
 */

/**
 * Read one attribute string into its declared property value.
 *
 * The caller owns only the one platform-specific step, lowercasing the source
 * name at SSR; `resolveAttributeProperty` below owns NAME resolution and
 * declaration normalisation for both sides, and this function owns the value.
 * The two callers used to reach an attribute by different routes and NOT see
 * the same attribute set, which #1341 closed.
 *
 * @param {import('./component.js').PropertyDeclaration} def normalised declaration (`{ type, … }`)
 * @param {string|null} value the attribute text
 *
 * BOTH callers hand in an already-decoded value, so no branch decodes anything
 * (#1341). The client's came out of the DOM, which decodes every character
 * reference before any reader sees it; the SSR caller runs `decodeAttrEntities`
 * once at its own call site, ahead of this function, over EVERY branch rather
 * than only the ones that parse. This used to be a third `decode` parameter
 * applied to the JSON and converter branches alone, which left a `String`-typed
 * prop holding the raw source text at SSR while `getAttribute()` on the client
 * returned the decoded one.
 * @returns {unknown}
 */
export function readAttributeValue(def, value) {
  if (def.converter && def.converter.fromAttribute) {
    // Deliberately UNGUARDED, and deliberately first (#1340). An author who
    // supplies a converter owns the whole read, which is the same rule
    // `_reflectAttribute` already states for `toAttribute`: its guards sit
    // AFTER the converter branch because a custom converter is
    // author-controlled. So a converter that throws throws, on both sides. At
    // SSR that lands in per-component error isolation (render-server.js), which
    // surfaces an error box in dev and an empty element at a 200 in prod with
    // the cause in the server log; on the client it escapes
    // attributeChangedCallback during upgrade. Catching on one side only would
    // manufacture a fresh divergence (an SSR paint holding a fallback against a
    // browser holding the constructor value), which is worse than both sides
    // failing. lit propagates too (reactive-element `_$attributeToProperty`).
    //
    // A converter RETURN that SSR cannot serialise needs no guard here either.
    // Unreflected it is only a property, and a function in a text hole renders
    // as nothing. Reflected, the #1169 function guard and the #1253
    // unserializable guard in `_reflectAttribute` already run on the SSR side
    // and cover whatever the converter produced.
    //
    // The converter is handed DECODED text, which matters more here than
    // anywhere: the documented reason to write one is a type the built-in
    // converters cannot parse (Date, Map, Set), those parse their input, and
    // `escapeAttr` encodes every `"` in an emitted attribute, so an encoded
    // `{&quot;a&quot;:1}` would throw inside the author's converter and (since
    // the throw is deliberately uncaught) render an empty component at a 200.
    // Both callers now decode before calling, so it gets the same text on both
    // sides for hand-written markup as well as for anything WebJs emitted
    // (#1341); this used to be a `decode` argument applied on this branch and
    // the JSON one.
    return def.converter.fromAttribute(value, def.type);
  }
  if (def.type === Number) return value == null ? null : Number(value);
  if (def.type === Boolean) return value != null && value !== 'false';
  if (def.type === Object || def.type === Array) {
    // An attribute that is not parseable JSON yields `null` rather than the raw
    // string (#1253), because a STRING is never a valid value for a property
    // the author declared `Object` or `Array`, whatever put it there. lit's
    // `defaultConverter.fromAttribute` lands on the same `null`, for the reason
    // its own comment gives: an element does not complain about being
    // mis-configured. Both readers reach this line, so they cannot disagree.
    //
    // An attribute that was never PRESENT does not reach either reader, so such
    // a prop simply keeps its constructor value.
    //
    // The two readers now see the SAME attribute set, so this fallback is not
    // the only thing they agree on (#1341). Both resolve a name through
    // `resolveAttributeProperty` below, which matches the same
    // `d.attribute || hyphenate(k)` expression `observedAttributes` maps over
    // and nothing else, so it skips a `state: true` prop and ignores a name that
    // maps to no attribute-backed property exactly as the observed list does.
    // The SSR caller lowercases its source name first, because the browser
    // lowercases while parsing. And both are handed a value with every
    // character reference already decoded, legacy semicolon-less names included.
    if (value == null) return null;
    try { return JSON.parse(value); } catch { return null; }
  }
  return value;
}

/** Kebab-case a property name for its default HTML attribute. @param {string} s */
function hyphenate(s) {
  return s.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/**
 * Resolve an attribute NAME to the property it feeds, and to that property's
 * normalised declaration.
 *
 * `state: true` props are skipped, because they are absent from
 * `observedAttributes` and so the browser never delivers their attribute to any
 * reader. lit reaches the same outcome the same way, resolving through the very
 * map `observedAttributes` is built from (`reactive-element.ts`
 * `_$attributeToProperty`).
 *
 * `attrName` must already be the name the PLATFORM would deliver. The browser
 * lowercases attribute names while parsing, so the SSR caller lowercases its
 * source name before calling and the client caller passes the browser's name
 * through untouched. That one step is the only thing that differs between the
 * two sides, which is why it lives in the callers and not here. A custom
 * `attribute` option is matched VERBATIM, as lit matches it and as a browser
 * would, so a camelCase custom attribute stays unreachable from markup rather
 * than being reachable at SSR only. Lowercasing the DECLARED side would make
 * SSR read MORE than a browser can deliver, which is the bug this function
 * exists to remove, so do not add it.
 *
 * The match is EXACTLY `d.attribute || hyphenate(k)`, the same expression
 * `observedAttributes` maps over, and nothing else. A `props[attrName] ||
 * props[camelCase(attrName)]` fallback used to sit after the loop, so a prop
 * declaring a custom attribute also answered to its PROPERTY name. Both readers
 * carried that code, which read like an agreement and was not one: the browser
 * only ever calls in with a name from `observedAttributes`, and that list holds
 * the declared attribute alone, so the fallback was unreachable on the client
 * and live on the server. Measured, `open: prop(Boolean, { attribute:
 * 'is-open' })` with `<my-el open>` SSR'd `true` and upgraded to the
 * constructor value. Deriving the match from the same expression the observed
 * list is built from is what makes the two sides agree by construction rather
 * than by two copies staying in step (#1341).
 *
 * @param {any} Cls  the component class
 * @param {string} attrName
 * @returns {{ propName: string, def: PropertyDeclaration } | undefined}
 *   `undefined` when the attribute maps to no attribute-backed property, in
 *   which case the caller must IGNORE the attribute entirely (#1341).
 */
export function resolveAttributeProperty(Cls, attrName) {
  const props = (Cls && Cls.properties) || {};
  for (const [k, decl] of Object.entries(props)) {
    const d = typeof decl === 'object' && decl !== null ? decl : { type: decl };
    if (d.state) continue;
    if ((d.attribute || hyphenate(k)) === attrName) return { propName: k, def: d };
  }
  return undefined;
}
