import { formatConflicts, makeInstalledManifestReader } from '../manifest.js';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK 7, importmap coherence (issue #450). Defense-in-depth that catches an
 * INCOHERENT client dependency graph in the produced importmap, regardless of
 * how the incoherence arose (a hand-edited pin file, a partial vendor pin, or
 * the #446 resolution skew). For each resolved package, it checks that the
 * version actually pinned for every OTHER resolved package it depends on
 * satisfies the declared range; a miss warns naming both packages, the range,
 * and the pinned version.
 *
 * Runs the SAME check over BOTH inputs and produces the same verdict for the
 * same dep set (the parity invariant): the live importmap (resolved the way the
 * server resolves it at runtime) AND the vendored `.webjs/vendor/importmap.json`.
 * A vendored importmap is a freeze of the runtime-resolved graph, so a coherent
 * runtime graph that gets vendored stays coherent.
 *
 * WARN-only and BEST-EFFORT: it never hard-fails (a runtime incoherence is the
 * app's concern, not a broken toolchain), and it degrades to a soft
 * "could not verify" whenever metadata or a live resolve is unavailable rather
 * than failing closed. Dependency metadata is read from the already-installed
 * `node_modules` manifests, no network call of its own; the only network touch
 * is the live importmap resolve, which is wrapped so any failure degrades.
 *
 * The vendor functions + manifest reader are injectable via `opts.coherence`
 * so a test can drive every branch without a network call.
 *
 * @param {string} appDir
 * @param {{ coherence?: {
 *   liveImports?: () => Promise<Record<string,string> | null>,
 *   vendoredImports?: () => Promise<Record<string,string> | null>,
 *   getManifest?: (pkg: string, version: string) => Promise<any>,
 *   check?: (imports: Record<string,string>, o: { getManifest: any }) => Promise<{ conflicts: any[], unverified: any[], checked: number }>,
 * } }} opts
 * @returns {Promise<DoctorResult>}
 */
export async function checkImportmapCoherence(appDir, opts) {
  let inj = opts.coherence;
  // Resolve the real vendor toolchain unless a test injected stubs. Both the
  // importmap sources and the coherence-check function come from
  // @webjsdev/server, so a missing install degrades to a WARN, never a throw.
  if (!inj || !inj.check || !inj.liveImports || !inj.vendoredImports || !inj.getManifest) {
    let mod;
    try {
      mod = await import('@webjsdev/server');
    } catch {
      return {
        name: 'importmap-coherence',
        status: 'warn',
        bestEffort: true,
        message: 'Could not load the vendor toolchain to check importmap coherence.',
        fix: 'Run `npm install` so @webjsdev/server is available, then re-run `webjs doctor`.',
      };
    }
    const real = {
      check: mod.checkImportmapCoherence,
      // Hoist-aware manifest read from the already-installed node_modules (no
      // network of its own), so a monorepo-hoisted dep still resolves. Falls
      // back to the local app/node_modules read if the server build predates
      // getPackageManifest.
      getManifest: typeof mod.getPackageManifest === 'function'
        ? (pkg) => mod.getPackageManifest(pkg, appDir)
        : makeInstalledManifestReader(appDir),
      // Live importmap: resolve vendor imports the way the server does on the
      // first request (prefers the pin file, else a live jspm.io resolve).
      liveImports: async () => {
        try {
          const resolved = await mod.resolveVendorImports(appDir, () => mod.scanBareImports(appDir));
          return resolved && resolved.imports ? resolved.imports : {};
        } catch {
          return null;
        }
      },
      // Vendored importmap: the committed pin file, no network.
      vendoredImports: async () => {
        try {
          const pin = await mod.readPinFile(appDir);
          return pin && pin.imports ? pin.imports : null;
        } catch {
          return null;
        }
      },
    };
    inj = { ...real, ...(inj || {}) };
  }

  // Gather both importmaps. Either may be absent (no pin file, or a live
  // resolve that failed / found no vendor imports); the check runs over
  // whichever exist, identically.
  let live = null;
  let vendored = null;
  try { live = await inj.liveImports(); } catch { live = null; }
  try { vendored = await inj.vendoredImports(); } catch { vendored = null; }

  const liveHas = live && Object.keys(live).length > 0;
  const vendoredHas = vendored && Object.keys(vendored).length > 0;
  if (!liveHas && !vendoredHas) {
    return {
      name: 'importmap-coherence',
      status: 'pass',
      message: 'No vendor importmap to check (the app imports no npm packages on the client).',
    };
  }

  // Run the IDENTICAL check over each available importmap. The function is
  // pure in (imports, getManifest), so the same pinned dep set produces the
  // same verdict whichever input it came from (the runtime-vs-vendored parity
  // invariant). Aggregate the conflicts; dedupe identical ones so a package
  // pinned the same way in both maps is reported once.
  /** @type {Map<string, any>} */
  const conflictsByKey = new Map();
  let anyChecked = 0;
  let anyUnverified = 0;
  for (const imports of [liveHas ? live : null, vendoredHas ? vendored : null]) {
    if (!imports) continue;
    let report;
    try {
      report = await inj.check(imports, { getManifest: inj.getManifest });
    } catch {
      // A check that threw is a "could not verify", never a doctor crash.
      anyUnverified++;
      continue;
    }
    anyChecked += report.checked || 0;
    anyUnverified += (report.unverified || []).length;
    for (const c of report.conflicts || []) {
      conflictsByKey.set(`${c.pkg}@${c.version}->${c.dependsOn}@${c.pinnedVersion}`, c);
    }
  }

  const conflicts = [...conflictsByKey.values()];
  if (conflicts.length > 0) {
    return {
      name: 'importmap-coherence',
      status: 'warn',
      message: `Incoherent client dependency graph in the importmap: ${formatConflicts(conflicts)}.`,
      fix: 'Align the pinned versions: re-run `webjs vendor pin` to re-resolve a coherent set, or bump the lagging package in package.json and reinstall so the importmap pins a version satisfying every dependent.',
    };
  }
  if (anyChecked === 0 && anyUnverified > 0) {
    return {
      name: 'importmap-coherence',
      status: 'warn',
      bestEffort: true,
      message: 'Could not verify importmap coherence (dependency metadata for the pinned packages was unavailable).',
      fix: 'Run `npm install` so the pinned packages are present in node_modules, then re-run `webjs doctor`.',
    };
  }
  return {
    name: 'importmap-coherence',
    status: 'pass',
    message: 'The importmap dependency graph is coherent (every pinned package satisfies its dependents\' declared ranges).',
  };
}
