import { extractPackageName } from './scanner.js';
import { SUPPORTED_PROVIDERS } from './providers.js';
import { satisfiesSemverRange, parseSemver } from './integrity.js';
import { jspmGenerate } from './jspm.js';
import { readPinFile, listPinned, writePinFile } from './pins.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';
const NPM_TIMEOUT_MS = 60_000;
const PIN_BUNDLE_TIMEOUT_MS = 60_000;

async function fetchNpmJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NPM_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

function groupPinnedByPackage(entries) {
  const out = new Map();
  for (const e of entries) {
    if (!e.version || e.version === '(unknown)') continue;
    const bare = extractPackageName(e.pkg) || e.pkg;
    if (!out.has(bare)) out.set(bare, new Set());
    out.get(bare).add(e.version);
  }
  return out;
}

function compareSemver(a, b) {
  const aParts = a.split(/[.+-]/).map((p) => /^\d+$/.test(p) ? Number(p) : p);
  const bParts = b.split(/[.+-]/).map((p) => /^\d+$/.test(p) ? Number(p) : p);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const ai = aParts[i] ?? 0;
    const bi = bParts[i] ?? 0;
    if (typeof ai === 'number' && typeof bi === 'number') {
      if (ai !== bi) return ai - bi;
    } else if (ai !== bi) {
      return String(ai) < String(bi) ? -1 : 1;
    }
  }
  return 0;
}

function maxSemverVersion(versions) {
  return versions.reduce((max, v) => compareSemver(v, max) > 0 ? v : max, versions[0]);
}

export async function auditPinned(appDir) {
  const entries = await listPinned(appDir);
  if (!entries.length) return { vulnerable: [], totalChecked: 0 };
  const grouped = groupPinnedByPackage(entries);
  const body = {};
  for (const [pkg, versions] of grouped) body[pkg] = [...versions];
  const result = await fetchNpmJson(`${NPM_REGISTRY}/-/npm/v1/security/advisories/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const totalChecked = grouped.size;
  if (result === null) {
    return { vulnerable: [], totalChecked, errored: true };
  }
  if (typeof result !== 'object') return { vulnerable: [], totalChecked };
  const vulnerable = [];
  for (const [name, advisories] of Object.entries(result)) {
    if (!Array.isArray(advisories)) continue;
    for (const a of advisories) {
      vulnerable.push({
        name,
        severity: String(a?.severity || 'unknown'),
        vulnerableVersions: String(a?.vulnerable_versions || a?.range || ''),
        title: String(a?.title || a?.overview || ''),
      });
    }
  }
  return { vulnerable, totalChecked };
}

export async function findOutdated(appDir) {
  const entries = await listPinned(appDir);
  if (!entries.length) return [];
  const grouped = groupPinnedByPackage(entries);
  const queries = [...grouped].map(async ([pkg, versions]) => {
    const meta = await fetchNpmJson(`${NPM_REGISTRY}/${pkg}`);
    const latest = meta?.['dist-tags']?.latest;
    if (typeof latest !== 'string') return null;
    const current = maxSemverVersion([...versions]);
    if (compareSemver(current, latest) >= 0) return null;
    return { pkg, current, latest };
  });
  const results = await Promise.all(queries);
  return results.filter((x) => x !== null);
}

async function fetchIntegrity(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIN_BUNDLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const buf = new Uint8Array(await response.arrayBuffer());
    const digest = await import('./integrity.js').then(m => m.sha384Integrity(buf));
    return digest;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function updatePinned(appDir, opts = {}) {
  const file = await readPinFile(appDir);
  const from = opts.from || file?.provider || 'jspm';
  if (!SUPPORTED_PROVIDERS.has(from)) {
    throw new Error(
      `[webjs] unknown provider '${from}'. Supported: ${[...SUPPORTED_PROVIDERS].join(', ')}.`,
    );
  }
  const outdated = await findOutdated(appDir);
  if (!outdated.length) return { updated: [], noOutdated: true, provider: from };
  if (!file) return { updated: [], provider: from };
  const newImports = { ...file.imports };
  const newIntegrity = { ...(file.integrity || {}) };
  const updated = [];
  for (const { pkg, current, latest } of outdated) {
    let anySpecUpdated = false;
    for (const [spec, oldUrl] of Object.entries(file.imports)) {
      const specPkg = extractPackageName(spec) || spec;
      if (specPkg !== pkg) continue;
      const subpath = spec.slice(specPkg.length);
      const install = `${pkg}@${latest}${subpath}`;
      const resolved = await jspmGenerate([install], from, PIN_BUNDLE_TIMEOUT_MS);
      const newUrl = resolved[spec];
      if (!newUrl) continue;
      newImports[spec] = newUrl;
      delete newIntegrity[oldUrl];
      const sri = await fetchIntegrity(newUrl);
      if (sri) newIntegrity[newUrl] = sri;
      anySpecUpdated = true;
    }
    if (anySpecUpdated) updated.push({ pkg, from: current, to: latest });
  }
  await writePinFile(appDir, newImports, newIntegrity, from);
  return { updated, provider: from };
}

export function extractPinnedVersions(imports) {
  const out = new Map();
  for (const [spec, url] of Object.entries(imports || {})) {
    if (typeof url !== 'string') continue;
    const bare = extractPackageName(spec);
    if (!bare) continue;
    let version = null;
    if (url.startsWith('/__webjs/vendor/')) {
      const filename = url.slice('/__webjs/vendor/'.length);
      const atIdx = filename.lastIndexOf('@');
      if (atIdx > 0) {
        const afterAt = filename.slice(atIdx + 1, filename.endsWith('.js') ? -3 : undefined);
        const subIdx = afterAt.indexOf('__');
        version = subIdx < 0 ? afterAt : afterAt.slice(0, subIdx);
      }
    } else {
      const escapedBare = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
      if (m) version = m[1];
    }
    if (version && /\d/.test(version)) out.set(bare, version);
  }
  return out;
}

export async function checkImportmapCoherence(imports, opts) {
  const pinned = extractPinnedVersions(imports);
  const conflicts = [];
  const unverified = [];
  const packages = [...pinned.keys()].sort();
  let checked = 0;
  for (const pkg of packages) {
    const version = pinned.get(pkg);
    let manifest;
    try {
      manifest = await opts.getManifest(pkg, version);
    } catch {
      manifest = null;
    }
    if (!manifest || typeof manifest !== 'object') {
      unverified.push({ pkg, reason: `could not read dependency metadata for ${pkg}@${version}` });
      continue;
    }
    checked++;
    const groups = /** @type {const} */ ([
      ['dependency', manifest.dependencies],
      ['peerDependency', manifest.peerDependencies],
    ]);
    for (const [kind, deps] of groups) {
      if (!deps || typeof deps !== 'object') continue;
      for (const [depName, range] of Object.entries(deps)) {
        if (depName === pkg) continue;
        const depPinned = pinned.get(depName);
        if (!depPinned) continue;
        const ok = satisfiesSemverRange(depPinned, String(range));
        if (ok === false) {
          conflicts.push({
            pkg,
            version: String(version),
            dependsOn: depName,
            kind,
            requiredRange: String(range),
            pinnedVersion: depPinned,
          });
        }
      }
    }
  }
  return { conflicts, unverified, checked };
}
