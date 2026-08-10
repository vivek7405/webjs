import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { compileHeaderRules } from '../headers.js';
import { compileRedirectRules, readTrailingSlashPolicy } from '../redirects.js';
import { readBasePath } from '../base-path.js';
import { validateAppWebjsConfig } from '../webjs-config-validate.js';
import { readAllowedOrigins } from '../csrf.js';
import { readCspConfig } from '../csp.js';
import { readBodyLimits, computeServerTimeouts } from '../body-limit.js';

/**
 * Read the `WEBJS_ELIDE` environment override, if set.
 * `0` / `false` / `off` / `no` (case-insensitive) force elision OFF;
 * `1` / `true` / `on` / `yes` force it ON. Any other value, or an unset
 * variable, returns `undefined` so the caller falls through to the
 * `package.json` switch. The env override is the deploy-time / ops escape
 * hatch: force-disable elision to rule it out while debugging a wrong-strip
 * without editing committed code, or force-enable it regardless of an
 * app's `package.json`. It is also the seam the differential elision test
 * uses to render the same app on and off in one process.
 * @returns {boolean | undefined}
 */
function elideEnvOverride() {
  const raw = process.env.WEBJS_ELIDE;
  if (raw == null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return undefined;
}

/**
 * Read the project-level elision switch.
 * Precedence: the `WEBJS_ELIDE` env override wins when set, otherwise the
 * `package.json` `{ "webjs": { "elide": false } }` switch disables
 * display-only and inert-route elision app-wide (everything ships, like
 * before the feature existed). Any other value, or an absent key, leaves
 * elision enabled (the default). Re-read on every rebuild so toggling
 * either control takes effect without a server restart.
 * @param {string} appDir
 * @returns {Promise<boolean>}
 */
export async function readElideEnabled(appDir) {
  const override = elideEnvOverride();
  if (override !== undefined) return override;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.elide === false) return false;
  } catch {
    // No package.json, malformed JSON, or unreadable. Keep the default.
  }
  return true;
}

/**
 * Read the `WEBJS_SEED` environment override, if set. Same grammar as
 * `WEBJS_ELIDE`: `0`/`false`/`off`/`no` force seeding OFF, `1`/`true`/`on`/`yes`
 * force it ON, anything else (or unset) falls through to the package.json
 * switch. The deploy-time / ops escape hatch and the seam tests use to render
 * an app with seeding on and off in one process.
 * @returns {boolean | undefined}
 */
function seedEnvOverride() {
  const raw = process.env.WEBJS_SEED;
  if (raw == null || raw === '') return undefined;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  return undefined;
}

/**
 * Read the project-level SSR action-seeding switch (#472). Precedence: the
 * `WEBJS_SEED` env override wins when set, otherwise the package.json
 * `{ "webjs": { "seed": false } }` switch disables it (the client re-fetches on
 * hydration as it did before the feature). Default ON (opt-out), mirroring
 * elision: any value other than the literal `false` keeps seeding enabled.
 *
 * Seeding installs a process-global `module.registerHooks` load hook, so unlike
 * elision it is read ONCE at boot (not re-read per rebuild): toggling it needs a
 * restart, like a deploy.
 * @param {string} appDir
 * @returns {Promise<boolean>}
 */
export async function readSeedEnabled(appDir) {
  const override = seedEnvOverride();
  if (override !== undefined) return override;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.seed === false) return false;
  } catch {
    // No package.json, malformed JSON, or unreadable. Keep the default.
  }
  return true;
}

/**
 * Read the client-router switch (`webjs.clientRouter`) from the app's
 * package.json (#629). Default `true`: the client router auto-enables in the
 * browser whenever `@webjsdev/core` loads (the automatic-navigation thesis).
 * `{ "webjs": { "clientRouter": false } }` opts the WHOLE app out (pure MPA,
 * full-page navigation), which the render path signals to the browser so the
 * core bundle's module-end auto-enable is skipped. Any other value, or an
 * absent key, keeps the router on. Re-read on every rebuild (alongside elide)
 * so toggling it takes effect without a server restart.
 * @param {string} appDir
 * @returns {Promise<boolean>}
 */
export async function readClientRouterEnabled(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    if (pkg && pkg.webjs && pkg.webjs.clientRouter === false) return false;
  } catch {
    // No package.json, malformed JSON, or unreadable. Keep the default.
  }
  return true;
}

/**
 * Read the per-path response-header config (`webjs.headers`) from the
 * app's package.json and compile it to URLPattern rules. A missing,
 * malformed, or unreadable config yields an empty rule set (the secure
 * defaults still apply), never a throw.
 *
 * @param {string} appDir
 * @returns {Promise<ReturnType<typeof compileHeaderRules>>}
 */
export async function readHeaderRules(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return compileHeaderRules(pkg);
  } catch {
    return [];
  }
}

/**
 * Read the declarative redirect config (`webjs.redirects`) from the app's
 * package.json and compile it to URLPattern rules (issue #254). A missing,
 * malformed, or unreadable config yields an empty rule set (no redirects),
 * never a throw. Patterns are compiled ONCE here at boot, not per request.
 *
 * @param {string} appDir
 * @returns {Promise<ReturnType<typeof compileRedirectRules>>}
 */
