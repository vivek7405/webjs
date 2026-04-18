import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep, basename, dirname } from 'node:path';
import { walk } from './fs-walk.js';

/**
 * Convention validator for webjs apps.
 *
 * Scans an app directory and reports deviations from the conventions
 * documented in AGENTS.md. Designed to be run by AI agents, CI pipelines,
 * or `webjs lint` to catch structural mistakes early.
 *
 * **How AI agents should use the output:**
 * Each violation includes a machine-readable `rule` identifier, the offending
 * `file` (relative to appDir), a human-readable `message`, and a suggested
 * `fix`. Agents should iterate the array and apply (or propose) the fixes.
 * Rules can be disabled per-project via `webjs.conventions.js` or the
 * `"conventions"` key in `package.json`.
 *
 * @module check
 */

/**
 * @typedef {{
 *   rule: string,
 *   file: string,
 *   message: string,
 *   fix: string,
 * }} Violation
 */

/**
 * @typedef {{
 *   name: string,
 *   description: string,
 * }} RuleDescriptor
 */

/**
 * All available rule names with descriptions. Useful for help text and
 * documentation generators.
 *
 * @type {RuleDescriptor[]}
 */
export const RULES = [
  {
    name: 'actions-in-modules',
    description:
      'Server action files (*.server.{js,ts} or \'use server\') should live under modules/*/actions/ or modules/*/queries/, not loose in the app root. Skipped when no modules/ directory exists.',
  },
  {
    name: 'one-function-per-action',
    description:
      'Each .server.{js,ts} file should export exactly one async function (one-function-per-file convention).',
  },
  {
    name: 'components-have-define',
    description:
      'Component files that define a class extending WebComponent must register the class with customElements.define(). The server-side scanner derives the module URL from the file path at boot.',
  },
  {
    name: 'no-server-imports-in-components',
    description:
      'Component files must not directly import from @prisma/client, node:*, or lib/ paths.',
  },
  {
    name: 'tests-exist',
    description:
      'Each modules/<feature>/ directory should have corresponding test files under test/unit/ or test/e2e/.',
  },
  {
    name: 'tag-name-has-hyphen',
    description:
      'Static tag = \'...\' in component files must contain a hyphen (HTML custom element spec).',
  },
];

/** Set of all known rule names for fast lookup. */
const RULE_NAMES = new Set(RULES.map((r) => r.name));

/**
 * Check whether a file is a server action file based on its name or content.
 * @param {string} filePath - absolute path
 * @param {string} content - file content (already read)
 * @returns {boolean}
 */
function isServerActionFile(filePath, content) {
  if (/\.server\.m?[jt]s$/.test(filePath)) return true;
  const head = content.split('\n').slice(0, 5).join('\n');
  return /^\s*(['"])use server\1\s*;?\s*$/m.test(head);
}

/**
 * Check whether a file resides under a components/ directory (shared or
 * module-scoped).
 * @param {string} relPath - path relative to appDir
 * @returns {boolean}
 */
function isComponentFile(relPath) {
  const segments = relPath.split(sep);
  return segments.includes('components');
}

/**
 * Load overrides from `webjs.conventions.js` (default export) or the
 * `"conventions"` key in `package.json`. Returns a map of rule name to
 * boolean (true = enabled, false = disabled). Missing rules default to true.
 *
 * @param {string} appDir
 * @returns {Promise<Record<string, boolean>>}
 */
async function loadOverrides(appDir) {
  /** @type {Record<string, boolean>} */
  let overrides = {};

  // Try webjs.conventions.js first
  try {
    const conventionsPath = join(appDir, 'webjs.conventions.js');
    await stat(conventionsPath);
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL(conventionsPath).toString());
    const cfg = mod.default || mod;
    if (cfg && typeof cfg === 'object') {
      overrides = /** @type {Record<string, boolean>} */ (cfg);
    }
  } catch {
    // No conventions file — try package.json
    try {
      const pkgPath = join(appDir, 'package.json');
      const pkgText = await readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgText);
      if (pkg.conventions && typeof pkg.conventions === 'object') {
        overrides = pkg.conventions;
      }
    } catch {
      // No package.json or no conventions key — everything enabled
    }
  }

  return overrides;
}

/**
 * Check whether a rule is enabled given the overrides.
 * @param {string} ruleName
 * @param {Record<string, boolean>} overrides
 * @returns {boolean}
 */
