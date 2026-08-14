import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { satisfiesRange, readInstalledVersion } from '../manifest.js';

/**
 * @typedef {import('../codes.js').DoctorResult} DoctorResult
 */

/**
 * CHECK 5, @webjsdev/* version coherence. WARN-level only (a version drift is
 * not a crash). Reads the app package.json `@webjsdev/*` ranges across
 * dependencies + devDependencies, then for each resolves the INSTALLED version
 * through Node's own resolver anchored at the app dir (see
 * `readInstalledVersion`, which is why a workspace-hoisted install resolves)
 * and checks it satisfies the declared range. PASS when every @webjsdev dep is
 * present + satisfied; WARN on a missing install or a range drift.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
export async function checkWebjsVersions(appDir) {
  const pkgPath = join(appDir, 'package.json');
  if (!existsSync(pkgPath)) {
    return {
      name: 'webjs-versions',
      status: 'warn',
      message: 'No package.json found in this directory.',
      fix: 'Run `webjs doctor` from the app root (where package.json lives).',
    };
  }
  let pkg;
  try {
    pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  } catch {
    return {
      name: 'webjs-versions',
      status: 'warn',
      message: 'package.json could not be parsed.',
      fix: 'Fix the package.json syntax.',
    };
  }
  const ranges = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const webjsDeps = Object.keys(ranges).filter((n) => n.startsWith('@webjsdev/'));
  if (webjsDeps.length === 0) {
    return {
      name: 'webjs-versions',
      status: 'warn',
      message: 'No @webjsdev/* dependencies declared in package.json.',
      fix: 'A webjs app depends on @webjsdev/core + @webjsdev/server (+ @webjsdev/cli).',
    };
  }
  const missing = [];
  const drift = [];
  for (const dep of webjsDeps) {
    const installedVersion = await readInstalledVersion(dep, appDir);
    if (!installedVersion) {
      missing.push(dep);
      continue;
    }
    const ok = satisfiesRange(installedVersion, ranges[dep]);
    // null = a range shape we cannot statically verify; do not warn on it.
    if (ok === false) drift.push(`${dep}@${installedVersion} does not satisfy "${ranges[dep]}"`);
  }
  if (missing.length > 0) {
    return {
      name: 'webjs-versions',
      status: 'warn',
      message: `${missing.length} @webjsdev/* dependency not installed: ${missing.join(', ')}.`,
      fix: 'Run `npm install` to install the declared dependencies.',
    };
  }
  if (drift.length > 0) {
    return {
      name: 'webjs-versions',
      status: 'warn',
      message: `@webjsdev version drift: ${drift.join('; ')}.`,
      fix: 'Run `npm install` to reconcile node_modules with the declared ranges.',
    };
  }
  return {
    name: 'webjs-versions',
    status: 'pass',
    message: `All ${webjsDeps.length} @webjsdev/* dependency satisfy their declared ranges.`,
  };
}
