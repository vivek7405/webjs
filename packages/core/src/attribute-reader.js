/**
 * THE attribute reader, singular.
 *
 * `attributeChangedCallback` in `component.js` and `applyAttrsToInstance` in
 * `render-server.js` are both thin callers of the one function below, so the
 * client and the SSR pass cannot drift on precedence or on a fallback again.
 * They had drifted twice before it existed: the unparseable-JSON fallback
 * (#1253) and a missing converter arm (#1340).
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
 * The caller owns NAME resolution (which attribute maps to which property) and
 * declaration normalisation; this function owns only the value. That split is
 * deliberate: the two callers reach an attribute by different routes and do NOT
 * see the same attribute set, which is a separate problem tracked in #1341.
 *
 * @param {import('./component.js').PropertyDeclaration} def normalised declaration (`{ type, … }`)
 * @param {string|null} value the attribute text
 * @param {(s: string) => string} [decode] applied to the branches that PARSE
 *   their input: the JSON branch and the converter branch. The client is handed
 *   a value the DOM already decoded and passes nothing; the SSR reader walks the
 *   raw source tag and passes `unescapeAttr`. The JSON branch is where the SSR
 *   reader applied it before this function existed, so that branch is unchanged;
 *   the converter branch is new and needs it for the same reason, since handing
 *   a parsing converter entity-encoded text is exactly the divergence this
 *   function removes. The pass-through branches (String, Number, Boolean) are
 *   deliberately untouched: they see the raw text at SSR today, and whether the
 *   decode should reach them, and whether three entities is enough, are #1341's
 *   questions.
 * @returns {unknown}
 */
export function readAttributeValue(def, value, decode) {
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
    // The converter is handed DECODED text, which is why `decode` applies here
    // as well as to the JSON branch. The client's value came out of the DOM,
    // which already decoded it, while the SSR reader walks the raw source tag
    // and gets the literal characters between the quotes. Hand those straight
    // to a converter and the two sides read the SAME attribute differently the
    // moment it carries a quote or an ampersand, which is the divergence this
    // whole function exists to remove. It also fails LOUDLY rather than
    // subtly: the documented reason to write a converter is a type the built-in
    // ones cannot parse (Date, Map, Set), those parse their input, and
    // `escapeAttr` encodes every `"` in an emitted attribute, so an encoded
    // `{&quot;a&quot;:1}` throws inside the author's converter and (since the
    // throw is deliberately uncaught) renders an empty component at a 200.
    //
    // `unescapeAttr` reverses exactly the three entities `escapeAttr` writes,
    // so for any attribute WebJs itself emitted this is an exact round trip.
    // Hand-written markup carrying some OTHER entity still reaches the two
    // readers differently, which is the pre-existing gap #1341 owns; this line
    // does not widen it, and does not touch the type branches below.
    return def.converter.fromAttribute(decode && value != null ? decode(value) : value, def.type);
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
    // This is about the FALLBACK, not a guarantee that the two readers see the
    // same attributes in the first place. They reach an attribute by different
    // routes (the client via `observedAttributes` and the browser's own name
    // lowercasing, the SSR one by walking the parsed source tag), and
    // hand-written markup can land in the gaps between those routes. Those gaps
    // are tracked in #1341 and are not enumerated here.
    if (value == null) return null;
    try { return JSON.parse(decode ? decode(value) : value); } catch { return null; }
  }
  return value;
}
