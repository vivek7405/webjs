import { extractPackageName } from './scanner.js';
import { SUPPORTED_PROVIDERS } from './providers.js';
import { PIN_BUNDLE_TIMEOUT_MS, fetchIntegrity, satisfiesSemverRange } from './integrity.js';
import { jspmGenerate } from './jspm.js';
import { readPinFile, listPinned, writePinFile } from './pins.js';

const NPM_REGISTRY = 'https://registry.npmjs.org';
// The npm registry is reached only by `audit`, `outdated`, and `update`,
// all CLI commands, so it takes the same generous budget the pin bundle
// fetch does rather than the server's. importmap-rails makes these same two
// calls with Ruby's 60s Net::HTTP default.
const NPM_TIMEOUT_MS = 60_000;
// Bounds a single bundle GET made by the pin command, which either writes the
// bytes to disk (`downloadBundle`) or fetches them to hash
// (`fetchIntegrity`). Deliberately six times the warmup budget, because the
// two are not the same situation: a pin is a one-shot command a person ran and
// is waiting on, with a whole multi-megabyte package to transfer, while the
// warmup is a server holding a request. Ten seconds is generous for the
// latter and tight for the former on a slow link.
//
// 60s matches what importmap-rails effectively allows. It sets no timeout at
// all, but Ruby's Net::HTTP defaults open_timeout and read_timeout to 60s, so
// a Rails pin is bounded at a minute without asking. JavaScript's fetch() has
// no default whatsoever, which is why this has to be explicit: without it a
// CDN that accepts the connection and then stalls hangs the pin forever, with
// no ambient deadline on a CLI run to cut it short.

/**
 * Fetch one URL from registry.npmjs.org with a small timeout. Returns
 * the parsed JSON body on 2xx, or null on any non-2xx / network /
 * timeout. Used by audit + outdated.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<any | null>}
 */
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

/**
 * Group the pin file's entries by package name + the set of versions
 * actually pinned (a single package can be pinned at multiple versions
 * via subpath imports). Used by audit (npm advisories want
 * `{ pkgName: [versions] }`) and outdated (one query per package).
 *
 * @param {Array<{ pkg: string, version: string }>} entries
 * @returns {Map<string, Set<string>>}
 */
function groupPinnedByPackage(entries) {
  const out = new Map();
  for (const e of entries) {
    if (!e.version || e.version === '(unknown)') continue;
    // entries[].pkg can include a subpath (e.g. `dayjs/plugin/utc`).
    // Extract the bare package name (`dayjs` or `@scope/name`).
    const bare = extractPackageName(e.pkg) || e.pkg;
    if (!out.has(bare)) out.set(bare, new Set());
    out.get(bare).add(e.version);
  }
  return out;
}

/**
 * Lightweight semver-aware comparison (no prerelease tags). Returns
 * negative if a < b, zero if equal, positive if a > b. Used by
 * findOutdated to decide if `current` lags `latest`. Non-numeric
 * segments fall back to string compare so prerelease-ish strings
 * still sort somewhere.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
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

/** @param {string[]} versions */
function maxSemverVersion(versions) {
  return versions.reduce((max, v) => compareSemver(v, max) > 0 ? v : max, versions[0]);
}

/**
 * Run a security audit against the pinned versions in the committed
 * pin file. POSTs to npm's bulk-advisory endpoint, the same one
 * `npm audit` uses internally.
 *
 * Returns `{ errored: true }` when the registry call failed (network
 * down, timeout, 5xx) so the CLI can surface the failure clearly
 * instead of misleading the user with "no vulnerabilities found".
 *
 * Mirrors importmap-rails's `bin/importmap audit`.
 *
 * @param {string} appDir
 * @returns {Promise<{
 *   vulnerable: Array<{ name: string, severity: string, vulnerableVersions: string, title: string }>,
 *   totalChecked: number,
 *   errored?: boolean,
 * }>}
 */
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
    // Distinguish "registry returned no advisories" (success, empty
    // object) from "couldn't reach registry" (null). The latter is
    // user-visible because a silent "no vulnerabilities" on a failed
    // call would falsely reassure the user.
    return { vulnerable: [], totalChecked, errored: true };
  }
  if (typeof result !== 'object') return { vulnerable: [], totalChecked };
  /** @type {Array<{ name: string, severity: string, vulnerableVersions: string, title: string }>} */
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

