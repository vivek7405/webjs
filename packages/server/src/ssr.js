/**
 * @module @webjsdev/server/ssr
 * Thin barrel re-exporting SSR render, document assembly, and head/metadata sub-modules.
 */

export {
  ssrPage,
  ssrNotFound,
  ssrForbidden,
  ssrUnauthorized,
  privateFragment,
} from './ssr/render.js';

export { setClientRouterEnabled } from './ssr/client-router-flag.js';

export { publicEnvShim } from './ssr/env-shim.js';

export {
  _layoutSegmentPath,
  _pageSegmentPath,
  _regionRouteKey,
  _wrapWithChildrenMarker,
  _extractUserShell,
  _buildDocumentParts,
} from './ssr/document.js';

export {
  _hoistHeadTags,
  _escapeJsonLd,
  _jsonLdScript,
  preloadCrossOriginAttr,
  integrityAttr,
  setMetadataIconRoutes,
} from './ssr/head.js';
