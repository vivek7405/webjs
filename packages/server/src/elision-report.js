/**
 * App-level elision report (#646, extended in #1308).
 *
 * A reporting layer over the `analyzeElision` verdict, NOT a second analysis
 * and NOT a build (WebJs is no-build; elision is the server's analysis pass,
 * run at dev-server start and re-derived after each fs.watch rebuild). It
 * builds the module graph, runs `analyzeElision` ONCE, and projects the whole
 * verdict into a sorted, app-relative, JSON-serializable object.
 *
 * It carries BOTH directions:
 *
 *   - `components`: every component module with `elided` or `shipped`, and for
 *     a shipped one the evidence that forced it plus the module that did the
 *     forcing. This is the direction where a wrong verdict silently loses
 *     interactivity in production, and before #1308 an app had no way to ask
 *     "what did you drop from my page?".
 *   - `routeModules`: every page / layout as `inert` / `import-only` /
 *     `shipped`, a module that ships whole naming the first client-effecting
 *     blocker that pins it (a non-component on a component-free path from the
 *     module, #963, or its own signal when the module itself is the cause).
 *   - `orphans`: a `class X extends WebComponent` with no literal-tag
 *     registration. The scanner never sees it (invariant 3 requires a literal
 *     tag), so it gets NO verdict at all and `static interactive = true`
 *     cannot rescue it. It is the one shape that is dropped silently.
 *
 * Consumed by `webjs elision` (the CLI report + `--json`), the MCP
 * `list_elision` tool, and `webjs doctor`'s two elision checks, which share
 * ONE call so the module graph is built once per doctor run. Advisory only: a
 * page legitimately MAY ship, and the analyser is biased toward shipping by
 * design (server AGENTS invariant 7), so this never fails anything.
 *
 * Nothing is cached here. Every out-of-process consumer runs the analysis once
 * and exits, so a cache would never hit and would only add a staleness bug.
 */
import { readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import { buildModuleGraph } from './module-graph.js';
import { scanComponents, findOrphanComponents } from './component-scanner.js';
import { buildRouteTable } from './router.js';
import { analyzeElision } from './component-elision.js';

/**
 * @typedef {'own'|'observed'|'closure'|'render'|'import'|'unreadable'} ElisionEvidence
 * @typedef {{ file: string, tags: string[], verdict: 'elided'|'shipped', evidence: ElisionEvidence|null, reason: string|null, by: string|null }} ElisionComponentRow
 * @typedef {{ file: string, verdict: 'inert'|'import-only'|'shipped', emits: string[], blocker: string|null, reason: string|null }} ElisionRouteModuleRow
 * @typedef {{ file: string, className: string }} ElisionOrphanRow
 * @typedef {{ components: number, elided: number, shipped: number, routeModules: number, inert: number, importOnly: number, shippedWhole: number, orphans: number }} ElisionSummary
 * @typedef {{ analysed: boolean, skipped: 'no-app'|'elide-off'|'unanalysable'|null, components: ElisionComponentRow[], routeModules: ElisionRouteModuleRow[], orphans: ElisionOrphanRow[], summary: ElisionSummary }} ElisionReport
 */

/**
 * @param {string} appDir
 * @returns {Promise<ElisionReport>}
 */
export async function analyzeAppElision(appDir) {
  // No `app/` means this is not a routable app (a bare component library, a
  // lib-only fixture); nothing ships, so there is nothing to report on.
  if (!(await pathExists(join(appDir, 'app')))) return empty('no-app');
  // Elision off (opt-out) ships everything by design, so the verdict is moot.
  if (!(await readElideEnabled(appDir))) return empty('elide-off');

  let moduleGraph, components, routeTable, orphans;
  try {
    moduleGraph = await buildModuleGraph(appDir);
    components = await scanComponents(appDir);
    routeTable = await buildRouteTable(appDir);
    // Not a second elision analysis: a lexical scan for the one shape elision
    // never gets to judge, reusing what the dev server already runs.
    orphans = await findOrphanComponents(appDir);
  } catch {
    // A malformed app the analysis cannot process degrades to no report (the
    // dev server and `webjs check` surface the real problem).
    return empty('unanalysable');
  }

  // Exactly the page + layout set the dev server feeds to analyzeElision, so
  // the verdict matches (error / loading / not-found modules always ship and
  // are never elision candidates, so they are not in scope here).
  const routeModuleSet = new Set();
  for (const page of routeTable.pages || []) {
    if (page.file) routeModuleSet.add(page.file);
    for (const f of page.layouts || []) routeModuleSet.add(f);
  }

  const { inertRouteModules, importOnlyRouteModules, shippedRouteModules, componentVerdicts } =
    await analyzeElision(components, [...routeModuleSet], moduleGraph, (f) => readFile(f, 'utf8'), appDir);

  const rel = (f) => (f == null ? null : relative(appDir, f) || f);
  const byFile = (a, b) => a.file.localeCompare(b.file);

  /** @type {ElisionComponentRow[]} */
  const componentRows = [...componentVerdicts.entries()].map(([file, v]) => ({
    file: /** @type {string} */ (rel(file)),
    tags: v.tags,
    verdict: v.shipped ? 'shipped' : 'elided',
    evidence: v.shipped ? /** @type {ElisionEvidence|null} */ (v.evidence) : null,
    reason: v.shipped ? relativizeReason(v.reason, appDir) : null,
    by: v.shipped ? rel(v.by) : null,
  })).sort(byFile);

  /** @type {ElisionRouteModuleRow[]} */
  const routeRows = [
    ...[...inertRouteModules].map((f) => ({
      file: /** @type {string} */ (rel(f)), verdict: /** @type {const} */ ('inert'), emits: [], blocker: null, reason: null,
    })),
    ...[...importOnlyRouteModules].map(([f, emits]) => ({
      file: /** @type {string} */ (rel(f)), verdict: /** @type {const} */ ('import-only'),
      emits: emits.map((e) => /** @type {string} */ (rel(e))).sort(), blocker: null, reason: null,
    })),
    ...[...shippedRouteModules].map(([f, v]) => ({
      file: /** @type {string} */ (rel(f)), verdict: /** @type {const} */ ('shipped'), emits: [],
      blocker: rel(v.blocker), reason: relativizeReason(v.reason, appDir),
    })),
  ].sort(byFile);

  /** @type {ElisionOrphanRow[]} */
  const orphanRows = orphans
    .map((o) => ({ file: /** @type {string} */ (rel(o.file)), className: o.className }))
    .sort((a, b) => byFile(a, b) || a.className.localeCompare(b.className));

  return {
    analysed: true, skipped: null,
    components: componentRows, routeModules: routeRows, orphans: orphanRows,
    summary: {
      components: componentRows.length,
      elided: componentRows.filter((c) => c.verdict === 'elided').length,
      shipped: componentRows.filter((c) => c.verdict === 'shipped').length,
      routeModules: routeRows.length,
      inert: inertRouteModules.size,
      importOnly: importOnlyRouteModules.size,
      shippedWhole: shippedRouteModules.size,
      orphans: orphanRows.length,
    },
  };
}

/**
 * The no-verdict report, naming WHY nothing was analysed so a machine consumer
 * can tell "elision is switched off" from "this is not an app".
 * @param {'no-app'|'elide-off'|'unanalysable'} skipped
 * @returns {ElisionReport}
 */
function empty(skipped) {
  return {
    analysed: false, skipped,
    components: [], routeModules: [], orphans: [],
    summary: { components: 0, elided: 0, shipped: 0, routeModules: 0, inert: 0, importOnly: 0, shippedWhole: 0, orphans: 0 },
  };
}

/**
 * `analyzeElision` bakes ABSOLUTE paths into its reason phrases (it works in
 * absolute paths throughout). No absolute filesystem path may reach the JSON
 * contract, so strip the app dir prefix wherever it appears in the sentence.
 * A plain split/join rather than a regex, so an appDir containing regex
 * metacharacters (a `(group)` directory, a `+`) is safe.
 *
 * @param {string|null} reason
 * @param {string} appDir
 * @returns {string|null}
 */
function relativizeReason(reason, appDir) {
  if (reason == null) return null;
  return reason.split(appDir.endsWith(sep) ? appDir : appDir + sep).join('');
}

/** Mirror of the dev server's elide flag: WEBJS_ELIDE override, then webjs.elide. */
async function readElideEnabled(appDir) {
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
    // No package.json, malformed JSON, or unreadable: keep the default (on).
  }
  return true;
}

/** @param {string} p @returns {Promise<boolean>} */
async function pathExists(p) {
  try { await stat(p); return true; } catch { return false; }
}
