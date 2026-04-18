/**
 * Server-side scanner that walks the app tree and records the
 * browser-visible URL for every webjs component class declared in
 * `.js`/`.ts`/`.mjs`/`.mts` files.
 *
 * Called once at server boot. Results are used to prime the core
 * registry (`primeModuleUrl`) BEFORE any SSR render — so when a page
 * renders a component tag, `lookupModuleUrl(tag)` already has the URL
 * ready for `<link rel="modulepreload">` hints.
 *
 * Regex-based on purpose: the framework is no-build and keeps the
 * server cold-start cheap. A full TS parse (via web-component-analyzer
 * or typescript) would be ~50× slower for no payoff here — we only
 * need to extract `{ className, tag, file }` tuples.
 */

import { readFile } from 'node:fs/promises';
import { relative, sep } from 'node:path';
import { walk } from './fs-walk.js';
import { primeModuleUrl } from 'webjs';

/**
 * Recognise class declarations shaped like
 *
 *     export class Foo extends WebComponent {
 *       static tag = 'foo-el';
 *       …
 *     }
 *
 * Works with any base class name — we don't hard-require `WebComponent`
 * so test fixtures that extend a local base or plain `HTMLElement`
 * aren't invisible.
 *
 * @param {string} src
 * @returns {Array<{ className: string, tag: string }>}
 */
export function extractComponents(src) {
  /** @type {Array<{ className: string, tag: string }>} */
  const results = [];
  // Locate the class header. Body-balanced matching happens below because
  // regex alone can't handle nested braces (method bodies, objects, etc.).
  const headerRe = /\b(?:export\s+)?(?:default\s+)?class\s+([A-Z][A-Za-z0-9_$]*)\s+extends\s+[A-Za-z0-9_$.]+\s*\{/g;
  let m;
  while ((m = headerRe.exec(src)) !== null) {
    const className = m[1];
    const bodyStart = m.index + m[0].length;
    const bodyEnd = findMatchingBrace(src, bodyStart - 1);
    if (bodyEnd < 0) continue;
    const body = src.slice(bodyStart, bodyEnd);
    const tagMatch = body.match(/\bstatic\s+tag(?:\s*:\s*\w+)?\s*=\s*['"]([^'"\n]+)['"]/);
    if (tagMatch && tagMatch[1].includes('-')) {
      results.push({ className, tag: tagMatch[1] });
    }
    headerRe.lastIndex = bodyEnd + 1;
  }
  return results;
}

/**
 * Given the index of an opening `{`, return the index of its matching
 * `}`, or -1 if unbalanced. Ignores braces inside string / template
 * literals and line / block comments. Not a full tokenizer but close
 * enough for component class bodies.
 *
 * @param {string} src
 * @param {number} openIdx
 * @returns {number}
 */
function findMatchingBrace(src, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      // line comment
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i = skipString(src, i, c);
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Skip past a quoted string. Handles escapes. For template literals
 * we ignore `${}` holes — nested braces there could technically close
 * an outer class, but in practice component source doesn't pack
 * classes inside template strings.
 *
 * @param {string} src
 * @param {number} start
 * @param {string} quote
 * @returns {number}
 */
function skipString(src, start, quote) {
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === quote) return i + 1;
    i++;
  }
  return src.length;
}

/**
 * Walk an app directory, return every discovered component with its
 * browser-visible URL (rooted at `/`, matching how the dev server
 * serves module files).
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ tag: string, className: string, moduleUrl: string, file: string }>>}
 */
export async function scanComponents(appDir) {
  /** @type {Array<{ tag: string, className: string, moduleUrl: string, file: string }>} */
  const components = [];
  const filter = (p) =>
    /\.m?[jt]sx?$/.test(p) &&
    !/\.(test|spec)\.m?[jt]sx?$/.test(p) &&
    !/\.server\.m?[jt]s$/.test(p);

  for await (const file of walk(appDir, filter)) {
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    const comps = extractComponents(src);
    if (!comps.length) continue;
    const moduleUrl = toUrlPath(file, appDir);
    for (const c of comps) {
      components.push({ ...c, moduleUrl, file });
    }
  }
  return components;
}

/**
 * Scan the app tree and push every component's (tag, moduleUrl) pair
 * into the core registry via `primeModuleUrl`. Idempotent: if called
 * again (e.g. on dev-server rebuild after a file add), new discoveries
 * are added and existing tags are updated.
 *
 * @param {string} appDir
 * @returns {Promise<{ count: number }>}
 */
export async function primeComponentRegistry(appDir) {
  const components = await scanComponents(appDir);
  for (const { tag, moduleUrl } of components) {
    primeModuleUrl(tag, moduleUrl);
  }
  return { count: components.length };
}

/**
 * @param {string} abs
 * @param {string} appDir
 * @returns {string}
 */
function toUrlPath(abs, appDir) {
  let rel = abs.startsWith(appDir) ? abs.slice(appDir.length) : abs;
  rel = rel.split(sep).join('/');
  if (!rel.startsWith('/')) rel = '/' + rel;
  return rel;
}
