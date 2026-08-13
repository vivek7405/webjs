/**
 * TypeScript rules. WebJs strips types rather than compiling them, so
 * non-erasable syntax is a 500 at strip time, not a build error.
 *
 * Lifted verbatim out of checkConventions, which held all twenty rules inline
 * in one 900-line function. Each rule keeps its original comment header, its
 * logic, and its position in the run order.
 */
import { readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { walk } from '../fs-walk.js';
import {
  redactStringsAndTemplates,
} from '../js-scan.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 * @typedef {{ abs: string, rel: string, content: string, scan: string }} ScannedFile
 */


/**
 * Rule: `erasable-typescript-only`.
 *
 * @param {string} appDir  absolute path to the app root
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {Promise<void>}
 */
export async function checkErasableTypescriptOnly(appDir, violations) {
  // --- Rule: erasable-typescript-only ---
  // The dev server's type-stripper is Node's built-in
  // module.stripTypeScriptTypes, which rejects non-erasable TS (enum,
  // namespace with values, constructor parameter properties, legacy
  // decorators, `import = require`). There is no fallback: non-erasable
  // syntax is rejected at request time with a 500. Enforce TS-side
  // rejection of those patterns via `compilerOptions.erasableSyntaxOnly:
  // true` in tsconfig.json so violations surface as red squiggles in
  // the editor before they ever hit the dev server. The companion
  // no-non-erasable-typescript rule (below) catches violations even if
  // the tsconfig flag is unset.
  {
    let tsconfigContent = null;
    try {
      tsconfigContent = await readFile(join(appDir, 'tsconfig.json'), 'utf8');
    } catch {
      // No tsconfig.json (pure JS app). Skip the rule.
    }
    if (tsconfigContent != null) {
      let parsed = null;
      try {
        const stripped = tsconfigContent
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/,(\s*[}\]])/g, '$1');
        parsed = JSON.parse(stripped);
      } catch {
        parsed = null;
      }
      const compilerOptions = parsed && typeof parsed === 'object' ? parsed.compilerOptions : null;
      const flag = compilerOptions && typeof compilerOptions === 'object' ? compilerOptions.erasableSyntaxOnly : undefined;
      if (flag !== true) {
        violations.push({
          rule: 'erasable-typescript-only',
          file: 'tsconfig.json',
          message:
            flag === false
              ? '`compilerOptions.erasableSyntaxOnly` is `false`. The framework strips TypeScript via Node\'s built-in stripper, which only supports erasable TS. Non-erasable syntax (enum, namespace with values, constructor parameter properties, legacy decorators) fails at strip time and the dev server returns a 500. webjs is buildless end-to-end and has no bundler fallback; turn the flag on so the TypeScript compiler catches non-erasable constructs as red squiggles at edit time.'
              : '`compilerOptions.erasableSyntaxOnly` is not set. The framework strips TypeScript via Node\'s built-in stripper, which only supports erasable TS. Setting this flag makes the TypeScript compiler flag non-erasable syntax as a red squiggle in the editor instead of letting it silently slip through to a 500 at runtime.',
          fix:
            'Set `"erasableSyntaxOnly": true` under `compilerOptions` in tsconfig.json. Replace any existing `enum` declarations with `const X = { ... } as const` plus a `type X = typeof X[keyof typeof X]` union. Replace constructor parameter properties with explicit field declarations + assignments.',
        });
      }
    }
  }
}

/**
 * Rule: `no-non-erasable-typescript`.
 *
 * @param {string} appDir  absolute path to the app root
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {Promise<void>}
 */
