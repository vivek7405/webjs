/**
 * `webjs doctor`: a project-health checklist runner (issue #266).
 *
 * WebJs has unusually many fragile preconditions, each an independent failure
 * mode a contributor onboarding to an existing repo only hits at runtime: the
 * Node 24+ strip-types floor, the `erasableSyntaxOnly` TS flag, importmap pin
 * freshness, env drift vs `.env.example`, `@webjsdev/*` version coherence,
 * whether the framework even resolves from the app dir (the fresh-git-worktree
 * trap, #954), whether a route-module stylesheet link is content-hashed (#1095),
 * and the git pre-commit hook activation. `webjs doctor` verifies
 * each one up front and prints pass/warn/fail with an actionable fix line.
 *
 * This module is PURE: `runDoctorChecks(appDir, opts?)` reads files (and, for
 * the pin check, optionally the network), but NEVER calls `process.exit` and
 * NEVER prints. The CLI (`bin/webjs.js`, `case 'doctor'`) renders the results
 * and owns the exit code, which is what makes every check unit-testable in
 * isolation against a tmp fixture appDir.
 *
 * HARD-FAIL vs WARN split (the CLI exits non-zero on any 'fail'):
 *
 *   - 'fail' is reserved for a genuinely-broken TOOLCHAIN that would crash or
 *     500 at runtime, so CI can gate on it. Two checks can fail:
 *       * Node version below the required major (the strip-types floor).
 *       * `erasableSyntaxOnly` missing/false in an EXISTING tsconfig (non-erasable
 *         TS would fail at strip time with a 500).
 *   - 'warn' is for drift / preferences / best-effort signals that are the
 *     app's own runtime concern, never a doctor hard-fail: a missing tsconfig
 *     (a JS-only app legitimately has none), env drift, an outdated or
 *     unverifiable vendor pin, a `@webjsdev/*` version drift or missing install,
 *     an unresolvable framework (a worktree with no node_modules, #954), and a
 *     missing/non-executable git hook.
 *   - 'pass' is the green path.
 *
 * Every NETWORK touch (the vendor-pin freshness check, plus the live resolve in
 * the importmap-coherence check) is BEST-EFFORT: a fetch failure is a WARN
 * ("could not check, network"), never a hard fail and never a throw that
 * crashes the command. Network is flaky, and a doctor that fails CI because npm
 * was briefly unreachable is worse than useless. A result that reports "could
 * not check" rather than a real finding carries `bestEffort: true`, and that
 * flag is what the severity gate below reads to CLAMP it: an app may declare a
 * code fatal, but an outage still cannot red its CI.
 *
 * SEVERITY POLICY (#1257) is CONFIG, not a flag, and lives one layer up. The
 * checks below stay policy-unaware; `readDoctorPolicy(appDir)` reads the app's
 * `webjs.doctor.gate` map out of package.json and `applyDoctorPolicy` folds it
 * over the results, attaching the EFFECTIVE severity each one contributes. So a
 * project declares which health signals it treats as fatal in ONE place that
 * travels with the repo, and its CI workflow, its `npm run doctor`, and an
 * agent's `--json` loop all read that one policy. `--strict` stays what it is:
 * the blunt "every warning is fatal" switch, layered on top.
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { checkNodeInline } from './node-preflight.js';

/**
 * `status` is what the CHECK found and never depends on config. `severity` is
 * the EFFECTIVE level the result contributes after the app's gate is applied,
 * attached by `applyDoctorPolicy` (the checks never set it). `bestEffort` marks
 * a result that reports "could not check" rather than a real finding, which is
 * the one thing a gate can never escalate.
 * @typedef {'pass' | 'warn' | 'fail'} DoctorStatus
 * @typedef {'off' | 'warn' | 'error'} DoctorSeverity  a level a gate entry may DECLARE
 * @typedef {'pass' | DoctorSeverity} DoctorLevel  the EFFECTIVE level of a result
 * @typedef {{ name: string, code: string, status: DoctorStatus, message: string, fix?: string, bestEffort?: boolean, severity?: DoctorLevel }} DoctorResult
 */

/**
 * The severity levels a `webjs.doctor.gate` entry may name, mirroring ESLint's
 * three-level scale (its `off` / `warn` / `error`, which Next.js's
 * `eslint-plugin-next` uses verbatim as a rule-id-keyed map). `off` is uniform:
 * it silences ANY code, the two hard-fail checks included, exactly as ESLint
 * lets any rule be turned off.
 * @type {DoctorSeverity[]}
 */
export const DOCTOR_SEVERITIES = ['off', 'warn', 'error'];

/**
 * Stable machine-readable code per check (#975), so an agent consuming
 * `webjs doctor --json` branches on the failure KIND, not the human message
 * text (which is free to change). The `name` stays the display identity (some
 * are kebab-case, two are prose); the `code` is the durable contract, a
 * SCREAMING_SNAKE_CASE constant that never changes for a given check. Attached
 * centrally in `runDoctorChecks` so every check function stays focused on its
 * own logic. Mirrors Remix's `DoctorFindingCode` enum (its `doctor/types.ts`).
 *
 * Keyed by each check's `name`. A missing entry falls back to a name-derived
 * code (see `codeForName`), but every shipped check is listed here explicitly
 * and a drift test asserts each result carries one of these codes.
 * @type {Record<string, string>}
 */
export const DOCTOR_CODES = {
  'node-version': 'NODE_VERSION',
  'tsconfig-erasable': 'TSCONFIG_ERASABLE',
  'env-drift': 'ENV_DRIFT',
  'vendor-pin': 'VENDOR_PIN',
  'vendor-gitignore': 'VENDOR_GITIGNORE',
  'webjs-versions': 'WEBJS_VERSIONS',
  'framework-resolve': 'FRAMEWORK_RESOLVE',
  'importmap-coherence': 'IMPORTMAP_COHERENCE',
  'git-hook': 'GIT_HOOK',
  'Page/layout elision (carrier hygiene)': 'ELISION_CARRIERS',
  'Static build outputs (dev.regenerate freshness)': 'STATIC_ASSET_FRESHNESS',
  'Asset urls (unmarked stylesheet links)': 'UNMARKED_ASSET_LINKS',
};

/**
 * The stable code for a check name: the explicit `DOCTOR_CODES` entry, else a
 * best-effort derivation (uppercased, non-alphanumerics collapsed to `_`) so a
 * newly-added check that forgets its map entry still gets a non-empty code.
 * @param {string} name
 * @returns {string}
 */
