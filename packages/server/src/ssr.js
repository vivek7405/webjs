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
  setClientRouterEnabled,
} from './ssr/render.js';

export {
  _layoutSegmentPath,
  _pageSegmentPath,
  _regionRouteKey,
  _wrapWithChildrenMarker,
  _extractUserShell,
  _buildDocumentParts,
  publicEnvShim,
} from './ssr/document.js';

export {
  _hoistHeadTags,
  _escapeJsonLd,
  _jsonLdScript,
  preloadCrossOriginAttr,
  integrityAttr,
} from './ssr/head.js';
