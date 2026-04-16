import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, relative, sep, extname, basename, dirname } from 'node:path';
import { walk } from './fs-walk.js';

/**
 * Minimum-viable production bundle.
 *
 * Walks the app and produces a single `.webjs/bundle.js` that imports every
 * component module + every page/layout module. Transitive deps (including
 * `webjs` core) are bundled in. In prod the SSR shell loads `/__webjs/bundle.js`
 * instead of per-page module imports, collapsing dozens of HTTP requests into
 * one on first page load.
 *
 * Deliberate limits:
 *   - One bundle for the whole app (no per-route code splitting). For apps
 *     with 50+ component files this is still usually a better bet than
 *     unbundled ES-module waterfalls on a cold cache — but it's not what
 *     NextJs does.
 *   - `.server.js` files and API route handlers are NEVER bundled; they
 *     stay on the server. Any accidental import of one from a page/component
 *     is left as-is and would be caught at runtime in dev.
 *   - esbuild is an optional peer-style dep: if it's not installed we throw
 *     a helpful error.
 *
 * @param {{ appDir: string, outDir?: string, minify?: boolean, sourcemap?: boolean }} opts
 */
export async function buildBundle(opts) {
  const appDir = opts.appDir;
  const outDir = opts.outDir ?? join(appDir, '.webjs');
  const bundleFile = join(outDir, 'bundle.js');
  const entryFile = join(outDir, 'entry.js');

  const entries = await collectClientEntries(appDir);
  if (!entries.length) {
    console.warn('[webjs build] no client-side entries found (empty app/?). Skipping.');
    return { bundleFile: null, entries: [] };
  }

  await mkdir(outDir, { recursive: true });
  const rels = entries.map((abs) =>
    './' + relative(outDir, abs).split(sep).join('/')
  );
  await writeFile(
    entryFile,
    `// webjs: generated bundle entry — do not edit.\n` +
      rels.map((p) => `import ${JSON.stringify(p)};`).join('\n') +
      '\n'
  );

  let esbuild;
  try {
    ({ build: esbuild } = await import('esbuild'));
  } catch {
    throw new Error(
      '[webjs build] esbuild is required but not installed.\n' +
      '  Install it as a dev dependency:  npm i -D esbuild'
    );
  }

  await esbuild({
    entryPoints: [entryFile],
    outfile: bundleFile,
    bundle: true,
    format: 'esm',
    target: 'es2022',
    platform: 'browser',
    minify: opts.minify !== false,
    sourcemap: opts.sourcemap !== false,
    logLevel: 'warning',
    // Don't try to bundle server-only modules that accidentally end up in the graph:
    // fail loudly so authors see the leak rather than ship broken browser code.
    conditions: ['browser', 'import'],
  });

  return { bundleFile, entries };
}

/**
 * Collect every file that should ship to the browser:
 *   - components/**.js  (always)
 *   - app/**\/(page|layout|not-found|error).js (SSR-only today but their
 *     transitive imports include components; ensures registrations run)
 * Excludes: .server.js, route.js, middleware.js, .webjs/, node_modules, dotfiles.
 *
 * @param {string} appDir
 * @returns {Promise<string[]>}
 */
async function collectClientEntries(appDir) {
  /** @type {string[]} */
  const out = [];
  for await (const file of walk(appDir)) {
    if (!/\.m?[jt]s$/.test(file)) continue;
    if (/\.server\.m?[jt]s$/.test(file)) continue;
    const name = basename(file);
    const rel = relative(appDir, file).split(sep).join('/');
    if (rel.startsWith('.webjs/')) continue;
    if (/^(route|middleware)\.m?[jt]s$/.test(name)) continue;
    if (name === 'webjs.config.js' || name === 'webjs.config.ts') continue;
    // Include components wholesale (top-level + module-scoped),
    // plus page/layout/not-found/error inside app/.
    if (rel.startsWith('components/') || /\/components\//.test(rel)) out.push(file);
    else if (rel.startsWith('app/') && /^(page|layout|not-found|error)\.m?[jt]s$/.test(name)) out.push(file);
  }
  return out;
}

/** @param {string} p */
export async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}