export function codeForName(name) {
  return DOCTOR_CODES[name] || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * @typedef {{ gate: Record<string, DoctorSeverity>, unknownCodes: string[], badSeverities: Array<{ code: string, value: unknown }>, malformed: Array<{ path: string, value: unknown }>, unknownKeys: string[] }} DoctorPolicy
 */

/** A plain JSON object (not null, not an array), the only shape the gate accepts. */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Read the app's per-check severity policy out of `package.json`
 * `webjs.doctor.gate` (#1257). PURE: it reads one file and returns data, and
 * the caller (the CLI) decides what to do about a problem.
 *
 * `gate` keeps only WELL-FORMED entries, so a caller can fold it over the
 * results without re-validating. Everything rejected is reported separately:
 * a key that is not a value of `DOCTOR_CODES` lands in `unknownCodes`, a value
 * outside `DOCTOR_SEVERITIES` in `badSeverities`, and a wrong SHAPE (a
 * non-object `doctor` or `gate`, in `malformed`, and a misspelled
 * sibling of `gate` such as `gates` in `unknownKeys`. All four are surfaced as a hard error by the CLI
 * rather than skipped.
 *
 * The shape check matters as much as the per-entry one, and is the easier half
 * to leave out. A gate that FAILS OPEN is the one outcome this mechanism cannot
 * afford: `"gate": "error"` or a misspelled `"gates": {...}` would leave CI
 * un-gated while the package.json looks gated, which is strictly worse than
 * having no gate at all, since nobody goes looking. The JSON Schema catches
 * these in an editor, but it is editor-only, so it can never be the enforcement.
 *
 * A missing package.json, a missing block, or unparseable JSON is an EMPTY
 * policy with no problems: an app that declares nothing behaves exactly as it
 * did before the gate existed. Unparseable JSON in particular is deliberately
 * not an error here, since `checkWebjsVersions` already reports that condition
 * and doctor must never crash on a broken app file.
 *
 * @param {string} appDir
 * @returns {DoctorPolicy}
 */
export function readDoctorPolicy(appDir) {
  /** @type {DoctorPolicy} */
  const empty = { gate: {}, unknownCodes: [], badSeverities: [], malformed: [], unknownKeys: [] };
  let raw;
  try {
    raw = readFileSync(join(appDir, 'package.json'), 'utf8');
  } catch {
    return empty;
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch {
    return empty;
  }
  const doctor = pkg?.webjs?.doctor;
  if (doctor === undefined) return empty;
  if (!isPlainObject(doctor)) return { ...empty, malformed: [{ path: 'webjs.doctor', value: doctor }] };

  /** @type {DoctorPolicy} */
  const policy = { gate: {}, unknownCodes: [], badSeverities: [], malformed: [], unknownKeys: [] };
  // A misspelled sibling (`gates`) would otherwise be dropped in silence, which
  // is the fail-open case. `gate` is the only key this block accepts.
  for (const key of Object.keys(doctor)) {
    if (key !== 'gate') policy.unknownKeys.push(`webjs.doctor.${key}`);
  }
  const declared = doctor.gate;
  if (declared !== undefined && !isPlainObject(declared)) {
    policy.malformed.push({ path: 'webjs.doctor.gate', value: declared });
  }
  if (!isPlainObject(declared)) return policy;

  const known = new Set(Object.values(DOCTOR_CODES));
  for (const [code, value] of Object.entries(declared)) {
    if (!known.has(code)) {
      policy.unknownCodes.push(code);
      continue;
    }
    if (typeof value !== 'string' || !DOCTOR_SEVERITIES.includes(/** @type {DoctorSeverity} */ (value))) {
      policy.badSeverities.push({ code, value });
      continue;
    }
    policy.gate[code] = /** @type {DoctorSeverity} */ (value);
  }
  return policy;
}

/**
 * Fold a severity `gate` over check results, returning a NEW array whose
 * results each carry the EFFECTIVE level they contribute (#1257). PURE: the
 * input array and its results are never mutated.
 *
 * `severity` is the effective level, not the declared one, which is why a
 * PASSING check reports `'pass'` even when its code is gated `error`. A rule
 * that did not fire contributes nothing, the same way ESLint puts severity on a
 * message rather than on a rule that stayed quiet. It also keeps the obvious
 * one-liner honest: `results.some((r) => r.severity === 'error')` is exactly
 * "something fatal was found", with no passing-check false positive.
 *
 * The gate's one hard limit is `bestEffort`: a result that could not check
 * (a toolchain that would not load, a network that was unreachable) is CLAMPED
 * to `warn` however loudly the gate declares its code. That is what lets this
 * repo's required CI job run a check whose live resolve touches jspm without
 * an outage there ever redding an unrelated pull request.
 *
 * @param {DoctorResult[]} results
 * @param {Record<string, DoctorSeverity>} [gate]  well-formed entries only (see readDoctorPolicy)
 * @returns {DoctorResult[]}
 */
export function applyDoctorPolicy(results, gate = {}) {
  return results.map((r) => {
    if (r.status === 'pass') return { ...r, severity: /** @type {DoctorLevel} */ ('pass') };
    const declared = gate[r.code];
    const fallback = r.status === 'fail' ? 'error' : 'warn';
    let severity = /** @type {DoctorSeverity} */ (declared || fallback);
    if (r.bestEffort && severity === 'error') severity = 'warn';
    return { ...r, severity };
  });
}

/**
 * Read the CLI package's own `engines.node` so the required Node major lives in
 * one place (mirrors how `bin/webjs.js` sources it). Falls back to `>=24.0.0`.
 * @param {string} cliDir  directory of THIS file's package (lib/ -> package root)
 * @returns {Promise<string>}
 */
async function readEngines(cliDir) {
  try {
    const pkg = JSON.parse(await readFile(join(cliDir, '..', 'package.json'), 'utf8'));
    return pkg?.engines?.node || '>=24.0.0';
  } catch {
    return '>=24.0.0';
  }
}

/**
 * Strip `//` line comments, block comments, and trailing commas from a JSONC
 * string so a tsconfig (which permits all three) parses with `JSON.parse`.
 * Deliberately simple: it does not honor comment-looking sequences inside
 * string values, which is acceptable for a tsconfig (paths rarely contain `//`
 * or block-comment markers, and the worst case is a parse failure the caller
 * already degrades to a WARN).
 * @param {string} text
 * @returns {string}
 */
function stripJsonc(text) {
  let out = '';
  let inString = false;
  let stringQuote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Copy the escaped char verbatim so an escaped quote does not end the string.
        out += text[i + 1] || '';
        i++;
      } else if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++; // land on the '/'
      continue;
    }
    out += ch;
  }
  // Drop trailing commas before } or ].
  return out.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Parse a `.env`-style file into the SET of KEY names it declares. A simple
 * `KEY=value` line parse: comments (`#`) and blank lines are skipped, and only
 * the key before the first `=` is taken (the value is irrelevant for drift).
 * @param {string} text
 * @returns {Set<string>}
 */
function parseEnvKeys(text) {
  const keys = new Set();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    // Tolerate a leading `export ` (a common .env.example convention).
    if (key.startsWith('export ')) key = key.slice('export '.length).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) keys.add(key);
  }
  return keys;
}

/**
 * CHECK 1, Node version. HARD-FAIL when the running major is below the required
 * major (the strip-types + recursive fs.watch floor). `opts.nodeVersion` lets a
 * test inject the running version so the fail case is assertable without being
 * on old Node.
 * @param {string} cliDir
 * @param {{ nodeVersion?: string }} opts
 * @returns {Promise<DoctorResult>}
 */
async function checkNode(cliDir, opts) {
  const engines = await readEngines(cliDir);
  const current = opts.nodeVersion || process.versions.node;
  const r = checkNodeInline(current, engines);
  if (r.ok) {
    return {
      name: 'node-version',
      status: 'pass',
      message: `Node ${r.current} satisfies the required Node ${r.requiredMajor}+.`,
    };
  }
  return {
    name: 'node-version',
    status: 'fail',
    message:
      `Node ${r.current} is below the required Node ${r.requiredMajor}+. ` +
      `webjs is buildless and relies on Node ${r.requiredMajor}'s built-in TypeScript ` +
      `strip and recursive fs.watch.`,
    fix: `Upgrade to Node ${r.requiredMajor}+ (see https://nodejs.org).`,
  };
}

