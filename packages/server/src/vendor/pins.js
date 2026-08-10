import { readFile, writeFile, mkdir, unlink, stat, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUILTIN, FRAMEWORK_SERVER_ONLY, extractPackageName, scanBareImports } from './scanner.js';
import { getPackageVersion } from './manifest.js';
import { SUPPORTED_PROVIDERS } from './providers.js';
import { sha384Integrity } from './integrity.js';
import { jspmGenerate } from './jspm.js';

const PIN_DIR_REL = ['.webjs', 'vendor'];
const PIN_FILE = 'importmap.json';
const PIN_BUNDLE_TIMEOUT_MS = 60_000;

function pinDir(appDir) {
  return join(appDir, ...PIN_DIR_REL);
}

function pinFilePath(appDir) {
  return join(pinDir(appDir), PIN_FILE);
}

const VENDOR_GITIGNORE_LINES = [
  '**/.webjs/*',
  '!**/.webjs/vendor/',
  '!**/.webjs/vendor/**',
];

function vendorPinIsIgnored(appDir) {
  try {
    const {
      GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, GIT_PREFIX: _gp,
      ...gitEnv
    } = process.env;
    const probe = `.webjs/vendor/${PIN_FILE}`;
    const result = spawnSync('git', ['check-ignore', '-q', probe], {
      cwd: appDir,
      stdio: 'pipe',
      env: gitEnv,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export async function ensureVendorCommittable(appDir) {
  if (!vendorPinIsIgnored(appDir)) {
    return { ignored: false, patched: false, gitignorePath: null };
  }
  const gitignorePath = join(appDir, '.gitignore');
  let original;
  try {
    original = await readFile(gitignorePath, 'utf8');
  } catch {
    return { ignored: true, patched: false, gitignorePath: null };
  }

  const exclude = VENDOR_GITIGNORE_LINES[0];
  const eol = /\r\n/.test(original) ? '\r\n' : '\n';

  const lines = original.split('\n');
  let rewroteDir = false;
  const rewritten = lines.map((line) => {
    const t = line.replace(/\r$/, '').trim();
    if (/^(\*\*\/|\/)?\.webjs\/?$/.test(t)) {
      rewroteDir = true;
      return line.endsWith('\r') ? exclude + '\r' : exclude;
    }
    return line;
  });

  const present = new Set(rewritten.map((l) => l.replace(/\r$/, '').trim()));
  const missing = VENDOR_GITIGNORE_LINES.filter((l) => !present.has(l));

  let next = rewritten.join('\n');
  if (missing.length > 0) {
    const block =
      [
        '# webjs: keep the committed vendor pin (`webjs vendor pin`) out of',
        '# the `.webjs` cache exclusion so the pinned importmap is committable.',
        ...missing,
      ].join(eol) + eol;
    const sep = next.endsWith('\n') || next === '' ? '' : eol;
    next = next + sep + block;
  }

  if (!rewroteDir && missing.length === 0) {
    return { ignored: true, patched: false, gitignorePath };
  }

  await writeFile(gitignorePath, next);

  if (vendorPinIsIgnored(appDir)) {
    await writeFile(gitignorePath, original);
    return { ignored: true, patched: false, gitignorePath };
  }
  return { ignored: true, patched: true, gitignorePath };
}

export function hasVendorPin(appDir) {
  return existsSync(pinFilePath(appDir));
}

function bundleFilenameWithSubpath(pkgName, version, subpath) {
  const safeName = pkgName.replace(/\//g, '--');
  const safeSubpath = subpath.replace(/\//g, '__');
  return `${safeName}@${version}${safeSubpath}.js`;
}

export async function readPinFile(appDir) {
  try {
    const raw = await readFile(pinFilePath(appDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.imports !== 'object' || Array.isArray(parsed.imports)) {
      return null;
    }
    const cleanImports = {};
    for (const [k, v] of Object.entries(parsed.imports)) {
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      if (/[\x00-\x1f\x7f]/.test(k)) continue;
      if (!/^(?:https?:\/\/[^/]|\/[^/])/.test(v)) continue;
      cleanImports[k] = v;
    }
    if (Object.keys(cleanImports).length === 0) return null;

    const cleanIntegrity = {};
    if (parsed.integrity && typeof parsed.integrity === 'object' && !Array.isArray(parsed.integrity)) {
      for (const [k, v] of Object.entries(parsed.integrity)) {
        if (typeof k === 'string' && typeof v === 'string' && /^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(v)) {
          cleanIntegrity[k] = v;
        }
      }
    }
    const out = { imports: cleanImports };
    if (Object.keys(cleanIntegrity).length) out.integrity = cleanIntegrity;
    if (typeof parsed.provider === 'string' && SUPPORTED_PROVIDERS.has(parsed.provider)) {
      out.provider = parsed.provider;
    }
    return out;
  } catch {
    return null;
  }
}

export async function writePinFile(appDir, imports, integrity, provider) {
  await mkdir(pinDir(appDir), { recursive: true });
  const payload = { imports };
  if (integrity && Object.keys(integrity).length) payload.integrity = integrity;
  if (provider && provider !== 'jspm') payload.provider = provider;
  const body = JSON.stringify(payload, null, 2) + '\n';
  const finalPath = pinFilePath(appDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, body, 'utf8');
  await rename(tmpPath, finalPath);
}

async function downloadBundle(url, appDir, filename) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIN_BUNDLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[webjs] download ${url} returned ${response.status}`);
      return null;
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    await mkdir(pinDir(appDir), { recursive: true });
    await writeFile(join(pinDir(appDir), filename), buf);
    return { bytes: buf.byteLength, integrity: await sha384Integrity(buf) };
  } catch (e) {
    const why = e && e.name === 'AbortError'
      ? `timed out after ${PIN_BUNDLE_TIMEOUT_MS}ms`
      : e && e.message;
    console.error(`[webjs] download ${url} failed: ${why}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchIntegrity(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIN_BUNDLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[webjs] hash ${url} returned ${response.status}`);
      return null;
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    return await sha384Integrity(buf);
  } catch (e) {
    const why = e && e.name === 'AbortError'
      ? `timed out after ${PIN_BUNDLE_TIMEOUT_MS}ms`
      : e && e.message;
    console.error(`[webjs] hash ${url} failed: ${why}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function pruneOrphans(appDir, expected) {
  const dir = pinDir(appDir);
  let files;
  try { files = await readdir(dir); } catch { return []; }
  const pruned = [];
  for (const f of files) {
    if (expected.has(f)) continue;
    try {
      await unlink(join(dir, f));
      pruned.push(f);
    } catch { /* ignore */ }
  }
  return pruned;
}

export function derivePinParts(spec, url) {
  const pkg = extractPackageName(spec);
  if (!pkg) return null;
  const subpath = spec.slice(pkg.length);
  const escapedBare = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
  if (!match) return null;
  return { pkg, version: match[1], subpath };
}

export function basePackage(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

export function prunePinToReachable(imports, integrity, reachable) {
  const reachableBases = new Set([...reachable].map(basePackage));
  const keptImports = {};
  for (const [spec, url] of Object.entries(imports || {})) {
    if (reachable.has(spec) || reachableBases.has(basePackage(spec))) {
      keptImports[spec] = url;
    }
  }
  const keptUrls = new Set(Object.values(keptImports));
  const keptIntegrity = {};
  for (const [url, hash] of Object.entries(integrity || {})) {
    if (keptUrls.has(url)) keptIntegrity[url] = hash;
  }
  return { imports: keptImports, integrity: keptIntegrity };
}

export async function pinAll(appDir, opts = {}) {
  const download = !!opts.download;
  const existing = await readPinFile(appDir);
  const from = opts.from || existing?.provider || 'jspm';
  if (!SUPPORTED_PROVIDERS.has(from)) {
    throw new Error(
      `[webjs] unknown provider '${from}'. Supported: ${[...SUPPORTED_PROVIDERS].join(', ')}.`,
    );
  }
  const bare = await scanBareImports(appDir);
  const installs = [];
  const partsByInstall = new Map();
  const droppedUnresolvable = [];
  for (const spec of bare) {
    if (BUILTIN.has(spec)) continue;
    const pkg = extractPackageName(spec);
    if (!pkg || BUILTIN.has(pkg) || FRAMEWORK_SERVER_ONLY.has(pkg)) continue;
    const version = getPackageVersion(pkg, appDir);
    if (!version) {
      droppedUnresolvable.push(spec);
      continue;
    }
    const subpath = spec.slice(pkg.length);
    const install = `${pkg}@${version}${subpath}`;
    installs.push(install);
    partsByInstall.set(spec, { pkg, version, subpath });
  }
  const resolved = await jspmGenerate(installs, from, PIN_BUNDLE_TIMEOUT_MS);

  const importmap = {};
  const integrity = {};
  const pins = [];
  const expected = new Set([PIN_FILE]);
  let downloaded = 0;

  const pinnedDirectSpecs = new Set();
  for (const [spec, jspmUrl] of Object.entries(resolved)) {
    const parts = partsByInstall.get(spec) || derivePinParts(spec, jspmUrl);
    if (!parts) continue;
    const direct = partsByInstall.has(spec);
    const { pkg, version, subpath } = parts;
    if (download) {
      const filename = bundleFilenameWithSubpath(pkg, version, subpath);
      const result = await downloadBundle(jspmUrl, appDir, filename);
      if (result == null) continue;
      const localUrl = `/__webjs/vendor/${filename}`;
      importmap[spec] = localUrl;
      integrity[localUrl] = result.integrity;
      expected.add(filename);
      pins.push({ pkg: spec, version, url: localUrl, bytes: result.bytes, integrity: result.integrity });
      downloaded++;
    } else {
      importmap[spec] = jspmUrl;
      const sri = await fetchIntegrity(jspmUrl);
      if (sri) integrity[jspmUrl] = sri;
      else console.warn(
        `[webjs] could not compute SRI for ${jspmUrl}; pinning without ` +
        `integrity (browser will accept any bytes from this URL on ` +
        `next load). Rerun \`webjs vendor pin\` when jspm.io is healthy ` +
        `to lock in the integrity hash.`,
      );
      pins.push({ pkg: spec, version, url: jspmUrl, integrity: sri || undefined });
    }
    if (direct) pinnedDirectSpecs.add(spec);
  }

  if (installs.length > 0 && pinnedDirectSpecs.size === 0) {
    return { pins, pruned: [], downloaded, failed: true, attemptedInstalls: installs, provider: from };
  }

  if (pinnedDirectSpecs.size < partsByInstall.size) {
    const missing = [];
    for (const [spec, parts] of partsByInstall.entries()) {
      if (!pinnedDirectSpecs.has(spec)) {
        missing.push(`${parts.pkg}@${parts.version}${parts.subpath}`);
      }
    }
    console.warn(
      `[webjs] pin: partial success. The following installs did NOT ` +
      `make it into the pin file and will fall back to live ` +
      `resolution on next boot:`,
    );
    for (const m of missing) console.warn(`  ${m}`);
  }

  if (installs.length === 0) {
    if (droppedUnresolvable.length > 0) {
      return { pins, pruned: [], downloaded, droppedUnresolvable, provider: from };
    }
    return { pins, pruned: [], downloaded, noBareImports: true, provider: from };
  }

  await writePinFile(appDir, importmap, integrity, from);
  const pruned = await pruneOrphans(appDir, expected);
  return droppedUnresolvable.length > 0
    ? { pins, pruned, downloaded, provider: from, droppedUnresolvable }
    : { pins, pruned, downloaded, provider: from };
}

export async function unpinPackage(appDir, pkg) {
  const file = await readPinFile(appDir);
  if (!file || !(pkg in file.imports)) return { removed: false };
  const url = file.imports[pkg];
  delete file.imports[pkg];
  const newIntegrity = { ...(file.integrity || {}) };
  delete newIntegrity[url];
  if (Object.keys(file.imports).length === 0) {
    try { await unlink(pinFilePath(appDir)); } catch { /* ignore */ }
  } else {
    await writePinFile(appDir, file.imports, newIntegrity, file.provider);
  }

  let deletedFile;
  if (url.startsWith('/__webjs/vendor/')) {
    const filename = url.slice('/__webjs/vendor/'.length);
    try {
      await unlink(join(pinDir(appDir), filename));
      deletedFile = filename;
    } catch { /* ignore */ }
  }
  return { removed: true, deletedFile };
}

export async function listPinned(appDir) {
  const file = await readPinFile(appDir);
  if (!file) return [];
  const entries = [];
  for (const [pkg, url] of Object.entries(file.imports)) {
    let version = '(unknown)';
    let bytes;
    if (url.startsWith('/__webjs/vendor/')) {
      const filename = url.slice('/__webjs/vendor/'.length);
      const atIdx = filename.lastIndexOf('@');
      if (atIdx > 0) {
        const afterAt = filename.slice(atIdx + 1, -3);
        const subIdx = afterAt.indexOf('__');
        version = subIdx < 0 ? afterAt : afterAt.slice(0, subIdx);
      }
      try {
        const st = await stat(join(pinDir(appDir), filename));
        bytes = st.size;
      } catch { /* ignore */ }
    } else {
      const bare = extractPackageName(pkg) || pkg;
      const escapedBare = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bareMatch = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
      if (bareMatch) version = bareMatch[1];
    }
    entries.push({ pkg, version, url, bytes });
  }
  return entries;
}
