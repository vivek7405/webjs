import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { walk } from '../fs-walk.js';
import {
  redactStringsAndTemplates,
} from '../js-scan.js';
import {
  checkComponentsHaveRegister,
  checkNoStaticProperties,
  checkReactivePropsNoClassField,
  checkArrayPropUsesArrayType,
  checkNoBrowserGlobalsInRender,
  checkNoShadowedNativeMember,
} from './rules-components.js';
import {
  checkNoRedirectInApiRoute,
  checkNoInterpolationInRawTextElement,
  checkNoServerEnvInComponents,
  checkShellInNonRootLayout,
} from './rules-routing.js';
import {
  checkErasableTypescriptOnly,
  checkNoNonErasableTypescript,
} from './rules-typescript.js';
import {
  checkUseServerNeedsExtension,
  checkUseServerExportsCallable,
  checkOneActionPerConfiguredFile,
} from './rules-actions.js';
import {
  checkTagNameHasHyphen,
  checkNoDuplicateTag,
} from './rules-registry.js';
import { checkServerImportInBrowserModule } from './runner-support.js';
import {
  checkNoMissingLocalImport,
  checkFormActionNotAGetAction,
} from './rules-imports.js';

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

  checkComponentsHaveRegister(files, violations);
  checkNoStaticProperties(files, violations);
  checkReactivePropsNoClassField(files, violations);
  checkArrayPropUsesArrayType(files, violations);
  checkNoBrowserGlobalsInRender(files, violations);
  checkNoShadowedNativeMember(files, violations);
  checkNoRedirectInApiRoute(files, violations);
  checkNoInterpolationInRawTextElement(files, violations);
  checkNoServerEnvInComponents(files, violations);
  checkShellInNonRootLayout(files, violations);
  await checkErasableTypescriptOnly(appDir, violations);
  await checkNoNonErasableTypescript(appDir, violations);
  checkUseServerNeedsExtension(files, violations);
  checkUseServerExportsCallable(files, violations);
  checkOneActionPerConfiguredFile(files, violations);
  checkTagNameHasHyphen(files, violations);
  await checkNoDuplicateTag(appDir, files, violations);
  await checkServerImportInBrowserModule(appDir, violations);
  checkNoMissingLocalImport(appDir, files, violations);
  checkFormActionNotAGetAction(appDir, files, violations);

  return violations;
}