/**
 * CHECK 2, tsconfig erasableSyntaxOnly. PASS when `true`; WARN when no tsconfig
 * (a JS-only app legitimately has none) or the file is unparseable; HARD-FAIL
 * when the file EXISTS but the flag is missing/false (non-erasable TS 500s at
 * strip time).
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
async function checkTsconfig(appDir) {
  const path = join(appDir, 'tsconfig.json');
  if (!existsSync(path)) {
    return {
      name: 'tsconfig-erasable',
      status: 'warn',
      message: 'No tsconfig.json found. A JS-only app needs none; a TypeScript app requires one.',
      fix: 'If this app uses TypeScript, add a tsconfig.json with "erasableSyntaxOnly": true.',
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stripJsonc(await readFile(path, 'utf8')));
  } catch {
    return {
      name: 'tsconfig-erasable',
      status: 'warn',
      message: 'tsconfig.json could not be parsed (even after stripping comments + trailing commas).',
      fix: 'Fix the tsconfig.json syntax, then ensure "compilerOptions.erasableSyntaxOnly": true.',
    };
  }
  const flag = parsed?.compilerOptions?.erasableSyntaxOnly;
  if (flag === true) {
    return {
      name: 'tsconfig-erasable',
      status: 'pass',
      message: 'tsconfig.json sets "erasableSyntaxOnly": true.',
    };
  }
  return {
    name: 'tsconfig-erasable',
    status: 'fail',
    message:
      'tsconfig.json is missing "compilerOptions.erasableSyntaxOnly": true. ' +
      'Non-erasable TypeScript (enum, namespace, parameter properties, ...) 500s at strip time.',
    fix: 'Set "compilerOptions": { "erasableSyntaxOnly": true } in tsconfig.json.',
  };
}

/**
 * CHECK 3, .env presence + drift vs .env.example. WARN-level only (a missing
 * env var is the app's runtime problem, not a toolchain crash). When no
 * `.env.example`, PASS (nothing to compare). When `.env.example` exists but
 * `.env` is absent, WARN to copy it. Otherwise WARN listing any example key
 * missing from `.env`, else PASS.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
async function checkEnv(appDir) {
  const examplePath = join(appDir, '.env.example');
  if (!existsSync(examplePath)) {
    return {
      name: 'env-drift',
      status: 'pass',
      message: 'No .env.example to compare against.',
    };
  }
  const exampleKeys = parseEnvKeys(await readFile(examplePath, 'utf8'));
  const envPath = join(appDir, '.env');
  if (!existsSync(envPath)) {
    return {
      name: 'env-drift',
      status: 'warn',
      message: '.env.example exists but .env does not.',
      fix: 'Copy it: cp .env.example .env  (then fill in the values).',
    };
  }
  const envKeys = parseEnvKeys(await readFile(envPath, 'utf8'));
  const missing = [...exampleKeys].filter((k) => !envKeys.has(k));
  if (missing.length === 0) {
    return {
      name: 'env-drift',
      status: 'pass',
      message: `.env has all ${exampleKeys.size} key(s) declared in .env.example.`,
    };
  }
  return {
    name: 'env-drift',
    status: 'warn',
    message: `.env is missing ${missing.length} key(s) from .env.example: ${missing.join(', ')}.`,
    fix: 'Add the missing key(s) to .env (see .env.example for the expected names).',
  };
}

/**
 * CHECK 4, vendor pin freshness. Applies ONLY when a pin file exists. PASS/skip
 * for an unpinned app (it resolves live, which is fine in dev). BEST-EFFORT +
 * NETWORK-TOLERANT: any error (network, timeout) is a WARN "could not check",
 * never a hard fail and never a throw. PASS when all pins current, WARN listing
 * outdated packages otherwise.
 *
 * The vendor functions are injected via `opts.vendor` so a test can supply a
 * stub without a real network call; absent the override, they are dynamically
 * imported from `@webjsdev/server`.
 * @param {string} appDir
 * @param {{ vendor?: { hasVendorPin: (d: string) => boolean, findOutdated: (d: string) => Promise<Array<{ pkg: string, current: string, latest: string }>> } }} opts
 * @returns {Promise<DoctorResult>}
 */
async function checkVendorPin(appDir, opts) {
  let vendor = opts.vendor;
  if (!vendor) {
    try {
      const mod = await import('@webjsdev/server');
      vendor = { hasVendorPin: mod.hasVendorPin, findOutdated: mod.findOutdated };
    } catch {
      return {
        name: 'vendor-pin',
        status: 'warn',
        // "Could not check", not a finding: never escalatable by a gate.
        bestEffort: true,
        message: 'Could not load the vendor toolchain to check pin freshness.',
        fix: 'Run `npm install` so @webjsdev/server is available, then re-run `webjs doctor`.',
      };
    }
  }
  let pinned = false;
  try {
    pinned = vendor.hasVendorPin(appDir);
  } catch {
    pinned = false;
  }
  if (!pinned) {
    return {
      name: 'vendor-pin',
      status: 'pass',
      message: 'No vendor pin file; the app resolves vendor imports live (fine in dev).',
    };
  }
  let outdated;
  try {
    outdated = await vendor.findOutdated(appDir);
  } catch {
    // findOutdated is built to swallow fetch errors and return [], but guard
    // anyway: a network check must NEVER throw out of doctor.
    return {
      name: 'vendor-pin',
      status: 'warn',
      bestEffort: true,
      message: 'Could not check pin freshness (network unreachable or registry error).',
      fix: 'Re-run `webjs doctor` when connectivity is back, or run `webjs vendor outdated`.',
    };
  }
  if (!Array.isArray(outdated) || outdated.length === 0) {
    return {
      name: 'vendor-pin',
      status: 'pass',
      message: 'All vendor pins are current.',
    };
  }
  const list = outdated.map((o) => `${o.pkg} (${o.current} -> ${o.latest})`).join(', ');
  return {
    name: 'vendor-pin',
    status: 'warn',
    message: `${outdated.length} pinned package(s) are outdated: ${list}.`,
    fix: 'Run `webjs vendor update` to re-pin to the latest versions.',
  };
}

/**
 * CHECK: the `.gitignore` does not swallow the committed vendor pin. The pattern
 * for `.webjs/vendor/` is subtle: a bare `.webjs/` line excludes the directory
 * entirely and git cannot re-include children of an excluded parent, so a
 * `!.webjs/vendor/` exception silently does nothing and `webjs vendor pin`
 * output never gets committed. The correct pattern is the depth-robust
 * contents-glob form (see the fix text below / VENDOR_GITIGNORE_LINES in
 * vendor.js): a globstar-prefixed `.webjs/*` plus the matching vendor
 * negations, which ignores transient `.webjs` output at any depth while
 * keeping the committed vendor pin tracked.
 *
 * This was a `webjs check` rule, but inspecting `.gitignore` is a project-config
 * concern (like `tsconfig-erasable`), not source-code correctness, and vendoring
 * is optional, so a doctor WARN fits the domain and severity better than a CI
 * hard-fail (#461). It lives next to `vendor-pin` (same family).
 *
 * PASS/skip when the dir is not a git repo or has no `.gitignore` (the user has
 * not opted into version control yet). Probes two representative paths via
 * `git check-ignore` with the inherited GIT_* env stripped so `cwd` is the sole
 * authority on which repo + .gitignore stack is consulted (a pre-commit hook
 * from a linked worktree exports GIT_WORK_TREE, which would otherwise override
 * cwd-based discovery).
 *
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
async function checkVendorGitignore(appDir) {
  const hasGit = existsSync(join(appDir, '.git'));
  const hasGitignore = existsSync(join(appDir, '.gitignore'));
  if (!hasGit || !hasGitignore) {
    return {
      name: 'vendor-gitignore',
      status: 'pass',
      message: 'Not a git checkout with a .gitignore; nothing to verify.',
    };
  }
  const { spawnSync } = await import('node:child_process');
  const {
    GIT_DIR: _gd, GIT_WORK_TREE: _gwt, GIT_INDEX_FILE: _gif, GIT_PREFIX: _gp,
    ...gitEnv
  } = process.env;
  // Check two representative paths: the pin manifest AND a sample downloaded
  // bundle. A `.gitignore` that allows the manifest but blocks bundles (e.g.
  // `*.js` higher up) would still break `webjs vendor pin --download`.
  // `git check-ignore -q` exits 0 when the path is ignored, 1 when not.
  const probes = [
    '.webjs/vendor/importmap.json',
    '.webjs/vendor/sample-pkg@1.0.0.js',
  ];
  for (const probe of probes) {
    const result = spawnSync('git', ['check-ignore', '-q', probe], {
      cwd: appDir,
      stdio: 'pipe',
      env: gitEnv,
    });
    if (result.status === 0) {
      return {
        name: 'vendor-gitignore',
        status: 'warn',
        message:
          `${probe} is gitignored, but \`webjs vendor pin\` writes files under .webjs/vendor/ that MUST be committed for a production deploy to use the pin (instead of calling api.jspm.io on every cold start). The most common cause: a \`.webjs/\` line that excludes the parent directory before the \`!.webjs/vendor/\` exception can take effect (git semantics: a parent exclusion blocks child negations). A second cause is a broader rule (e.g. \`*.js\` at root) hiding bundle files added by \`webjs vendor pin --download\`.`,
        fix:
          'Replace `.webjs/` in your .gitignore with this three-line pattern:\n' +
          '  **/.webjs/*\n' +
          '  !**/.webjs/vendor/\n' +
          '  !**/.webjs/vendor/**\n' +
          'The `**/` prefix ignores `.webjs/` at any depth (so a nested / monorepo app does not leak its generated `.webjs/routes.d.ts`) while still re-including the committed vendor pin. ' +
          'Verify with `git check-ignore -q .webjs/vendor/importmap.json` (exit 1 means correctly un-ignored).',
      };
    }
  }
  return {
    name: 'vendor-gitignore',
    status: 'pass',
    message: 'The .gitignore keeps .webjs/vendor/ committable.',
  };
}

