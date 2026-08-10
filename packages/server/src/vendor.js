/**
 * Resolve bare npm imports to browser-loadable URLs via jspm.io.
 *
 * WebJs follows the Rails 7 + importmap-rails posture exactly. When user
 * code imports a bare specifier (e.g. `import dayjs from 'dayjs'`), the
 * browser can't resolve it natively. The framework's job is to emit an
 * importmap that translates each bare specifier to a real URL.
 *
 * The URL points at **jspm.io**, the same CDN Rails uses by default:
 *
 *   importmap: { "dayjs": "https://ga.jspm.io/npm:dayjs@1.11.13/index.js" }
 *
 * The browser fetches the bundle directly from jspm.io. The WebJs server
 * does not proxy, cache, or bundle anything. jspm.io has done the work
 * server-side (CJS-to-ESM conversion, transitive bundling, browser
 * polyfills).
 *
 * Why jspm.io: institutional backing (37signals, CacheFly for CDN
 * infrastructure, Rails ecosystem dependency creates downstream pressure
 * for continued operation), status page at status.jspm.io, standards-
 * first maintenance by Guy Bedford (TC39 contributor on ESM and import
 * maps). Years of uptime track record.
 *
 * URL resolution: jspm.io's bare-package URL (without entry path)
 * returns metadata, not JavaScript. The correct entry file (e.g.,
 * `/dayjs.min.js`, `/index.js`) varies per package and must be
 * resolved from the JSPM Generator API. The Generator is called once
 * on the first request for the full set of bare imports; results are
 * cached in-memory for the process lifetime.
 *
 * Connectivity: the Generator API call happens on the first request,
 * inside `ensureReady` via `setVendorEntries`, never at boot. If
 * api.jspm.io is unreachable, the
 * importmap will be missing vendor entries and the browser will
 * report "unresolved bare specifier" errors. The server itself still
 * boots and serves user routes; only vendor-importing pages break
 * until api.jspm.io is reachable again. Failure is loud and clear.
 *
 * No local bundler. No disk cache. No memory cache of bundle bytes.
 * Matches Rails' "no build" posture literally.
 *
 * Public API barrel re-exporting sub-modules under `./vendor/*`.
 *
 * @module vendor
 */

export { scanBareImports, extractPackageName } from './vendor/scanner.js';
export { getPackageVersion, getPackageManifest } from './vendor/manifest.js';
export { SUPPORTED_PROVIDERS, normalizeProvider } from './vendor/providers.js';
export { sha384Integrity, satisfiesSemverRange } from './vendor/integrity.js';
import { clearJspmCache } from './vendor/jspm.js';
import { clearLiveIntegrityCache } from './vendor/resolver.js';

/**
 * Clear the resolved-importmap cache. Called on file-watcher rebuild
 * so newly-added bare imports trigger a fresh api.jspm.io/generate
 * call on the next request to populate the in-memory cache.
 */
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
