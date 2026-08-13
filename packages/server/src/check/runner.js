import { readFile, stat } from 'node:fs/promises';
import { join, relative, sep, basename, dirname } from 'node:path';
import { walk } from '../fs-walk.js';
import {
  redactStringsAndTemplates, redactToPlaceholders, extractWebComponentClassBodies,
  matchClosingBrace, parsePropEntries, classifyActionHole,
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
 * Every rule is a correctness check (a crash, a security leak, a reactive
 * prop that silently stops re-rendering, or a build/type-strip failure), so
 * they all run unconditionally. There is no
 * per-project disabling: project conventions (layout, style, process) live in
 * CONVENTIONS.md as guidance, not in this tool.
 *
 * @param {string} appDir  absolute path to the app root (the directory
 *   containing `app/`, `modules/`, `components/`, etc.)
 * @returns {Promise<Violation[]>}
 *
 * @example
 * ```js
 * import { checkConventions } from '@webjsdev/server';
 * const violations = await checkConventions('/path/to/myapp');
 * for (const v of violations) {
 *   console.warn(`[${v.rule}] ${v.file}: ${v.message}`);
 * }
 * ```
 */
export async function checkConventions(appDir) {
  /** @type {Violation[]} */
  const violations = [];

  // Collect all JS/TS files in the app directory. Each entry carries
  // both the raw `content` (for rules that need verbatim source: the
  // `'use server'` directive detector, the `.gitignore` reader, etc.)
  // and a `scan` view with comments, string contents, and
  // template-literal bodies redacted to whitespace. Rules that
  // pattern-match across raw source should consume `scan` so docs-
  // page code-block examples and JSDoc samples don't trigger false
  // positives.
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
      // Use redacted source so a code-example string like
      // `Foo.register('bar')` inside a tagged template literal does
      // not falsely satisfy the rule for a sibling unregistered
      // class. Real register() calls live at top level where the
      // redactor leaves them alone.
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      // Accept either registration pattern:
      //   Counter.register('tag')                    (WebJs idiom)
      //   customElements.define('tag', Counter)      (native)
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
  // A hand-written `static properties = { … }` in a WebComponent class body is
  // no longer supported: reactive properties are declared via the
  // `extends WebComponent({ … })` factory (the runtime throws on a direct
  // `static properties`). Flag it statically so the editor catches it before
  // the page 500s.
  {
    for (const { rel, scan } of files) {
      // Use redacted source so fixture-style strings like
      // `class X extends WebComponent { static properties = {…} }` inside
      // template literals don't trip the rule. Real declarations live at
      // top-level code where the redactor leaves them alone.
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
  // A reactive property declared via the factory must not also carry a plain
  // class-field declaration (initializer OR type-only): under modern class-field
  // semantics (including `erasableSyntaxOnly: true`) every class-field declaration
  // compiles to Object.defineProperty after super() and clobbers the framework's
  // reactive accessor (silent broken re-renders). Catches `count = 0`,
  // `count: number = 0`, `count!: number`, and `count?: number`.
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
  // An array-typed reactive prop declared via the factory should pass the
  // `Array` runtime constructor, not `Object`. Both share one converter
  // (JSON encode/decode), so `Object` does not crash, but it misstates the
  // prop contract and diverges from the documented built-in set. Fires only
  // when the factory generic is itself an array type AND the constructor is
  // `Object`; a bare `foo: Object` (no generic to prove array-ness) is left
  // alone to avoid false positives. Uses the redacted `scan`, so a
  // `prop<X[]>(Object)` shown inside an html`` example string never fires.
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
  // The SSR pipeline runs the constructor (`new Cls()`), willUpdate, and
  // render() on the server element shim (attribute methods backed, but no real
  // DOM). A genuinely browser-only global or an unshimmed HTMLElement member on
  // `this` touched in any of those throws at SSR time. Those belong in
  // connectedCallback / post-render hooks, which SSR never calls. willUpdate is
  // scanned because it now runs at SSR (issue #217).
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
  // A WebComponent method named after a native DOM mutation method WebJs
  // instruments on every light-DOM host for the slot API (#1021) is SHADOWED at
  // runtime (the native/instrumented method wins), so the component method never
  // runs, while TypeScript stays green (a shorter override is assignable). Rename
  // the handler. The lifecycle hooks are meant to be overridden, so only the DOM
  // mutation members are reserved.
  {
    const NATIVE_MEMBERS = [
      'append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren', 'remove',
      'appendChild', 'insertBefore', 'removeChild', 'replaceChild',
    ];
    for (const { rel, scan } of files) {
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(scan)) continue;
      for (const { body } of extractWebComponentClassBodies(scan)) {
        // The slot interception installs only on LIGHT-DOM hosts (the shadow
        // branch keeps the true native methods), so a shadow component's method
        // is never shadowed. Skip the whole class.
        if (/static\s+shadow\s*=\s*true/.test(body)) continue;
        // Brace-depth map over the (already string/comment-masked) class body,
        // so only TOP-LEVEL class members flag: a same-named object-literal
        // shorthand or function expression nested inside a method body is a
        // different object's property and shadows nothing.
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
          // Two shadowed-definition shapes, both instance-level: the method /
          // accessor form (`remove() {`, `get remove() {`), and the class-field
          // FUNCTION form (`remove = () => {}` / `= function () {}`), which the
          // connect-time interception install overwrites just the same. A
          // `static` member lives on the constructor and shadows nothing.
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
              if (m[1]) continue;                       // static: not shadowed
              const nameIdx = m.index + m[0].indexOf(m[2]);
              if (depth[nameIdx] !== 0) continue;       // nested: another object's property
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
  // `redirect()` from `@webjsdev/core` throws a control-flow signal designed
  // for the SSR page renderer. In a `route.ts` API handler it goes uncaught
  // and produces a 500. API handlers must use `Response.redirect(url, 303)`
  // instead. Page functions, layouts, and server actions may still use
  // `redirect()` (caught by the SSR / action pipeline).
  {
    const ROUTE_FILE = /(?:^|\/)route\.m?[jt]s$/;
    for (const { rel, scan } of files) {
      if (!ROUTE_FILE.test(rel)) continue;
      // `redirect` reaches the route file in one of two statically-visible ways:
      //   1. A NAMED import from `@webjsdev/core` (possibly aliased):
      //      `import { redirect }`, `import { redirect as r }`, `import { …, redirect, … }`.
      //   2. A NAMESPACE import then a member call:
      //      `import * as core from '@webjsdev/core'` then `core.redirect(...)`.
      // The named case flags a bare `redirect(` call; the namespace case flags
      // `<ns>.redirect(`. `Response.redirect(` and any other `obj.redirect(` are
      // the standard API and stay fine. A `redirect()` thrown inside a
      // '`use server`' action the route calls DIRECTLY (an uncaught 500) needs
      // cross-file analysis and is left to the AST rework (#753).
      const namedM = /\bimport\s+\{[^}]*\bredirect\b(?:\s+as\s+(\w+))?\s*[^}]*\}\s+from\s+['"]@webjsdev\/core['"]/.exec(scan);
      const nsM = /\bimport\s+\*\s+as\s+(\w+)\s+from\s+['"]@webjsdev\/core['"]/.exec(scan);
      // A file can carry BOTH a named `redirect` import AND a namespace import,
      // so check every matcher independently (not mutually exclusive): a named
      // import means a bare `<localName>(`, a namespace import means
      // `<ns>.redirect(`. The `member` flag distinguishes the two so a bare
      // named call can screen out `Response.redirect(` / `obj.redirect(`.
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
            // Screen out `Response.redirect(` / `someObj.redirect(` sharing the
            // local name: a preceding member-access dot means it is not the import.
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
          flagged = true; // one violation per file is enough
          break;
        }
      }
    }
  }

  // --- Rule: no-interpolation-in-raw-text-element ---
  // A `${...}` hole inside a `<style>` or `<script>` element in an `html`
  // template is an SSR/client asymmetry: `renderToString` emits it, but the
  // client parser drops a raw-text hole as a `noop` (the compile cache is keyed
  // on the static strings, so a per-render value cannot be baked in), so the
  // element paints at SSR then wipes to empty on hydration.
  //
  // Scoped to COMPONENTS. The drop only happens on the CLIENT renderer, which
  // runs for components (hydration + re-render). Pages and layouts render
  // server-only (never hydrate), so a page's `<style>${STYLES.text}</style>` is
  // a legitimate, taught pattern and must NOT be flagged. Scan raw source with
  // comments stripped (the tag text lives in a template string, which the
  // redacted `scan` view blanks). One violation per file.
  {
    for (const { rel, content } of files) {
      // Only files that define a hydrating custom element. A page/layout that
      // interpolates a `css` result into a `<style>` is server-only and fine.
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(content)) continue;
      const stripped = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
      for (const tag of ['style', 'script']) {
        // `<tag ...> ... ${ ... </tag>`, where the hole sits before the close
        // tag. The negative lookahead keeps the match from crossing `</tag>`.
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
          break; // one violation per file is enough
        }
      }
    }
  }

  // --- Rule: no-server-env-in-components ---
  // Catches `process.env.X` reads in component files where X is not a
  // WEBJS_PUBLIC_* var and not NODE_ENV. The SSR shim only exposes those
  // two categories to the browser; any other read either leaks a secret
  // into the SSR'd HTML or reads as undefined after hydration.
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
  // Only app/layout.{js,ts} may write <!doctype>/<html>/<head>/<body>. The
  // framework auto-emits the shell around the whole composition; a nested
  // shell ends up duplicated and silently dropped by the HTML parser.
  {
    // Root layout = exactly "app/layout.js" or "app/layout.ts".
    const ROOT_LAYOUT = /^app\/layout\.(?:js|mjs|ts|mts)$/;
    // Any other layout or page under app/ (including pages, nested layouts).
    const LAYOUT_OR_PAGE = /^app\/(?:.+\/)?(?:layout|page)\.(?:js|mjs|ts|mts)$/;
    // Shell tags. Case-insensitive, allow whitespace, allow attributes for <html>/<body>.
    const SHELL_RE = /<!doctype\b|<html\b|<head\b|<body\b/i;
    for (const { rel, content } of files) {
      if (ROOT_LAYOUT.test(rel)) continue;
      if (!LAYOUT_OR_PAGE.test(rel)) continue;
      // Strip line comments + /* … */ block comments + ` ` string-template
      // tag content is fine: we're looking at the literal HTML in the
      // returned `html` template, which won't be inside a code comment.
      // A naive substring scan is good enough; false positives only when
      // someone genuinely embeds `<html>` inside a string literal that
      // isn't a layout shell (rare and probably an honest code smell).
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

  // --- Rule: tag-name-has-hyphen ---
  {
    for (const { rel, scan } of files) {
      if (!isComponentFile(rel)) continue;
      // Use redacted source. A `register('tag')` call inside a
      // TAGGED template literal (docs-page code example) is blanked.
      // Calls at top level keep their structure AND their string
      // argument. Quote style can be ', ", or ` (untagged backtick
      // literals survive the redactor, like single/double-quote
      // strings).
      const patterns = [
        // Class.register('tag') / register("tag") / register(`tag`)
        /\b[A-Z][A-Za-z0-9_$]*\.register\s*\(\s*(['"`])([^'"`]+)\1/g,
        // customElements.define('tag', Class) and quote variants
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
  // Two registrations of the SAME tag string anywhere in the app resolve
  // inconsistently at runtime (SSR last-wins, browser first-wins), so flag
  // every colliding site naming the others. Scans EVERY source file, not just
  // components/, because a duplicate is a runtime hazard regardless of where
  // the register/define call lives (a page, a lib, a module can register a
  // tag too); this keeps the rule in lockstep with the editor's 9004
  // diagnostic, which is likewise project-wide. Reuses the same
  // register/define extraction as tag-name-has-hyphen, over the redacted
  // source so a tag in a docs-page tagged-template example does not count.
  // Only hyphenated tags are considered (a non-hyphenated tag is already
  // flagged by tag-name-has-hyphen / invariant 3), matching the 9004 filter.
  {
    // Generated / gitignored files (e.g. a `webjs ui add`-regenerated
    // `components/` dir) are not committed source the rule should police;
    // counting them would flag a collision between a hand-written component
    // and its generated copy. Skip anything git reports as ignored.
    // Best-effort: a non-git project (or absent git) scans everything.
    const ignored = await gitIgnoredSet(appDir, files.map((f) => f.rel));
    /** @type {Map<string, string[]>} tag -> rel files that register it (with repeats) */
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
      // Report once per DISTINCT file, naming the others.
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
  // A page / layout / component module that SHIPS to the browser must not
  // transitively import a server-only `.server.{ts,js}` module. The browser
  // gets a stub for the server file, so the import is harmless while the
  // module never loads client-side: a display-only page is elided, and an
  // import-only page (#605/#963) is dropped from the boot in favour of its
  // components. But the moment the page does its OWN client work (the client
  // router, a reactive primitive, module-scope code, a client-effecting util
  // on a component-free path) it ships whole, must load in the browser,
  // and drags the server import with it: the stub throws (or a server-only
  // export like `auth` is missing) the instant the module loads. That crash
  // only surfaces at runtime; typecheck and every other check pass.
  //
  // The rule reuses the BUILD'S elision verdict (analyzeElision) instead of
  // re-deriving it, so it fires ONLY on modules that genuinely ship: a
  // display-only page the framework elides is never flagged (that is the
  // legitimate pattern). The motivating case (crisp dogfood): a page that does
  // `await auth()` (import from `lib/auth.server.ts`) AND imports a component
  // directly, so it is not elided and ships the server import.
  await checkServerImportInBrowserModule(appDir, violations);

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

  return violations;
}

/**
 * BFS the module graph for the shortest import path from `from` to `to`,
 * returning every hop `[from, ..., to]` so the `no-server-import-in-browser-module`
 * message can print the FULL chain instead of an opaque `… ->` truncation (#804).
 * Falls back to `[from, to]` if no path is found (defensive; the caller only
 * calls this once `to` is known reachable).
 *
 * @param {Map<string, Set<string>>} graph
 * @param {string} from
 * @param {string} to
 * @returns {string[]}
 */
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

/**
 * Implements `no-server-import-in-browser-module`. Factored into its own
 * function (rather than an inline block) because it does the heavier
 * whole-app analysis the other rules avoid: it builds the module graph,
 * scans components, builds the route table, and runs the framework's own
 * elision analysis so the rule's notion of "ships to the browser" is
 * byte-for-byte the build's.
 *
 * A module is flagged when BOTH hold:
 *   1. It SHIPS to the browser. For a component that means it is NOT in the
 *      elidable set; for a page / layout that means it is NOT in the inert
 *      route-module set. (Pages and layouts that do real client work are not
 *      inert and therefore ship.)
 *   2. Its transitive import closure reaches a `.server.{ts,js}` module.
 *      `transitiveDeps` stops AT a server file (it is included but not walked
 *      into), so a server file pulled in only through another server file is
 *      not attributed to a browser module that never reaches it directly.
 *
 * Also flagged: error / loading / not-found modules. These ship to the browser
 * too (the dev server's `computeBrowserBoundFiles` adds them unconditionally)
 * and are never elided, so a server import reaching one of them is the same
 * throw-at-load crash.
 *
 * Never flagged: a `.server.ts` importing another `.server.ts` (server-to-
 * server, and `.server.*` modules are not components nor route modules), and
 * `middleware.ts` / `route.ts` (server-only, never page/layout/component
 * entries, so they are not in the candidate set to begin with).
 *
 * Scope note for dynamic imports: a string-literal `import('./widget.ts')` IS
 * tracked by the module graph now (#751), but only as a GATE edge (so the
 * lazily-imported module is servable); this rule's server-import detection
 * still runs over STATIC edges only (`transitiveDeps`), so a dynamic
 * `import('./x.server.ts')` of a no-`'use server'` utility is not flagged here.
 * That is deliberate: the throw-at-load crash is deferred to call time (when
 * the module is actually fetched), not module load, and a dynamic import is
 * also not elided framework-wide. A computed `import(expr)` cannot be resolved
 * statically at all; rather than a false-positive-prone check rule (a computed
 * import of an npm specifier or an otherwise-reachable app module is perfectly
 * valid, so it fails the check-is-correctness-only dividing line), the dev
 * server surfaces it with a 404 hint when the target 404s (see dev.js #751).
 *
 * @param {string} appDir
 * @param {Violation[]} violations  appended to in place
 */
async function checkServerImportInBrowserModule(appDir, violations) {
  // No `app/` directory means this is not a routable WebJs app (e.g. a bare
  // component library, or a fixture with only `lib/`); nothing ships, so the
  // rule has nothing to police. Skip rather than do the heavy analysis.
  if (!(await pathExists(join(appDir, 'app')))) return;

  let moduleGraph, components, routeTable;
  try {
    moduleGraph = await buildModuleGraph(appDir);
    components = await scanComponents(appDir);
    routeTable = await buildRouteTable(appDir);
  } catch {
    // A malformed app the analysis can't process is left to the other rules
    // (and the dev server) to surface; this rule degrades to a no-op.
    return;
  }

  // Page + layout modules that the router treats as route modules, exactly the
  // set the dev server feeds to analyzeElision (so the inert verdict matches).
  /** @type {Set<string>} */
  const routeModuleSet = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) routeModuleSet.add(page.file);
    for (const f of page.layouts || []) routeModuleSet.add(f);
  }
  const routeModules = [...routeModuleSet];

  // error / loading / not-found modules ALSO ship to the browser, but unlike
  // pages + layouts they are never elided: the dev server's
  // `computeBrowserBoundFiles` adds them to the browser-bound entry set
  // unconditionally (only ELIDABLE-COMPONENT imports are ever stripped, and
  // these modules have no component to strip). So a personalized 404 that does
  // `await auth()` is a real throw-at-load crash the page+layout-only candidate
  // set would miss. Collect them here and add them to the candidate set as
  // always-shipping (no elision verdict to consult).
  /** @type {Map<string, string>} abs file -> kind */
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

  // The elision flag mirrors `dev.js`: respect `webjs.elide === false` and the
  // WEBJS_ELIDE override. When elision is OFF, the build ships EVERY component
  // and route module, so the verdict is "nothing is elidable / inert" and the
  // rule treats every candidate as shipping (which is correct: with elision
  // off, a display-only page really does ship its server import too).
  const elideEnabled = await readElideEnabledForCheck(appDir);
  const { elidableComponents, inertRouteModules, importOnlyRouteModules } = elideEnabled
    ? await analyzeElision(components, routeModules, moduleGraph, (f) => readFile(f, 'utf8'), appDir)
    : { elidableComponents: new Set(), inertRouteModules: new Set(), importOnlyRouteModules: new Map() };

  // Candidate browser-shipped modules: components that are NOT elided, plus
  // route modules that are NOT inert and NOT import-only (an import-only
  // module is dropped from the boot in favour of its component frontier,
  // #605/#963, so its own imports never load in a browser and a bare
  // server-only import in it is harmless). A `.server.*` file is never a
  // component (the scanner skips it) nor a route module the browser loads, so
  // it cannot enter this set; server-to-server imports are excluded by
  // construction.
  /** @type {Map<string, { kind: string }>} relFile is keyed by ABS path */
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
  // error / loading / not-found modules always ship (never elided), so they are
  // candidates unconditionally. A page/layout entry already in `candidates`
  // wins (it is the more specific kind); these only add files not already seen.
  for (const [file, kind] of alwaysShipRouteModules) {
    if (!candidates.has(file)) candidates.set(file, { kind });
  }

  // Report at most once per module (a page importing two server modules is one
  // finding, naming the first reached). Sorted for deterministic output.
  for (const file of [...candidates.keys()].sort()) {
    // `transitiveDeps` skips nothing here, so it includes (but does not walk
    // into) any `.server.*` file reachable from this module. The module itself
    // is not in the result. A direct OR indirect server import both surface,
    // because the closure walks every non-server edge until it hits one.
    const closure = transitiveDeps(moduleGraph, [file], appDir);
    // Of the reachable server files, find one that is a genuine throw-at-load
    // crash in the browser. TWO kinds of `.server.*` import are NOT crashes and
    // must be skipped, or the rule false-positives on legitimate code:
    //   - A `'use server'` ACTION. The browser receives a working RPC stub
    //     whose exports POST to the server, so calling it from a shipping
    //     module is the intended pattern (the issue even lists it as a fix).
    //     Only a bare `.server.*` utility (no directive) gets the
    //     throw-at-module-load stub that crashes the page.
    //   - A PHANTOM edge to a file that does not exist on disk. The module
    //     graph keeps quoted-string CONTENT verbatim, so an `import` written
    //     inside a code-example string (the docs / website `<pre>` samples)
    //     resolves to a non-existent path. That import never runs, so it is
    //     not a crash; require the server file to actually exist.
    let serverDep = null;
    for (const d of closure) {
      if (!/\.server\.m?[jt]s$/.test(d)) continue;
      if (await isUseServerActionFile(d)) continue; // working RPC stub, not a crash
      if (!(await pathExists(d))) continue;          // phantom edge from a string sample
      serverDep = d;
      break;
    }
    if (!serverDep) continue;

    const { kind } = candidates.get(file);
    const relFile = relative(appDir, file);
    const relServer = relative(appDir, serverDep);
    // Name the import chain: if the server file is a DIRECT import of this
    // module, the chain is just the two; otherwise show one intermediate hop
    // so the diagnostic points at where the edge enters (the full path is
    // recoverable from the graph, but one hop is enough to locate it).
    const chainFiles = findImportChain(moduleGraph, file, serverDep);
    const chain = chainFiles.map((f) => relative(appDir, f)).join(' -> ');
    // If the edge into the server file comes from a types-shaped module, the
    // idiomatic fix is to relocate that type to a browser-safe typedef (#804).
    const importer = chainFiles.length >= 2 ? chainFiles[chainFiles.length - 2] : null;
    const viaTypesModule = importer && /(^|\/)types(\.m?[jt]s$|\/)/.test(relative(appDir, importer));

    // The "elides again" remedy only applies to a page / layout: since the
    // path-aware import-only verdict (#963), a page importing a component to
    // register is dropped from the boot, so a page/layout on this rule ships
    // because of its OWN client work (or a client-effecting non-component in
    // its closure); moving that work into a component makes it a dropped
    // carrier again and the server import never loads. The error / loading /
    // not-found boundaries always ship and are never elided, so offering
    // them an "elides again" fix is wrong. Branch the fix text on kind.
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

/**
 * Read whether component elision is enabled for `appDir`, mirroring
 * `dev.js`'s `readElideEnabled` so the check's notion of "ships" matches the
 * dev server's. Elision is ON unless `webjs.elide === false` in package.json or
 * the `WEBJS_ELIDE` env var forces it off (`0` / `false` / `off` / `no`). A
 * missing or malformed package.json keeps the default (on). Inlined rather
 * than imported from `dev.js` so the check tool does not pull the whole dev
 * server module just for this flag.
 *
 * @param {string} appDir
 * @returns {Promise<boolean>}
 */
/**
 * True if `file` is a `'use server'` action: a `.server.{ts,js}` module that
 * declares the `'use server'` directive. The dev server rewrites its browser
 * import into a working RPC stub (exports POST to the server), so importing it
 * from a shipping module is legitimate, NOT the throw-at-load crash the
 * no-server-import-in-browser-module rule catches. A bare `.server.*` utility
 * (no directive) instead gets a stub that throws when the module loads, which
 * IS the crash. Returns false on any read failure (treat an unreadable server
 * file as a potential crash, the conservative direction for this rule).
 *
 * @param {string} file absolute path to a `.server.*` file
 * @returns {Promise<boolean>}
 */
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
    // No package.json, malformed JSON, or unreadable: keep the default.
  }
  return true;
}

/**
 * Async fs.exists shim. Returns true if the path exists at all (file
 * or directory), false on ENOENT or any other stat failure.
 *
 * @param {string} p absolute path
 * @returns {Promise<boolean>}
 */
async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * The subset of `rels` (appDir-relative paths) that git reports as ignored,
 * via a single batched `git check-ignore --stdin`. Best-effort: returns an
 * empty Set when the directory is not a git repo, git is absent, or the
 * spawn fails, so a non-git project scans every file as before. Runs with
 * `cwd: appDir` and the inherited GIT_* env stripped so cwd is the sole
 * authority on which repo + .gitignore stack is consulted (a pre-commit
 * hook from a linked worktree exports GIT_WORK_TREE, which would otherwise
 * override cwd-based discovery; same reason the doctor vendor-gitignore check
 * strips them).
 * Works for an in-repo sub-package with no nested `.git` too: git walks up
 * to the monorepo root and resolves the relative paths against cwd.
 *
 * @param {string} appDir absolute app directory
 * @param {string[]} rels appDir-relative file paths
 * @returns {Promise<Set<string>>}
 */
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
    // `git check-ignore --stdin` exits 0 when ≥1 path is ignored (those
    // paths are echoed on stdout), 1 when none are ignored, >1 on error.
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
    // git missing or spawn failure: scan everything (no filter).
  }
  return out;
}
