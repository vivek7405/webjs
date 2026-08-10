import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Set of package names whose importmap entries are populated by the
 * framework, not by the vendor scanner. The scanner skips these to
 * keep `@webjsdev/core` (and any future framework-internal package)
 * off the jspm.io path: their bytes are served by the dev server's
 * dedicated `/__webjs/core/*` route, and `buildCoreEntries()` in
 * `importmap.js` derives one importmap line per exported subpath
 * directly from the package's own `exports` field.
 *
 * The `'@webjsdev/core/'` prefix entry is here so that `extractPackageName`
 * returning the bare name is enough to recognise core-subpath imports
 * (`@webjsdev/core/directives`, `@webjsdev/core/task`, …) and skip
 * them; the prefix form catches anything whose extractPackageName
 * returns null but whose specifier starts with the prefix. Same
 * mechanism, no special casing per subpath.
 */
export const BUILTIN = new Set(['@webjsdev/core', '@webjsdev/core/']);

/**
 * Server-only framework packages that must NEVER be vendored to the browser.
 * Unlike `@webjsdev/core` (browser-bound, served locally via `/__webjs/core/*`),
 * these are pure server packages: the CLI, the SSR runtime, the MCP server. A
 * stray browser-graph scan
 * that surfaces one of them must not push it onto the jspm path (#713). Matched
 * on the extracted package name, so subpaths (`@webjsdev/cli/bin/webjs.js`) are
 * covered. `@webjsdev/ui` is intentionally absent: its components ARE
 * browser-bound, so it stays vendorable.
 */
export const FRAMEWORK_SERVER_ONLY = new Set(['@webjsdev/cli', '@webjsdev/server', '@webjsdev/mcp']);

/**
 * Extract the package name from a bare specifier.
 * `'dayjs'`             → `'dayjs'`
 * `'dayjs/locale/en'`   → `'dayjs'`
 * `'@tanstack/query'`   → `'@tanstack/query'`
 * `'@tanstack/query/x'` → `'@tanstack/query'`
 * `'./foo'`, `'../bar'`, `'/baz'` → `null` (relative/absolute)
 * `'#components/x.ts'`, `'#lib/db'` → `null` (`#` path alias, #555: resolves to
 *   a LOCAL file via `package.json` "imports", never an npm package, so it must
 *   not be sent to the vendor resolver, #623)
 *
 * @param {string} spec
 * @returns {string | null}
 */
export function extractPackageName(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('__') || spec.startsWith('#')) return null;
  if (/^[a-z]+:/.test(spec)) return null;
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return spec.split('/')[0];
}

