/**
 * Build the import map JSON injected into every SSR HTML document.
 *
 * superjson is mapped to a single pre-bundled ESM file (its transitive deps
 * copy-anything + is-what are inlined by esbuild on first request) so only
 * ONE fetch is needed and no extra bare-specifier entries leak into the map.
 *
 * Additional vendor entries are added automatically when the bare-import
 * scanner discovers npm packages used by client code (Vite-style optimizeDeps).
 */

/** @type {Record<string, string>} */
let _extraEntries = {};

/**
 * Merge additional vendor entries into the import map.
 * Called by the server after scanning for bare imports.
 * @param {Record<string, string>} entries
 */
export function setVendorEntries(entries) {
  _extraEntries = entries;
}

export function buildImportMap() {
  return {
    imports: {
      'webjs':              '/__webjs/core/index.js',
      'webjs/':             '/__webjs/core/src/',
      'webjs/client-router': '/__webjs/core/src/router-client.js',
      'webjs/lazy-loader':   '/__webjs/core/src/lazy-loader.js',
      'webjs/directives':    '/__webjs/core/src/directives.js',
      'webjs/context':       '/__webjs/core/src/context.js',
      'webjs/testing':       '/__webjs/core/src/testing.js',
      'webjs/task':          '/__webjs/core/src/task.js',
      'superjson':          '/__webjs/vendor/superjson.js',
      ..._extraEntries,
    },
  };
}

/** Serialise the import map to an HTML script tag string. */
export function importMapTag() {
  return `<script type="importmap">${JSON.stringify(buildImportMap())}</script>`;
}
