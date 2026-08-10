import { readFile, stat } from 'node:fs/promises';
import { join, relative, sep, basename, dirname } from 'node:path';
import { walk } from '../fs-walk.js';
import {
  redactStringsAndTemplates,
  redactToPlaceholders,
  extractWebComponentClassBodies,
  matchClosingBrace,
  matchClosingParenthesis,
  parsePropEntries,
  classifyActionHole,
} from '../js-scan.js';
import { buildModuleGraph, transitiveDeps, resolveImport } from '../module-graph.js';
import { scanComponents } from '../component-scanner.js';
import { buildRouteTable } from '../router.js';
import { analyzeElision } from '../component-elision.js';
import { RESERVED_CONFIG } from '../action-config.js';
import {
  hasUseServerDirective,
  isServerActionFile,
  isComponentFile,
  arrayPropUsesObject,
  findFieldInitializers,
  methodBodyOf,
  findBrowserMemberUses,
  enumerableExports,
  importedLocalNames,
  importedValueNames,
} from './helpers.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 */

/**
 * Scan a WebJs app directory and report convention violations.
 *
 * @param {string} appDir absolute path to the app root
 * @returns {Promise<Violation[]>}
 */
export async function checkConventions(appDir) {
  /** @type {Violation[]} */
  const violations = [];

  /** @type {{ abs: string, rel: string, content: string, scan: string }[]} */
  const files = [];
  for await (const abs of walk(appDir, (p) => /\.m?[jt]sx?$/.test(p))) {
    const rel = relative(appDir, abs);
    let content;
    try {
      content = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    files.push({ abs, rel, content, scan: redactStringsAndTemplates(content) });
  }

  // --- Rule: components-have-register ---
  {
    for (const { rel, scan } of files) {
      if (!isComponentFile(rel)) continue;
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      if (/\b[A-Z][A-Za-z0-9_$]*\.register\s*\(\s*['"`]/.test(scan)) continue;
      if (/\bcustomElements\.define\s*\(/.test(scan)) continue;
      violations.push({
        rule: 'components-have-register',
        file: rel,
        message: "Component extends WebComponent but is never registered. Call ClassName.register('tag-name') at the bottom of the file.",
        fix: "Add `ClassName.register('tag-name')` after the class definition",
      });
    }
  }

  // --- Rule: no-static-properties ---
  {
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body } of extractWebComponentClassBodies(scan)) {
        if (!/static\s+properties\s*=\s*\{/.test(body)) continue;
        violations.push({
          rule: 'no-static-properties',
          file: rel,
          message:
            '`static properties = { … }` is no longer supported; declare reactive properties via the `extends WebComponent({ … })` factory instead.',
          fix: 'Move the properties into the factory call: `class X extends WebComponent({ count: Number })`. Use `prop(Number, { reflect: true })` for options and set defaults in the constructor after super(). Delete the `static properties` block and any `declare` fields for those props.',
        });
      }
    }
  }

  // --- Rule: reactive-props-no-class-field ---
  {
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body, factoryProps } of extractWebComponentClassBodies(scan)) {
        if (factoryProps.size === 0) continue;
        for (const bad of findFieldInitializers(body, factoryProps)) {
          violations.push({
            rule: 'reactive-props-no-class-field',
            file: rel,
            message: `Reactive prop \`${bad}\` uses a class-field declaration (initializer or type-only); this clobbers the framework's reactive accessor under modern class-field semantics.`,
            fix: `Delete the class-field declaration and set the default by assigning \`this.${bad} = <value>\` inside \`constructor()\` after \`super()\`.`,
          });
        }
      }
    }
  }

  // --- Rule: array-prop-uses-array-type ---
  {
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { factoryArg } of extractWebComponentClassBodies(scan)) {
        const objStart = factoryArg.indexOf('{');
        if (objStart === -1) continue;
        const objEnd = matchClosingBrace(factoryArg, objStart + 1);
        if (objEnd === -1) continue;
        const objContent = factoryArg.slice(objStart + 1, objEnd);
        for (const { key, value } of parsePropEntries(objContent)) {
          if (!arrayPropUsesObject(value)) continue;
          violations.push({
            rule: 'array-prop-uses-array-type',
            file: rel,
            message: `Array-typed reactive prop \`${key}\` is declared with the \`Object\` constructor (\`prop<…[]>(Object)\`); use \`Array\` so the runtime converter matches the declared shape.`,
            fix: `Change the constructor to \`Array\`: \`${key}: prop<…[]>(Array)\`. Object and Array share one converter so behaviour is unchanged, but \`Array\` states the prop's shape correctly.`,
          });
        }
      }
    }
  }

  // --- Rule: no-browser-globals-in-render ---
  {
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body } of extractWebComponentClassBodies(scan)) {
        for (const method of ['constructor', 'willUpdate', 'render']) {
          const code = methodBodyOf(body, method);
          if (!code) continue;
          for (const { member, kind } of findBrowserMemberUses(code)) {
            violations.push({
              rule: 'no-browser-globals-in-render',
              file: rel,
              message: `\`${member}\` (${kind}) is used in ${method}(), which runs during SSR where it is not available, so it throws and the component fails to server-render.`,
              fix: `Move browser-only work to connectedCallback() or a lifecycle hook (firstUpdated/updated), which SSR never calls. Seed first-paint defaults in the constructor only from server-known inputs (attributes / props), then refine in connectedCallback by writing to a signal.`,
            });
          }
        }
      }
    }
  }

  // --- Rule: no-shadowed-native-member ---
  {
    const NATIVE_MEMBERS = [
      'append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren', 'remove',
      'appendChild', 'insertBefore', 'removeChild', 'replaceChild',
    ];
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body } of extractWebComponentClassBodies(scan)) {
        if (/static\s+shadow\s*=\s*true/.test(body)) continue;
        const depth = new Int32Array(body.length);
        {
          let d = 0;
          for (let i = 0; i < body.length; i++) {
            if (body[i] === '{') { depth[i] = d; d++; }
            else if (body[i] === '}') { d--; depth[i] = d; }
            else depth[i] = d;
          }
        }
        for (const name of NATIVE_MEMBERS) {
          const methodRe = new RegExp(
            `(?:^|[\\s;}])((?:static\\s+)?)(?:async\\s+)?(?:get\\s+|set\\s+)?(${name})\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`,
            'g',
          );
          const fieldRe = new RegExp(
            `(?:^|[\\s;}])((?:static\\s+)?)(${name})\\s*=\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]*)?=>|[\\w$]+\\s*=>)`,
            'g',
          );
          let flagged = false;
          for (const re of [methodRe, fieldRe]) {
            let m;
            while (!flagged && (m = re.exec(body)) !== null) {
              if (m[1]) continue;
              const nameIdx = m.index + m[0].indexOf(m[2]);
              if (depth[nameIdx] !== 0) continue;
              flagged = true;
              violations.push({
                rule: 'no-shadowed-native-member',
                file: rel,
                message: `Component member \`${name}\` shadows the native DOM method WebJs instruments for the slot API, so it silently never runs (the native method wins) and TypeScript does not catch it.`,
                fix: `Rename the member to a non-native name (e.g. \`${name}Row()\` / \`${name}Item()\`) and update its call sites.`,
              });
            }
            if (flagged) break;
          }
        }
      }
    }
  }

  // --- Rule: no-redirect-in-api-route ---
  {
    const ROUTE_FILE = /(?:^|\/)route\.m?[jt]s$/;
    for (const { rel, scan } of files) {
      if (!ROUTE_FILE.test(rel)) continue;
      const namedM = /\bimport\s+\{[^}]*\bredirect\b(?:\s+as\s+(\w+))?\s*[^}]*\}\s+from\s+['"]@webjsdev\/core['"]/.exec(scan);
      const nsM = /\bimport\s+\*\s+as\s+(\w+)\s+from\s+['"]@webjsdev\/core['"]/.exec(scan);
      /** @type {Array<{ re: RegExp, member: boolean }>} */
      const matchers = [];
      if (namedM) {
        const localName = namedM[1] || 'redirect';
        matchers.push({ re: new RegExp(`(?<!\\.)\\b${localName}\\s*\\(`, 'g'), member: false });
      }
      if (nsM) {
        matchers.push({ re: new RegExp(`\\b${nsM[1]}\\.redirect\\s*\\(`, 'g'), member: true });
      }
      let flagged = false;
      for (const { re, member } of matchers) {
        if (flagged) break;
        let m;
        while ((m = re.exec(scan)) !== null) {
          if (!member) {
            const before = scan.slice(Math.max(0, m.index - 20), m.index);
            if (/\w\.$/.test(before)) continue;
          }
          violations.push({
            rule: 'no-redirect-in-api-route',
            file: rel,
            message:
              `\`redirect()\` from \`@webjsdev/core\` throws a control-flow signal for the SSR page renderer; in a \`route.ts\` handler it goes uncaught and returns a 500.`,
            fix: `Use \`Response.redirect(url, 303)\` for external redirects, or return a 3xx Response directly. The \`redirect()\` sentinel is only valid in page functions, layouts, and server actions (where the SSR pipeline catches it).`,
          });
          flagged = true;
          break;
        }
      }
    }
  }

  // --- Rule: no-interpolation-in-raw-text-element ---
  {
    for (const { rel, content } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(content)) continue;
      const stripped = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      for (const tag of ['style', 'script']) {
        const re = new RegExp(
          `<${tag}\\b[^>]*>(?:(?!<\\/${tag}>)[\\s\\S])*?\\$\\{(?:(?!<\\/${tag}>)[\\s\\S])*?<\\/${tag}>`,
          'i',
        );
        if (re.test(stripped)) {
          violations.push({
            rule: 'no-interpolation-in-raw-text-element',
            file: rel,
            message: `An interpolation (\`\${...}\`) sits inside a <${tag}> element in an html template. The server renderer emits it but the client renderer drops it, so it paints at SSR then wipes to empty on hydration.`,
            fix:
              tag === 'style'
                ? `Move the CSS out of the raw-text hole: use \`static styles\` (shadow DOM) or a \`css\` template for a component, or put page CSS in the layout. Static \`<style>...</style>\` with no \`\${}\` is fine.`
                : `Build the script body outside the raw-text element (set attributes/properties via bindings, or compute the value before the template). Static \`<script>...</script>\` with no \`\${}\` is fine.`,
          });
          break;
        }
      }
    }
  }

  // --- Rule: no-server-env-in-components ---
  {
    for (const { abs, rel, content } of files) {
      if (!isComponentFile(rel)) continue;
      if (isServerActionFile(abs, content)) continue;

      const re = /\bprocess\.env\.([A-Z][A-Z0-9_]*)\b/g;
      const seen = new Set();
      let m;
      while ((m = re.exec(content)) !== null) {
        const name = m[1];
        if (name.startsWith('WEBJS_PUBLIC_')) continue;
        if (name === 'NODE_ENV') continue;
        if (seen.has(name)) continue;
        seen.add(name);
        violations.push({
          rule: 'no-server-env-in-components',
          file: rel,
          message: `Component reads process.env.${name}; server-only env vars must not be read in components (would leak into SSR'd HTML and read as undefined after hydration)`,
          fix: `Either rename to WEBJS_PUBLIC_${name} if the value is intended for the browser, or read process.env.${name} in a page function / server action / middleware and pass a derived value to the component as an attribute.`,
        });
      }
    }
  }

  // --- Rule: shell-in-non-root-layout ---
  {
    const ROOT_LAYOUT = /^app\/layout\.(?:js|mjs|ts|mts)$/;
    const LAYOUT_OR_PAGE = /^app\/(?:.+\/)?(?:layout|page)\.(?:js|mjs|ts|mts)$/;
    const SHELL_RE = /<!doctype\b|<html\b|<head\b|<body\b/i;
    for (const { rel, content } of files) {
      if (ROOT_LAYOUT.test(rel)) continue;
      if (!LAYOUT_OR_PAGE.test(rel)) continue;
      const stripped = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      const m = stripped.match(SHELL_RE);
      if (m) {
        violations.push({
          rule: 'shell-in-non-root-layout',
          file: rel,
          message:
            `Non-root layout/page contains ${m[0]}: only the root layout (app/layout.{js,ts}) may write the shell. The framework auto-emits <!doctype>/<html>/<head>/<body> around the whole composition; a nested shell ends up duplicated and dropped by the HTML parser.`,
          fix:
            'Remove the <!doctype>/<html>/<head>/<body> wrapper from this file. Use the `metadata` export for <title>/<meta>/og/twitter, return inline <link>/<style>/<script> for head-bound resources (they auto-hoist), and put any `<html lang>` / `<body class>` overrides in app/layout.{js,ts} instead.',
        });
      }
    }
  }

  // --- Rule: erasable-typescript-only ---
  {
    let tsconfigContent = null;
    try {
      tsconfigContent = await readFile(join(appDir, 'tsconfig.json'), 'utf8');
    } catch {
      // No tsconfig.json
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

  // --- Rule: no-non-erasable-typescript ---
  {
    const NON_ERASABLE_PATTERNS = [
      {
        name: 'enum',
        regex: /^[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:const[ \t]+)?enum[ \t]+[A-Z]\w*[ \t]*\{/m,
        fix: 'Replace `enum Foo { A, B }` with `const Foo = { A: "A", B: "B" } as const; type Foo = typeof Foo[keyof typeof Foo];`.',
      },
      {
        name: 'namespace with values',
        regex: /^[ \t]*(?:export[ \t]+)?namespace[ \t]+\w+[ \t]*\{[\s\S]*?\b(?:let|const|var|function|class)\b/m,
        fix: 'Replace `namespace Foo { export const x = 1 }` with `export const Foo = { x: 1 } as const;` or split the contents into separate modules.',
      },
      {
        name: 'constructor parameter property',
        regex: /constructor[ \t]*\([^)]*\b(?:public|private|protected|readonly)[ \t]+\w+/,
        fix: 'Replace `constructor(public x: number)` with `x: number; constructor(x: number) { this.x = x; }`.',
      },
      {
        name: 'import = require',
        regex: /^[ \t]*(?:export[ \t]+)?import[ \t]+\w+[ \t]*=[ \t]*require[ \t]*\(/m,
        fix: 'Replace `import foo = require("bar")` with `import * as foo from "bar"` or `import { something } from "bar"`.',
      },
    ];

    for await (const abs of walk(appDir, (p) => /\.m?ts$/.test(p))) {
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

  // --- Rule: use-server-needs-extension ---
  {
    for (const { rel, content } of files) {
      if (!hasUseServerDirective(content)) continue;
      if (/\.server\.m?[jt]s$/.test(rel)) continue;
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

  // --- Rule: use-server-exports-callable ---
  {
    for (const { rel, content, scan } of files) {
      if (!/\.server\.m?[jt]s$/.test(rel)) continue;
      if (!hasUseServerDirective(content)) continue;
      const names = new Set();
      let m;
      const reFn = /\bexport\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
      while ((m = reFn.exec(scan))) names.add(m[1]);
      const reArrow = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::(?:[^=]|=>)*?)?=(?!>)\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g;
      while ((m = reArrow.exec(scan))) names.add(m[1]);
      const callables = [...names].filter((n) => !RESERVED_CONFIG.has(n));
      if (callables.length > 0) continue;
      if (/\bexport\s+default\b/.test(scan)) continue;
      if (/\bexport\s*\{/.test(scan)) continue;
      if (/\bexport\s*\*/.test(scan)) continue;
      if (/\bexport\s+(?:const|let|var)\s*[{[]/.test(scan)) continue;
      const reFactory = /\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::(?:[^=]|=>)*?)?=\s*[A-Za-z_$(]/g;
      let ambiguousAction = false;
      while ((m = reFactory.exec(scan))) { if (!RESERVED_CONFIG.has(m[1])) { ambiguousAction = true; break; } }
      if (ambiguousAction) continue;
      violations.push({
        rule: 'use-server-exports-callable',
        file: rel,
        message:
          "File declares `'use server'` but exports no callable action. The `'use server'` directive registers FUNCTION exports as RPC-callable; a file exporting only a non-function (a `const` / a type / only verb config) registers nothing, so a client import resolves to nothing and the call 404s.",
        fix: "Export an `async function` action from this file, or remove the `'use server'` directive if it is a plain server-only utility.",
      });
    }
  }

  // --- Rule: one-action-per-configured-file ---
  {
    for (const { rel, content, scan } of files) {
      if (!/\.server\.m?[jt]s$/.test(rel)) continue;
      if (!hasUseServerDirective(content)) continue;
      if (!/\bexport\s+const\s+(?:method|cache|tags|invalidates|validate|middleware)\b/.test(scan)) continue;
      const names = new Set();
      let m;
      const reFn = /\bexport\s+(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/g;
      while ((m = reFn.exec(scan))) names.add(m[1]);
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

  // --- Rule: tag-name-has-hyphen ---
  {
    for (const { rel, scan } of files) {
      if (!isComponentFile(rel)) continue;
      const patterns = [
        /\b[A-Z][A-Za-z0-9_$]*\.register\s*\(\s*(['"`])([^'"`]+)\1/g,
        /\bcustomElements\.define\s*\(\s*(['"`])([^'"`]+)\1/g,
      ];
      for (const re of patterns) {
        let match;
        while ((match = re.exec(scan)) !== null) {
          const tagName = match[2];
          if (!tagName.includes('-')) {
            violations.push({
              rule: 'tag-name-has-hyphen',
              file: rel,
              message: `Custom element tag "${tagName}" must contain a hyphen`,
              fix: `Rename to a hyphenated tag name, e.g. "app-${tagName}" or "${tagName}-element"`,
            });
          }
        }
      }
    }
  }

  // --- Rule: no-duplicate-tag ---
  {
    const ignored = await gitIgnoredSet(appDir, files.map((f) => f.rel));
    /** @type {Map<string, string[]>} */
    const tagSites = new Map();
    const patterns = [
      /\b[A-Z][A-Za-z0-9_$]*\.register\s*\(\s*(['"`])([^'"`]+)\1/g,
      /\bcustomElements\.define\s*\(\s*(['"`])([^'"`]+)\1/g,
    ];
    for (const { scan, rel } of files) {
      if (ignored.has(rel)) continue;
      for (const re of patterns) {
        let match;
        while ((match = re.exec(scan)) !== null) {
          const tagName = match[2];
          if (!tagName.includes('-')) continue;
          const arr = tagSites.get(tagName) || [];
          arr.push(rel);
          tagSites.set(tagName, arr);
        }
      }
    }
    for (const [tagName, sites] of tagSites) {
      if (sites.length < 2) continue;
      for (const file of new Set(sites)) {
        const others = [...new Set(sites)].filter((f) => f !== file);
        const where = others.length
          ? `also registered in ${others.join(', ')}`
          : 'registered more than once in this file';
        violations.push({
          rule: 'no-duplicate-tag',
          file,
          message: `Custom element tag "${tagName}" is registered more than once (${where}). A tag must be registered exactly once; the runtime resolves a duplicate inconsistently (SSR keeps the last registration, the browser keeps the first).`,
          fix: `Rename one registration so each "${tagName}" is unique, e.g. "${tagName}-2".`,
        });
      }
    }
  }

  // --- Rule: no-server-import-in-browser-module ---
  await checkServerImportInBrowserModule(appDir, violations);

  // --- Rule: no-missing-local-import ---
  {
    const maskedByAbs = new Map();
    for (const f of files) maskedByAbs.set(f.abs, redactStringsAndTemplates(f.content, true));
    const exportsByAbs = new Map();
    for (const f of files) exportsByAbs.set(f.abs, enumerableExports(maskedByAbs.get(f.abs)));
    const reImport = /\bimport\s+([^'";]*?)\bfrom\s*(['"])/g;
    for (const { abs, rel, content } of files) {
      const masked = maskedByAbs.get(abs);
      reImport.lastIndex = 0;
      let m;
      while ((m = reImport.exec(masked))) {
        const quote = m[2];
        const specStart = reImport.lastIndex;
        const specEnd = content.indexOf(quote, specStart);
        if (specEnd < 0) continue;
        const spec = content.slice(specStart, specEnd);
        if (!/^(?:\.|#)/.test(spec)) continue;
        const names = importedValueNames(m[1]);
        if (!names || names.length === 0) continue;
        const target = resolveImport(spec, abs, appDir);
        const exp = exportsByAbs.get(target);
        if (exp == null) continue;
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

  // --- Rule: form-action-not-a-get-action ---
  {
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
        const { redacted, literals } = redactToPlaceholders(content);
        const bound = new Set();
        for (const m of redacted.matchAll(/__STR_(\d+)__\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
          if (!classifyActionHole(literals[Number(m[1])] || '')) continue;
          bound.add(m[2]);
        }
        if (!bound.size) continue;
        reImport.lastIndex = 0;
        let im;
        while ((im = reImport.exec(redacted))) {
          const tok = /__STR_(\d+)__/.exec(redacted.slice(reImport.lastIndex, reImport.lastIndex + 24));
          if (!tok) continue;
          const spec = literals[Number(tok[1])] || '';
          if (!/^(?:\.|#)/.test(spec)) continue;
          const names = importedLocalNames(im[1]);
          if (!names.length) continue;
          const target = resolveImport(spec, abs, appDir);
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

  return violations;
}

function findImportChain(graph, from, to) {
  const prev = new Map();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    const deps = graph.get(cur);
    if (!deps) continue;
    for (const dep of deps) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      prev.set(dep, cur);
      if (dep === to) {
        const path = [];
        for (let n = to; n !== undefined; n = prev.get(n)) path.unshift(n);
        return path;
      }
      queue.push(dep);
    }
  }
  return [from, to];
}

async function checkServerImportInBrowserModule(appDir, violations) {
  if (!(await pathExists(join(appDir, 'app')))) return;

  let moduleGraph, components, routeTable;
  try {
    moduleGraph = await buildModuleGraph(appDir);
    components = await scanComponents(appDir);
    routeTable = await buildRouteTable(appDir);
  } catch {
    return;
  }

  /** @type {Set<string>} */
  const routeModuleSet = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) routeModuleSet.add(page.file);
    for (const f of page.layouts || []) routeModuleSet.add(f);
  }
  const routeModules = [...routeModuleSet];

  /** @type {Map<string, string>} */
  const alwaysShipRouteModules = new Map();
  for (const page of routeTable.pages || []) {
    for (const f of page.errors || []) alwaysShipRouteModules.set(f, 'error boundary');
    for (const f of page.loadings || []) alwaysShipRouteModules.set(f, 'loading boundary');
  }
  if (routeTable.notFound) alwaysShipRouteModules.set(routeTable.notFound, 'not-found page');
  if (routeTable.notFounds) {
    for (const f of routeTable.notFounds.values()) {
      alwaysShipRouteModules.set(f, 'not-found page');
    }
  }

  const elideEnabled = await readElideEnabledForCheck(appDir);
  const { elidableComponents, inertRouteModules, importOnlyRouteModules } = elideEnabled
    ? await analyzeElision(components, routeModules, moduleGraph, (f) => readFile(f, 'utf8'), appDir)
    : { elidableComponents: new Set(), inertRouteModules: new Set(), importOnlyRouteModules: new Map() };

  /** @type {Map<string, { kind: string }>} */
  const candidates = new Map();
  for (const c of components) {
    if (!elidableComponents.has(c.file)) candidates.set(c.file, { kind: 'component' });
  }
  for (const file of routeModules) {
    if (inertRouteModules.has(file) || importOnlyRouteModules.has(file)) continue;
    const base = basename(file);
    const kind = /^layout\./.test(base) ? 'layout' : 'page';
    candidates.set(file, { kind });
  }
  for (const [file, kind] of alwaysShipRouteModules) {
    if (!candidates.has(file)) candidates.set(file, { kind });
  }

  for (const file of [...candidates.keys()].sort()) {
    const closure = transitiveDeps(moduleGraph, [file], appDir);
    let serverDep = null;
    for (const d of closure) {
      if (!/\.server\.m?[jt]s$/.test(d)) continue;
      if (await isUseServerActionFile(d)) continue;
      if (!(await pathExists(d))) continue;
      serverDep = d;
      break;
    }
    if (!serverDep) continue;

    const { kind } = candidates.get(file);
    const relFile = relative(appDir, file);
    const relServer = relative(appDir, serverDep);
    const chainFiles = findImportChain(moduleGraph, file, serverDep);
    const chain = chainFiles.map((f) => relative(appDir, f)).join(' -> ');
    const importer = chainFiles.length >= 2 ? chainFiles[chainFiles.length - 2] : null;
    const viaTypesModule = importer && /(^|\/)types(\.m?[jt]s$|\/)/.test(relative(appDir, importer));

    const canElide = kind === 'page' || kind === 'layout';
    const typesHint = viaTypesModule
      ? `The edge enters via a types-shaped module (${relative(appDir, importer)}); if it re-exports a runtime VALUE from a \`.server.{ts,js}\` file, relocate that to a browser-safe typedef (a plain \`interface\` / JSDoc, or an \`import type\` which the stripper erases) so the type is shared without pinning the module. `
      : '';
    const fixText = canElide
      ? `${typesHint}Keep the server call off this browser-shipped ${kind}. Options: (1) gate the route in \`middleware.ts\` (runs server-side, never ships); (2) move the server-only call behind a \`'use server'\` action in a \`.server.{ts,js}\` file and call it as an RPC; or (3) move this ${kind}'s own client work (the module-scope call, browser-global access, or client-effecting util import that pins it) into a component, so the ${kind} elides again as a dropped carrier and its server import never loads.`
      : `${typesHint}Keep the server call off this browser-shipped ${kind} (it always ships and is never elided). Options: (1) gate the route in \`middleware.ts\` (runs server-side, never ships); or (2) move the server-only call behind a \`'use server'\` action in a \`.server.{ts,js}\` file and call it as an RPC.`;

    violations.push({
      rule: 'no-server-import-in-browser-module',
      file: relFile,
      message:
        `This ${kind} ships to the browser (the build does not elide it) but transitively imports the server-only module ${relServer} (${chain}). In the browser that import resolves to a stub, so the module crashes at load (the stub throws, or a server-only export such as \`auth\` is missing). \`webjs typecheck\` and the rest of \`webjs check\` pass; only the running ${kind} fails.`,
      fix: fixText,
    });
  }
}

async function isUseServerActionFile(file) {
  try {
    const content = await readFile(file, 'utf8');
    return hasUseServerDirective(content);
  } catch {
    return false;
  }
}

async function readElideEnabledForCheck(appDir) {
  const raw = process.env.WEBJS_ELIDE;
  if (raw != null) {
    const v = raw.trim().toLowerCase();
    if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
    if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  }
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.elide === false) return false;
  } catch {
    // No package.json
  }
  return true;
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function gitIgnoredSet(appDir, rels) {
  /** @type {Set<string>} */
  const out = new Set();
  if (!rels.length) return out;
  try {
    const { spawnSync } = await import('node:child_process');
    const {
      GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, GIT_PREFIX: _gp,
      ...gitEnv
    } = process.env;
    const res = spawnSync('git', ['check-ignore', '--stdin'], {
      cwd: appDir,
      input: rels.join('\n'),
      encoding: 'utf8',
      env: gitEnv,
    });
    if (res.status === 0 && typeof res.stdout === 'string') {
      for (const line of res.stdout.split('\n')) {
        const p = line.trim();
        if (p) out.add(p);
      }
    }
  } catch {
    // git missing
  }
  return out;
}
