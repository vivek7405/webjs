/**
 * Build the import map JSON injected into every SSR HTML document.
 * Lets users write bare specifiers (`import { html } from 'webjs'`,
 * `import { parse } from 'superjson'`) without relative paths or a bundler.
 */
export function buildImportMap() {
  return {
    imports: {
      'webjs':     '/__webjs/core/index.js',
      'webjs/':    '/__webjs/core/src/',
      'superjson': '/__webjs/vendor/superjson/dist/index.js',
      'superjson/': '/__webjs/vendor/superjson/dist/',
    },
  };
}

/** Serialise the import map to an HTML script tag string. */
export function importMapTag() {
  return `<script type="importmap">${JSON.stringify(buildImportMap())}</script>`;
}