function isRuleEnabled(ruleName, overrides) {
  if (ruleName in overrides) return overrides[ruleName] !== false;
  return true;
}

/**
 * Guess a module name from a loose server action file path. Used for the
 * `fix` suggestion in `actions-in-modules`.
 * @param {string} relPath
 * @returns {string}
 */
function guessModuleName(relPath) {
  const segments = relPath.split(sep);
  // Try to infer from the parent directory name
  // e.g. app/api/users/create.server.ts -> "users"
  for (let i = segments.length - 2; i >= 0; i--) {
    const seg = segments[i];
    if (seg !== 'app' && seg !== 'api' && !seg.startsWith('[') && !seg.startsWith('(') && !seg.startsWith('_')) {
      return seg;
    }
  }
  // Fall back to the file stem
  const base = basename(relPath).replace(/\.server\.m?[jt]s$/, '').replace(/\.m?[jt]s$/, '');
  return base;
}

/**
 * Count the number of named exported async functions in source text using
 * regex heuristics (no AST — intentionally fast and loose).
 *
 * Looks for patterns like:
 *   export async function name(...)
 *   export const name = async (...)
 *   export const name = async function(...)
 *   export default async function(...)
 *
 * @param {string} content
 * @returns {number}
 */
function countExportedFunctions(content) {
  const patterns = [
    /export\s+async\s+function\s+\w+/g,
    /export\s+const\s+\w+\s*=\s*async\s/g,
    /export\s+default\s+async\s+function/g,
    /export\s+function\s+\w+/g,
    /export\s+const\s+\w+\s*=\s*(?:async\s*)?\(/g,
    /export\s+const\s+\w+\s*=\s*(?:async\s*)?function/g,
  ];
  const seen = new Set();
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(content)) !== null) {
      seen.add(m.index);
    }
  }
  return seen.size;
}

/**
 * Scan a webjs app directory and report convention violations.
 *
 * @param {string} appDir - absolute path to the app root (the directory
 *   containing `app/`, `modules/`, `components/`, etc.)
 * @param {{ rules?: Record<string, boolean> }} [opts] - programmatic
 *   overrides. Merged on top of file-based overrides (package.json /
 *   webjs.conventions.js). Set a rule to `false` to skip it.
 * @returns {Promise<Violation[]>}
 *
 * @example
 * ```js
 * import { checkConventions } from '@webjs/server';
 * const violations = await checkConventions('/path/to/myapp');
 * for (const v of violations) {
 *   console.warn(`[${v.rule}] ${v.file}: ${v.message}`);
 * }
 * ```
 */
