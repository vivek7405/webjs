import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha384Integrity } from './integrity.js';
import { vendorImportMapEntries, isLastLiveResolveFailed, setLastLiveResolveFailed } from './jspm.js';
import { readPinFile } from './pins.js';
import { BUFFERED_MARKER } from '../conditional-get.js';

const liveIntegrityCache = new Map();

export function clearLiveIntegrityCache() {
  liveIntegrityCache.clear();
}

const INTEGRITY_FETCH_TIMEOUT_MS = 10_000;
const INTEGRITY_FETCH_CONCURRENCY = 6;
const INTEGRITY_TOTAL_BUDGET_MS = 15_000;

function pinDir(appDir) {
  return join(appDir, '.webjs', 'vendor');
}

async function fetchLiveIntegrity(url) {
  const cached = liveIntegrityCache.get(url);
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTEGRITY_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const buf = new Uint8Array(await response.arrayBuffer());
    const sri = await sha384Integrity(buf);
    liveIntegrityCache.set(url, sri);
    return sri;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function computeLiveIntegrity(imports) {
  const urls = [...new Set(Object.values(imports))].filter((u) => /^https:\/\//.test(u));
  const integrity = {};
  if (urls.length === 0) return integrity;

  const failed = [];
  let next = 0;
  const deadline = Date.now() + INTEGRITY_TOTAL_BUDGET_MS;
  async function worker() {
    while (next < urls.length && Date.now() < deadline) {
      const url = urls[next++];
      const sri = await fetchLiveIntegrity(url);
      if (sri) integrity[url] = sri;
      else failed.push(url);
    }
  }
  const workerCount = Math.min(INTEGRITY_FETCH_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  while (next < urls.length) failed.push(urls[next++]);

  if (failed.length) {
    console.warn(
      `[webjs] could not compute SRI for ${failed.length} live-resolved ` +
      `vendor URL(s) (e.g. ${failed[0]}); they will load WITHOUT integrity. ` +
      `This is a fail-open fallback for a CDN fetch failure or the warmup ` +
      `time budget; the app still works. Run \`webjs vendor pin\` to lock in ` +
      `SRI hashes.`,
    );
  }
  return integrity;
}

export async function resolveVendorImports(appDir, getBareImports) {
  const file = await readPinFile(appDir);
  if (file) {
    return { imports: file.imports, integrity: file.integrity || {}, ok: true };
  }
  setLastLiveResolveFailed(false);
  const bareImports = await getBareImports();
  const imports = await vendorImportMapEntries(bareImports, appDir);
  const integrity = await computeLiveIntegrity(imports);
  return { imports, integrity, ok: !isLastLiveResolveFailed() };
}

export async function serveDownloadedBundle(filename, appDir, dev) {
  if (!/^[A-Za-z0-9@._+-]+\.js$/.test(filename) || filename.includes('..')) {
    return new Response(`/* invalid vendor filename */`, {
      status: 400,
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }
  try {
    const body = await readFile(join(pinDir(appDir), filename));
    return new Response(body, {
      headers: {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': dev ? 'no-cache' : 'public, max-age=31536000, immutable',
        [BUFFERED_MARKER]: '1',
      },
    });
  } catch {
    return new Response(`/* vendor bundle not found. Run webjs vendor pin --download to (re-)download. */`, {
      status: 404,
      headers: { 'content-type': 'application/javascript; charset=utf-8' },
    });
  }
}
