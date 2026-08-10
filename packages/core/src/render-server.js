// Public surface, byte-identical to the pre-split module. `injectDSD` is
// deliberately NOT re-exported: it is internal to `render-server/`, nothing
// outside imports it, and `render-server.d.ts` does not declare it. This file
// backs the published `@webjsdev/core/server` subpath, so re-exporting it would
// widen the package's public API for a helper no consumer asked for.
export { renderToString, renderToStream } from './render-server/stream.js';
