/**
 * webjs/core — public surface.
 *
 * Isomorphic: this module is safe to import on both server and client.
 * The client renderer is lazy-loaded by the WebComponent base; the server
 * renderer is only reached on the server.
 */

export { html, isTemplate, MARKER } from './src/html.js';
export { css, isCSS, adoptStyles, stylesToString } from './src/css.js';
export { WebComponent } from './src/component.js';
export { register, lookup, allTags } from './src/registry.js';
export { renderToString } from './src/render-server.js';
export { render } from './src/render-client.js';
export { escapeText, escapeAttr } from './src/escape.js';
export { notFound, redirect, isNotFound, isRedirect } from './src/nav.js';
export { expose, getExposed } from './src/expose.js';
