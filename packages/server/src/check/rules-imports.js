/**
 * Import-graph rules: what a browser-bound module may reach, whether a local
 * specifier resolves, and whether a bound form action can answer a POST.
 *
 * Lifted verbatim out of checkConventions, which held all twenty rules inline
 * in one 900-line function. Each rule keeps its original comment header, its
 * logic, and its position in the run order.
 */
import { relative } from 'node:path';
import {
  redactStringsAndTemplates, redactToPlaceholders, classifyActionHole,
} from '../js-scan.js';
import { resolveImport } from '../module-graph.js';
import {
  hasUseServerDirective, enumerableExports, importedLocalNames, importedValueNames,
} from './helpers.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 * @typedef {{ abs: string, rel: string, content: string, scan: string }} ScannedFile
 */

/**
 * Rule: `no-missing-local-import`.
 *
 * @param {string} appDir  absolute path to the app root
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkNoMissingLocalImport(appDir, files, violations) {
  // --- Rule: no-missing-local-import ---
  // A named value import of a symbol an app-internal module does not export is a
  // runtime crash (the binding is undefined) that the elision-based checks miss,
  // so `check` can stay green while `typecheck` is red (a dropped schema table
  // orphaning a gallery module is the motivating dogfood case). Conservative by
  // construction: only app-internal specifiers resolving to a known app file,
  // only named value imports, and only when the target's exports are fully
  // enumerable (see enumerableExports / importedValueNames).
  {
    // Fully-blanked view (blankStrings=true): string AND template AND comment
    // bodies blank to spaces, position-preserving. The default `scan` keeps
    // plain-string bodies VERBATIM (so callers can read `register('tag')`),
    // which would let an `import`/`export` inside a string be matched, so use
    // the fully-blanked view for both the export map and the import scan. The
    // real specifier is read back from `content` at the same (length-preserved)
    // offset.
    const maskedByAbs = new Map();
    for (const f of files) maskedByAbs.set(f.abs, redactStringsAndTemplates(f.content, true));
    const exportsByAbs = new Map();
    for (const f of files) exportsByAbs.set(f.abs, enumerableExports(maskedByAbs.get(f.abs)));
    // `import\s+` excludes `import.meta` and a dynamic `import(`. The clause is
    // `[^'";]*?` so it cannot swallow a side-effect `import '...'` (its quote) or
    // bridge across a `;` into the next statement's `from`.
    const reImport = /\bimport\s+([^'";]*?)\bfrom\s*(['"])/g;
    for (const { abs, rel, content } of files) {
      const masked = maskedByAbs.get(abs);
      reImport.lastIndex = 0;
      let m;
      while ((m = reImport.exec(masked))) {
        const quote = m[2];
        const specStart = reImport.lastIndex;           // just past the opening quote
        const specEnd = content.indexOf(quote, specStart);
        if (specEnd < 0) continue;
        const spec = content.slice(specStart, specEnd);
        if (!/^(?:\.|#)/.test(spec)) continue; // app-internal only (relative or #alias)
        const names = importedValueNames(m[1]);
        if (!names || names.length === 0) continue;
        const target = resolveImport(spec, abs, appDir);
        const exp = exportsByAbs.get(target);
        if (exp == null) continue; // not an app file, or exports not enumerable
        for (const name of names) {
          if (exp.has(name)) continue;
          violations.push({
            rule: 'no-missing-local-import',
            file: rel,
            message: `Imports \`${name}\` from \`${spec}\`, but that module does not export \`${name}\`. The binding is undefined at runtime and crashes on first use (often a renamed or removed export, e.g. a dropped schema table).`,
            fix: `Add \`${name}\` to \`${spec}\`, correct the imported name, or remove the import.`,
          });
        }
      }
    }
  }
}

/**
 * Rule: `form-action-not-a-get-action`.
 *
 * @param {string} appDir  absolute path to the app root
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkFormActionNotAGetAction(appDir, files, violations) {
  // --- Rule: form-action-not-a-get-action (#1155) ---
  // `<form action=${fn}>` binds a server action to a POST submission. An action
  // declaring `method = 'GET'` cannot serve one: it is CSRF-exempt and takes its
  // args in the url, so the dispatcher answers 405. Catch it at edit time.
  {
    // A `'use server'` file's declared method, or absent when it declares none.
    const methodByAbs = new Map();
    for (const f of files) {
      if (!/\.server\.m?[jt]s$/.test(f.rel)) continue;
      if (!hasUseServerDirective(f.content)) continue;
      const m = /\bexport\s+const\s+method\s*(?::[^=]*)?=\s*['"`]([A-Za-z]+)['"`]/.exec(f.scan);
      if (m) methodByAbs.set(f.abs, m[1].toUpperCase());
    }
    if (methodByAbs.size) {
      const reImport = /\bimport\s+([^'";]*?)\bfrom\s*(['"])/g;
      for (const { abs, rel, content } of files) {
        // PLACEHOLDER redaction, not either mask, and the choice is forced.
        // The default mask blanks a tagged template outright, so a real
        // `html`<form action=${fn}>`` disappears and the rule could never fire;
        // the fully-blanked mask does the same. Placeholder mode keeps `${...}`
        // holes as REAL code while turning each literal BODY into one opaque
        // `__STR_n__` token, so a live binding is readable and a `<form
        // action=${x}>` shown as text inside a docs sample is a single token
        // with no hole in it. That distinction is the whole carve-out: the
        // framework's own website renders this exact shape as a code sample.
        const { redacted, literals } = redactToPlaceholders(content);
        // Both binding shapes count the same here: `action=` on a `<form>`
        // (#1155) and `formaction=` on a `<button>` / `<input>` submitter
        // (#1207) each put the named action behind a form submission, and a
        // GET-declared action cannot serve either. `classifyActionHole` owns
        // the tag-and-attribute pairing (js-scan.js).
        const bound = new Set();
        for (const m of redacted.matchAll(/__STR_(\d+)__\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
          if (!classifyActionHole(literals[Number(m[1])] || '')) continue;
          bound.add(m[2]);
        }
        if (!bound.size) continue;
        reImport.lastIndex = 0;
        let im;
        while ((im = reImport.exec(redacted))) {
          // The specifier is a placeholder token in this view, so read the real
          // one back out of `literals`.
          const tok = /__STR_(\d+)__/.exec(redacted.slice(reImport.lastIndex, reImport.lastIndex + 24));
          if (!tok) continue;
          const spec = literals[Number(tok[1])] || '';
          if (!/^(?:\.|#)/.test(spec)) continue;
          const names = importedLocalNames(im[1]);
          if (!names.length) continue;
          const target = resolveImport(spec, abs, appDir);
          // ONLY a GET is contradictory, and the rule must say exactly what the
          // dispatcher does or it is a false positive. A browser form always
          // submits as a POST, and the dispatcher runs a PUT / PATCH / DELETE
          // action on that POST: the declared verb governs the RPC transport,
          // not whether the function can serve a form. A GET is different in
          // kind (CSRF-exempt, args in the url, no body), which is why it is
          // the one the dispatcher answers with a 405.
          const method = target ? methodByAbs.get(target) : undefined;
          if (method !== 'GET') continue;
          for (const { local, imported } of names) {
            if (!bound.has(local)) continue;
            violations.push({
              rule: 'form-action-not-a-get-action',
              file: rel,
              message: `Binds \`${imported}\` to a form, but \`${spec}\` declares \`method = 'GET'\`. A GET action rides its arguments in the url and skips the CSRF check, so it cannot answer a form POST; the submission is a 405.`,
              fix: `Drop the \`method\` export from \`${spec}\` (an action with no method is a POST, which is what a form submits), or bind an action that takes a POST.`,
            });
          }
        }
      }
    }
  }
}
