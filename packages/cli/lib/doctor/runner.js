import { codeForName } from './codes.js';
import { checkNode } from './probes/node.js';
import { checkTsconfig } from './probes/tsconfig.js';
import { checkEnv } from './probes/env.js';
import { checkVendorPin } from './probes/vendor-pin.js';
import { checkVendorGitignore } from './probes/vendor-gitignore.js';
import { checkImportmapCoherence } from './probes/importmap-coherence.js';
import { checkWebjsVersions } from './probes/webjs-versions.js';
import { checkGitHook } from './probes/git-hook.js';
import { checkElisionCarriers, checkElisionComponents } from './probes/elision.js';
import { checkStaticAssetFreshness } from './probes/static-asset-freshness.js';
import { checkUnmarkedAssetLinks } from './probes/unmarked-asset-links.js';
import { checkFrameworkResolves } from './probes/framework-resolves.js';

/**
 * @typedef {import('./codes.js').DoctorResult} DoctorResult
 */

/**
 * Run every doctor check against `appDir` and return the results. PURE: no
 * printing, no `process.exit`; the CLI renders + decides the exit code.
 *
 * @param {string} appDir  the app directory to check (usually `process.cwd()`)
 * @param {{
 *   nodeVersion?: string,
 *   cliDir?: string,
 *   vendor?: { hasVendorPin: (d: string) => boolean, findOutdated: (d: string) => Promise<Array<{ pkg: string, current: string, latest: string }>> },
 *   coherence?: {
 *     liveImports?: () => Promise<Record<string,string> | null>,
 *     vendoredImports?: () => Promise<Record<string,string> | null>,
 *     getManifest?: (pkg: string, version: string) => Promise<any>,
 *     check?: (imports: Record<string,string>, o: { getManifest: any }) => Promise<{ conflicts: any[], unverified: any[], checked: number }>,
 *   },
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
export async function runDoctorChecks(appDir, opts = {}) {
  const cliDir = opts.cliDir || new URL('.', import.meta.url).pathname;
  // ONE elision report for BOTH elision checks (#1308). Started before the
  // batch and awaited inside each check, so the module graph is built once per
  // doctor run and the two checks still run in parallel with everything else.
  // Fails soft to null, exactly as the carrier check's own try/catch did.
  const elision = (async () => {
    try {
      const { analyzeAppElision } = await import('@webjsdev/server');
      return await analyzeAppElision(appDir);
    } catch { return null; }
  })();
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
    checkElisionCarriers(elision),
    checkElisionComponents(elision),
    checkStaticAssetFreshness(appDir),
    checkUnmarkedAssetLinks(appDir),
  ]);
  // Attach the stable machine code to every result (#975). Centralized here so
  // each check function stays free of the code-contract concern.
  for (const r of results) r.code = codeForName(r.name);
  return results;
}