/**
 * Find pinned packages that have a newer version available on npm.
 * Queries `registry.npmjs.org/<pkg>` per pinned package, compares the
 * pinned version against `dist-tags.latest` with semver-shaped string
 * ordering (regex parse, then numeric compare per segment).
 *
 * Mirrors importmap-rails's `bin/importmap outdated`.
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ pkg: string, current: string, latest: string }>>}
 */
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


/**
 * Re-pin every package returned by findOutdated to its latest version.
 * Calls jspm.io's Generator API with `<pkg>@<latest>` for each
 * outdated entry, then writes the new pin file.
 *
 * Mirrors importmap-rails's `bin/importmap update`, with the same
 * caveat: this updates the pin file but does NOT update the user's
 * `package.json` / `node_modules`. The user should run `npm install
 * <pkg>@<latest>` afterward to keep package.json in sync.
 *
 * When `opts.from` is not passed, the existing pin file's `provider`
 * field is used (so a user who pinned `--from jsdelivr` originally
 * stays on jsdelivr after update). When the file has no provider
 * field, defaults to `jspm`.
 *
 * @param {string} appDir
 * @param {{ from?: string }} [opts]
 * @returns {Promise<{ updated: Array<{ pkg: string, from: string, to: string }>, noOutdated?: boolean, provider?: string }>}
 */
export async function updatePinned(appDir, opts = {}) {
  const file = await readPinFile(appDir);
  // Provider precedence:
  //   1. explicit opts.from (CLI flag wins)
  //   2. pin file's persisted provider
  //   3. default 'jspm'
  // Validate AFTER resolving so a stale pin file with a previously-
  // valid-but-now-removed provider still errors clearly.
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
  /** @type {Array<{ pkg: string, from: string, to: string }>} */
  const updated = [];
  for (const { pkg, current, latest } of outdated) {
    // Resolve the new version via jspm.io. The Generator API
    // returns URLs for `<pkg>@<latest>` (and any subpath we ask
    // for, but for update we just refresh the bare root pin and
    // any subpaths that were already pinned).
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
      // Recompute integrity for the new URL. Drop the stale entry
      // even on fetch failure so the new pin doesn't carry the
      // wrong hash silently.
      delete newIntegrity[oldUrl];
      const sri = await fetchIntegrity(newUrl);
      if (sri) newIntegrity[newUrl] = sri;
      anySpecUpdated = true;
    }
    // Only report `pkg` as updated when at least one spec actually
    // got a new URL. If every subpath failed to resolve via
    // jspm.io (transient outage, the new version not yet indexed),
    // the CLI must not lie about having updated it.
    if (anySpecUpdated) updated.push({ pkg, from: current, to: latest });
  }
  await writePinFile(appDir, newImports, newIntegrity, from);
  return { updated, provider: from };
}

/**
 * Extract `{ basePackage -> pinned version }` from an importmap's `imports`
 * map. Each value is a CDN URL (jspm.io's `npm:dayjs@1.11.13/...`, jsdelivr's
 * `npm/dayjs@1.11.13/...`, unpkg's bare `dayjs@1.11.13/...`, skypack's
 * `dayjs@1.11.13`) or a local `/__webjs/vendor/<pkg>@<version>...js` path. The
 * key is the bare package name parsed from the importmap KEY (the specifier),
 * which is authoritative; the version is parsed from the URL.
 *
 * A specifier that resolves to a version we cannot parse from its URL is
 * skipped (it contributes nothing to the dep graph rather than a wrong pin).
 * When the same base package appears at several versions (subpath imports),
 * the LAST parsed wins; in practice every subpath of a package resolves to the
 * one installed version, so they agree.
 *
 * @param {Record<string, string>} imports  importmap `imports` map (specifier -> URL)
 * @returns {Map<string, string>}  base package name -> pinned version
 */
