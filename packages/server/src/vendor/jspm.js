import { BUILTIN, FRAMEWORK_SERVER_ONLY, extractPackageName } from './scanner.js';
import { getPackageVersion } from './manifest.js';
import { normalizeProvider, SUPPORTED_PROVIDERS } from './providers.js';

const jspmCache = new Map();
let lastLiveResolveFailed = false;

export function isLastLiveResolveFailed() {
  return lastLiveResolveFailed;
}

export function setLastLiveResolveFailed(val) {
  lastLiveResolveFailed = val;
}

const JSPM_GENERATE_ENDPOINT = 'https://api.jspm.io/generate';
const JSPM_GENERATE_TIMEOUT_MS = 10_000;

async function jspmCall(installs, provider, timeoutMs = JSPM_GENERATE_TIMEOUT_MS) {
  const label = installs.length === 1 ? `'${installs[0]}'` : `${installs.length} packages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(JSPM_GENERATE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        install: installs,
        flattenScope: true,
        env: ['browser', 'production', 'module'],
        provider: normalizeProvider(provider),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        if (body && typeof body.error === 'string') detail = `: ${body.error}`;
      } catch { /* non-JSON body */ }
      console.error(
        `[webjs] could not vendor ${label} via ${provider} (status ${response.status})${detail}`,
      );
      const transient = response.status >= 500 || response.status === 429;
      return { ok: false, imports: {}, transient };
    }
    const result = await response.json();
    const imports = (result && result.map && result.map.imports) || {};
    return { ok: true, imports, transient: false };
  } catch (e) {
    const msg = e && e.name === 'AbortError'
      ? `timed out after ${timeoutMs}ms`
      : `${e && e.message}`;
    console.error(`[webjs] could not vendor ${label} via ${provider}: ${msg}`);
    return { ok: false, imports: {}, transient: true };
  } finally {
    clearTimeout(timer);
  }
}

async function jspmResolveOne(install, provider = 'jspm', timeoutMs) {
  const { ok, imports, transient } = await jspmProbeOne(install, provider, timeoutMs);
  if (!ok && transient) lastLiveResolveFailed = true;
  return imports;
}

function jspmProbeOne(install, provider, timeoutMs) {
  const cacheKey = `${provider}::probe::${install}`;
  const existing = jspmCache.get(cacheKey);
  if (existing) return existing;

  const promise = (async () => {
    const result = await jspmCall([install], provider, timeoutMs);
    if (!result.ok) jspmCache.delete(cacheKey);
    return result;
  })();

  jspmCache.set(cacheKey, promise);
  return promise;
}

function mergePerInstall(fragments) {
  const merged = {};
  for (const fragment of fragments) Object.assign(merged, fragment);
  return merged;
}

/**
 * Resolve a list of `pkg@version` installs to importmap entries via jspm.io.
 *
 * @param {Array<string>} installs
 * @param {string} [provider]
 * @param {number} [timeoutMs]
 * @returns {Promise<Record<string, string>>}
 */
export async function jspmGenerate(installs, provider = 'jspm', timeoutMs) {
  if (installs.length === 0) return {};

  if (installs.length === 1) return jspmResolveOne(installs[0], provider, timeoutMs);

  const unifiedKey = `${provider}::unified::${[...installs].sort().join('\n')}`;
  const cached = jspmCache.get(unifiedKey);
  if (cached) return cached;

  const promise = (async () => {
    const unified = await jspmCall(installs, provider, timeoutMs);
    if (unified.ok) return unified.imports;

    jspmCache.delete(unifiedKey);

    if (unified.transient) {
      lastLiveResolveFailed = true;
      return mergePerInstall(await Promise.all(installs.map(i => jspmResolveOne(i, provider, timeoutMs))));
    }

    const probes = await Promise.all(installs.map(i => jspmProbeOne(i, provider, timeoutMs)));
    const transientProbe = probes.some(p => !p.ok && p.transient);
    if (transientProbe) {
      lastLiveResolveFailed = true;
      return mergePerInstall(probes.map(p => p.imports));
    }

    const resolvable = installs.filter((_, idx) => probes[idx].ok);

    if (resolvable.length === installs.length) {
      return mergePerInstall(probes.map(p => p.imports));
    }
    if (resolvable.length === 0) return {};
    if (resolvable.length === 1) return jspmResolveOne(resolvable[0], provider, timeoutMs);

    const retry = await jspmCall(resolvable, provider, timeoutMs);
    if (retry.ok) return retry.imports;
    return mergePerInstall(resolvable.map(i => probes[installs.indexOf(i)].imports));
  })();

  jspmCache.set(unifiedKey, promise);
  return promise;
}

/**
 * Build importmap entries for discovered bare imports.
 *
 * @param {Set<string>} bareImports
 * @param {string} appDir
 * @returns {Promise<Record<string, string>>}
 */
export async function vendorImportMapEntries(bareImports, appDir) {
  const installs = [];
  for (const spec of bareImports) {
    if (BUILTIN.has(spec)) continue;
    const pkg = extractPackageName(spec);
    if (!pkg || BUILTIN.has(pkg) || FRAMEWORK_SERVER_ONLY.has(pkg)) continue;
    const version = getPackageVersion(pkg, appDir);
    if (!version) continue;
    const subpath = spec.slice(pkg.length);
    installs.push(`${pkg}@${version}${subpath}`);
  }
  return jspmGenerate(installs);
}

/**
 * Clear in-memory JSPM generator cache.
 */
export function clearJspmCache() {
  jspmCache.clear();
}

