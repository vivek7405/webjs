/**
 * Resolve bare npm imports to browser-loadable URLs via jspm.io.
 *
 * Public API barrel re-exporting modular sub-modules under `./vendor/*`.
 */

export { scanBareImports, extractPackageName } from './vendor/scanner.js';
export { getPackageVersion, getPackageManifest } from './vendor/manifest.js';
export { SUPPORTED_PROVIDERS, normalizeProvider } from './vendor/providers.js';
export { sha384Integrity, satisfiesSemverRange } from './vendor/integrity.js';
import { clearJspmCache } from './vendor/jspm.js';
import { clearLiveIntegrityCache } from './vendor/resolver.js';

export function clearVendorCache() {
  clearJspmCache();
  clearLiveIntegrityCache();
}

export { jspmGenerate, vendorImportMapEntries } from './vendor/jspm.js';

export {
  ensureVendorCommittable,
  hasVendorPin,
  readPinFile,
  pinAll,
  unpinPackage,
  listPinned,
  prunePinToReachable,
} from './vendor/pins.js';
export {
  auditPinned,
  findOutdated,
  updatePinned,
  extractPinnedVersions,
  checkImportmapCoherence,
} from './vendor/audit.js';
export { resolveVendorImports, serveDownloadedBundle } from './vendor/resolver.js';
