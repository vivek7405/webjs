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
