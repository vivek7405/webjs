/**
 * Public type surface for `webjs`.
 *
 * The runtime is packages/core/index.js (JSDoc-annotated JavaScript); this
 * overlay exists so TypeScript-based editors (tsserver under VS Code,
 * Neovim, Zed, WebStorm) resolve richer types than JSDoc alone can express
 * - specifically the generic component factory and property-descriptor
 * inference helpers. Zero runtime cost.
 */

export * from './src/component.d.ts';
export type {
  Metadata,
  MetadataContext,
  TitleMetadata,
  ViewportMetadata,
  RobotsMetadata,
  AlternatesMetadata,
  VerificationMetadata,
  OpenGraphMetadata,
  TwitterMetadata,
  AppleWebAppMetadata,
  IconsMetadata,
  IconDescriptor,
  AuthorMetadata,
  PreloadDescriptor,
  JsonLd,
} from './src/metadata.d.ts';

// Typed route props + the opt-in generated route union (#258). The
// `WebjsRoutes` / `RouteParamMap` interfaces are exported as VALUES-of-types
// (interfaces) so app code and the generated `.webjs/routes.d.ts` can augment
// them via `declare module '@webjsdev/core'`.
export type {
  Route,
  RouteParams,
  PageProps,
  LayoutProps,
  RouteHandlerContext,
  WebjsRoutes,
  RouteParamMap,
} from './src/routes.d.ts';

// The package.json `webjs` config block (#259). Typed reference for the
// elide / headers / redirects / trailingSlash / csp / ingress-limit knobs;
// the companion JSON Schema (packages/server/webjs-config.schema.json) gives
// editors native validation of package.json itself.
export type {
  WebjsConfig,
  WebjsHeaderRule,
  WebjsHeaderDirective,
  WebjsRedirectRule,
  WebjsTrailingSlash,
  WebjsCspConfig,
  WebjsDoctorConfig,
  WebjsDoctorSeverity,
} from './src/webjs-config.d.ts';

// Compile-time serializability typing for server actions (#488): the opt-in
// guard that makes a non-serializable action arg / return a type error.
export type {
  Serializable,
  SerializableArgs,
  SerializableResult,
  SerializableActionFn,
  NonSerializable,
} from './src/serializable.d.ts';

export { html, isTemplate, MARKER } from './src/html.js';
// The `html\`\`` return type. A JSDoc typedef in html.js used across the
// component / route / testing type surfaces; re-exported so an app or the
// docs/website can annotate a value as `TemplateResult` (#772).
export type { TemplateResult } from './src/html.js';
export { css, isCSS, adoptStyles, stylesToString } from './src/css.js';
export { register, lookup, lookupModuleUrl, isLazy, allTags, primeModuleUrl, tagOf } from './src/registry.js';
export { renderToString, renderToStream } from './src/render-server.js';
export { render } from './src/render-client.js';
export { escapeText, escapeAttr } from './src/escape.js';
export { notFound, redirect, forbidden, unauthorized, isNotFound, isRedirect, isForbidden, isUnauthorized } from './src/nav.js';
export { repeat, isRepeat } from './src/repeat.js';
export { Suspense, isSuspense } from './src/suspense.js';
export { connectWS } from './src/websocket-client.js';
export { richFetch } from './src/rich-fetch.js';
export { enableClientRouter, disableClientRouter, revalidate, loadFrame } from './src/router-client.js';

// `navigate` is typed against the generated `Route` union (#258) rather than
// the JSDoc `string`. Until an app runs `webjs types`, `Route` resolves to
// `string`, so this is non-breaking; once generated, a bogus in-app path is a
// tsserver error. The runtime is the same async function in router-client.js.
import type { Route } from './src/routes.d.ts';
export function navigate(url: Route, opts?: { replace?: boolean }): Promise<void>;
// The full lit-html-parity directive set (mirrors index.js); the per-directive
// declarations live in src/directives.d.ts. `repeat` is re-exported above.
export {
  unsafeHTML, isUnsafeHTML, live, isLive, keyed, isKeyed, guard, isGuard,
  templateContent, isTemplateContent, ref, isRef, createRef, cache, isCache,
  until, isUntil, asyncAppend, isAsyncAppend, asyncReplace, isAsyncReplace,
  watch, isWatch,
} from './src/directives.js';
export { createContext, ContextProvider, ContextConsumer, ContextRequestEvent } from './src/context.js';
export { Task, TaskStatus } from './src/task.js';

// Signals (the default state primitive, invariant 5), the CSP nonce reader,
// the wire serializer, and the streaming/frame custom elements. These mirror
// the index.js runtime re-exports; their declarations live in the matching
// src/*.d.ts (#388 fixed the index.d.ts drift from index.js).
export { signal, computed, effect, batch, isSignal, Signal } from './src/signal.js';
export { cspNonce, setCspNonceProvider } from './src/csp-nonce.js';
export { asset, setAssetUrlProvider } from './src/asset-url.js';
export { FORM_ACTION_FIELD, FORM_ACTION_ID_KEY, setFormActionResolver } from './src/form-action.js';
export { takeSeed, scanSeeds, seedStats, SEED_MISS } from './src/action-seed-client.js';
export { markStale, registerKeyTags, consumeStale, parseTagHeader, fetchMark } from './src/action-cache-client.js';
// Client action-abort plumbing (#492): a superseded async render aborts its
// in-flight action fetches. Inert server-side.
export { setActiveActionSignal, activeActionSignal } from './src/action-abort-client.js';
// Streaming RPC wire protocol (#489).
export {
  STREAM_CONTENT_TYPE, FRAME_CHUNK, FRAME_END, FRAME_ERROR, encodeFrame, createFrameDecoder,
} from './src/action-stream.js';
export { stringify, parse, serialize, deserialize } from './src/serialize.js';
export { WebjsFrame } from './src/webjs-frame.js';
export { WebjsStream, renderStream } from './src/webjs-stream.js';

export interface OptimisticState<State, Action> {
  readonly value: State;
  add(payload: Action, promise?: Promise<any> | any): () => void;
}

// Declarative Signature with custom update reducer
export function optimistic<State, Action>(
  host: { requestUpdate?(): void },
  options: {
    source: () => State;
    update: (state: State, action: Action) => State;
  }
): OptimisticState<State, Action>;

// Declarative Signature with default replace reducer (Action = State)
export function optimistic<State>(
  host: { requestUpdate?(): void },
  options: {
    source: () => State;
  }
): OptimisticState<State, State>;


// Legacy Imperative Signature (Signal-based rollback)
export function optimistic<T, R>(
  signal: { get(): T; set(v: T): void },
  value: T,
  action: () => Promise<R> | R,
): Promise<R>;