export async function readRedirectRules(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return compileRedirectRules(pkg);
  } catch {
    return [];
  }
}

/**
 * Read the trailing-slash policy (`webjs.trailingSlash`) from the app's
 * package.json (issue #255). A missing, malformed, or unreadable config
 * yields `'ignore'` (no canonicalization), never a throw, so an
 * unconfigured app is unchanged.
 *
 * @param {string} appDir
 * @returns {Promise<'never' | 'always' | 'ignore'>}
 */
export async function readTrailingSlashFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readTrailingSlashPolicy(pkg);
  } catch {
    return 'ignore';
  }
}

/**
 * Read the sub-path base path (`webjs.basePath`) from the app's
 * package.json (issue #256). A missing, malformed, or unreadable config
 * yields `''` (root mount), never a throw, so an unconfigured app is
 * byte-identical to before this feature. Normalized to `''` or
 * `/segment[/segment...]` by `readBasePath`.
 *
 * @param {string} appDir
 * @returns {Promise<string>}
 */
export async function readBasePathFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readBasePath(pkg);
  } catch {
    return '';
  }
}

/**
 * Read the app package.json and warn once about anything wrong with its `webjs`
 * block (#1300). One aggregated warning, listing every problem, so a config with
 * three typos does not produce three log lines.
 *
 * Never throws and never exits. See `webjs-config-validate.js` for why warning
 * is the ruling and why this does not replace the CLI's `doctor.gate` check.
 *
 * @param {string} appDir
 * @param {{ warn?: (...args: any[]) => void }} logger
 * @returns {Promise<void>}
 */
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

/**
 * Read the cross-origin allowlist (`webjs.allowedOrigins`) from the app's
 * package.json. These hosts / origins are accepted by the action CSRF check
 * even when cross-site (reverse-proxy / multi-domain setups). A missing or
 * unreadable config yields `[]`.
 *
 * @param {string} appDir
 * @returns {Promise<string[]>}
 */
export async function readAllowedOriginsFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readAllowedOrigins(pkg);
  } catch {
    return [];
  }
}

/**
 * Read the CSP config (`webjs.csp`) from the app's package.json and
 * normalize it (issue #233). A missing, malformed, or unreadable config
 * yields a disabled config (no nonce minted, no CSP header), never a
 * throw: a broken security knob must fail closed, not take the app down.
 *
 * @param {string} appDir
 * @returns {Promise<ReturnType<typeof readCspConfig>>}
 */
export async function readCspConfigFromApp(appDir) {
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    return readCspConfig(pkg);
  } catch {
    return readCspConfig(undefined);
  }
}

/**
 * Resolve the request body-size limits (issue #237) from the app's package.json
 * `webjs.maxBodyBytes` / `webjs.maxMultipartBytes` plus the env overrides
 * (`WEBJS_MAX_BODY_BYTES` / `WEBJS_MAX_MULTIPART_BYTES`). A missing or
 * unreadable package.json falls through to the secure defaults (env still wins),
 * never a throw.
 *
 * @param {string} appDir
 * @returns {Promise<{ json: number, multipart: number }>}
 */
export async function readBodyLimitsFromApp(appDir) {
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    pkg = undefined;
  }
  return readBodyLimits(pkg);
}

/**
 * Extra dev watch roots from the app's package.json `webjs.dev.watch` (#894).
 * These are directories the app READS from but that live OUTSIDE its appDir, so
 * the recursive `fs.watch(appDir)` never sees them (e.g. the website renders
 * posts from a repo-root `blog/` dir, a sibling of the app, so editing a post
 * would not live-reload). Each entry is resolved relative to the appDir and MAY
 * escape it (`"../blog"`); a change under one runs the same rebuild + reload as
 * an in-tree edit. Opt-in: a missing/empty config yields `[]`, so a plain app
 * watches only its appDir, unchanged.
 *
 * Returns absolute, de-duped paths, skipping any that overlap the appDir (the
 * appDir is already watched recursively, so an ancestor or descendant root
 * would just double-fire the rebuild). Existence is NOT checked here (the caller
 * filters missing paths so it can log them); the reader stays a pure
 * package.json read, matching the other `readXFromApp` helpers.
 *
 * @param {string} appDir
 * @returns {Promise<string[]>}
 */
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
    // Skip the appDir itself and any ancestor/descendant overlap: the appDir is
    // already watched recursively, so an overlapping extra root double-fires.
    if (abs === appDir || appDir.startsWith(abs + sep) || abs.startsWith(appDir + sep)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

/**
 * Resolve the node:http server timeouts (issue #237) from the app's
 * package.json `webjs.requestTimeoutMs` / `webjs.headersTimeoutMs` /
 * `webjs.keepAliveTimeoutMs` plus the env overrides. A missing or unreadable
 * package.json falls through to the secure defaults (env still wins).
 *
 * @param {string} appDir
 * @returns {Promise<{ requestTimeout: number, headersTimeout: number, keepAliveTimeout: number }>}
 */
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
