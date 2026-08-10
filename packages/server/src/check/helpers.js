import { sep } from 'node:path';
import { matchClosingBrace } from '../js-scan.js';

/**
 * Check whether a file has the `'use server'` directive in its first
 * five lines. Used by the `use-server-needs-extension` rule, and by
 * `isServerActionFile` below.
 * @param {string} content file content (already read)
 * @returns {boolean}
 */
export function hasUseServerDirective(content) {
  const head = content.split('\n').slice(0, 5).join('\n');
  return /^\s*(['"])use server\1\s*;?\s*$/m.test(head);
}

/**
 * Check whether a file is a server action. A server action requires
 * BOTH the `.server.{js,ts,mts,mjs}` extension AND the `'use server'`
 * directive in the file head. Either alone is not enough: bare `.server.ts`
 * is a server-only utility (no RPC), and bare `'use server'` is a lint
 * violation (use-server-needs-extension).
 * @param {string} filePath absolute path
 * @param {string} content file content (already read)
 * @returns {boolean}
 */
export function isServerActionFile(filePath, content) {
  if (!/\.server\.m?[jt]s$/.test(filePath)) return false;
  return hasUseServerDirective(content);
}

/**
 * Check whether a file resides under a components/ directory (shared or
 * module-scoped).
 * @param {string} relPath Path relative to appDir
 * @returns {boolean}
 */
export function isComponentFile(relPath) {
  const segments = relPath.split(sep);
  return segments.includes('components');
}

/**
 * Scan a class body for class-field initializers naming any of `props`.
 * "Class-field" means: at the top of the class body (brace depth 0
 * relative to the body), at the start of a line, NOT prefixed with
 * `declare`, `static`, or `this.`.
 *
 * Returns the offending property names. The caller maps these to
 * Violation objects.
 *
 * @param {string} classBody
 * @param {Set<string>} props
 * @returns {string[]}
 */
/**
 * True when a factory prop value is an array-typed `prop<…>(…)` whose
 * runtime constructor argument is `Object`. The generic and the
 * constructor sit in the same call, so it is decidable from the value
 * text alone. The match is greedy on the generic so a nested generic
 * (`prop<Array<X>>(Object)`) closes at the outer `>` that precedes the
 * `(Object` call. A bare constructor (`Object`, with no generic) or a
 * non-array generic (`prop<Foo>(Object)`) returns false.
 *
 * @param {string} value the raw prop value text, e.g. `prop<Tag[]>(Object)`
 * @returns {boolean}
 */
export function arrayPropUsesObject(value) {
  const m = /^prop\s*<([\s\S]*)>\s*\(\s*Object\s*[,)]/.exec(value.trim());
  if (!m) return false;
  return isArrayTypeText(m[1]);
}

/**
 * True when a TypeScript type expression denotes an array: `T[]`,
 * `readonly T[]`, `T[][]`, `Array<T>`, or `ReadonlyArray<T>`.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function isArrayTypeText(type) {
  const bare = type.trim().replace(/^readonly\s+/, '');
  if (/\[\s*\]$/.test(bare)) return true;
  if (/^(?:Readonly)?Array\s*<[\s\S]*>$/.test(bare)) return true;
  return false;
}

export function findFieldInitializers(classBody, props) {
  /** @type {string[]} */
  const out = [];
  const n = classBody.length;
  // Match class-field declarations. Two shapes:
  // 1. With initializer: `count = 0`, `count: number = 0`, `public count = 0`
  // 2. Type-only (no initializer): `count!: number`, `count?: number`, `count: number`
  // Both compile to Object.defineProperty after super() under modern class-field
  // semantics, clobbering the reactive accessor.
  // The initializer regex: optional modifier, identifier, optional type, then `=`.
  const initRe = /^\s*(?:(public|private|protected|readonly)\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?\s*=\s*[^=>]/;
  // The type-only regex: optional modifier, identifier, then `!:` or `?:` or `:` with a type.
  const typeOnlyRe = /^\s*(?:(public|private|protected|readonly)\s+)?([A-Za-z_$][\w$]*)\s*[!?]?\s*:\s*\S/;
  const examineLine = (lineStart) => {
    let j = lineStart;
    while (j < n && classBody[j] !== '\n') j++;
    const line = classBody.slice(lineStart, j);
    const initM = initRe.exec(line);
    const typeM = typeOnlyRe.exec(line);
    // Prefer the initializer match; if neither, skip.
    const name = initM ? initM[2] : (typeM ? typeM[2] : null);
    // `declare`, `static`, and `this.` patterns shouldn't reach here
    // (declare/static start with their keyword, this.x has the dot in
    // the regex group), but guard against matching keywords as names:
    if (name && name !== 'declare' && name !== 'static' && props.has(name)) out.push(name);
  };
  // Walk the body char by char, tracking brace depth. A class field lives at
  // the class-body top level (depth 0). We examine a line ONCE, at its first
  // non-whitespace char, only while depth is 0, and WITHOUT skipping the braces
  // on that line: an opening brace on the line (`method() {`, `field = {`) must
  // still be counted so the lines inside its block are seen at depth > 0. The
  // earlier version jumped `i` past the whole examined line, which dropped that
  // line's braces and let object-literal keys inside a method body (`{ game:
  // ..., scoreboard: ... }`) be misread as depth-0 class fields (#934).
  let depth = 0;
  let i = 0;
  let lineStart = 0;
  let examined = false;
  let str = '';
  while (i < n) {
    const c = classBody[i];
    if (str) {
      if (c === '\\') { i += 2; continue; }
      if (c === str) str = '';
      i++;
      continue;
    }
    if (c === '\n') { lineStart = i + 1; examined = false; i++; continue; }
    if (c === '/' && classBody[i + 1] === '/') {
      while (i < n && classBody[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && classBody[i + 1] === '*') {
      i += 2;
      while (i < n && !(classBody[i] === '*' && classBody[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { str = c; i++; continue; }
    // First non-whitespace char of a class-body top-level line: examine it for
    // a field declaration BEFORE consuming any brace it opens.
    if (depth === 0 && !examined && !/\s/.test(c)) {
      examined = true;
      examineLine(lineStart);
    }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; continue; }
    i++;
  }
  return out;
}

// Browser-only globals that are undefined during SSR (the server-side
// WebComponent base is a bare class with no DOM). High-confidence names only
// (unlikely to be ordinary local variables), so the rule stays low-noise.
const BROWSER_GLOBALS = [
  'document', 'window', 'localStorage', 'sessionStorage', 'navigator',
  'matchMedia', 'requestAnimationFrame', 'getComputedStyle',
  'IntersectionObserver', 'MutationObserver', 'ResizeObserver',
];

// HTMLElement instance members that do not exist on the server element shim,
// so `this.<member>` throws (a method call) or is `undefined` (a property) at
// SSR. The attribute methods (get/set/has/remove/toggleAttribute), the event
// methods (add/removeEventListener, dispatchEvent), and attachInternals are
// backed by the shim and run server-side, so they are intentionally NOT
// flagged: a component may read attributes in render and reflect properties
// during the SSR update cycle. What stays is the genuinely browser-only
// surface (DOM querying, layout reads, shadow construction, focus).
const HTMLELEMENT_MEMBERS = [
  'attachShadow', 'shadowRoot', 'classList',
  'querySelector', 'querySelectorAll', 'getBoundingClientRect',
  'focus', 'blur', 'scrollIntoView',
];

/**
 * Extract the body text of a named method from a (redacted) class body, or
 * '' if absent. Handles `async`, a TS return-type annotation, and params.
 * @param {string} classBody
 * @param {string} name
 */
export function methodBodyOf(classBody, name) {
  const re = new RegExp(`(?:^|[\\s;}])(?:async\\s+)?${name}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`, 'g');
  const m = re.exec(classBody);
  if (!m) return '';
  const open = classBody.indexOf('{', m.index + m[0].length - 1);
  if (open === -1) return '';
  const close = matchClosingBrace(classBody, open + 1);
  return close === -1 ? '' : classBody.slice(open + 1, close);
}

/**
 * Find browser-only globals and HTMLElement `this.<member>` accesses in a
 * (redacted) method body. Returns one entry per distinct member.
 * @param {string} code
 * @returns {{ member: string, kind: string }[]}
 */
export function findBrowserMemberUses(code) {
  // The class body arrives template-redacted, but `redactStringsAndTemplates`
  // keeps single/double-quoted string CONTENT (real specifiers ride strings).
  // Blank that too so a browser word inside a string literal (e.g. a label
  // `'open the document'`) is not mistaken for a real global access.
  code = code
    .replace(/'(?:[^'\\]|\\.)*'/g, (s) => `'${' '.repeat(Math.max(0, s.length - 2))}'`)
    .replace(/"(?:[^"\\]|\\.)*"/g, (s) => `"${' '.repeat(Math.max(0, s.length - 2))}"`);
  const out = [];
  const seen = new Set();
  const gRe = new RegExp(`(?<![.\\w$])(${BROWSER_GLOBALS.join('|')})\\b`, 'g');
  let m;
  while ((m = gRe.exec(code)) !== null) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ member: m[1], kind: 'a browser global' });
  }
  const hRe = new RegExp(`\\bthis\\.(${HTMLELEMENT_MEMBERS.join('|')})\\b`, 'g');
  while ((m = hRe.exec(code)) !== null) {
    const key = `this.${m[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ member: key, kind: 'an HTMLElement member' });
  }
  return out;
}

/**
 * True if any `export const/let/var` declares more than one binding
 * (`export const a = 1, b = 2`), which the single-name collector would
 * under-count. Depth-aware: a comma inside an initializer (`f(a, b)`, `[a, b]`,
 * `{ a, b }`) does not count, only a top-level comma before the statement end.
 * Bailing the whole module on this errs toward a false negative (safe), never a
 * false positive. Runs on the string/comment-redacted `scan`.
 * @param {string} scan
 * @returns {boolean}
 */
export function hasMultiDeclaratorExport(scan) {
  const re = /\bexport\s+(?:const|let|var)\b/g;
  let m;
  while ((m = re.exec(scan))) {
    let depth = 0;      // () [] {} nesting
    let angle = 0;      // <> generics, tracked ONLY inside a type annotation
    let seenEq = false; // passed this declarator's `=` (now in the initializer)
    let inType = false; // inside a `: Type` annotation (before the `=`)
    for (let i = m.index + m[0].length; i < scan.length; i++) {
      const ch = scan[i];
      if (ch === '(' || ch === '[' || ch === '{') { depth++; continue; }
      if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; continue; }
      if (depth !== 0) continue;
      if (ch === ';') break;
      // A plain `=` ends the type annotation and enters the initializer. `<=`,
      // `>=`, `=>`, `==` are harmless here (seenEq only latches true).
      if (ch === '=') { seenEq = true; inType = false; angle = 0; continue; }
      // A `:` BEFORE the `=` opens the type annotation. A `:` after `=` (a
      // ternary in the initializer) is NOT a type and must not suppress a real
      // declarator comma.
      if (ch === ':' && !seenEq) { inType = true; continue; }
      // Inside a type annotation `<` / `>` are generic delimiters (a comparison
      // only appears in the initializer, after `=`). Track their depth so a
      // generic's comma (`Map<string, number>`) is skipped while a real
      // declarator comma (`a: number, b: number`) still counts. A `>` that is
      // part of a `=>` function-type arrow is not a generic close.
      if (inType && ch === '<') { angle++; continue; }
      if (inType && ch === '>' && scan[i - 1] !== '=') { if (angle > 0) angle--; continue; }
      // A top-level comma starts a second declarator UNLESS it is a generic's
      // comma inside a type annotation.
      if (ch === ',' && !(inType && angle > 0)) return true;
    }
  }
  return false;
}

/**
 * Enumerate a module's provable named exports from its redacted `scan`, for the
 * `no-missing-local-import` rule. Returns `null` when the export list is NOT
 * fully enumerable (a `export *` star re-export, a destructuring export, or a
 * multi-declarator `export const a = .., b = ..`), which tells the rule to treat
 * the module as unknowable and flag nothing from it. Otherwise returns the set
 * of exported names (the alias after `as` for a clause, and type/interface/enum
 * names too, so a value import of a type is not falsely flagged; tsc owns that).
 * @param {string} scan  string/template/comment-redacted source
 * @returns {Set<string>|null}
 */
export function enumerableExports(scan) {
  // Unknowable export shapes: bail so the rule never false-positives.
  if (/\bexport\s*\*/.test(scan)) return null;                       // export * from
  if (/\bexport\s+(?:const|let|var)\s*[{[]/.test(scan)) return null; // destructuring export
  if (hasMultiDeclaratorExport(scan)) return null;                   // export const a=1, b=2
  const names = new Set();
  let m;
  const collect = (re) => { while ((m = re.exec(scan))) names.add(m[1]); };
  collect(/\bexport\s+(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)/g);
  collect(/\bexport\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g);
  collect(/\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
  collect(/\bexport\s+(?:type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)/g);
  // A named-default import (`import { default as Foo }`) is legal against an
  // `export default` module, so record the `default` name when present.
  if (/\bexport\s+default\b/.test(scan)) names.add('default');
  // `export { a, b as c }` / `export type { ... }` / `export { x } from '...'`:
  // the EXPORTED name is the alias after `as`, else the bare name.
  const reClause = /\bexport\s+(?:type\s+)?\{([^}]*)\}/g;
  while ((m = reClause.exec(scan))) {
    for (let part of m[1].split(',')) {
      part = part.trim().replace(/^type\s+/, '');
      if (!part) continue;
      const name = part.split(/\s+as\s+/).pop().trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * The NAMED VALUE names a single `import { ... } from` clause pulls in, for the
 * `no-missing-local-import` rule. Returns `null` for an `import type { ... }`
 * (all type, skip), and `[]` for a default / namespace / side-effect import
 * (nothing named to verify). A per-specifier inline `type` marker is dropped,
 * and for `a as b` the IMPORTED name is `a` (what the target must export).
 * @param {string} clause  the text between `import` and `from`
 * @returns {string[]|null}
 */
/**
 * The `{ local, imported }` pairs a named import clause binds, for a rule that
 * has to match the LOCAL name against code (`action=${reader}`) while reporting
 * the IMPORTED one (`readIt`, which is what the target module calls it).
 *
 * `importedValueNames` cannot serve here: it returns only the imported side,
 * which is the wrong name to match against a template hole under `as`.
 *
 * @param {string} clause  the text between `import` and `from`
 * @returns {{ local: string, imported: string }[]}
 */
export function importedLocalNames(clause) {
  if (/^\s*type\b/.test(clause)) return [];
  const brace = clause.match(/\{([^}]*)\}/);
  if (!brace) return [];
  /** @type {{ local: string, imported: string }[]} */
  const out = [];
  for (const part of brace[1].split(',')) {
    const seg = part.trim().replace(/^type\s+/, '');
    if (!seg) continue;
    const as = seg.split(/\s+as\s+/);
    const imported = as[0].trim();
    const local = (as[1] || as[0]).trim();
    if (/^[A-Za-z_$][\w$]*$/.test(local) && /^[A-Za-z_$][\w$]*$/.test(imported)) {
      out.push({ local, imported });
    }
  }
  return out;
}

export function importedValueNames(clause) {
  if (/^\s*type\b/.test(clause)) return null; // import type { ... }
  const brace = clause.match(/\{([^}]*)\}/);
  if (!brace) return []; // default / namespace only
  return brace[1].split(',')
    .map((s) => s.trim())
    .filter((s) => s && !/^type\s/.test(s))
    .map((s) => s.split(/\s+as\s+/)[0].trim())
    .filter((n) => /^[A-Za-z_$][\w$]*$/.test(n));
}