// Matches `import { x } from 'pkg'`, `import 'pkg'`, `import * as x from 'pkg'`.
// The `(?!type\s)` negative lookahead skips `import type … from 'pkg'`
// because TypeScript type-only imports are fully erased at compile time
// and never reach the browser.
const IMPORT_RE = /\bimport\s+(?!type\s)(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /(^|[^:])\/\/.*$/gm;

function stripComments(src) {
  return src.replace(BLOCK_COMMENT_RE, '').replace(LINE_COMMENT_RE, '$1');
}

/**
 * Filename matches webjs's server-only file-router conventions.
 *
 * @param {string} name  basename of the file
 */
function isServerOnlyFile(name) {
  if (/\.server\.(js|ts|mjs|mts)$/.test(name)) return true;
  if (/^route\.(js|ts|mjs|mts)$/.test(name)) return true;
  if (/^middleware\.(js|ts|mjs|mts)$/.test(name)) return true;
  return false;
}

/**
 * Tooling config files at any depth. They import test runners, build
 * helpers, AI plugins etc. that legitimately cannot resolve through
 * jspm.io (e.g. `@web/test-runner-playwright` pulls in `playwright-core`
 * with subpaths jspm.io can't bundle). Their bare imports must never
 * reach the importmap.
 */
const CONFIG_FILE_RE = /\.config\.(js|ts|mjs|mts|cjs|cts)$/;

/**
 * @param {string} dir
 * @param {Set<string>} found
 */
async function walk(dir, found, skipFiles) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (
      e.name === 'node_modules' ||
      e.name === '.webjs' ||
      e.name === 'public' ||
      e.name === 'test' ||
      e.name === 'tests' ||
      e.name.startsWith('_') ||
      // Skip ALL dot-prefixed dirs (.opencode, .claude, .github, .husky,
      // .git, .vscode, .idea, .cursor, …). They hold tooling / IDE /
      // agent state that imports packages the browser will never load
      // (e.g. `@opencode-ai/plugin`). The walker visits dirs and files
      // separately; this guard only fires for directory entries because
      // dot-prefixed *files* (e.g. `.env.d.ts` someday) still need the
      // extension check below.
      (e.isDirectory() && e.name.startsWith('.'))
    ) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, found, skipFiles);
    } else if (skipFiles && skipFiles.has(full)) {
      // Display-only component file: its imports are stripped from the
      // served source, so a vendor specifier reachable ONLY through it
      // never loads in the browser and must not enter the importmap. A
      // specifier also imported by a shipping file still appears via that
      // file's scan, so shared deps are retained.
      continue;
    } else if (/\.(js|ts|mjs|mts)$/.test(e.name) && !isServerOnlyFile(e.name) && !CONFIG_FILE_RE.test(e.name)) {
      try {
        const raw = await readFile(full, 'utf8');
        if (raw.trimStart().startsWith("'use server'") || raw.trimStart().startsWith('"use server"')) continue;
        const src = stripComments(raw);
        // We keep the FULL specifier (with subpath), not just the package
        // name. `import 'dayjs/plugin/utc'` adds `'dayjs/plugin/utc'` to the
        // set, not just `'dayjs'`. vendorImportMapEntries needs the
        // subpath to emit a per-specifier importmap entry; jspm.io
        // resolves each subpath independently via the package's `exports`
        // field. extractPackageName is still applied to filter out
        // relative / absolute / protocol-URL specifiers.
        for (const m of src.matchAll(IMPORT_RE)) {
          if (extractPackageName(m[1])) found.add(m[1]);
        }
        for (const m of src.matchAll(DYNAMIC_IMPORT_RE)) {
          if (extractPackageName(m[1])) found.add(m[1]);
        }
      } catch { /* unreadable file */ }
    }
  }
}

/**
 * Scan source files under `dir` for bare import specifiers reachable
 * from the browser. Returns a Set of package names.
 *
 * Excludes:
 *   - `node_modules`, `.webjs`, `public` directories
 *   - Any directory starting with `_` (webjs `_private/` convention)
 *   - `test/` and `tests/` (server-only by WebJs convention)
 *   - Files whose name marks them as server-only:
 *       * `*.server.{js,ts,mjs,mts}` (path-level boundary)
 *       * `route.{js,ts,mjs,mts}` (file-router HTTP handler)
 *       * `middleware.{js,ts,mjs,mts}` (file-router middleware)
 *   - Any file whose first non-whitespace content is `'use server'`
 *   - `import type` statements (TypeScript erases them at compile time)
 *   - `import` strings inside `/* … *​/` block comments or `//` line comments
 *
 * @param {string} dir
 * @returns {Promise<Set<string>>}
 */
export async function scanBareImports(dir, skipFiles) {
  /** @type {Set<string>} */
  const found = new Set();
  await walk(dir, found, skipFiles);
  for (const b of BUILTIN) found.delete(b);
  // Drop server-only framework packages (and their subpaths) so they never
  // reach the importmap / jspm path (#713).
  for (const spec of found) {
    const p = extractPackageName(spec);
    if (p && FRAMEWORK_SERVER_ONLY.has(p)) found.delete(spec);
  }
  return found;
}
