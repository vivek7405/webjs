import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { compileHeaderRules } from '../headers.js';
import { compileRedirectRules, readTrailingSlashPolicy } from '../redirects.js';
import { readBasePath } from '../base-path.js';
import { validateAppWebjsConfig } from '../webjs-config-validate.js';
import { readAllowedOrigins } from '../csrf.js';
import { readCspConfig } from '../csp.js';
import { readBodyLimits, computeServerTimeouts } from '../body-limit.js';

function elideEnvOverride() {
  const raw = process.env.WEBJS_ELIDE;
  if (raw == null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return undefined;
}

export async function readElideEnabled(appDir) {
  const override = elideEnvOverride();
  if (override !== undefined) return override;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.elide === false) return false;
  } catch {
    // Keep default
  }
  return true;
}

function seedEnvOverride() {
  const raw = process.env.WEBJS_SEED;
  if (raw == null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return undefined;
}

export async function readSeedEnabled(appDir) {
  const override = seedEnvOverride();
  if (override !== undefined) return override;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.seed === false) return false;
  } catch {
    // Keep default
  }
  return true;
}

export async function readClientRouterEnabled(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.clientRouter === false) return false;
  } catch {
    // Keep default
  }
  return true;
}

export async function readHeaderRules(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return compileHeaderRules(pkg);
  } catch {
    return [];
  }
}

export async function readRedirectRules(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return compileRedirectRules(pkg);
  } catch {
    return [];
  }
}

export async function readTrailingSlashFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readTrailingSlashPolicy(pkg);
  } catch {
    return 'ignore';
  }
}

export async function readBasePathFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readBasePath(pkg);
  } catch {
    return '';
  }
}

export async function warnOnInvalidWebjsConfig(appDir, logger) {
  let problems;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    problems = validateAppWebjsConfig(pkg);
  } catch {
    return;
  }
  if (!problems.length) return;
  logger?.warn?.(
    `[webjs] the "webjs" block in package.json has ${problems.length} problem(s), ` +
      `each ignored at its default: ${problems.join('; ')}. ` +
      `See https://webjs.dev/docs/configuration`,
  );
}

export async function readAllowedOriginsFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readAllowedOrigins(pkg);
  } catch {
    return [];
  }
}

export async function readCspConfigFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readCspConfig(pkg);
  } catch {
    return readCspConfig(undefined);
  }
}

export async function readBodyLimitsFromApp(appDir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    pkg = undefined;
  }
  return readBodyLimits(pkg);
}

export async function readDevWatchPathsFromApp(appDir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    return [];
  }
  const raw = pkg && pkg.webjs && pkg.webjs.dev && pkg.webjs.dev.watch;
  if (!Array.isArray(raw)) return [];
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    if (typeof entry !== 'string' || !entry.trim()) continue;
    const abs = resolve(appDir, entry);
    if (abs === appDir || appDir.startsWith(abs + sep) || abs.startsWith(appDir + sep)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

export async function readServerTimeoutsFromApp(appDir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    pkg = undefined;
  }
  return computeServerTimeouts(pkg);
}

export function shouldIgnoreWatchPath(absPath, appDir) {
  const relPath = relative(appDir, absPath);
  if (
    relPath.includes('node_modules' + sep) ||
    relPath.startsWith('.git' + sep) ||
    relPath.startsWith('.webjs' + sep) ||
    relPath.startsWith('dist' + sep) ||
    relPath.startsWith('build' + sep)
  ) {
    return true;
  }
  return false;
}
