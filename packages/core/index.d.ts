/**
 * Public type surface for `webjs`.
 *
 * The runtime is packages/core/index.js (JSDoc-annotated JavaScript); this
 * overlay exists so TypeScript-based editors (tsserver under VS Code,
 * Neovim, Zed, WebStorm) resolve richer types than JSDoc alone can express
 * — specifically the generic component factory and property-descriptor
 * inference helpers. Zero runtime cost.
 */

export * from './src/component.d.ts';

export { html, isTemplate, MARKER } from './src/html.js';
export { css, isCSS, adoptStyles, stylesToString } from './src/css.js';
export { register, lookup, lookupModuleUrl, isLazy, allTags, primeModuleUrl, tagOf } from './src/registry.js';
export { renderToString, renderToStream } from './src/render-server.js';
export { render } from './src/render-client.js';
export { escapeText, escapeAttr } from './src/escape.js';
export { notFound, redirect, isNotFound, isRedirect } from './src/nav.js';
export { expose, getExposed } from './src/expose.js';
export { repeat, isRepeat } from './src/repeat.js';
export { Suspense, isSuspense } from './src/suspense.js';
export { connectWS } from './src/websocket-client.js';
export { richFetch } from './src/rich-fetch.js';
export { enableClientRouter, disableClientRouter, navigate } from './src/router-client.js';
export { unsafeHTML, isUnsafeHTML, live, isLive } from './src/directives.js';
export { createContext, ContextProvider, ContextConsumer, ContextRequestEvent } from './src/context.js';
export { Task, TaskStatus } from './src/task.js';
