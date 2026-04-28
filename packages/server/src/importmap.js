/**
 * Build the import map JSON injected into every SSR HTML document.
 *
 * Additional vendor entries are added automatically when the bare-import
 * scanner discovers npm packages used by client code (Vite-style
 * optimizeDeps).
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
      '@webjskit/core':               '/__webjs/core/index.js',
      '@webjskit/core/':              '/__webjs/core/src/',
      '@webjskit/core/client-router': '/__webjs/core/src/router-client.js',
      '@webjskit/core/lazy-loader':   '/__webjs/core/src/lazy-loader.js',
      '@webjskit/core/directives':    '/__webjs/core/src/directives.js',
      '@webjskit/core/context':       '/__webjs/core/src/context.js',
      '@webjskit/core/testing':       '/__webjs/core/src/testing.js',
      '@webjskit/core/task':          '/__webjs/core/src/task.js',
      ..._extraEntries,
    },
  };
}

/** Serialise the import map to an HTML script tag string. */
export function importMapTag() {
  return `<script type="importmap">${JSON.stringify(buildImportMap())}</script>`;
}
