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

export { DOCTOR_SEVERITIES, DOCTOR_CODES, codeForName } from './doctor/codes.js';
export { readDoctorPolicy, applyDoctorPolicy } from './doctor/policy.js';
export { readAppBasePath } from './doctor/route-modules.js';
export { frameworkResolves, checkFrameworkResolves, inspectFrameworkLink, checkFrameworkLinks } from './doctor/probes/framework-resolves.js';
export { runDoctorChecks } from './doctor/runner.js';
