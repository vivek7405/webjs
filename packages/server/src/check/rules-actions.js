/**
 * Server-action rules: where `'use server'` is honoured, what its exports must
 * look like, and what a configured action file may contain.
 *
 * Lifted verbatim out of checkConventions, which held all twenty rules inline
 * in one 900-line function. Each rule keeps its original comment header, its
 * logic, and its position in the run order.
 */
import { join, basename } from 'node:path';
import { RESERVED_CONFIG } from '../action-config.js';
import {
  hasUseServerDirective,
} from './helpers.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 * @typedef {{ abs: string, rel: string, content: string, scan: string }} ScannedFile
 */


/**
 * Rule: `use-server-needs-extension`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkUseServerNeedsExtension(files, violations) {
  // --- Rule: use-server-needs-extension ---
  // Catch files that declare `'use server'` at the top but lack the
  // `.server.{js,ts}` extension. Under the two-marker convention the
  // directive alone does nothing (the file is served to the browser as
  // plain source and exports are not registered as RPC), which is a
  // silent footgun. The fix is mechanical: rename the file.
  {
    for (const { rel, content } of files) {
      if (!hasUseServerDirective(content)) continue;
      if (/\.server\.m?[jt]s$/.test(rel)) continue; // OK: has both markers
      const fileBase = basename(rel);
      const renamedBase = fileBase.replace(/\.(m?[jt]sx?)$/, '.server.$1');
      violations.push({
        rule: 'use-server-needs-extension',
        file: rel,
        message:
          "File declares `'use server'` but its name does not match `.server.{js,ts,mts,mjs}`. The directive is silently ignored: the file is served to the browser as plain source and its exports are not RPC-callable. Code the developer expects to run on the server actually runs in the browser.",
        fix: `Rename to ${renamedBase} (add the .server. infix before the extension)`,
      });
    }
  }
}

/**
 * Rule: `use-server-exports-callable`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkUseServerExportsCallable(files, violations) {
  // --- Rule: use-server-exports-callable (#464) ---
  // A `.server.{js,ts}` file with the `'use server'` directive registers only
  // its FUNCTION exports as RPC actions (the registrar checks `typeof === 'function'`).
  // A file that declares the directive but exports no callable registers nothing,
  // silently: the developer thinks they exposed an action, and the only signal is
  // a 404 / undefined at the first call site. Flag it. The complement of
  // use-server-needs-extension (the directive without the extension) and of
  // one-action-per-configured-file (more than one action).
  {
    for (const { rel, content, scan } of files) {
      // Only properly-marked action files (the extension boundary). A `'use
      // server'` file WITHOUT the .server. extension is the use-server-needs-
      // extension rule's job; do not double-flag it here.
      if (!/\.server\.m?[jt]s$/.test(rel)) continue;
      if (!hasUseServerDirective(content)) continue;
      // Count function-shaped EXPORTED callables, the SAME way the action
      // registrar sees them: function declarations + arrow / function-expression
      // consts (with an optional `: Type` annotation, #495). Reserved verb-config
      // names (method/cache/...) are config, never a callable action.
      const names = new Set();
      let m;
      const reFn = /\bexport\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
      while ((m = reFn.exec(scan))) names.add(m[1]);
      const reArrow = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::(?:[^=]|=>)*?)?=(?!>)\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
      while ((m = reArrow.exec(scan))) names.add(m[1]);
      const callables = [...names].filter((n) => !RESERVED_CONFIG.has(n));
      if (callables.length > 0) continue; // exports at least one callable -> fine
      // A default export is assumed callable (an action commonly default-exports).
      if (/\bexport\s+default\b/.test(scan)) continue;
      // Conservative, avoid a FALSE POSITIVE: the runtime registrar
      // (`actionFunctionNames`) keeps EVERY export whose value is a function at
      // load time, regardless of the export syntax, so any export shape these
      // patterns cannot prove is non-callable must NOT be flagged. Skip when the
      // file has:
      //   - a named-export clause `export { a, b as c }` (with or WITHOUT `from`):
      //     it can surface a local function (`function getX(){}; export { getX }`)
      //     or a re-exported / imported function, neither matched above;
      //   - a star re-export `export * from ...`;
      //   - a destructuring export `export const { x } = obj` / `export const [x] = arr`,
      //     which may bind a function;
      //   - an `export const NAME = <identifier-or-call>`, a factory-produced
      //     function (`export const get = cache(fetch)`).
      // A sole `export { aConst }` of a non-function is then a tolerated FALSE
      // NEGATIVE, which is the right bias for a non-overridable correctness rule.
      if (/\bexport\s*\{/.test(scan)) continue;
      if (/\bexport\s*\*/.test(scan)) continue;
      if (/\bexport\s+(?:const|let|var)\s*[{[]/.test(scan)) continue;
      // A factory / identifier-valued const could be a callable ACTION, so skip,
      // BUT only when its name is NOT a reserved config key: the registrar
      // excludes reserved names from actions (`actionFunctionNames`), so a file
      // whose only ambiguous const is `validate` / `tags` / ... (config produced
      // by an arrow or a factory) still has zero actions and must flag. Skip only
      // for a NON-reserved ambiguous const (a real possible action).
      const reFactory = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::(?:[^=]|=>)*?)?=\s*[A-Za-z_$(]/g;
      let ambiguousAction = false;
      while ((m = reFactory.exec(scan))) { if (!RESERVED_CONFIG.has(m[1])) { ambiguousAction = true; break; } }
      if (ambiguousAction) continue;
      // Every export is provably non-callable (a literal const, a type) or there
      // are none: the directive exposes nothing.
      violations.push({
        rule: 'use-server-exports-callable',
        file: rel,
        message:
          "File declares `'use server'` but exports no callable action. The `'use server'` directive registers FUNCTION exports as RPC-callable; a file exporting only a non-function (a `const` / a type / only verb config) registers nothing, so a client import resolves to nothing and the call 404s.",
        fix: "Export an `async function` action from this file, or remove the `'use server'` directive if it is a plain server-only utility.",
      });
    }
  }
}

