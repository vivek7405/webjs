/**
 * Shared machinery behind the check rules: the module-graph walk for the
 * server-import rule, the git-ignore probe, and the small fs predicates.
 *
 * Its own module rather than private to runner.js, because the rules call it
 * and runner.js calls the rules. Parked in runner.js it made that a cycle.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { walk } from '../fs-walk.js';
import { buildModuleGraph, transitiveDeps } from '../module-graph.js';
import { scanComponents } from '../component-scanner.js';
import { buildRouteTable } from '../router.js';
import { analyzeElision } from '../component-elision.js';
import {
  hasUseServerDirective,
} from './helpers.js';

/**
 * @typedef {import('./rules.js').Violation} Violation
 * @typedef {{ abs: string, rel: string, content: string, scan: string }} ScannedFile
 */

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
export function findImportChain(graph, from, to) {
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
export async function checkServerImportInBrowserModule(appDir, violations) {
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
export async function isUseServerActionFile(file) {
  try {
    const content = await readFile(file, 'utf8');
    return hasUseServerDirective(content);
  } catch {
    return false;
  }
}

export async function readElideEnabledForCheck(appDir) {
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
export async function pathExists(p) {
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
export async function gitIgnoredSet(appDir, rels) {
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