/**
 * Compare an installed version against a semver range PRAGMATICALLY (no semver
 * dependency). Supports the common scaffold shapes: `latest` / `*` / `workspace:*`
 * (any installed version satisfies), an exact `1.2.3`, and a caret `^1.2.3`
 * (installed must be >= the floor AND share the same major, with major 0 also
 * pinning the minor, matching npm caret semantics). An unrecognized range is
 * treated as "cannot statically verify" (returns null), so the caller does not
 * warn on a shape it does not understand.
 * @param {string} installed
 * @param {string} range
 * @returns {boolean | null}
 */
function satisfiesRange(installed, range) {
  if (!installed) return null;
  const r = String(range).trim();
  if (r === 'latest' || r === '*' || r === '' || r.startsWith('workspace:')) return true;
  const parse = (v) => {
    const m = String(v).match(/(\d+)\.(\d+)\.(\d+)/);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const inst = parse(installed);
  if (!inst) return null;
  if (/^\d+\.\d+\.\d+$/.test(r)) {
    const exact = parse(r);
    return exact ? inst[0] === exact[0] && inst[1] === exact[1] && inst[2] === exact[2] : null;
  }
  if (r.startsWith('^')) {
    const floor = parse(r);
    if (!floor) return null;
    if (inst[0] !== floor[0]) return false;
    // For 0.x, caret pins the minor too (^0.7.0 allows 0.7.x, not 0.8.0).
    if (floor[0] === 0 && inst[1] !== floor[1]) return false;
    const cmp =
      inst[0] !== floor[0] ? inst[0] - floor[0] :
      inst[1] !== floor[1] ? inst[1] - floor[1] :
      inst[2] - floor[2];
    return cmp >= 0;
  }
  return null;
}

/**
 * Read the declared dependency ranges of an INSTALLED package from
 * `node_modules/<pkg>/package.json`, for the importmap-coherence check. This
 * is the "already-resolved metadata, no network" path the issue calls for: the
 * package is on disk (it was installed for the importmap to pin it), so its
 * manifest is a local read. Returns null on any failure (not installed,
 * unreadable, unparseable), which the coherence check treats as "could not
 * verify" rather than a conflict.
 *
 * @param {string} appDir
 * @returns {(pkg: string) => Promise<{ dependencies?: Record<string,string>, peerDependencies?: Record<string,string> } | null>}
 */
function makeInstalledManifestReader(appDir) {
  return async (pkg) => {
    const manifestPath = join(appDir, 'node_modules', pkg, 'package.json');
    if (!existsSync(manifestPath)) return null;
    try {
      const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
      return {
        dependencies: parsed.dependencies || {},
        peerDependencies: parsed.peerDependencies || {},
      };
    } catch {
      return null;
    }
  };
}

/**
 * Format a coherence conflict list into a single human-readable warning line
 * naming each conflicting pair, the required range, and the pinned version.
 * @param {Array<{ pkg: string, version: string, dependsOn: string, kind: string, requiredRange: string, pinnedVersion: string }>} conflicts
 * @returns {string}
 */
function formatConflicts(conflicts) {
  return conflicts
    .map(
      (c) =>
        `${c.pkg}@${c.version} needs ${c.dependsOn} ${c.kind === 'peerDependency' ? '(peer) ' : ''}${c.requiredRange} but the importmap pins ${c.dependsOn}@${c.pinnedVersion}`,
    )
    .join('; ');
}

/**
 * CHECK 7, importmap coherence (issue #450). Defense-in-depth that catches an
 * INCOHERENT client dependency graph in the produced importmap, regardless of
 * how the incoherence arose (a hand-edited pin file, a partial vendor pin, or
 * the #446 resolution skew). For each resolved package, it checks that the
 * version actually pinned for every OTHER resolved package it depends on
 * satisfies the declared range; a miss warns naming both packages, the range,
 * and the pinned version.
 *
 * Runs the SAME check over BOTH inputs and produces the same verdict for the
 * same dep set (the parity invariant): the live importmap (resolved the way the
 * server resolves it at runtime) AND the vendored `.webjs/vendor/importmap.json`.
 * A vendored importmap is a freeze of the runtime-resolved graph, so a coherent
 * runtime graph that gets vendored stays coherent.
 *
 * WARN-only and BEST-EFFORT: it never hard-fails (a runtime incoherence is the
 * app's concern, not a broken toolchain), and it degrades to a soft
 * "could not verify" whenever metadata or a live resolve is unavailable rather
 * than failing closed. Dependency metadata is read from the already-installed
 * `node_modules` manifests, no network call of its own; the only network touch
 * is the live importmap resolve, which is wrapped so any failure degrades.
 *
 * The vendor functions + manifest reader are injectable via `opts.coherence`
 * so a test can drive every branch without a network call.
 *
 * @param {string} appDir
 * @param {{ coherence?: {
 *   liveImports?: () => Promise<Record<string,string> | null>,
 *   vendoredImports?: () => Promise<Record<string,string> | null>,
 *   getManifest?: (pkg: string, version: string) => Promise<any>,
 *   check?: (imports: Record<string,string>, o: { getManifest: any }) => Promise<{ conflicts: any[], unverified: any[], checked: number }>,
 * } }} opts
 * @returns {Promise<DoctorResult>}
 */
async function checkImportmapCoherence(appDir, opts) {
  let inj = opts.coherence;
  // Resolve the real vendor toolchain unless a test injected stubs. Both the
  // importmap sources and the coherence-check function come from
  // @webjsdev/server, so a missing install degrades to a WARN, never a throw.
  if (!inj || !inj.check || !inj.liveImports || !inj.vendoredImports || !inj.getManifest) {
    let mod;
    try {
      mod = await import('@webjsdev/server');
    } catch {
      return {
        name: 'importmap-coherence',
        status: 'warn',
        bestEffort: true,
        message: 'Could not load the vendor toolchain to check importmap coherence.',
        fix: 'Run `npm install` so @webjsdev/server is available, then re-run `webjs doctor`.',
      };
    }
    const real = {
      check: mod.checkImportmapCoherence,
      // Hoist-aware manifest read from the already-installed node_modules (no
      // network of its own), so a monorepo-hoisted dep still resolves. Falls
      // back to the local app/node_modules read if the server build predates
      // getPackageManifest.
      getManifest: typeof mod.getPackageManifest === 'function'
        ? (pkg) => mod.getPackageManifest(pkg, appDir)
        : makeInstalledManifestReader(appDir),
      // Live importmap: resolve vendor imports the way the server does on the
      // first request (prefers the pin file, else a live jspm.io resolve).
      liveImports: async () => {
        try {
          const resolved = await mod.resolveVendorImports(appDir, () => mod.scanBareImports(appDir));
          return resolved && resolved.imports ? resolved.imports : {};
        } catch {
          return null;
        }
      },
      // Vendored importmap: the committed pin file, no network.
      vendoredImports: async () => {
        try {
          const pin = await mod.readPinFile(appDir);
          return pin && pin.imports ? pin.imports : null;
        } catch {
          return null;
        }
      },
    };
    inj = { ...real, ...(inj || {}) };
  }

  // Gather both importmaps. Either may be absent (no pin file, or a live
  // resolve that failed / found no vendor imports); the check runs over
  // whichever exist, identically.
  let live = null;
  let vendored = null;
  try { live = await inj.liveImports(); } catch { live = null; }
  try { vendored = await inj.vendoredImports(); } catch { vendored = null; }

  const liveHas = live && Object.keys(live).length > 0;
  const vendoredHas = vendored && Object.keys(vendored).length > 0;
  if (!liveHas && !vendoredHas) {
    return {
      name: 'importmap-coherence',
      status: 'pass',
      message: 'No vendor importmap to check (the app imports no npm packages on the client).',
    };
  }

  // Run the IDENTICAL check over each available importmap. The function is
  // pure in (imports, getManifest), so the same pinned dep set produces the
  // same verdict whichever input it came from (the runtime-vs-vendored parity
  // invariant). Aggregate the conflicts; dedupe identical ones so a package
  // pinned the same way in both maps is reported once.
  /** @type {Map<string, any>} */
  const conflictsByKey = new Map();
  let anyChecked = 0;
  let anyUnverified = 0;
  for (const imports of [liveHas ? live : null, vendoredHas ? vendored : null]) {
    if (!imports) continue;
    let report;
    try {
      report = await inj.check(imports, { getManifest: inj.getManifest });
    } catch {
      // A check that threw is a "could not verify", never a doctor crash.
      anyUnverified++;
      continue;
    }
    anyChecked += report.checked || 0;
    anyUnverified += (report.unverified || []).length;
    for (const c of report.conflicts || []) {
      conflictsByKey.set(`${c.pkg}@${c.version}->${c.dependsOn}@${c.pinnedVersion}`, c);
    }
  }

  const conflicts = [...conflictsByKey.values()];
  if (conflicts.length > 0) {
    return {
      name: 'importmap-coherence',
      status: 'warn',
      message: `Incoherent client dependency graph in the importmap: ${formatConflicts(conflicts)}.`,
      fix: 'Align the pinned versions: re-run `webjs vendor pin` to re-resolve a coherent set, or bump the lagging package in package.json and reinstall so the importmap pins a version satisfying every dependent.',
    };
  }
  if (anyChecked === 0 && anyUnverified > 0) {
    return {
      name: 'importmap-coherence',
      status: 'warn',
      bestEffort: true,
      message: 'Could not verify importmap coherence (dependency metadata for the pinned packages was unavailable).',
      fix: 'Run `npm install` so the pinned packages are present in node_modules, then re-run `webjs doctor`.',
    };
  }
  return {
    name: 'importmap-coherence',
    status: 'pass',
    message: 'The importmap dependency graph is coherent (every pinned package satisfies its dependents\' declared ranges).',
  };
}

/**
 * CHECK 5, @webjsdev/* version coherence. WARN-level only (a version drift is
 * not a crash). Reads the app package.json `@webjsdev/*` ranges across
 * dependencies + devDependencies, then for each reads the INSTALLED version from
 * `node_modules/@webjsdev/<pkg>/package.json` and checks it satisfies the
 * declared range. PASS when every @webjsdev dep is present + satisfied; WARN on
 * a missing install or a range drift.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
async function checkWebjsVersions(appDir) {
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
    const installedPkg = join(appDir, 'node_modules', dep, 'package.json');
    if (!existsSync(installedPkg)) {
      missing.push(dep);
      continue;
    }
    let installedVersion = '';
    try {
      installedVersion = JSON.parse(await readFile(installedPkg, 'utf8')).version || '';
    } catch {
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

/**
 * CHECK 6 (optional), git pre-commit hook installed + executable. WARN when the
 * repo is a git checkout but `.git/hooks/pre-commit` is absent or
 * non-executable, since the test-gate / changelog hook would not fire. PASS when
 * present + executable, or skip (PASS) when this is not a git checkout at all
 * (an exported tarball, a non-repo dir). Respects a configured `core.hooksPath`
 * is OUT of scope here: the common scaffold installs into `.git/hooks`, so this
 * checks the default location and a configured path is the user's own concern.
 * @param {string} appDir
 * @returns {DoctorResult}
 */
function checkGitHook(appDir) {
  const gitDir = join(appDir, '.git');
  if (!existsSync(gitDir)) {
    return {
      name: 'git-hook',
      status: 'pass',
      message: 'Not a git checkout; no pre-commit hook expected.',
    };
  }
  const hook = join(gitDir, 'hooks', 'pre-commit');
  if (!existsSync(hook)) {
    return {
      name: 'git-hook',
      status: 'warn',
      message: 'No .git/hooks/pre-commit hook installed.',
      fix: 'Install the project hooks (e.g. `npm install` runs the prepare step that wires them).',
    };
  }
  let executable = false;
  try {
    // Owner-execute bit. On a checkout without exec bits (some Windows / CI
    // setups) the hook will not run, so flag it.
    executable = (statSync(hook).mode & 0o100) !== 0;
  } catch {
    executable = false;
  }
  if (!executable) {
    return {
      name: 'git-hook',
      status: 'warn',
      message: '.git/hooks/pre-commit exists but is not executable.',
      fix: 'chmod +x .git/hooks/pre-commit',
    };
  }
  return {
    name: 'git-hook',
    status: 'pass',
    message: '.git/hooks/pre-commit is installed and executable.',
  };
}

/**
 * Run every doctor check against `appDir` and return the results. PURE: no
 * printing, no `process.exit`; the CLI renders + decides the exit code.
 *
 * @param {string} appDir  the app directory to check (usually `process.cwd()`)
 * @param {{
 *   nodeVersion?: string,
 *   cliDir?: string,
 *   vendor?: { hasVendorPin: (d: string) => boolean, findOutdated: (d: string) => Promise<Array<{ pkg: string, current: string, latest: string }>> },
 * }} [opts]  test-injection seams:
 *   - `nodeVersion`: override the running Node version (asserts the fail case
 *     without being on old Node);
 *   - `cliDir`: directory of the CLI package whose `engines.node` sources the
 *     required major (defaults to THIS module's package);
 *   - `vendor`: inject the `{ hasVendorPin, findOutdated }` pair so the pin check
 *     runs against a stub instead of a real network call.
 *   - `coherence`: inject `{ liveImports, vendoredImports, getManifest, check }`
 *     so the importmap-coherence check runs against stub importmaps + metadata
 *     instead of a real live resolve / node_modules read.
 * @returns {Promise<DoctorResult[]>}
 */
/**
 * Advisory (#646): name why a page/layout SHIPS its module to the browser
 * instead of being elided. A page/layout that is a pure carrier (import-only
 * #605 / inert #179) stays out of the browser; one that ships whole is pinned
 * by a specific client-effecting NON-component on a component-free path from it, #963 (a util touching
 * a client global, a module-scope side effect, a bare side-effect import) or by
 * its own client work. This turns that invisible #605/#179 regression into a
 * named line. WARN only: a page legitimately MAY ship, and the analyser is
 * biased toward shipping by design (server AGENTS invariant 7), so this is a
 * "you may not have intended this" hint, never a hard fail.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
async function checkElisionCarriers(appDir) {
  const name = 'Page/layout elision (carrier hygiene)';
  let report;
  try {
    const { analyzeAppElision } = await import('@webjsdev/server');
    report = await analyzeAppElision(appDir);
  } catch {
    // Analysis unavailable (no app, malformed, server import failed): no advice.
    return { name, status: 'pass', message: 'not analysed (no routable app or analysis unavailable)' };
  }
  if (!report.analysed) {
    return { name, status: 'pass', message: 'not analysed (no routable app, or elision is disabled)' };
  }
  if (report.shipped.length === 0) {
    return { name, status: 'pass', message: 'every page/layout is elided (a pure import-only or inert carrier)' };
  }
  const rel = (f) => relative(appDir, f) || f;
  // Name the FIRST client-effecting blocker (there may be more than one; the
  // module stays shipped until every such blocker is moved out).
  const lines = report.shipped.map(({ file, blocker, reason }) =>
    blocker
      ? `${rel(file)} ships whole. Its first client-effecting blocker is ${rel(blocker)}, which ${reason} and is not a component`
      : `${rel(file)} ships whole because it ${reason}`,
  );
  return {
    name,
    status: 'warn',
    message:
      `${report.shipped.length} page/layout module(s) ship to the browser instead of being elided:\n` +
      lines.map((l) => `    ${l}`).join('\n'),
    fix: 'Move the client work out of the page/layout closure (into a component, or a .server module reached through an action) so the carrier can be elided, or accept that it ships. See references/components.md in the skill.',
  };
}

// Directories never worth walking for the CSS-freshness advisory (mirrors
// dev-regenerate's IGNORE_DIRS): build output, deps, VCS + framework caches.
const FRESHNESS_IGNORE = new Set(['node_modules', '.git', '.webjs', 'dist', '.next', 'coverage']);

/**
 * Newest mtime (ms) of any FILE under a path (a file's own, or the max over the
 * files in a directory tree, skipping dependencies / dotfiles). Directory-node
 * mtimes are NOT counted, matching dev-regenerate's walker: a content edit only
 * shows through the file mtime, and a directory mtime is a flaky moving target.
 * A missing path is 0. Best-effort: never throws.
 * @param {string} abs
 * @returns {number}
 */
function newestMtimeMs(abs) {
  let st;
  try { st = statSync(abs); } catch { return 0; }
  if (!st.isDirectory()) return st.mtimeMs;
  let newest = 0;
  let entries;
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return newest; }
  for (const e of entries) {
    if (e.name.startsWith('.') || FRESHNESS_IGNORE.has(e.name)) continue;
    // Skip symlinks: following one can cycle into unbounded recursion (a stack
    // overflow here) or escape into node_modules. Same tradeoff as the server
    // walker in dev-regenerate.js.
    if (e.isSymbolicLink()) continue;
    const m = newestMtimeMs(join(abs, e.name));
    if (m > newest) newest = m;
  }
  return newest;
}

