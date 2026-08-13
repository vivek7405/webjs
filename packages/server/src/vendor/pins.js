import { readFile, writeFile, mkdir, unlink, stat, rename, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUILTIN, FRAMEWORK_SERVER_ONLY, extractPackageName, scanBareImports } from './scanner.js';
import { getPackageVersion } from './manifest.js';
import { SUPPORTED_PROVIDERS } from './providers.js';
import { PIN_BUNDLE_TIMEOUT_MS, fetchIntegrity, sha384Integrity } from './integrity.js';
import { jspmGenerate } from './jspm.js';

const PIN_DIR_REL = ['.webjs', 'vendor'];
const PIN_FILE = 'importmap.json';
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

/** Compute the absolute path of the pin directory for an app. */
function pinDir(appDir) {
  return join(appDir, ...PIN_DIR_REL);
}

/** Compute the absolute path of the importmap config file for an app. */
function pinFilePath(appDir) {
  return join(pinDir(appDir), PIN_FILE);
}

/**
 * The three-line `.gitignore` pattern that ignores the transient
 * `.webjs` caches at any depth while re-including the committed
 * `.webjs/vendor/` pin output. This mirrors the scaffold template
 * (`packages/cli/templates/gitignore`, shipped dotless so npm cannot
 * strip it, renamed to `.gitignore` on copy) and the `vendor-gitignore`
 * check in `doctor.js` verbatim, so a self-healed `.gitignore`
 * ends up byte-identical to a freshly scaffolded one.
 */
const VENDOR_GITIGNORE_LINES = [
  '**/.webjs/*',
  '!**/.webjs/vendor/',
  '!**/.webjs/vendor/**',
];

/**
 * Probe whether `appDir`'s `.gitignore` would swallow the vendor pin
 * output, via `git check-ignore`. Best-effort: returns false when the
 * directory is not a git repo, git is absent, or the spawn fails.
 *
 * The inherited GIT_* env vars are stripped so `cwd` is the sole
 * authority on which repo + `.gitignore` stack is consulted. Git
 * exports GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE / GIT_PREFIX into
 * hook processes (a pre-commit hook from a linked worktree exports
 * GIT_WORK_TREE), and those OVERRIDE cwd-based discovery; without the
 * strip the probe would consult the outer repo instead of `appDir`.
 * Same reasoning as the `vendor-gitignore` doctor check.
 *
 * @param {string} appDir
 * @returns {boolean} true when `.webjs/vendor/importmap.json` is ignored
 */
