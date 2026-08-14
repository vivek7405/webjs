/**
 * Routing and template rules: what a route handler may throw, what a non-root
 * layout may emit, and which holes a template may carry.
 *
 * Lifted verbatim out of checkConventions, which held all twenty rules inline
 * in one 900-line function. Each rule keeps its original comment header, its
 * logic, and its position in the run order.
 */
import {
  isServerActionFile, isComponentFile,
} from './helpers.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 * @typedef {{ abs: string, rel: string, content: string, scan: string }} ScannedFile
 */


/**
 * Rule: `no-redirect-in-api-route`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkNoRedirectInApiRoute(files, violations) {
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
}

/**
 * Rule: `no-interpolation-in-raw-text-element`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkNoInterpolationInRawTextElement(files, violations) {
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
}

/**
 * Rule: `no-server-env-in-components`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkNoServerEnvInComponents(files, violations) {
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
}

/**
 * Rule: `shell-in-non-root-layout`.
 *
 * @param {ScannedFile[]} files  every JS/TS file in the app, raw and redacted
 * @param {Violation[]} violations  accumulator the rule pushes onto
 * @returns {void}
 */
export function checkShellInNonRootLayout(files, violations) {
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
}
