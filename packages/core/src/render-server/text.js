import NAMED_ENTITIES, { LEGACY_NAMES } from '../html-entities.js';

/**
 * Name-case conversion and HTML character-reference decoding.
 *
 * A leaf like `html-scan.js`, and for the same reason: `template-renderer.js`
 * needs `kebabCase` to serialize property-binding names, and taking it from
 * here rather than from `dsd.js` is half of what keeps the two acyclic.
 */

/** @param {string} s */
export function camelCase(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Inverse of camelCase. `userName` -> `user-name`, `userID` -> `user-i-d`.
 * Used to serialize property-binding names into HTML attribute names,
 * which are case-insensitive in the parser. The original JS property
 * name is recovered via camelCase() on the consumer side.
 *
 * @param {string} s
 */
export function kebabCase(s) {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** windows-1252 mappings the HTML tokenizer applies to the C1 range. */
const C1_REPLACEMENTS = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
};

// The trailing `;` is OPTIONAL on the named arm, because a browser decodes a
// legacy semicolon-less reference too. The callback decides which of the two
// forms it has; see `decodeNamed`.
const CHAR_REF = /&(?:#(\d+);?|#[xX]([0-9a-fA-F]+);?|([a-zA-Z][a-zA-Z0-9]*)(;?))/g;
// A Map, not the imported object, so a name that collides with something on
// `Object.prototype` misses instead of returning a function. See `decodeNamed`.
const NAMED = new Map(Object.entries(NAMED_ENTITIES));
const LEGACY = new Set(LEGACY_NAMES);

/**
 * Decode HTML character references in an attribute value.
 *
 * `parseAttrs` hands back the literal characters between the quote marks, so
 * nothing has decoded them yet, while a browser decodes EVERY reference before
 * any reader sees the value. This closes that gap (#1341): the full WHATWG
 * named table plus decimal and hexadecimal numeric references, with the
 * tokenizer's own numeric fix-ups (null, a surrogate, and anything past
 * U+10FFFF become U+FFFD; the C1 range maps through windows-1252). It replaced
 * a three-entity `unescapeAttr`, which left a `String`-typed prop undecoded
 * entirely and turned `&lt;script&gt;` into the half-decoded `<script&gt;`.
 *
 * SINGLE PASS on purpose. A replacement is never rescanned, so `&amp;lt;`
 * decodes to the literal `&lt;` and never to `<`. The old function got that
 * from replacing `&amp;` last, which does not generalise past three entities.
 *
 * The 106 legacy semicolon-LESS names are covered too, because a browser really
 * does decode them and measurably: Chromium, Firefox, and WebKit all hand a
 * reader U+00A0 for `s="&nbsp"`. Leaving them literal would have been a value
 * divergence of exactly the kind this function exists to remove, not a
 * harmless non-goal. The rule that governs them, in an ATTRIBUTE value, is a
 * one-character LOOKAHEAD rather than deep tokenizer state, which is why it is
 * implementable here. `decodeNamed` carries the rule and the reason it takes
 * the shape it does; the short version is that `&nbsp` at the end of a value
 * decodes while `&nbspx`, `&nbsp=x`, and `&notin` stay literal, all three
 * verified against the three engines.
 *
 * The same function also decodes `data-webjs-fallback`, which is MARKUP, where
 * the tokenizer applies no such carve-out. Using the attribute rule there is
 * deliberate and strictly conservative: that payload is written by
 * `escapeAttr`, which emits only `&amp;` / `&quot;` / `&lt;`, so every
 * reference in it is semicolon-terminated and never reaches this path.
 *
 * @param {string} s
 * @returns {string}
 */
export function decodeAttrEntities(s) {
  // Load bearing, not a micro-optimisation: skipping the scan for the common
  // no-`&` value is what makes this cheaper per attribute than the three
  // chained `replace` calls it replaced, which paid for three passes always.
  if (s.indexOf('&') === -1) return s;
  return s.replace(CHAR_REF, (match, dec, hex, name, semi, offset) => {
    if (dec !== undefined) return fromCodePoint(parseInt(dec, 10));
    if (hex !== undefined) return fromCodePoint(parseInt(hex, 16));
    return decodeNamed(match, name, semi === ';', s[offset + match.length]);
  });
}

/**
 * Resolve one named reference, semicolon-terminated or legacy.
 *
 * The table is read through a `Map` rather than by indexing the imported
 * object. An object-literal lookup resolves through `Object.prototype`, so
 * `&constructor;` / `&toString;` / `&hasOwnProperty;` and four more returned a
 * FUNCTION instead of `undefined` and threw on the spread in
 * `codePointsToString`, a path `seedServerAttrs` reaches for every attribute of
 * every custom element, which rendered the whole component as an SSR error box.
 * A browser leaves those literal, since they are not named references, so the
 * throw was a divergence of exactly the kind this file exists to remove. A
 * `Map` has no prototype chain to fall through, which closes the shape rather
 * than guarding one call site.
 *
 * WHY THERE IS NO LONGEST-PREFIX LOOP. The tokenizer consumes the longest name
 * in the table, so `&notin` is `&not` followed by `in`. Here that always
 * collapses to the whole name: `CHAR_REF` captures `[a-zA-Z][a-zA-Z0-9]*`, so a
 * prefix SHORTER than the name is by construction followed by an ASCII
 * alphanumeric, which is precisely when the attribute carve-out declines to
 * decode. A loop over shorter prefixes could therefore only ever return
 * `match`, which is what falling through to the end already does. `&notin`
 * stays literal either way, verified against the three engines, though note it
 * gets there by not being a legacy name rather than by the carve-out.
 *
 * That same greediness means an ASCII alphanumeric character can never follow
 * the match: whatever follows is by construction not `[a-zA-Z0-9]`, or the
 * capture would have eaten it. So only the `=` check is needed for the
 * attribute carve-out. `&nbspx` is literal because `nbspx` is not a legacy
 * name, NOT because of the lookahead; `&nbsp=x` is the shape the lookahead
 * actually decides.
 *
 * @param {string} match  the whole matched reference, returned unchanged when nothing decodes
 * @param {string} name   the name, with no `&` and no `;`
 * @param {boolean} hadSemi
 * @param {string|undefined} nextChar  the character after the match, if any
 * @returns {string}
 */
export function decodeNamed(match, name, hadSemi, nextChar) {
  if (hadSemi) {
    const cp = NAMED.get(name);
    return cp === undefined ? match : codePointsToString(cp);
  }
  if (!LEGACY.has(name)) return match;
  // The attribute carve-out: a legacy name decodes only when what follows is
  // neither `=` nor an ASCII alphanumeric. Nothing following at all (the end of
  // the value) decodes, which is the common `s="&nbsp"` shape. Because CHAR_REF
  // captures greedily, what follows is never an ASCII alphanumeric, so only `=`
  // needs to be checked here.
  if (nextChar === '=') return match;
  // Every legacy name is in the table under the same name, asserted by a test
  // rather than left to trust, so this cannot miss.
  return codePointsToString(NAMED.get(name));
}

/** @param {number|number[]} cp */
export function codePointsToString(cp) {
  return typeof cp === 'number' ? String.fromCodePoint(cp) : String.fromCodePoint(...cp);
}

/**
 * The tokenizer's numeric character reference fix-ups.
 * @param {number} n
 * @returns {string}
 */
export function fromCodePoint(n) {
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\uFFFD';
  if (C1_REPLACEMENTS[n] !== undefined) return String.fromCodePoint(C1_REPLACEMENTS[n]);
  return String.fromCodePoint(n);
}