function vendorPinIsIgnored(appDir) {
  try {
    const {
      GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, GIT_PREFIX: _gp,
      ...gitEnv
    } = process.env;
    const probe = `.webjs/vendor/${PIN_FILE}`;
    // `git check-ignore -q` exits 0 when ignored, 1 when not ignored,
    // 128 on error (not a git repo, etc.). Treat anything but 0 as
    // "not ignored" so a non-git project never gets its .gitignore
    // touched.
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

/**
 * Make the `webjs vendor pin` output committable, idempotently.
 *
 * Vendoring is an OPTIONAL opt-in: the no-build default resolves bare
 * specifiers at runtime via jspm.io and needs nothing committed. But a
 * user who runs `webjs vendor pin` deliberately creates pins they want
 * in source control, and a `.gitignore` that excludes `.webjs/` (the
 * older scaffold pattern, or one an editor/agent "simplified") silently
 * swallows that output. Fresh scaffolds already carry the vendor
 * exception (a glob exclusion plus a re-include negation), so for them
 * this is a no-op.
 *
 * Behaviour (only ever called from the opt-in `vendor pin` path):
 *   - The pin output is NOT ignored (the common, already-correct case):
 *     return `{ ignored: false, patched: false }`. Nothing is written.
 *   - The pin output IS ignored AND a `.gitignore` exists: heal it (see
 *     below), then re-probe. If the pin is committable afterwards return
 *     `{ ignored: true, patched: true, gitignorePath }`; if a broader
 *     unrelated rule still swallows it (e.g. a root `*.json`), the heal
 *     cannot help, so revert the edit and return `patched: false` so the
 *     caller prints a notice rather than claiming a fix that did not take.
 *   - The pin output IS ignored but there is NO `.gitignore` to patch
 *     (e.g. the ignore comes from a parent repo's `.gitignore`, or from
 *     `.git/info/exclude`): leave the tree untouched and return
 *     `{ ignored: true, patched: false, gitignorePath: null }` so the
 *     caller can print a notice instead of writing a file the user did
 *     not create.
 *
 * Healing has two parts, because a plain append is NOT enough. A bare
 * directory exclusion (`.webjs/`, `/.webjs/`, `.webjs`, with or without a
 * leading glob) excludes the directory itself, and git CANNOT re-include
 * a child of an excluded directory, so any later negation is silently
 * dead. So: (1) rewrite each such line IN PLACE to the glob form
 * (`**` + `/.webjs/*`), which ignores the directory's CONTENTS at any
 * depth while leaving the directory re-includable; (2) append whichever
 * of the three exception lines are still missing. The heal is idempotent:
 * a re-run finds the pin already committable and short-circuits.
 *
 * @param {string} appDir
 * @returns {Promise<{ ignored: boolean, patched: boolean, gitignorePath: string | null }>}
 */
export async function ensureVendorCommittable(appDir) {
  if (!vendorPinIsIgnored(appDir)) {
    return { ignored: false, patched: false, gitignorePath: null };
  }
  const gitignorePath = join(appDir, '.gitignore');
  let original;
  try {
    original = await readFile(gitignorePath, 'utf8');
  } catch {
    // No app-level .gitignore to patch. The ignore is coming from a
    // parent repo or from .git/info/exclude; do not fabricate a
    // .gitignore the user never had. Let the caller print a notice.
    return { ignored: true, patched: false, gitignorePath: null };
  }

  // The exclusion glob, assembled so the literal `*` + `/` sequence never
  // appears in this file's source comments above.
  const exclude = VENDOR_GITIGNORE_LINES[0]; // **/.webjs/*

  // Preserve the file's line ending so a CRLF .gitignore stays all-CRLF
  // (and an LF one all-LF). Splitting on bare `\n` keeps each existing
  // line's trailing `\r`; the lines we WRITE (the rewritten exclusion and
  // the appended block) must use the same ending or the file goes mixed.
  // A file with any CRLF is treated as CRLF; otherwise LF.
  const eol = /\r\n/.test(original) ? '\r\n' : '\n';

  // 1. Rewrite any bare `.webjs` DIRECTORY exclusion to the glob form. A
  //    directory exclusion blocks all child negations, so it must become
  //    `**/.webjs/*` (ignore contents, keep the dir re-includable).
  const lines = original.split('\n');
  let rewroteDir = false;
  const rewritten = lines.map((line) => {
    // Trim CR too, so a CRLF file's `.webjs/\r` still matches.
    const t = line.replace(/\r$/, '').trim();
    // Match the bare-directory shapes only (no `/*` suffix, not already a
    // negation): `.webjs`, `.webjs/`, `/.webjs`, `/.webjs/`, `**/.webjs`,
    // `**/.webjs/`. These all exclude the directory itself. Emit the
    // replacement with the file's own ending if the original line carried
    // one (every line but a no-trailing-newline last line does).
    if (/^(\*\*\/|\/)?\.webjs\/?$/.test(t)) {
      rewroteDir = true;
      return line.endsWith('\r') ? exclude + '\r' : exclude;
    }
    return line;
  });

  // 2. Append whichever exception lines are still missing.
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
    // Nothing to change, yet git still ignores the pin: a broader,
    // unrelated rule is the cause and the vendor exception cannot fix it.
    return { ignored: true, patched: false, gitignorePath };
  }

  await writeFile(gitignorePath, next);

  // 3. Re-probe. If a broader unrelated rule still swallows the pin, the
  //    edit did not achieve the goal, so revert it and report not-patched
  //    so the caller prints a notice instead of an inaccurate success.
  if (vendorPinIsIgnored(appDir)) {
    await writeFile(gitignorePath, original);
    return { ignored: true, patched: false, gitignorePath };
  }
  return { ignored: true, patched: true, gitignorePath };
}

/**
 * True when the app commits a vendor pin file (`.webjs/vendor/importmap.json`).
 * A pinned app's importmap is deterministic and cheap to read, so `dev.js`
 * resolves it AT BOOT (no analysis, no network) and publishes the build id
 * immediately, giving the recommended posture a stable id from the first
 * response with zero warmup exposure. An unpinned app returns false and keeps
 * its vendor resolution deferred to the first request.
 *
 * @param {string} appDir
 * @returns {boolean}
 */
export function hasVendorPin(appDir) {
  return existsSync(pinFilePath(appDir));
}

/**
 * Filesystem-safe filename for a downloaded bundle. Encodes the full
 * specifier (which may include a subpath) into a flat filename:
 *
 *   bundleFilenameWithSubpath('dayjs', '1.11.13', '')             returns 'dayjs@1.11.13.js'
 *   bundleFilenameWithSubpath('dayjs', '1.11.13', '/plugin/utc')  returns 'dayjs@1.11.13__plugin__utc.js'
 *   bundleFilenameWithSubpath('@hotwired/turbo', '8.0.0', '')     returns '@hotwired--turbo@8.0.0.js'
 *
 * Scoped names use `--` to encode `/`; subpath separators use `__`.
 * Both are reversible round-trip so unpin / list can parse the
 * package + version + subpath back from the filename.
 */
function bundleFilenameWithSubpath(pkgName, version, subpath) {
  const safeName = pkgName.replace(/\//g, '--');
  const safeSubpath = subpath.replace(/\//g, '__');
  return `${safeName}@${version}${safeSubpath}.js`;
}

/**
 * Read the committed pin importmap if one exists. Returns the parsed
 * `{ imports, integrity?, provider? }` shape or null if no pin file.
 * The `integrity` and `provider` fields are optional: pin files
 * written before SRI / multi-CDN support lack them; pin files written
 * by current `webjs vendor pin` include them (provider only when
 * non-default).
 *
 * @param {string} appDir
 * @returns {Promise<{ imports: Record<string, string>, integrity?: Record<string, string>, provider?: string } | null>}
 */
export async function readPinFile(appDir) {
  try {
    const raw = await readFile(pinFilePath(appDir), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.imports !== 'object' || Array.isArray(parsed.imports)) {
      return null;
    }
    // Validate every imports entry. Drop:
    // - non-string keys/values (numbers, nulls, objects from malformed
    //   hand-edits would otherwise land structurally-invalid entries in
    //   the served importmap and break the browser parser);
    // - keys containing newlines or other control chars (they would
    //   serialize to escape sequences in JSON and confuse downstream
    //   diffing logic);
    // - values whose URL scheme isn't `http(s)://` or a path starting
    //   with `/` (relative to the app's origin). `javascript:` and
    //   `data:` URLs in a malicious pin file would otherwise be
    //   accepted by the browser's importmap parser and let an attacker
    //   ship code via a single-line pin diff. Tightest acceptable
    //   set: matches what `webjs vendor pin` itself produces
    //   (`https://ga.jspm.io/...` or `/__webjs/vendor/...`).
    /** @type {Record<string, string>} */
    const cleanImports = {};
    for (const [k, v] of Object.entries(parsed.imports)) {
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      if (/[\x00-\x1f\x7f]/.test(k)) continue;
      // Require a non-slash byte after the scheme prefix so a
      // hand-edited or tampered pin file cannot smuggle a
      // protocol-relative URL like `//attacker.tld/x.js` past the
      // filter. Browsers resolve `//host/path` against the document
      // origin and would happily fetch attacker-controlled code if
      // the importmap accepted it. The framework itself only writes
      // `https://ga.jspm.io/...` or `/__webjs/vendor/...`, which both
      // satisfy the tighter form.
      if (!/^(?:https?:\/\/[^/]|\/[^/])/.test(v)) continue;
      cleanImports[k] = v;
    }
    if (Object.keys(cleanImports).length === 0) return null;

    /** @type {Record<string, string>} */
    const cleanIntegrity = {};
    if (parsed.integrity && typeof parsed.integrity === 'object' && !Array.isArray(parsed.integrity)) {
      for (const [k, v] of Object.entries(parsed.integrity)) {
        // Integrity values must look like SRI hashes end-to-end
        // (`sha(256|384|512)-<base64>`). Anchor the regex on both
        // ends and constrain the body to the base64 alphabet so a
        // hand-edited or tampered pin file can't slip an attribute
        // injection (e.g. `sha384-x"><script>`) past the prefix
        // check and through to `integrity="..."` emission in ssr.js
        // unescaped.
        if (typeof k === 'string' && typeof v === 'string' && /^sha(256|384|512)-[A-Za-z0-9+/=]+$/.test(v)) {
          cleanIntegrity[k] = v;
        }
      }
    }
    /** @type {{ imports: Record<string,string>, integrity?: Record<string,string>, provider?: string }} */
    const out = { imports: cleanImports };
    if (Object.keys(cleanIntegrity).length) out.integrity = cleanIntegrity;
    // Provider is optional in the pin file. Validate against the
    // supported set so a tampered file can't smuggle an arbitrary
    // string into downstream code paths.
    if (typeof parsed.provider === 'string' && SUPPORTED_PROVIDERS.has(parsed.provider)) {
      out.provider = parsed.provider;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Write the pin importmap to `.webjs/vendor/importmap.json`. Ensures
 * the directory exists. Pretty-printed for human-reviewable diffs.
 *
 * When `integrity` is provided and non-empty, it's included alongside
 * `imports` as a sibling key (matching the browser importmap-integrity
 * spec: a flat `{url: 'sha384-...'}` map). Omitted entirely when empty
 * so older WebJs versions read the file as before.
 *
 * `provider` is persisted alongside imports when non-default. It lets
 * `webjs vendor update` know which CDN to re-resolve against, and
 * makes the pin file self-describing for incident response: if jspm.io
 * has an outage you can read the file and know which alternate CDN
 * the deploy targets. Omitted for the default jspm provider so the
 * pin file shape stays stable for the 99% case.
 *
 * @param {string} appDir
 * @param {Record<string, string>} imports
 * @param {Record<string, string>} [integrity]
 * @param {string} [provider]
 */
export async function writePinFile(appDir, imports, integrity, provider) {
  await mkdir(pinDir(appDir), { recursive: true });
  /** @type {Record<string, any>} */
  const payload = { imports };
  if (integrity && Object.keys(integrity).length) payload.integrity = integrity;
  if (provider && provider !== 'jspm') payload.provider = provider;
  const body = JSON.stringify(payload, null, 2) + '\n';
  // Atomic write: stage into a sibling tmp file, then rename onto the
  // final path. Rename within the same directory is atomic on POSIX
  // and on Windows since Node 14+, so a crash mid-write can leave the
  // tmp file as garbage but cannot corrupt the live pin file. Without
  // this, a partially-written importmap.json round-trips through
  // readPinFile as null (fail-closed) but still requires the user to
  // notice and rerun pin; the rename keeps the live file intact across
  // every failure mode.
  const finalPath = pinFilePath(appDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, body, 'utf8');
  await rename(tmpPath, finalPath);
}

/**
 * Download a single jspm.io URL and write the body to
 * `.webjs/vendor/<filename>`. Returns `{ bytes, integrity }` on
 * success or null on failure. The integrity hash is computed from the
 * downloaded bytes so it's always consistent with what's on disk.
 *
 * Bounded by PIN_BUNDLE_TIMEOUT_MS. `pinAll(dir, { download: true })`
 * runs this once per resolved URL on a CLI run with no ambient
 * deadline, so a CDN that accepts the connection and then stalls would
 * otherwise hang the pin with nothing to interrupt it (#1150).
 *
 * @param {string} url
 * @param {string} appDir
 * @param {string} filename
 * @returns {Promise<{ bytes: number, integrity: string } | null>}
 */
async function downloadBundle(url, appDir, filename) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIN_BUNDLE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      console.error(`[webjs] download ${url} returned ${response.status}`);
      return null;
    }
    // Hash raw response bytes, not the UTF-8 decoded string. The
    // browser's SRI implementation hashes the raw body bytes; if we
    // hashed `.text()` here we'd risk encoding round-trip drift on
    // any byte sequence the decode-then-re-encode pipeline doesn't
    // round-trip exactly. arrayBuffer + Uint8Array gives us the
    // same primitive the browser uses.
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


/**
 * After writing the new pin output, delete any file in the pin
 * directory that doesn't belong. Handles three orphan scenarios
 * uniformly: version-bump leftovers, removed packages, and mode
 * switches (default <-> download).
 *
 * @param {string} appDir
 * @param {Set<string>} expected  filenames that should remain
 * @returns {Promise<string[]>}   list of pruned filenames
 */
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
    } catch { /* race or permission; ignore */ }
  }
  return pruned;
}

/**
 * Recover `{ pkg, version, subpath }` for a resolved import spec that was
 * NOT in the directly-scanned set, i.e. a flattened transitive the unified
 * resolve added (issue #446). The bare package name and subpath come from
 * the spec; the version is read out of the resolved CDN URL by locating
 * `<bare>@<version>` in it (same logic `listPinned` uses, which handles
 * every supported provider's URL shape). Returns null when the version
 * can't be parsed, in which case the caller pins the entry by URL anyway
 * but cannot derive a `--download` filename for it.
 *
 * @param {string} spec  e.g. '@codemirror/state' or 'dayjs/plugin/utc'
 * @param {string} url   the resolved CDN URL for that spec
 * @returns {{ pkg: string, version: string, subpath: string } | null}
 */
export function derivePinParts(spec, url) {
  const pkg = extractPackageName(spec);
  if (!pkg) return null;
  const subpath = spec.slice(pkg.length);
  const escapedBare = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
  if (!match) return null;
  return { pkg, version: match[1], subpath };
}

// ---------------------------------------------------------------------------
// File-based pin (.webjs/vendor/importmap.json, optional --download bundles)
// ---------------------------------------------------------------------------

/**
 * Resolve the vendor importmap fragment for runtime use. Prefers the
 * committed pin file over a live api.jspm.io call. Called from
 * `ensureReady()` in dev.js on the first request, never at boot.
 *
 * Order of preference:
 *   1. `.webjs/vendor/importmap.json` (committed; no network needed)
 *   2. Live api.jspm.io/generate (fallback when no pin file exists)
 *
 * Returns both `imports` (the URL map) and `integrity` (SRI hashes
 * keyed by the FINAL URL). Integrity is populated on BOTH paths (#235):
 * the pin file supplies it directly, and the live-API path now hashes
 * each cross-origin bundle after resolving (bounded + fail-open, see
 * `computeLiveIntegrity`), so an unpinned app also serves SRI. A fetch
 * failure for one URL degrades to a missing hash for that URL plus a
 * one-time warning, never a broken resolve.
 *
 * @param {string} appDir
 * @param {() => Promise<Set<string>>} getBareImports lazy scan, invoked ONLY
 *   on the unpinned path (so a pinned app never pays the whole-app walk).
 * @returns {Promise<{ imports: Record<string, string>, integrity: Record<string, string> }>}
 */
/**
 * Base package of a bare specifier: `dayjs` -> `dayjs`,
 * `dayjs/plugin/utc` -> `dayjs`, `@scope/pkg/sub` -> `@scope/pkg`.
 *
 * @param {string} spec
 * @returns {string}
 */
export function basePackage(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * Prune a pinned import map to the vendor specifiers still reachable from
 * NON-elided modules. A committed pin is the whole map, but elision can make
 * a pinned package unreachable (its only importer is a display-only component
 * that ships no JS, e.g. dayjs via the blog's vendor-badge). The live-resolve
 * path prunes such a package by excluding elided components from the bare-
 * import scan; this brings the pinned path to the same result, so a pinned app
 * and an unpinned app serve the same import map (issue #197).
 *
 * Keeps an entry when its specifier is reachable, OR when its base package is
 * the base of any reachable specifier (so a pinned base entry `dayjs` survives
 * when code imports `dayjs/plugin/utc`, and vice versa). Integrity hashes for
 * dropped URLs are pruned too.
 *
 * @param {Record<string, string>} imports  pin entries (specifier -> URL)
 * @param {Record<string, string>} integrity  SRI hashes keyed by URL
 * @param {Set<string>} reachable  bare specifiers used by non-elided modules
 * @returns {{ imports: Record<string, string>, integrity: Record<string, string> }}
 */
export function prunePinToReachable(imports, integrity, reachable) {
  const reachableBases = new Set([...reachable].map(basePackage));
  /** @type {Record<string, string>} */
  const keptImports = {};
  for (const [spec, url] of Object.entries(imports || {})) {
    if (reachable.has(spec) || reachableBases.has(basePackage(spec))) {
      keptImports[spec] = url;
    }
  }
  const keptUrls = new Set(Object.values(keptImports));
  /** @type {Record<string, string>} */
  const keptIntegrity = {};
  for (const [url, hash] of Object.entries(integrity || {})) {
    if (keptUrls.has(url)) keptIntegrity[url] = hash;
  }
  return { imports: keptImports, integrity: keptIntegrity };
}

// ---------------------------------------------------------------------------
// Importmap coherence check (issue #450)
// ---------------------------------------------------------------------------
//
// A produced importmap pins one URL per resolved package, each URL carrying an
// `@<version>`. That pinned graph is INCOHERENT when one resolved package
// declares a dependency or peer range on ANOTHER resolved package and the
// version actually pinned for that other package falls OUTSIDE the range. The
// motivating crash (#446): `@codemirror/view@6.39.16` pinned while
// `@codemirror/lint@6.9.6` (also pinned) needs `view@^6.42.0`, so a symbol
// `lint` expects is missing from the older `view` bundle at runtime.
//
// This is a VALIDATION over a produced importmap, NOT a re-resolution (that is
// #446's job) and NOT bundling. It emits warnings; it never mutates the map.
//
// PARITY: `checkImportmapCoherence` is a pure function of the EXTRACTED
// `{ package -> pinned version }` set plus the dependency metadata. It does not
// know or care whether the importmap came from a live jspm.io resolve or from a
// committed `.webjs/vendor/importmap.json`. Two importmaps that pin the same
// versions for the same packages therefore always produce the same verdict,
// which is exactly the runtime-vs-vendored parity the maintainer requires.

/**
 * Pin all currently-imported npm packages to `.webjs/vendor/
 * importmap.json`. Two modes:
 *
 *   - Default: importmap URLs point at jspm.io (browser fetches from
 *     CDN directly at runtime). Only `importmap.json` is committed.
 *   - `download: true`: also fetches each bundle from jspm.io and
 *     writes it to `.webjs/vendor/<pkg>@<version>.js`. importmap URLs
 *     become local paths (`/__webjs/vendor/<filename>`), and the
 *     server handler serves them from disk. Both `importmap.json` and
 *     the bundle files are committed to source control.
 *
 * After pinning, prunes any orphan file in `.webjs/vendor/` not
 * produced by the current run. Pin is idempotent with respect to the
 * current source + node_modules: removed packages, bumped versions,
 * and mode switches all leave a clean directory.
 *
 * On success (at least one install resolved), returns
 * `{ pins, pruned, downloaded, provider }`. On total failure (one or
 * more installs were attempted but every jspm.io resolution failed),
 * the pin file is NOT written and the function returns
 * `{ pins: [], pruned: [], downloaded: 0, failed: true, attemptedInstalls }`
 * instead. When the app has zero bare-specifier imports at all
 * (scanned source produced nothing), returns
 * `{ pins: [], pruned: [], downloaded: 0, noBareImports: true }`
 * WITHOUT writing the pin file. When the scan DID find specifiers but
 * every one was dropped because no local version resolved (the package
 * is not installed under `node_modules`), returns
 * `{ pins: [], pruned: [], downloaded: 0, droppedUnresolvable: [...] }`
 * (also WITHOUT a pin file), so the caller can name the found-but-
 * uninstalled specifiers instead of claiming there were none. A
 * partial pin (some resolved, some dropped) still writes the file and
 * carries `droppedUnresolvable` alongside `pins`. Callers that need to
 * surface a non-zero exit code key off `failed`, `noBareImports`, or an
 * all-dropped `droppedUnresolvable`; all are absent on a clean success.
 *
 * The `from` option mirrors importmap-rails's `bin/importmap pin foo
 * --from jsdelivr`. Default `jspm` resolves to jspm.io; other values
 * (jsdelivr, unpkg, skypack) are passed through to jspm.io's
 * Generator API which returns URLs from the chosen CDN. The provider
 * is persisted in the pin file so `vendor update` and incident
 * response know which CDN to re-resolve against.
 *
 * @param {string} appDir
 * @param {{ download?: boolean, from?: string }} [opts]
 * @returns {Promise<{
 *   pins: Array<{ pkg: string, version: string, url: string, bytes?: number, integrity?: string }>,
 *   pruned: string[],
 *   downloaded: number,
 *   provider?: string,
 *   failed?: boolean,
 *   noBareImports?: boolean,
 *   droppedUnresolvable?: string[],
 *   attemptedInstalls?: string[],
 * }>}
 */
export async function pinAll(appDir, opts = {}) {
  const download = !!opts.download;
  // Provider precedence (same as updatePinned for consistency):
  //   1. explicit opts.from (CLI --from flag wins)
  //   2. existing pin file's persisted provider (stickiness: user
  //      who pinned via jsdelivr stays on jsdelivr until they
  //      explicitly switch back)
  //   3. default 'jspm'
  // Pre-read the file once to access its provider.
  const existing = await readPinFile(appDir);
  const from = opts.from || existing?.provider || 'jspm';
  if (!SUPPORTED_PROVIDERS.has(from)) {
    throw new Error(
      `[webjs] unknown provider '${from}'. Supported: ${[...SUPPORTED_PROVIDERS].join(', ')}.`,
    );
  }
  const bare = await scanBareImports(appDir);
  const installs = [];
  /**
   * Map from install spec (`pkg@version<subpath>`) to its components,
   * so we can recover the pkg + version + subpath when iterating jspm.io's
   * resolved imports.
   * @type {Map<string, { pkg: string, version: string, subpath: string }>}
   */
  const partsByInstall = new Map();
  /**
   * Bare specifiers the scan FOUND but that were dropped because no local
   * version could be resolved (the package is not installed under the app's
   * `node_modules`). Kept distinct from "scan found nothing" so the CLI can
   * name them and point at the remedy instead of claiming there were none.
   * @type {string[]}
   */
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

  /** @type {Record<string, string>} */
  const importmap = {};
  /**
   * SRI integrity by FINAL URL (post-rewrite). The browser's
   * importmap-integrity spec keys on the URL that appears in the
   * importmap, not the source jspm.io URL. For default mode the two
   * are identical; for --download mode the URL is the local
   * /__webjs/vendor/<filename> path.
   * @type {Record<string, string>}
   */
  const integrity = {};
  /** @type {Array<{ pkg: string, version: string, url: string, bytes?: number, integrity?: string }>} */
  const pins = [];
  const expected = new Set([PIN_FILE]);
  let downloaded = 0;

  // Specs that were directly scanned (`partsByInstall`) AND the flattened
  // transitive specs the unified resolve returns (issue #446) must BOTH be
  // pinned, or a pinned app's importmap would be missing the transitive
  // entries the runtime live-resolve serves (e.g. `@codemirror/state` pulled
  // in by `@codemirror/lint`), breaking parity: the browser would hit an
  // unresolved-bare-specifier error for the transitive. For a transitive we
  // recover pkg + version + subpath by parsing the spec against the resolved
  // jspm URL (`derivePinParts`), since it has no `partsByInstall` entry.
  /** @type {Set<string>} */
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
      // Fetch the bundle just to hash it. Bytes aren't written to
      // disk; only the SHA-384 reaches the pin file. CDN compromise
      // defense for default mode: if jspm.io serves different bytes
      // later, the browser refuses to execute (integrity mismatch).
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

  // If pin was attempted (installs non-empty) but resolved zero, do
  // NOT write the pin file. Writing `{ imports: {} }` would shadow
  // the live-API fallback (which reads when no pin file exists) and
  // leave the browser with an empty importmap, silently breaking
  // every bare-specifier import. Better: surface the failure so the
  // user knows pin didn't take, and let the next boot fall back to
  // live API resolution (which may have recovered by then).
  //
  // Account on DIRECT specs only: pins also carries flattened transitive
  // entries (#446), so `pins.length === 0` would no longer mean "every
  // direct install failed". A resolve that returned only transitives but
  // no direct spec is still a total failure for the user's deps.
  if (installs.length > 0 && pinnedDirectSpecs.size === 0) {
    return { pins, pruned: [], downloaded, failed: true, attemptedInstalls: installs, provider: from };
  }

  // Partial-failure surface. Some DIRECT installs were attempted but not
  // every one made it into pins (jspm.io returned the package OK,
  // but downloadBundle failed mid-stream in --download mode, or the
  // resolver response was missing the package entirely). Write the
  // pin file anyway so the working packages get committed, but warn
  // so the user knows the next runtime fetch for the missing
  // packages will fall through to a live jspm.io call (or 404 in
  // --download mode).
  //
  // Derive the missing set from partsByInstall (the bare-spec keys)
  // rather than from `installs` (the versioned strings). Compare against
  // the DIRECT specs that pinned, NOT pins[].pkg (which now includes
  // transitives), so a transitive can't mask a missing direct dep.
  if (pinnedDirectSpecs.size < partsByInstall.size) {
    /** @type {string[]} */
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

  // The app legitimately has zero bare-specifier imports (or the
  // scanner is running outside a WebJs project). Don't create an
  // empty `.webjs/vendor/importmap.json`. Without this guard the file
  // gets written as `{ imports: {} }` in whatever cwd the CLI was
  // invoked from, then immediately rejected by readPinFile's empty
  // -imports filter, so the file exists but does nothing. The CLI
  // surfaces this as a clearer "no bare imports found" message.
  if (installs.length === 0) {
    // Distinguish the two empty-set causes the CLI must report differently:
    // the scan genuinely found nothing (noBareImports) vs it found specifiers
    // that were all dropped for a missing local version (droppedUnresolvable).
    if (droppedUnresolvable.length > 0) {
      return { pins, pruned: [], downloaded, droppedUnresolvable, provider: from };
    }
    return { pins, pruned: [], downloaded, noBareImports: true, provider: from };
  }

  await writePinFile(appDir, importmap, integrity, from);
  const pruned = await pruneOrphans(appDir, expected);
  // Some specifiers may have pinned while others were dropped for a missing
  // version; surface the dropped ones so a partial pin is not silent.
  return droppedUnresolvable.length > 0
    ? { pins, pruned, downloaded, provider: from, droppedUnresolvable }
    : { pins, pruned, downloaded, provider: from };
}

/**
 * Remove a single package from the committed pin output. Deletes the
 * package's entry from `importmap.json`, and (if a bundle file
 * exists for it) deletes that file too.
 *
 * @param {string} appDir
 * @param {string} pkg
 * @returns {Promise<{ removed: boolean, deletedFile?: string }>}
 */
export async function unpinPackage(appDir, pkg) {
  const file = await readPinFile(appDir);
  if (!file || !(pkg in file.imports)) return { removed: false };
  const url = file.imports[pkg];
  delete file.imports[pkg];
  // Also strip the integrity entry for this URL, if present.
  const newIntegrity = { ...(file.integrity || {}) };
  delete newIntegrity[url];
  if (Object.keys(file.imports).length === 0) {
    // The pin file would now be empty. Delete it so the next boot
    // falls back to live API resolution rather than seeing an empty
    // importmap. Same reasoning as pinAll's "don't write empty pin"
    // guard.
    try { await unlink(pinFilePath(appDir)); } catch { /* race or never existed */ }
  } else {
    // Preserve the pin file's persisted provider (jsdelivr, unpkg,
    // etc.). Without this, `webjs vendor unpin <pkg>` would silently
    // revert the file to the default jspm provider, defeating
    // pinAll's stickiness for the remaining packages.
    await writePinFile(appDir, file.imports, newIntegrity, file.provider);
  }

  let deletedFile;
  if (url.startsWith('/__webjs/vendor/')) {
    const filename = url.slice('/__webjs/vendor/'.length);
    try {
      await unlink(join(pinDir(appDir), filename));
      deletedFile = filename;
    } catch { /* file already gone; ignore */ }
  }
  return { removed: true, deletedFile };
}

/**
 * List entries from the committed pin file. Parses the package
 * version from the URL (jspm.io URL or the local file's @version).
 *
 * @param {string} appDir
 * @returns {Promise<Array<{ pkg: string, version: string, url: string, bytes?: number }>>}
 */
export async function listPinned(appDir) {
  const file = await readPinFile(appDir);
  if (!file) return [];
  const entries = [];
  for (const [pkg, url] of Object.entries(file.imports)) {
    let version = '(unknown)';
    let bytes;
    // Order matters: try the local `/__webjs/vendor/` filename
    // parser first, then the CDN bare-name search. The local
    // filename embeds the subpath as `__plugin__utc.js`, which the
    // bare-name regex would match as part of the version (greedy
    // `[^/]+` swallows the encoded subpath). Handling the local
    // case explicitly preserves the cleaner version output for
    // `--download` mode pins.
    if (url.startsWith('/__webjs/vendor/')) {
      const filename = url.slice('/__webjs/vendor/'.length);
      const atIdx = filename.lastIndexOf('@');
      if (atIdx > 0) {
        // Strip trailing `.js`, split off any `__subpath` segment, keep
        // only the version. `dayjs@1.11.13__plugin__utc.js` parses as
        // version `1.11.13` (not `1.11.13__plugin__utc`).
        const afterAt = filename.slice(atIdx + 1, -3);
        const subIdx = afterAt.indexOf('__');
        version = subIdx < 0 ? afterAt : afterAt.slice(0, subIdx);
      }
      try {
        const st = await stat(join(pinDir(appDir), filename));
        bytes = st.size;
      } catch { /* file missing; bytes stays undefined */ }
    } else {
      // Derive the version from the URL by searching for the spec's
      // bare package name followed by `@<version>`. Works across
      // every CDN we support (jspm.io's `npm:dayjs@1.11.13`,
      // jsdelivr's `npm/dayjs@1.11.13`, unpkg's bare
      // `dayjs@1.11.13/`, skypack's `dayjs@1.11.13`). The bare name
      // lives in entries[].pkg (the import-map key), so we know it
      // exactly and just need to find the `<bare>@<version>`
      // substring. Stop at the first `/` after the version so we
      // don't include the entry-point path.
      //
      // Anchor the match against a non-pkg-name char (or string
      // start) so a short package name like `ms` doesn't false-
      // match inside another package's URL like `npm/terms@1.0.0/`.
      // npm package names use `[a-zA-Z0-9._-]` (plus `@` and `/`
      // for scoped names), so anything else is a safe boundary.
      const bare = extractPackageName(pkg) || pkg;
      const escapedBare = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const bareMatch = new RegExp(`(?:^|[^a-zA-Z0-9_.-])${escapedBare}@([^/]+)`).exec(url);
      if (bareMatch) version = bareMatch[1];
    }
    entries.push({ pkg, version, url, bytes });
  }
  return entries;
}