export async function checkNoNonErasableTypescript(appDir, violations) {
  // --- Rule: no-non-erasable-typescript ---
  // Scans .ts source for the four non-erasable TypeScript constructs
  // that the runtime stripper rejects. Complement to
  // erasable-typescript-only: the flag check catches the case where
  // the user opts into the tsconfig flag; this scan catches the
  // case where the flag is missing OR the user has bypassed it and
  // written offending syntax anyway. Both rules ship enabled by
  // default so violators get the strongest signal possible.
  {
    /** @type {Array<{ name: string, regex: RegExp, fix: string }>} */
    const NON_ERASABLE_PATTERNS = [
      {
        name: 'enum',
        // Matches `enum X {`, `export enum X {`, `const enum X {`,
        // `declare enum X {`. Requires uppercase first letter on the
        // identifier to avoid matching variables literally named "enum"
        // in user code (rare but possible).
        regex: /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:const[ \t]+)?enum[ \t]+[A-Z]\w*[ \t]*\{/m,
        fix: 'Replace `enum Foo { A, B }` with `const Foo = { A: "A", B: "B" } as const; type Foo = typeof Foo[keyof typeof Foo];`.',
      },
      {
        name: 'namespace with values',
        // Matches `namespace Foo { ... <value statement> ... }` at top
        // level. Type-only namespaces (which ARE erasable) won't contain
        // `let|const|var|function|class` as statements, so this catches
        // only the value-carrying form. False positives possible for
        // type-only namespaces that contain those words in type aliases;
        // accept this as a soft warning.
        regex: /^[ \t]*(?:export[ \t]+)?namespace[ \t]+\w+[ \t]*\{[\s\S]*?\b(?:let|const|var|function|class)\b/m,
        fix: 'Replace `namespace Foo { export const x = 1 }` with `export const Foo = { x: 1 } as const;` or split the contents into separate modules.',
      },
      {
        name: 'constructor parameter property',
        // Matches `constructor(public x: T)`, `constructor(private foo, ...)`,
        // `constructor(readonly bar)`. Looks for one of the four access
        // modifiers immediately followed by an identifier inside the
        // constructor's parameter list.
        regex: /constructor[ \t]*\([^)]*\b(?:public|private|protected|readonly)[ \t]+\w+/,
        fix: 'Replace `constructor(public x: number)` with `x: number; constructor(x: number) { this.x = x; }`.',
      },
      {
        name: 'import = require',
        // TypeScript-style CommonJS import. Catches `import foo =
        // require("bar")` and `export import foo = require("bar")`.
        regex: /^[ \t]*(?:export[ \t]+)?import[ \t]+\w+[ \t]*=[ \t]*require[ \t]*\(/m,
        fix: 'Replace `import foo = require("bar")` with `import * as foo from "bar"` or `import { something } from "bar"`.',
      },
    ];

    // Walk every .ts / .mts file under appDir, skipping node_modules,
    // build outputs, version control, and the framework's own private
    // folders. Match the conventional excludes that fs-walk.js's caller
    // contract expects.
    for await (const abs of walk(appDir, (p) => /\.m?ts$/.test(p))) {
      // Skip anything inside node_modules or common build / cache dirs.
      const relPath = relative(appDir, abs);
      if (
        relPath.includes('node_modules' + sep) ||
        relPath.startsWith('dist' + sep) ||
        relPath.startsWith('build' + sep) ||
        relPath.startsWith('.next' + sep) ||
        relPath.startsWith('.git' + sep) ||
        relPath.split(sep).some((s) => s.startsWith('_'))
      ) {
        continue;
      }
      let content;
      try {
        content = await readFile(abs, 'utf8');
      } catch {
        continue;
      }
      // Redact comments, string contents, and template-literal bodies
      // so docs-page code examples like `<pre>enum Direction { ... }</pre>`
      // inside `html\`...\`` template literals don't trip the rule.
      // The redactor preserves line + column so the reported line
      // number still maps to the right place in the original.
      const scan = redactStringsAndTemplates(content);
      for (const { name, regex, fix } of NON_ERASABLE_PATTERNS) {
        const m = scan.match(regex);
        if (m && typeof m.index === 'number') {
          const line = content.slice(0, m.index).split('\n').length;
          violations.push({
            rule: 'no-non-erasable-typescript',
            file: relPath,
            message: `Non-erasable TypeScript construct (${name}) detected at line ${line}. The framework's type-stripper rejects this at request time with a 500.`,
            fix,
          });
        }
      }
    }
  }
}
