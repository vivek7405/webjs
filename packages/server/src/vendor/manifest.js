import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { createRequire } from 'node:module';

function resolvePackageDir(pkgName, appDir) {
  let entry;
  try {
    const req = createRequire(join(appDir, 'package.json'));
    entry = req.resolve(pkgName);
  } catch {
    try {
      const req = createRequire(import.meta.url);
      entry = req.resolve(pkgName);
    } catch {
      return null;
    }
  }
  try {
    const parts = entry.split(sep);
    const nmIdx = parts.lastIndexOf('node_modules');
    if (nmIdx < 0) {
      let dir = dirname(entry);
      for (let i = 0; i < 8; i++) {
        if (existsSync(join(dir, 'package.json'))) return realpathSync(dir);
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return null;
    }
    const segmentsAfterNm = pkgName.startsWith('@') ? 2 : 1;
    const root = parts.slice(0, nmIdx + 1 + segmentsAfterNm).join(sep);
    return realpathSync(root);
  } catch {
    return null;
  }
}

/**
 * Read the installed version of a package from `node_modules/<pkg>/package.json`.
 *
 * @param {string} pkgName
 * @param {string} appDir
 * @returns {string | null}
 */
export function getPackageVersion(pkgName, appDir) {
  const real = resolvePackageDir(pkgName, appDir);
  if (!real) return null;
  try {
    const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * Read the installed package's declared `dependencies` + `peerDependencies`.
 *
 * @param {string} pkgName
 * @param {string} appDir
 * @returns {{ dependencies: Record<string,string>, peerDependencies: Record<string,string> } | null}
 */
export function getPackageManifest(pkgName, appDir) {
  const real = resolvePackageDir(pkgName, appDir);
  if (!real) return null;
  try {
    const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
    return {
      dependencies: pkg.dependencies || {},
      peerDependencies: pkg.peerDependencies || {},
    };
  } catch {
    return null;
  }
}