export function extractPinnedVersions(imports) {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [spec, url] of Object.entries(imports || {})) {
    if (typeof url !== 'string') continue;
    const bare = extractPackageName(spec);
    if (!bare) continue;
    let version = null;
    if (url.startsWith('/__webjs/vendor/')) {
      // Local downloaded-pin path: `<name>@<version>[__subpath].js`. The name
      // is `--`-encoded for scoped packages; we only need the version, which
      // sits after the LAST `@` and before any `__subpath` / `.js` suffix.
      const filename = url.slice('/__webjs/vendor/'.length);
      const atIdx = filename.lastIndexOf('@');
      if (atIdx > 0) {
        const afterAt = filename.slice(atIdx + 1, filename.endsWith('.js') ? -3 : undefined);
        const subIdx = afterAt.indexOf('__');
        version = subIdx < 0 ? afterAt : afterAt.slice(0, subIdx);
      }
    } else {
      // CDN URL: find `<bare>@<version>` anchored on a non-name char (or the
      // string start) so a short name like `ms` does not false-match inside
      // another package's URL. Mirrors listPinned's parser.
      const escapedBare = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
      if (m) version = m[1];
    }
    if (version && /\d/.test(version)) out.set(bare, version);
  }
  return out;
}

/**
 * Validate that a produced importmap's pinned dependency graph is COHERENT
 * (issue #450). For each resolved package, read its declared `dependencies`
 * and `peerDependencies` (via the injected `getManifest`) and, for every
 * declared range that targets ANOTHER package ALSO pinned in this importmap,
 * check the pinned version satisfies the range. A miss is a conflict naming
 * both packages, the required range, and the pinned version.
 *
 * This is the SAME function the doctor runs over the live importmap and over
 * `.webjs/vendor/importmap.json`. It is pure in `(imports, getManifest)`, so
 * the same pinned dep set yields the same verdict regardless of which input it
 * came from (the runtime-vs-vendored parity invariant).
 *
 * Degrades gracefully: a package whose manifest `getManifest` cannot supply
 * (not installed, unreadable, network unavailable) is recorded under
 * `unverified` and contributes NO conflict, so the check reports "could not
 * verify" rather than failing closed. A declared range in a shape we cannot
 * statically evaluate (see `satisfiesSemverRange` -> null) is likewise skipped,
 * never warned on.
 *
 * @param {Record<string, string>} imports  importmap `imports` map
 * @param {{
 *   getManifest: (pkg: string, version: string) =>
 *     ({ dependencies?: Record<string,string>, peerDependencies?: Record<string,string> } | null
 *      | Promise<{ dependencies?: Record<string,string>, peerDependencies?: Record<string,string> } | null>),
 * }} opts  `getManifest` returns the declared dep ranges for a resolved
 *   `pkg@version`, or null when unavailable (degrade to "unverified").
 * @returns {Promise<CoherenceReport>}
 */
export async function checkImportmapCoherence(imports, opts) {
  const pinned = extractPinnedVersions(imports);
  /** @type {CoherenceConflict[]} */
  const conflicts = [];
  /** @type {Array<{ pkg: string, reason: string }>} */
  const unverified = [];
  // Sort for deterministic output: the same dep set always yields the same
  // ordering, which keeps the verdict (and any test asserting it) stable and
  // strengthens the parity guarantee end to end.
  const packages = [...pinned.keys()].sort();
  // Count of packages whose metadata we could actually read (so a conflict
  // verdict is grounded). A package whose manifest is unavailable lands in
  // `unverified` instead and does NOT count as checked, which lets the caller
  // distinguish "verified coherent" from "could not verify anything".
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
        // Only edges INTO the pinned graph matter: a dep on a package that is
        // not in this importmap is not the importmap's coherence problem (it
        // is either bundled into a CDN megabundle or simply unused on the
        // client). Self-edges cannot conflict.
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
        // ok === null (range shape not understood) is silently skipped: the
        // check never warns on a range it could not evaluate.
      }
    }
  }
  return { conflicts, unverified, checked };
}
