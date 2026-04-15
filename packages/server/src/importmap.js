/**
 * Build the import map JSON injected into every SSR HTML document.
 * Lets users write `import { html, WebComponent } from 'webjs'` without
 * relative paths or a bundler.
 */
export function buildImportMap() {
  return {
    imports: {
      webjs: '/__webjs/core/index.js',
      'webjs/': '/__webjs/core/src/',
    },
  };
}

/** Serialise import map to an HTML script tag string. */
export function importMapTag() {
  return `<script type="importmap">${JSON.stringify(buildImportMap())}</script>`;
}