/**
 * ADVISORY: a declared `webjs.dev.regenerate` output is STALE on disk (a source
 * is newer than the committed/built output). In DEV the framework recompiles it
 * on request (#967), so this never bites locally, but the check is the explicit
 * dev/prod PARITY backstop: it catches a stale `public/tailwind.css` that would
 * be served as-is by `webjs start` (prod does NOT recompile on request) or
 * committed into the repo. WARN-level: the fix is a one-line rebuild, and a
 * missing output (a fresh clone before the first `css:build`) is not this app's
 * bug to hard-fail on.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
async function checkStaticAssetFreshness(appDir) {
  const name = 'Static build outputs (dev.regenerate freshness)';
  let pkg;
  try {
    pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
  } catch {
    return { name, status: 'pass', message: 'no package.json to analyse' };
  }
  const rules = pkg && pkg.webjs && pkg.webjs.dev ? pkg.webjs.dev.regenerate : null;
  if (!Array.isArray(rules) || rules.length === 0) {
    return { name, status: 'pass', message: 'no webjs.dev.regenerate rules declared' };
  }
  const stale = [];
  for (const rule of rules) {
    if (!rule || typeof rule.output !== 'string') continue;
    const output = rule.output.replace(/^\/+/, '');
    const outMtime = newestMtimeMs(join(appDir, output));
    if (outMtime === 0) continue; // missing output: not a staleness fail (built on first boot)
    let newestSrc = 0;
    for (const inp of Array.isArray(rule.inputs) ? rule.inputs : []) {
      const m = newestMtimeMs(join(appDir, inp));
      if (m > newestSrc) newestSrc = m;
    }
    if (newestSrc > outMtime) stale.push({ output, command: rule.command });
  }
  if (stale.length === 0) {
    return { name, status: 'pass', message: 'every declared build output is up to date with its sources' };
  }
  return {
    name,
    status: 'warn',
    message:
      `${stale.length} static build output(s) are older than a source file:\n` +
      stale.map((s) => `    ${s.output} (rebuild: ${s.command})`).join('\n') +
      '\n    In dev the framework recompiles these on request, so this only bites a `webjs start` (prod) or a committed stale file.',
    fix: 'Rebuild the output(s) with the command shown (e.g. `npm run css:build`) before deploying or committing. `webjs dev` regenerates them on request automatically.',
  };
}

// Directories the route-module walk never descends into (deps, VCS, framework
// and build caches). Mirrors FRESHNESS_IGNORE; kept separate so either walk can
// change its exclusions without silently moving the other.
const ROUTE_WALK_IGNORE = new Set(['node_modules', '.git', '.webjs', 'dist', '.next', 'coverage']);

/**
 * A route module that renders markup on the server, which is where `asset()`
 * belongs. Page and layout are the common case, but the BOUNDARY modules matter
 * too and are easy to miss: `error` / `not-found` / `forbidden` / `unauthorized`
 * / `loading` are always shipped and never elided, and `global-error` renders
 * its OWN `<!doctype><html><head>` and is returned verbatim with no framework
 * head splice, which makes it the likeliest place outside the root layout for
 * an author to hand-write a stylesheet link.
 * @type {RegExp}
 */