/**
 * Rule: `one-action-per-configured-file`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkOneActionPerConfiguredFile(files, violations) {
  // --- Rule: one-action-per-configured-file (#488) ---
  // A `'use server'` file that declares HTTP-verb config (method/cache/tags/
  // invalidates/validate) must export exactly one callable action; the config
  // is file-level, so a second exported function would silently inherit it.
  {
    for (const { rel, content, scan } of files) {
      if (!/\.server\.m?[jt]s$/.test(rel)) continue;
      if (!hasUseServerDirective(content)) continue;
      if (!/\bexport\s+const\s+(?:method|cache|tags|invalidates|validate|middleware)\b/.test(scan)) continue;
      const names = new Set();
      let m;
      const reFn = /\bexport\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
      while ((m = reFn.exec(scan))) names.add(m[1]);
      // An arrow-const action: `export const x = (...) => ...`, the paren-less
      // `export const x = id => ...`, or a function expression. The `=>` /
      // `function` anchor keeps a plain `export const N = 5` from counting.
      // An OPTIONAL `: Type` annotation may sit between the name and the `=`
      // (#495); the type itself can contain a function-type `=>`, so the
      // annotation matcher consumes any non-`=` char OR a literal `=>`, and the
      // assignment is the first `=` NOT followed by `>` (`=(?!>)`). The
      // alternation is unambiguous at each position (a `=` can only start `=>`),
      // so there is no catastrophic backtracking.
      const reArrow = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::(?:[^=]|=>)*?)?=(?!>)\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
      while ((m = reArrow.exec(scan))) names.add(m[1]);
      if (/\bexport\s+default\b/.test(scan)) names.add('default');
      const actions = [...names].filter((n) => !RESERVED_CONFIG.has(n));
      if (actions.length > 1) {
        violations.push({
          rule: 'one-action-per-configured-file',
          file: rel,
          message: `Configured action file exports ${actions.length} callable functions (${actions.join(', ')}); the verb/cache config is file-level, so only one action per file is allowed.`,
          fix: 'Move the extra function to its own .server.{js,ts} file, or keep it private (do not export it).',
        });
      }
    }
  }
}