export async function checkConventions(appDir, opts) {
  const fileOverrides = await loadOverrides(appDir);
  const overrides = { ...fileOverrides, ...(opts?.rules || {}) };

  /** @type {Violation[]} */
  const violations = [];

  // Determine if modules/ directory exists (small apps exempt from some rules)
  let hasModulesDir = false;
  try {
    const s = await stat(join(appDir, 'modules'));
    hasModulesDir = s.isDirectory();
  } catch {
    // no modules/ dir
  }

  // Determine which module feature names exist
  /** @type {string[]} */
  const moduleNames = [];
  if (hasModulesDir) {
    try {
      const entries = await readdir(join(appDir, 'modules'), { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && !e.name.startsWith('.')) {
          moduleNames.push(e.name);
        }
      }
    } catch {
      // could not read modules/
    }
  }

  // Collect all JS/TS files in the app directory
  /** @type {{ abs: string, rel: string, content: string }[]} */
  const files = [];
  for await (const abs of walk(appDir, (p) => /\.m?[jt]sx?$/.test(p))) {
    const rel = relative(appDir, abs);
    let content;
    try {
      content = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    files.push({ abs, rel, content });
  }

  // --- Rule: actions-in-modules ---
  if (hasModulesDir && isRuleEnabled('actions-in-modules', overrides)) {
    for (const { abs, rel, content } of files) {
      if (!isServerActionFile(abs, content)) continue;
      // Files already inside modules/*/actions/ or modules/*/queries/ are fine
      const normRel = rel.split(sep).join('/');
      if (/^modules\/[^/]+\/(actions|queries)\//.test(normRel)) continue;
      // Files inside modules/ but not in actions/queries/ — also flag these
      // but skip files that are in other valid module subdirs (components, utils)
      if (/^modules\/[^/]+\/(components|utils)\//.test(normRel)) continue;
      // If inside modules/ at all but wrong subdir, still flag
      const moduleName = guessModuleName(rel);
      const fileBase = basename(rel);
      violations.push({
        rule: 'actions-in-modules',
        file: rel,
        message: `Server action should be in modules/${moduleName}/actions/`,
        fix: `Move to modules/${moduleName}/actions/${fileBase}`,
      });
    }
  }

  // --- Rule: one-function-per-action ---
  if (isRuleEnabled('one-function-per-action', overrides)) {
    for (const { abs, rel, content } of files) {
      if (!isServerActionFile(abs, content)) continue;
      const count = countExportedFunctions(content);
      if (count > 1) {
        violations.push({
          rule: 'one-function-per-action',
          file: rel,
          message: `Server action file exports ${count} functions; convention is one per file`,
          fix: 'Split into separate .server.{js,ts} files, one exported function each',
        });
      }
    }
  }

  // --- Rule: components-have-define ---
  if (isRuleEnabled('components-have-define', overrides)) {
    for (const { rel, content } of files) {
      if (!isComponentFile(rel)) continue;
      // Check if it defines a class extending WebComponent
      if (!/class\s+\w+\s+extends\s+WebComponent/.test(content)) continue;
      // Check for a customElements.define(...) call.
      if (/\bcustomElements\.define\s*\(/.test(content)) continue;
      violations.push({
        rule: 'components-have-define',
        file: rel,
        message: 'Component extends WebComponent but does not register with customElements.define()',
        fix: "Add customElements.define('tag-name', ClassName) after the class definition",
      });
    }
  }

  // --- Rule: no-server-imports-in-components ---
  if (isRuleEnabled('no-server-imports-in-components', overrides)) {
    for (const { abs, rel, content } of files) {
      if (!isComponentFile(rel)) continue;
      // Skip server action files — they are allowed to import anything
      if (isServerActionFile(abs, content)) continue;

      const importPatterns = [
        { re: /import\s+.*from\s+['"]@prisma\/client['"]/gm, label: '@prisma/client' },
        { re: /import\s+.*from\s+['"]node:[^'"]+['"]/gm, label: 'node:* built-in' },
        { re: /import\s+.*from\s+['"]\.{0,2}\/lib\/[^'"]*['"]/gm, label: 'lib/' },
      ];

      for (const { re, label } of importPatterns) {
        const match = re.exec(content);
        if (match) {
          violations.push({
            rule: 'no-server-imports-in-components',
            file: rel,
            message: `Component imports ${label} directly; this will break in the browser`,
            fix: 'Move the import into a .server.{js,ts} file and call it via a server action',
          });
        }
      }
    }
  }

  // --- Rule: tests-exist ---
  if (hasModulesDir && isRuleEnabled('tests-exist', overrides)) {
    for (const mod of moduleNames) {
      // Look for test files that reference this module
      let hasTest = false;

      // Check test/unit/ and test/e2e/
      for (const testDir of ['test/unit', 'test/e2e', 'test']) {
        try {
          const testDirAbs = join(appDir, testDir);
          for await (const testFile of walk(testDirAbs, (p) => /\.(test|spec)\.m?[jt]sx?$/.test(p))) {
            const testRel = relative(appDir, testFile);
            // Check if test file name contains the module name
            if (testRel.toLowerCase().includes(mod.toLowerCase())) {
              hasTest = true;
              break;
            }
          }
        } catch {
          // test directory doesn't exist
        }
        if (hasTest) break;
      }

      if (!hasTest) {
        violations.push({
          rule: 'tests-exist',
          file: `modules/${mod}`,
          message: `No test files found for module "${mod}"`,
          fix: `Add test files under test/unit/${mod}.test.js or test/e2e/${mod}.test.js`,
        });
      }
    }
  }

  // --- Rule: tag-name-has-hyphen ---
  if (isRuleEnabled('tag-name-has-hyphen', overrides)) {
    for (const { rel, content } of files) {
      if (!isComponentFile(rel)) continue;
      // Match customElements.define('...', ...) calls.
      const tagRe = /\bcustomElements\.define\s*\(\s*(['"])([^'"]+)\1/g;
      let match;
      while ((match = tagRe.exec(content)) !== null) {
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

  return violations;
}
