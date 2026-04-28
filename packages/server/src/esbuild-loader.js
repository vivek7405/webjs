/**
 * Node.js ESM loader hook that routes every server-side `.ts` / `.mts`
 * import through esbuild — the same transformer the dev server uses to
 * serve TypeScript to the browser.
 *
 * Why: SSR and hydration must produce identical JS. Without this hook,
 * Node would strip types using its built-in stripper (erasable-only,
 * rejects enums/decorators/parameter properties), while the browser
 * would receive esbuild-transformed code (full TS support). The mismatch
 * surfaces as "works in browser, throws on server" surprises.
 *
 * Registered from `dev.js` and `index.js` via `module.register()` before
 * any user-app `.ts` file is imported.
 *
 * Caches transformed source by file mtime so repeated imports are
 * effectively free.
 */

import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** @type {Map<string, { mtimeMs: number, source: string }>} */
const cache = new Map();

/** @type {typeof import('esbuild').transform | null} */
let esbuildTransform = null;

async function loadEsbuild() {
  if (esbuildTransform) return esbuildTransform;
  const { transform } = await import('esbuild');
  esbuildTransform = transform;
  return transform;
}

/**
 * Node loader `load` hook — called for every module Node evaluates
 * after `resolve` returns a URL. We only intercept file: URLs ending
 * in .ts / .mts; everything else delegates to the next loader.
 *
 * @param {string} url
 * @param {object} context
 * @param {Function} nextLoad
 */
export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !/\.m?ts$/.test(url)) {
    return nextLoad(url, context);
  }
  const path = fileURLToPath(url);
  let st;
  try { st = await stat(path); } catch { return nextLoad(url, context); }
  const cached = cache.get(path);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return { format: 'module', source: cached.source, shortCircuit: true };
  }
  const transform = await loadEsbuild();
  const raw = await readFile(path, 'utf8');
  const result = await transform(raw, {
    loader: 'ts',
    format: 'esm',
    target: 'node20',
    sourcefile: path,
    sourcemap: 'inline',
  });
  cache.set(path, { mtimeMs: st.mtimeMs, source: result.code });
  return { format: 'module', source: result.code, shortCircuit: true };
}