const ROUTE_MODULE_RE =
  /^(?:page|layout|error|not-found|forbidden|unauthorized|loading)\.(?:js|ts|mjs|mts)$/;

/**
 * The two boundary stems `router.js` registers ONLY at the app root (both are
 * guarded by `dir === '.'` there). A nested `app/admin/global-error.ts` is never
 * in the route table and never renders, so scanning one would advise on dead
 * code, the same defect the `_private` skip exists to avoid.
 * @type {RegExp}
 */
const ROOT_ONLY_MODULE_RE = /^(?:global-error|global-not-found)\.(?:js|ts|mjs|mts)$/;

/**
 * One whole `<link …>` tag. QUOTE-AWARE (`(?:[^>"']|"[^"]*"|'[^']*')*`), the
 * same shape `ssr.js`'s hoist scanner uses, so a `>` inside a quoted attribute
 * value cannot terminate the tag early.
 * @type {RegExp}
 */
const LINK_TAG_RE = /<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;

/**
 * One attribute inside a tag: a name, then optionally `=` and a double-quoted,
 * single-quoted, or unquoted value. Matching attributes as WHOLE units is what
 * makes the scan correct, because each quoted value is consumed in one step and
 * can therefore never be re-scanned as if it contained an attribute of its own.
 * @type {RegExp}
 */
const ATTR_RE = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/**
 * Parse a tag's attributes into a lowercased-name map. The value is `null` for a
 * valueless attribute and carries a `quoted` flag, since this check treats an
 * UNQUOTED href (a template hole) as undecidable rather than as a path.
 * @param {string} tag
 * @returns {Map<string, { value: string | null, quoted: boolean }>}
 */
function parseTagAttrs(tag) {
  /** @type {Map<string, { value: string | null, quoted: boolean }>} */
  const attrs = new Map();
  // Skip the tag name itself so `link` is not read as an attribute.
  const body = tag.replace(/^<[a-zA-Z_:][-\w:.]*/, '');
  ATTR_RE.lastIndex = 0;
  for (const m of body.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase();
    if (attrs.has(name)) continue; // first wins, as in HTML parsing
    const quoted = m[2] !== undefined || m[3] !== undefined;
    const value = m[2] ?? m[3] ?? m[4] ?? null;
    attrs.set(name, { value, quoted });
  }
  return attrs;
}

