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
  'Component elision (what the browser drops)': 'ELISION_COMPONENTS',
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
