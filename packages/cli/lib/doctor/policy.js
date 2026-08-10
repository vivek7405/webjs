import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOCTOR_CODES, DOCTOR_SEVERITIES } from './codes.js';

/**
 * @typedef {import('./codes.js').DoctorSeverity} DoctorSeverity
 * @typedef {import('./codes.js').DoctorLevel} DoctorLevel
 * @typedef {import('./codes.js').DoctorResult} DoctorResult
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
 * outside `DOCTOR_SEVERITIES` in `badSeverities`, a wrong SHAPE (a non-object
 * `doctor` or `gate`) in `malformed`, and a misspelled sibling of `gate` such
 * as `gates` in `unknownKeys`. All four are surfaced as a hard error by the
 * CLI rather than skipped.
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