/**
 * Whether a parsed `<link>` is an unmarked stylesheet, and if so its href.
 *
 * Attribute PARSING rather than a lookahead over the raw tag is load-bearing,
 * not tidiness. A scan that merely looks ahead for `rel=…stylesheet` anywhere in
 * the tag matches the string inside ANOTHER attribute's value, which flags the
 * two shapes this check most needs to leave alone: the canonical async-CSS
 * `<link rel="preload" as="style" href="/public/app.css" onload="this.rel='stylesheet'">`
 * (where the advised `asset()` fix would actively BREAK the preload, since the
 * versioned hint could then never match the unversioned request), and a
 * `data-rel="stylesheet"` sitting on a `rel="icon"`. Reading real attributes
 * makes `rel` mean the `rel` attribute and nothing else.
 *
 * Returns the href only when every condition holds:
 *   - `rel` is a token list CONTAINING `stylesheet` (so `rel="preload"` with an
 *     onload swap, and `rel="icon"`, are both out).
 *   - `href` is QUOTED. An unquoted value is a template hole
 *     (`href=${asset('/public/app.css')}`), undecidable from source, and is
 *     exactly the shape the marked form uses.
 *   - the path is under `/public/` (after the app's `webjs.basePath` is
 *     stripped, since under a sub-path deploy the author writes the prefix
 *     themselves and `resolveAssetUrl` strips it before its own `public/` gate).
 *   - `resolveAssetUrl` would actually fingerprint it. It returns a path
 *     carrying a QUERY or a `..` unchanged, so wrapping one in `asset()` is a
 *     runtime NO-OP: the author does the work and the url they ship is
 *     byte-identical. Advising it would be advising a change that buys nothing.
 *     A hand-rolled `?v=` cache-buster is exactly what an author who has not
 *     adopted `asset()` is most likely to have written, so this is the common
 *     case, not a corner. (The warning itself would clear, since this check
 *     reads the SOURCE shape and a wrapped href is an unquoted hole. Clearing a
 *     warning without improving the caching is the outcome to avoid.)
 *
 * @param {string} tag
 * @param {string} basePath  the app's normalized `webjs.basePath` (`''` at root)
 * @returns {string | null}
 */
function unmarkedStylesheetHref(tag, basePath = '') {
  const attrs = parseTagAttrs(tag);
  const rel = attrs.get('rel');
  if (!rel || !rel.value) return null;
  if (!rel.value.toLowerCase().split(/\s+/).includes('stylesheet')) return null;
  const href = attrs.get('href');
  if (!href || !href.quoted || !href.value) return null;
  const url = href.value;
  if (url[0] !== '/' || url[1] === '/') return null;
  // Mirror `resolveAssetUrl`'s refusals IN ITS ORDER, so every flagged href is
  // one `asset()` can actually fingerprint. It strips the base path, cuts at
  // `?` / `#`, DECODES, and only then tests `..` and the `public/` prefix.
  // Testing the raw value instead disagrees at both ends: `/public/%2e%2e/x`
  // would be flagged although wrapping it changes nothing, and
  // `/%70ublic/app.css` would be skipped although `asset()` fingerprints it.
  let probe = url;
  if (basePath && probe.startsWith(basePath + '/')) probe = probe.slice(basePath.length);
  const cuts = [probe.indexOf('?'), probe.indexOf('#')].filter((i) => i !== -1);
  let decoded = probe.slice(0, cuts.length ? Math.min(...cuts) : probe.length);
  try { decoded = decodeURIComponent(decoded); } catch { /* keep raw */ }
  if (decoded.includes('..') || !decoded.startsWith('/public/')) return null;
  // A query is refused outright (an author query may carry meaning we do not
  // own, so `resolveAssetUrl` returns the url untouched); a `#fragment` is not,
  // since it is split off and preserved.
  const beforeFragment = url.indexOf('#') === -1 ? url : url.slice(0, url.indexOf('#'));
  if (beforeFragment.includes('?')) return null;
  return url;
}

/**
 * The app's `webjs.basePath`, normalized to `''` (root mount) or `/segment…`.
 *
 * A faithful port of `normalizeBasePath` (`packages/server/src/base-path.js`),
 * which is the source of truth: it trims, PREPENDS the leading slash (so the
 * documented `"myapp"`, `"/myapp"` and `"/myapp/"` all normalize alike), and
 * fails safe to `''` on a value that is not a plain same-origin prefix. Reading
 * only `startsWith('/')` would leave this check inert for an app configured
 * `"myapp"`, which is exactly the silently-inert case it exists to close.
 *
 * Ported rather than imported because that helper is not on `@webjsdev/server`'s
 * public surface, and because doctor must stay usable when the framework does
 * not resolve from the app dir at all (the #954 fresh-worktree case this same
 * command exists to diagnose). `test/cli/doctor.test.mjs` pins the forms.
 * @param {string} appDir
 * @returns {Promise<string>}
 */
async function readAppBasePath(appDir) {
  let raw;
  try {
    const pkg = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'));
    raw = pkg?.webjs?.basePath;
  } catch {
    return '';
  }
  if (typeof raw !== 'string') return '';
  let v = raw.trim();
  if (v === '' || v === '/') return '';
  // Not a plain same-origin path prefix: fail safe to no base path.
  if (v.includes('..') || v.includes('://') || v.includes('\\') || /\s/.test(v)) return '';
  // A network-path reference (`//host`) is rejected BEFORE leading slashes are
  // collapsed, since collapsing would turn an origin escape into `/host`.
  if (v.startsWith('//')) return '';
  v = ('/' + v.replace(/^\/+/, '')).replace(/\/+$/, '');
  return v === '' || v === '/' ? '' : v;
}

/**
 * Whether the `<link>` tag at `idx` is commented out, so dead markup is never
 * reported as a live finding.
 *
 * A DELIMITED comment is decided by an unclosed opener behind the tag. Neither
 * `<!--` nor `/*` nests, so "nearest opener beats nearest closer" is exact, and
 * it covers a multi-line block whose interior lines carry no marker of their
 * own (what an editor's toggle-block-comment writes). A `//` has no closer, so
 * it is decided from the tag's own line: a `//` inside an href later in the
 * line cannot match, because the line does not START with it.
 *
 * Do NOT replace this with a lexer. Two attempts did, and both shipped bugs a
 * stateless test cannot have: a line-blanking regex killed any line holding a
 * protocol-relative url, and a quote-tracking walk inverted string/code
 * polarity on a nested ``html`...` `` inside a `${}` hole (one quote char
 * cannot model nesting), so an unbalanced apostrophe in template text
 * desynchronized the rest of the file. This check does not need to lex
 * JavaScript. If it ever genuinely does, export `redactStringsAndTemplates`
 * from `@webjsdev/server` (`src/js-scan.js`, fuzz-tested differentially against
 * a real TypeScript parse) rather than growing a third one here.
 *
 * Residual gap: a tag behind a `//` that trails real code on the same line
 * stays reported. Rare, and it fails toward reporting rather than toward the
 * silent inertness both lexers produced.
 *
 * @param {string} src
 * @param {number} idx  index of the tag's `<`
 * @returns {boolean}
 */
function isCommentedOut(src, idx) {
  const before = src.slice(0, idx);
  if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) return true;
  if (before.lastIndexOf('/*') > before.lastIndexOf('*/')) return true;
  const lineStart = before.lastIndexOf('\n') + 1;
  return before.slice(lineStart).trimStart().startsWith('//');
}

