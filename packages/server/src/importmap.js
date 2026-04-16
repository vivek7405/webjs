/**
 * Build the import map JSON injected into every SSR HTML document.
 *
 * superjson is mapped to a single pre-bundled ESM file (its transitive deps
 * copy-anything + is-what are inlined by esbuild on first request) so only
 * ONE fetch is needed and no extra bare-specifier entries leak into the map.
 */
export function buildImportMap() {
  return {
    imports: {
      'webjs':     '/__webjs/core/index.js',
      'webjs/':    '/__webjs/core/src/',
      'superjson': '/__webjs/vendor/superjson.js',
    },
  };
}

/** Serialise the import map to an HTML script tag string. */
export function importMapTag() {
  return `<script type="importmap">${JSON.stringify(buildImportMap())}</script>`;
}
