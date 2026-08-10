import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Set of package names whose importmap entries are populated by the
 * framework, not by the vendor scanner.
 */
export const BUILTIN = new Set(['@webjsdev/core', '@webjsdev/core/']);

/**
 * Server-only framework packages that must NEVER be vendored to the browser.
 */
export const FRAMEWORK_SERVER_ONLY = new Set(['@webjsdev/cli', '@webjsdev/server', '@webjsdev/mcp']);

/**
 * Extract the package name from a bare specifier.
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

const IMPORT_RE = /\bimport\s+(?!type\s)(?:(?:[\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /(^|[^:])\/\/.*$/gm;

function stripComments(src) {
  return src.replace(BLOCK_COMMENT_RE, '').replace(LINE_COMMENT_RE, '$1');
}

function isServerOnlyFile(name) {
  if (/\.server\.(js|ts|mjs|mts)$/.test(name)) return true;
  if (/^route\.(js|ts|mjs|mts)$/.test(name)) return true;
  if (/^middleware\.(js|ts|mjs|mts)$/.test(name)) return true;
  return false;
}

const CONFIG_FILE_RE = /\.config\.(js|ts|mjs|mts|cjs|cts)$/;

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
      (e.isDirectory() && e.name.startsWith('.'))
    ) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, found, skipFiles);
    } else if (skipFiles && skipFiles.has(full)) {
      continue;
    } else if (/\.(js|ts|mjs|mts)$/.test(e.name) && !isServerOnlyFile(e.name) && !CONFIG_FILE_RE.test(e.name)) {
      try {
        const raw = await readFile(full, 'utf8');
        if (raw.trimStart().startsWith("'use server'") || raw.trimStart().startsWith('"use server"')) continue;
        const src = stripComments(raw);
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
 * @param {string} dir
 * @param {Set<string>} [skipFiles]
 * @returns {Promise<Set<string>>}
 */
export async function scanBareImports(dir, skipFiles) {
  /** @type {Set<string>} */
  const found = new Set();
  await walk(dir, found, skipFiles);
  for (const b of BUILTIN) found.delete(b);
  for (const spec of found) {
    const p = extractPackageName(spec);
    if (p && FRAMEWORK_SERVER_ONLY.has(p)) found.delete(spec);
  }
  return found;
}
