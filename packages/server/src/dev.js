/**
 * @module @webjsdev/server/dev
 * Thin barrel re-exporting dev configuration, request handler, and server launching modules.
 */

export {
  readElideEnabled,
  readSeedEnabled,
  readClientRouterEnabled,
  readHeaderRules,
  readRedirectRules,
  readTrailingSlashFromApp,
  readBasePathFromApp,
  warnOnInvalidWebjsConfig,
  readAllowedOriginsFromApp,
  readCspConfigFromApp,
  readBodyLimitsFromApp,
  readDevWatchPathsFromApp,
  readServerTimeoutsFromApp,
} from './dev/config.js';

export { createRequestHandler } from './dev/handler.js';
export { startServer, shouldIgnoreWatchPath } from './dev/server.js';
