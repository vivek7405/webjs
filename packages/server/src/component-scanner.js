/**
 * Server-side scanner that walks the app tree and records the
 * browser-visible URL for every webjs component module.
 *
 * Called once at server boot. Results are used to prime the core
 * registry (`primeModuleUrl`) BEFORE any SSR render — so when a page
 * renders a component tag, `lookupModuleUrl(tag)` already has the URL
 * ready for `<link rel="modulepreload">` hints.
 *
 * The convention webjs uses is the web-standard one:
 *
 *     class Counter extends WebComponent { … }
 *     customElements.define('my-counter', Counter);
 *
 * The scanner looks for `customElements.define('<tag>', <ClassName>)`
 * calls — static text patterns that are cheap to regex-match without
 * a full TS parse. A full parse would be ~50× slower for no payoff;
 * we only need `{ tag, className, moduleUrl }` tuples.
 */

import { readFile } from 'node:fs/promises';
import { sep } from 'node:path';
import { walk } from './fs-walk.js';
import { primeModuleUrl } from '@webjs/core';

/**
 * Recognise either registration pattern:
 *
 *     Counter.register('my-counter')           // idiomatic webjs
 *     customElements.define('my-counter', Counter)  // native DOM API
 *
 * Both single and double quotes; whitespace is flexible.
 *
 * @param {string} src
 * @returns {Array<{ className: string, tag: string }>}
 */
export function extractComponents(src) {
  /** @type {Array<{ className: string, tag: string }>} */
  const results = [];
  // Pattern A: Class.register('tag')
  const registerRe = /\b([A-Z][A-Za-z0-9_$]*)\.register\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  let m;
  while ((m = registerRe.exec(src)) !== null) {
    const className = m[1];
    const tag = m[2];
    if (tag.includes('-')) {
      results.push({ className, tag });
    }
  }
  // Pattern B: customElements.define('tag', Class)
  const defineRe = /\bcustomElements\.define\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*([A-Z][A-Za-z0-9_$]*)\b/g;
  while ((m = defineRe.exec(src)) !== null) {
    const tag = m[1];
    const className = m[2];
    if (tag.includes('-')) {
      results.push({ className, tag });
    }
  }
  return results;
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
 * Find `class X extends WebComponent` (or its subclasses) declarations
 * that are NOT accompanied by a `customElements.define(tag, X)` call in
 * the same file. Lets the dev server warn authors early when they
 * forget the registration step.
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ className: string, file: string }>>}
 */
export async function findOrphanComponents(appDir) {
  /** @type {Array<{ className: string, file: string }>} */
  const orphans = [];
  const filter = (p) =>
    /\.m?[jt]sx?$/.test(p) &&
    !/\.(test|spec)\.m?[jt]sx?$/.test(p) &&
    !/\.server\.m?[jt]s$/.test(p);

  for await (const file of walk(appDir, filter)) {
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    // Find every class that extends WebComponent (exact name — we trust
    // the framework convention).
    const classRe = /\b(?:export\s+)?(?:default\s+)?class\s+([A-Z][A-Za-z0-9_$]*)\s+extends\s+WebComponent\b/g;
    // A class counts as "registered" if either Class.register('tag') or
    // customElements.define('tag', Class) appears in the file.
    const registerRe = /\b([A-Z][A-Za-z0-9_$]*)\.register\s*\(\s*['"][^'"]+['"]\s*\)/g;
    const defineRe = /\bcustomElements\.define\s*\(\s*['"][^'"]+['"]\s*,\s*([A-Z][A-Za-z0-9_$]*)\b/g;

    const declared = new Set();
    let m;
    while ((m = classRe.exec(src)) !== null) declared.add(m[1]);
    if (declared.size === 0) continue;

    const registered = new Set();
    while ((m = registerRe.exec(src)) !== null) registered.add(m[1]);
    while ((m = defineRe.exec(src)) !== null) registered.add(m[1]);

    for (const cls of declared) {
      if (!registered.has(cls)) {
        orphans.push({ className: cls, file });
      }
    }
  }
  return orphans;
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