/**
 * Collect every `app/**` route module that renders markup, depth-first.
 * Best-effort: an unreadable directory contributes nothing rather than throwing.
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function collectRouteModules(dir, root = dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || ROUTE_WALK_IGNORE.has(e.name)) continue;
    if (e.isSymbolicLink()) continue; // never follow: can cycle or escape into deps
    // `_`-prefixed folders are PRIVATE: `router.js` drops any route whose
    // directory has such a segment, so markup under one is never routed and
    // never rendered. Advising on it would be advice about dead code.
    if (e.isDirectory() && e.name.startsWith('_')) continue;
    const abs = join(dir, e.name);
    if (e.isDirectory()) collectRouteModules(abs, root, out);
    else if (ROUTE_MODULE_RE.test(e.name)) out.push(abs);
    else if (dir === root && ROOT_ONLY_MODULE_RE.test(e.name)) out.push(abs);
  }
  return out;
}

/**
 * ADVISORY (#1095): a route module hand-writes a `<link rel="stylesheet"
 * href="/public/…">` without `asset()`, so the url is un-versioned and a deploy
 * cannot bust a CDN's copy of it.
 *
 * The failure this names was caught in production on webjs.dev: the edge served
 * a `public/tailwind.css` built BEFORE the deploy (`cf-cache-status: HIT`,
 * `max-age=14400`) against post-deploy HTML, so the new page rendered with its
 * content edge to edge and its grid collapsed, because the cached css was
 * missing the arbitrary-value utilities that page introduced. It is invisible
 * while a deploy only restyles existing classes and maximally visible the moment
 * one adds a page using new utilities.
 *
 * Why this is an ADVISORY over the author's SOURCE rather than a rewrite of the
 * framework's OUTPUT. The first attempt at the automatic form (#1196) matched
 * urls in the assembled HTML, and two deep-review rounds found six major
 * defects, five of them one bug: at that layer framework output and author data
 * are indistinguishable, so the matcher kept editing things it did not own. That
 * is why `asset()` (#1194) is opt-in, and it is what Rails (a
 * `stylesheet_link_tag` helper over a digest manifest) and Remix (a hashed url
 * from the build graph, surfaced through `links()`) both do: take the
 * fingerprint from an authoritative source at the point the url is PRODUCED, and
 * never rewrite a rendered document. The gap `asset()` leaves is purely
 * ergonomic. In Rails the helper is the only idiomatic way to write the tag, so
 * forgetting it is nearly impossible; in WebJs the `<link>` is hand-written HTML,
 * so it is easy to omit. This check closes exactly that gap, at authoring time,
 * where the author's meaning is unambiguous and nothing is rewritten.
 *
 * Scoped to `rel="stylesheet"` on purpose. An icon is a legitimate deliberate
 * NON-mark (the website leaves its favicons bare so the SEO repo-health tests
 * can parse the hrefs literally), and a `rel="preload"` must NOT be marked at
 * all, since its versioned hint could never match the unversioned request a CSS
 * `url()` actually makes. Flagging either would nag about a correct choice.
 *
 * WARN only: an un-versioned stylesheet still SERVES correctly, it just caches
 * badly, and an app fronted by no CDN may not care.
 * @param {string} appDir
 * @returns {Promise<DoctorResult>}
 */
async function checkUnmarkedAssetLinks(appDir) {
  const name = 'Asset urls (unmarked stylesheet links)';
  const routeDir = join(appDir, 'app');
  if (!existsSync(routeDir)) {
    return { name, status: 'pass', message: 'no app/ directory to analyse' };
  }
  const basePath = await readAppBasePath(appDir);
  const findings = [];
  for (const file of collectRouteModules(routeDir)) {
    let src;
    try { src = await readFile(file, 'utf8'); } catch { continue; }
    // Cheap bail before any tag scanning. Case-INSENSITIVE to match the tag
    // regex: a file whose only link tag is written `<LINK …>` must still be
    // scanned, or the scanner's own case-insensitivity is unreachable exactly
    // where it is needed.
    if (!/<link/i.test(src)) continue;
    LINK_TAG_RE.lastIndex = 0;
    for (const m of src.matchAll(LINK_TAG_RE)) {
      const href = unmarkedStylesheetHref(m[0], basePath);
      if (!href) continue;
      // A commented-out tag emits nothing, so advising on it is advice about
      // dead markup.
      if (isCommentedOut(src, /** @type {number} */ (m.index))) continue;
      // 1-indexed line of the match, for a jump-to reference.
      const line = src.slice(0, m.index).split('\n').length;
      findings.push({ file, line, href });
    }
  }
  if (findings.length === 0) {
    return { name, status: 'pass', message: 'every route-module stylesheet link is content-hashed (or has none)' };
  }
  const rel = (f) => relative(appDir, f) || f;
  return {
    name,
    status: 'warn',
    message:
      `${findings.length} stylesheet link(s) are served at an un-versioned url, so a deploy cannot bust a cached copy:\n` +
      findings.map((f) => `    ${rel(f.file)}:${f.line} href="${f.href}"`).join('\n'),
    fix:
      "Wrap the path in asset(): `import { asset } from '@webjsdev/core'` then "
      + '`<link rel="stylesheet" href=${asset(\'/public/app.css\')}>`. It appends a content hash in prod '
      + '(the framework then serves that url immutable for a year) and is a no-op in dev and in the browser. '
      + 'Call it inside the render function, not at module scope.',
  };
}

/**
 * Probe whether `@webjsdev/core` resolves from `appDir`. Node resolution is
 * directory-relative, so this must probe FROM the app (not the CLI's own
 * location, which resolves the framework fine from a global install even when
 * the app cannot). A no-op-cheap resolve, no I/O beyond what Node's resolver
 * does, no network. Returns true when the framework resolves, false otherwise.
 * @param {string} appDir
 * @returns {boolean}
 */
export function frameworkResolves(appDir) {
  try {
    // The base file need not exist; createRequire only uses it to anchor the
    // node_modules lookup at appDir.
    const require = createRequire(join(appDir, '__webjs_resolve_probe__.js'));
    require.resolve('@webjsdev/core');
    return true;
  } catch {
    return false;
  }
}

/**
 * CHECK 8, framework resolvability (#954). WARN when `@webjsdev/core` cannot be
 * resolved FROM the app directory, which is the fresh-git-worktree trap: a
 * worktree does not copy `node_modules`, so a plain `webjs dev` there dies at
 * SSR with a raw `ERR_MODULE_NOT_FOUND: Cannot find package '@webjsdev/core'`
 * whose remedy is not obvious. Silent PASS when the framework resolves (the
 * common case), so this never slows a healthy app. WARN (not a hard fail): it
 * is a setup/environment concern, the same tier as the version-coherence check.
 * @param {string} appDir
 * @returns {DoctorResult}
 */
export function checkFrameworkResolves(appDir) {
  const name = 'framework-resolve';
  if (frameworkResolves(appDir)) {
    return { name, status: 'pass', message: '@webjsdev/core resolves from the app directory.' };
  }
  const hasNodeModules = existsSync(join(appDir, 'node_modules'));
  // A git worktree checks out `.git` as a FILE (a gitdir pointer), not a
  // directory. That, plus a missing node_modules, is the exact #954 cause.
  let isWorktree = false;
  try {
    isWorktree = statSync(join(appDir, '.git')).isFile();
  } catch {
    isWorktree = false;
  }
  if (isWorktree && !hasNodeModules) {
    return {
      name,
      status: 'warn',
      message:
        '@webjsdev/core cannot be resolved from this directory, and this is a git worktree with no ' +
        'node_modules. Git worktrees do not copy node_modules, so the framework is unresolvable here ' +
        'and `webjs dev` / `webjs start` would fail at SSR with a raw ERR_MODULE_NOT_FOUND.',
      fix:
        'Install dependencies in this worktree (`npm install`), or symlink node_modules from the ' +
        'primary checkout (`ln -s ../<primary-checkout>/node_modules node_modules`).',
    };
  }
  if (!hasNodeModules) {
    return {
      name,
      status: 'warn',
      message: '@webjsdev/core cannot be resolved from this directory (no node_modules present).',
      fix: 'Run `npm install` in the app directory so the framework resolves.',
    };
  }
  return {
    name,
    status: 'warn',
    message:
      '@webjsdev/core cannot be resolved from this directory even though node_modules exists ' +
      '(a partial or corrupted install).',
    fix: 'Reinstall dependencies (`npm install`, or remove node_modules and reinstall).',
  };
}

export async function runDoctorChecks(appDir, opts = {}) {
  const cliDir = opts.cliDir || new URL('.', import.meta.url).pathname;
  const results = await Promise.all([
    checkNode(cliDir, opts),
    checkTsconfig(appDir),
    checkEnv(appDir),
    checkVendorPin(appDir, opts),
    checkVendorGitignore(appDir),
    checkWebjsVersions(appDir),
    Promise.resolve(checkFrameworkResolves(appDir)),
    checkImportmapCoherence(appDir, opts),
    Promise.resolve(checkGitHook(appDir)),
    checkElisionCarriers(appDir),
    checkStaticAssetFreshness(appDir),
    checkUnmarkedAssetLinks(appDir),
  ]);
  // Attach the stable machine code to every result (#975). Centralized here so
  // each check function stays free of the code-contract concern.
  for (const r of results) r.code = codeForName(r.name);
  return results;
}
