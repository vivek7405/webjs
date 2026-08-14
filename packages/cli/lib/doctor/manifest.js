import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

/**
 * Compare an installed version against a semver range PRAGMATICALLY (no semver
 * dependency). Supports the common scaffold shapes: `latest` / `*` / `workspace:*`
 * (any installed version satisfies), an exact `1.2.3`, and a caret `^1.2.3`
 * (installed must be >= the floor AND share the same major, with major 0 also
 * pinning the minor, matching npm caret semantics). An unrecognized range is
 * treated as "cannot statically verify" (returns null), so the caller does not
 * warn on a shape it does not understand.
 * @param {string} installed
 * @param {string} range
 * @returns {boolean | null}
 */
export function satisfiesRange(installed, range) {
  if (!installed) return null;
  const r = String(range).trim();
  if (r === 'latest' || r === '*' || r === '' || r.startsWith('workspace:')) return true;
  const parse = (v) => {
    const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const inst = parse(installed);
  if (!inst) return null;
  if (/^\d+\.\d+\.\d+$/.test(r)) {
    const exact = parse(r);
    return exact ? inst[0] === exact[0] && inst[1] === exact[1] && inst[2] === exact[2] : null;
  }
  if (r.startsWith('^')) {
    const floor = parse(r);
    if (!floor) return null;
    if (inst[0] !== floor[0]) return false;
    // For 0.x, caret pins the minor too (^0.7.0 allows 0.7.x, not 0.8.0).
    if (floor[0] === 0 && inst[1] !== floor[1]) return false;
    const cmp =
      inst[0] !== floor[0] ? inst[0] - floor[0] :
      inst[1] !== floor[1] ? inst[1] - floor[1] :
      inst[2] - floor[2];
    return cmp >= 0;
  }
  return null;
}

/**
 * Read the declared dependency ranges of an INSTALLED package from
 * `node_modules/<pkg>/package.json`, for the importmap-coherence check. This
 * is the "already-resolved metadata, no network" path the issue calls for: the
 * package is on disk (it was installed for the importmap to pin it), so its
 * manifest is a local read. Returns null on any failure (not installed,
 * unreadable, unparseable), which the coherence check treats as "could not
 * verify" rather than a conflict.
 *
 * @param {string} appDir
 * @returns {(pkg: string) => Promise<{ dependencies?: Record<string,string>, peerDependencies?: Record<string,string> } | null>}
 */
export function makeInstalledManifestReader(appDir) {
  return async (pkg) => {
    const manifestPath = join(appDir, 'node_modules', pkg, 'package.json');
    if (!existsSync(manifestPath)) return null;
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      return {
        dependencies: parsed.dependencies || {},
        peerDependencies: parsed.peerDependencies || {},
      };
    } catch {
      return null;
    }
  };
}

/**
 * Format a coherence conflict list into a single human-readable warning line
 * naming each conflicting pair, the required range, and the pinned version.
 * @param {Array<{ pkg: string, version: string, dependsOn: string, kind: string, requiredRange: string, pinnedVersion: string }>} conflicts
 * @returns {string}
 */
export function formatConflicts(conflicts) {
  return conflicts
    .map(
      (c) =>
        `${c.pkg}@${c.version} needs ${c.dependsOn} ${c.kind === 'peerDependency' ? '(peer) ' : ''}${c.requiredRange} but the importmap pins ${c.dependsOn}@${c.pinnedVersion}`,
    )
    .join('; ');
}

/**
 * Read a dependency's INSTALLED version as resolved FROM `appDir`, or null when
 * it does not resolve there at all.
 *
 * Node's own resolver is the ground truth here, not a directory read. The check
 * this serves asks "would this app resolve this dependency at runtime, and at
 * what version", and Node's resolution algorithm IS that question's definition,
 * so anything re-implementing it can only be a worse approximation. Asking Node
 * handles workspace hoisting (the bug this fixes: under npm workspaces the
 * `@webjsdev/*` deps hoist to the ROOT node_modules, so an app subdirectory has
 * no local copy and a per-app `node_modules/<dep>/package.json` read reported
 * every declared dep missing on a healthy install), symlinked workspace links,
 * nested non-hoisted trees, and `package.json` `imports`, for free and for ever.
 *
 * The direct `<dep>/package.json` resolve is attempted FIRST because a package
 * may declare no main entry at all: `@webjsdev/cli` is bin-only (no `main`, no
 * `exports`), so `require.resolve('@webjsdev/cli')` throws MODULE_NOT_FOUND.
 * The ERR_PACKAGE_PATH_NOT_EXPORTED fallback exists because a package may lock
 * its manifest out of its `exports` map: `@webjsdev/server` exports only `.`,
 * `./check`, `./testing`, and `./webjs-config.schema.json`, so the direct
 * manifest resolve is refused and the main entry plus a bounded walk up to the
 * package root is the way in. Neither strategy alone resolves all four
 * `@webjsdev/*` packages; both halves are required.
 *
 * Local rather than `getPackageVersion` from `@webjsdev/server` for two reasons.
 * Doctor must stay usable when the framework does not resolve from the app dir
 * at all, which is the #954 fresh-worktree case doctor exists to diagnose, so
 * this check cannot import the server (the same argument `frameworkResolves`
 * below already follows). And `getPackageVersion` resolves the main entry only,
 * so it returns null for a bin-only package, which would leave `@webjsdev/cli`
 * reported missing: the same false positive with more machinery.
 *
 * Pinned by the workspace, bin-only, and exports-locked fixtures in
 * `test/cli/doctor.test.mjs`.
 * @param {string} dep package name, e.g. `@webjsdev/server`
 * @param {string} appDir directory to anchor resolution at
 * @returns {Promise<string|null>} the installed version, or null when unresolvable
 */
export async function readInstalledVersion(dep, appDir) {
  // The base file need not exist; createRequire only uses it to anchor the
  // node_modules lookup at appDir.
  const require = createRequire(join(appDir, '__webjs_resolve_probe__.js'));
  let manifestPath = null;
  try {
    manifestPath = require.resolve(dep + '/package.json');
  } catch (err) {
    if (err?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') return null;
    let entry;
    try {
      entry = require.resolve(dep);
    } catch {
      return null;
    }
    let dir = dirname(entry);
    for (let i = 0; i < 12; i++) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        manifestPath = candidate;
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    if (!manifestPath) return null;
  }
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8')).version || null;
  } catch {
    return null;
  }
}
