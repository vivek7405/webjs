# AGENTS.md for @webjsdev/core

The webjs **core runtime**: `html` / `css` tagged templates, the
`WebComponent` base class, isomorphic renderers, directives, the
client router, the `Task` controller, the Context Protocol, and
testing helpers.

Framework-wide rules (workflow, JSDoc-in-`packages/`, no-build,
commit conventions, autonomous-mode behaviour, scaffold rules)
live in the **framework root [`../../AGENTS.md`](../../AGENTS.md)**
and apply here. Read that first.

This file only covers what's specific to `@webjsdev/core`.

## Role

Shared by every webjs runtime path:
- Server (SSR via `renderToString` / `renderToStream`).
- Browser (fine-grained client renderer + hydration).
- Tests (`renderToString` + `fixture()` helpers).

The same `html` / `css` tag and the same `WebComponent` class produce
the same output in all three.

## Module map (`src/`)

| File | What it owns |
|---|---|
| `html.js` | `` html`` `` tagged-template → `TemplateResult`, plus `MARKER` and `isTemplate` |
| `css.js` | `` css`` `` → `CSSResult`, `adoptStyles`, `stylesToString` |
| `component.js` | `WebComponent` base class: lifecycle, properties, reactive accessors, light-vs-shadow DOM, scheduling, slot host wiring. On the server the base is a DOM shim (attribute methods backed by a Map, no-op events, inert `attachInternals`, `closest()` over the SSR ancestor chain, and the host IDL reflections `dataset` / `className` / `hidden` / `id` / `title` / `slot` / `role` / `tabIndex` / `aria*`); `performServerUpdate` runs the pre-render lifecycle (`willUpdate` + controllers' `hostUpdate` + reflection) for SSR. **Async render (#469):** `render()` may be async; when it returns a promise, `update()` routes to `_commitAsync` (stale-while-revalidate, a monotonic `__renderToken` race guard, rejection to the `renderError()` boundary) and `_performRender` defers the post-commit half (`hostUpdated`, `firstUpdated` / `updated`, `updateComplete`) until the commit lands via `_postCommit`. `renderFallback()` is the optional client re-fetch loading UI (re-fetch only, never first paint); `renderError()` is the per-component error boundary |
| `render-server.js` | `renderToString`, `renderToStream` (async, with Suspense streaming), SSR slot substitution in `injectDSD`. The walker seeds the server attribute shim from the source attributes, threads the enclosing-instance ancestor chain into each instance (so the shim's `closest()` resolves a parent), calls `performServerUpdate` before `render()`, and appends reflected/added attributes (including host attributes set inside `render()`) to the opening tag |
| `render-client.js` | Client-side patcher + hydration; the only file that touches `document`. Also discovers and binds light-DOM slot parts |
| `slot.js` | Light-DOM `<slot>` runtime, full native parity (#1021): `HTMLSlotElement` polyfills (`assignedNodes` / `assignedElements` / `assignedSlot` / `assign`), the ordered `authored` record + derived `assignedByName` (`repartition`), the single writer `applySlotAssignments`, per-instance method interception + the `RENDERING` window (`withRendererWrites`) + two read-only sensors for liveness, the parent-keyed prune rule, the unmatched-name park, first-wins resolution, fallback swap, and the `projectAuthored` router seam |
| `directives.js` | the lit-html-parity directive set (`unsafeHTML`, `live`, `keyed`, `guard`, `templateContent`, `ref` / `createRef`, `cache`, `until`, `asyncAppend` / `asyncReplace`, `watch`, plus each `is*` guard). `repeat` lives in `repeat.js`. All are re-exported from `index.js` / `index-browser.js` so the bare specifier and the `/directives` subpath (which collapses onto the dist browser bundle) expose the full set |
| `repeat.js` | `repeat(items, keyFn, templateFn)` for keyed list reconciliation |
| `suspense.js` | `Suspense()` page/region-level boundary primitive |
| `webjs-suspense.js` | The `<webjs-suspense>` component-level streaming boundary element (#471). SSR (`render-server.js`) does the work: `injectDSD`'s `processSuspenseElements` pre-pass reads `.fallback` (carried as `data-webjs-fallback` by `renderTemplate`, because this element is browser-defined, so the walk below finds no class for it and no server-side instance runs `consumePropAttrs`, which leaves `connectedCallback` as the only consumer of a normal `data-webjs-prop-*` binding, far too late for a placeholder that has to be in the first flushed bytes) and, in a streaming context, flushes the fallback as `<webjs-suspense id="sN">` while pushing the children to `ctx.pending` for out-of-order streaming (concurrent across boundaries via `Promise.all`); without a streaming context the children render inline (blocking). This client element is layout-neutral (`display:contents`) and the registration home for the soft-nav apply; first-load streaming needs no client runtime (the inline swap script `replaceWith`s the boundary element with the resolved children, which then upgrade). Every swap path (the inline script, the boot `__webjsResolve`, and the soft-nav `applyStreamedResolve`) removes the transient wrapper, so a boundary settles to the same DOM however the page was reached. SSR-inert (defined client-side only) |
| `context.js` | Context Protocol: `createContext`, `ContextProvider`, `ContextConsumer`, `ContextRequestEvent` |
| `task.js` | `Task` / `TaskStatus` controller for async data in components |
| `router-client.js` | Turbo Drive–style client router; entry: `enableClientRouter` / `navigate`. Also exports `loadFrame(frameEl, url)` (#253), the reusable frame self-load `webjs-frame.js` calls: it fetches `url` as a frame nav (the `x-webjs-frame` header) and applies the matched subtree through the SAME `fetchAndApply` frame-swap path a click uses (no history push / snapshot / optimistic skeleton, since it swaps one region). Post-swap activation of a boundary range goes through `activateSwappedRange` (#1102), the ONE place both tiers (`replaceBoundaryRange`, `swapMarkerRange`) reactivate scripts and upgrade custom elements. Two things it owns and a new call site must keep: it SNAPSHOTS the range before iterating, because `reactivateScripts` replaces a top-level script and a detached node cuts a live `nextSibling` walk (every later node in the range is then silently skipped); and `reactivateScripts` handles container-IS-a-script itself, since `querySelectorAll` never matches the node it is called on. A top-level script therefore re-executes on every swap of its range, INCLUDING one the keyed differ reused by `id`, matching what a descendant script in a reused container has always done. `data-webjs-permanent` splits into two cases and they must NOT be unified (#1252). The marked element IS a script: NEVER exempt, whether the walk reaches it as the container or as a descendant of one (the regraft selector has no tag filter, so a marked script IS preserved by identity and does land in the WeakSet, which is why the exemption is STRICT containment and never reflexive). The regraft also has a both-exist guard, so on the swap that first mounts a route there is no live node to preserve and exempting the inert parsed copy would leave a script that runs on a cold load and never on a soft nav, which is #1102 itself. Script INSIDE a preserved marked element: exempt, because the attribute is subtree-scoped (`diffElementInPlace` already returns early rather than recursing into one) and re-emitting an init script against an instance the author kept alive is a double-initialization. The filter keys on the `regraftedPermanents` WeakSet, which the two regrafts populate on every successful path, so it means ACTUALLY preserved by identity rather than merely carrying the attribute; an attribute-only filter would leave a first-mount permanent element's scripts never running at all |
| `webjs-frame.js` | The `<webjs-frame id>` custom element (a swap anchor; the router does the swap). Adds the `src` + `loading` self-load (#253): an eager (`connectedCallback`) or lazy (viewport, via `lazy-loader.js`'s `observeViewportOnce`) self-fetch through `router-client.js`'s `loadFrame`, with a per-element loaded-URL guard so eager connect / the lazy observer / a `src` mutation never double-fetch. SSR-inert (defined client-side only) |
| `webjs-stream.js` | The `<webjs-stream action target>` surgical-update element + `renderStream(payload)` (#248). The element self-applies its action on connect via native DOM (append / prepend / before / after / replace / update / remove against a `target` id or `targets` selector), cloning its single `<template>`, then removes itself. `renderStream(html)` parses a server payload and inserts the elements (they self-apply), so a live channel (`connectWS` / `broadcast`) reuses the SAME applier the HTTP path uses. `router-client.js` side-effect-imports this for app-wide registration and applies a content-negotiated `text/vnd.webjs-stream.html` form response through `renderStream` (sending the stream MIME in `Accept` only on a write, so a JS-off form degrades to a normal render). SSR-inert (defined client-side only) |
| `registry.js` | Custom-element bookkeeping (`register`, `lookup`, `allTags`, `tagOf`, `isLazy`, `primeModuleUrl`) |
| `lazy-loader.js` | IntersectionObserver-based lazy module loading for `static lazy = true`, plus `observeViewportOnce(el, cb)` (#253): a per-ELEMENT one-shot viewport callback (vs the per-tag module loader) reusing the same `rootMargin: '200px'` budget, used by `<webjs-frame loading="lazy">` to defer its self-load until the frame scrolls into view |
| `nav.js` | `notFound()`, `redirect()`, `forbidden()` (403), `unauthorized()` (401) sentinels for page/action handlers (#848) |
| `optimistic.js` | `optimistic()`, the optimistic-UI helper, in two shapes (#246, #799). DECLARATIVE (preferred): `optimistic(host, { source, update })` returns an `OptimisticState` whose `.value` is the merged view and whose `.add(payload, promise?)` queues an optimistic update that auto-releases when the promise settles. IMPERATIVE (legacy): `optimistic(signal, value, action)` sets the signal to `value`, awaits `action()`, and rolls back on a throw or an `ActionResult` `{ success: false }`. Both are re-exported from `index.js` + `index-browser.js` and classified in `component-elision.js` as a reactive (client-work) import |
| `action-stream.js` | Streaming RPC wire protocol (#489), isomorphic. The length-prefixed frame format (`[type:1][length:4 BE][payload]`, CHUNK / END / ERROR frame types, `STREAM_CONTENT_TYPE` = `application/vnd.webjs+stream`) shared by the server (which frames a streamed action result, `encodeFrame`) and the generated client stub (which decodes the body into an async iterable, `createFrameDecoder`, a stateful decoder buffering partial frames across network reads). Pure byte ops, no DOM / `node:*`, so it is safe in the browser bundle and on the server alike. An action that returns a `ReadableStream` / async iterable / async generator streams its chunks over one RPC response; each chunk is rich-serialized so a `Date` / `Map` / `BigInt` round-trips. Re-exported from `index.js` + `index-browser.js` |
| `action-seed-client.js` | Client consumer for SSR action-result seeding (#472): `takeSeed(hash, fn, argsKey)` (consume-once lookup, `SEED_MISS` sentinel) + `scanSeeds(root)` (ingest the page-level `#__webjs-seeds` JSON block and per-element `[data-webjs-seed]` carriers, stripping them). The generated RPC stub calls `takeSeed` before its `fetch`, so an async-render component's first client call resolves from the SSR seed instead of a hydration round-trip; `router-client.js`'s `applySwap` calls `scanSeeds` so a soft nav ingests seeds too. Ingest is LAST-write-wins (#1309): a hit DELETES its key, so a duplicate can only mean a later render seeded a key an earlier one left unconsumed, and the later render is the one on screen. That rule is only safe because a DETACHED root (what `applySwap` passes for a page navigation) makes `scanSeeds` STRIP the live document's leftover block WITHOUT ingesting it. A page whose async components all elided leaves one behind (the initial scan is lazy) and no swap removes it (it sits outside every boundary range), so left alone it is ingested LAST by the lazy scan and wins the keys both renders share, and a hit contradicts the paint. Discarding rather than re-ingesting also keeps the store bounded: those keys belong to elided components on a departed page, so nothing would ever consume them and only a hit deletes one. Stripping the DOM carrier is only half of it: a page carrying an elided component alongside a shipping one has its whole block INGESTED by the lazy scan the shipping one triggers, so those keys are in the store with no carrier left to strip, and an incoming page therefore also `seeds.clear()`s (everything still held is unconsumed by definition, since a hit deletes its key). A live root or live subtree is not an incoming page and never triggers either. Dev observability (#1309): `seedStats()` returns `{ ingested, replaced, hits, misses, keyMisses, pending }` (`keyMisses` being the PROVABLE subset of `misses`, a call for an action this page seeded under other arguments), and one `console.warn` fires at the first idle after a scan only when the cause is provable: a `streamed` or `drop` marker, where the server asserts no seed could ride, or a non-zero `keyMisses`. Any other miss is silent, because every action call routes through `takeSeed` including mutations and client-only reads that could never have been seeded, so it is not evidence of a defect; the server's `collected=0` states that case instead. Gated by the SERVER-stamped `data-webjs-dev` marker on the block rather than `process.env.NODE_ENV` (esbuild folds that to a constant here and `publicEnvShim` then inverts the guard). Each PAGE scan CLOSES the previous report window and opens its own, so a window measures exactly the page it was opened for. A `<webjs-frame>` swap runs through the same `applySwap` but is not a page navigation, so the router passes `scanSeeds(doc, { frame: true })` and the consumer leaves every bit of page state alone AND discards what it parses. It cannot infer this: `ssr.js` slices out a bare subtree only when the id was found and the render did not stream, and otherwise serves the WHOLE page, so a frame response is not reliably distinguishable from a page that seeded nothing. Discarding is right for every fallthrough shape, which are not all alike: a streamed render and a #241 cache hit both SWAP SUCCESSFULLY off a full page (the cached one carrying real seeds), while a missing id throws the response away. In each, the block describes the whole page rather than the region being swapped in, and the page on screen already has its own. Inert server-side (DOM access only inside `scanSeeds`). Re-exported from `index.js` + `index-browser.js` |
| `escape.js` | HTML attribute / text escaping (the only sanitiser) |
| `asset-url.js` | Isomorphic content-hashed asset urls (#1194): `asset(path)` returns `/public/x.css?v=<hash>` on the server and the path UNCHANGED in the browser, plus `setAssetUrlProvider` (server-only wiring, installed by `@webjsdev/server`'s `dev.js`). Same provider seam as `csp-nonce.js`, and the same scoping rule follows from it: call it from a page / layout / metadata route and INSIDE the render function, since a shipping component re-renders on hydration where no provider exists (the hashed url would be swapped for the bare path) and a module-scope call is a side effect that ships the module. `setAssetUrlProvider` is stripped from the browser surface. |
| `csp-nonce.js` | Isomorphic CSP nonce reader: `cspNonce()` (returns the request nonce, `''` in the browser) + `setCspNonceProvider` (server-only wiring). The provider is installed by `@webjsdev/server`'s `context.js`; as of #233 it returns a freshly-MINTED per-request nonce (not just an inbound-header parse). `setCspNonceProvider` is stripped from the browser surface |
| `rich-fetch.js` | Content-negotiated fetch helper |
| `websocket-client.js` | `connectWS()` with auto-reconnect |
| `serialize.js` | Wire-format primitives (Date/Map/Set/BigInt/cycles…) used by RPC |
| `testing.js` | `fixture`, `ssrFixture` (SSR + hydrate, awaits the native `updateComplete`), `waitForUpdate` (awaits `updateComplete` when present), `assertNoA11yViolations` (opt-in axe-core a11y assertion, dynamically imports the test-only `axe-core` peer), `click`, `shadowQuery`, `shadowQueryAll` |

## Public exports (re-exported from `index.js`)

Twelve entries in the [package.json `exports` field](./package.json) carry a
hand-written `.d.ts` overlay: the root `.` plus `/directives`, `/context`,
`/task`, `/client-router`, `/lazy-loader`, `/testing`, `/client`, `/server`,
`/component`, `/registry` and `/signals`. Everything else is exposed via the
main `index.js` re-exports. `exports` is the source of truth and the guard
below reads it directly, so a new subpath needs no edit here; keep the list
above readable when you add one.

**Every overlay behind a published `exports` entry must declare every
runtime named export of its sibling module** (the `index.d.ts` overlay
drifted badly once, #388: 35 missing). This is now enforced:
`test/types/dts-export-coverage.test.mjs` reads the entry list from this
package's own `exports`, imports each overlay's sibling `.js` for its real
runtime export names, and tsc-checks that the `.d.ts` declares them all, so
a new `export` in `index.js` OR in any subpath module (`src/directives.js`,
`src/signal.js`, the rest) without a matching declaration fails CI. It used
to check `@webjsdev/core` and two `@webjsdev/server` entries only, so all
eleven core subpaths could drift freely (#1291). When you add a runtime
export, add its declaration (re-export from the source module's `.d.ts`,
creating that `.d.ts` if absent).

**Prefix a test-only export with `_`.** A leading underscore marks a seam
that unit tests reach but the published API does not carry, and the coverage
guard exempts it, so it needs no declaration and never shows up in a
consumer's autocomplete. `src/router-client.js` keeps 63 of them in its
`Internal exports for unit testing` block. Without the prefix the guard
demands a declaration, and adding one publishes the seam as API.

**Type-only exports.** `index.d.ts` (the overlay) re-exports the
type-only public surface alongside the runtime exports. The component
typing lives in `src/component.d.ts`; the page-metadata typing
(`Metadata`, `MetadataContext`, and the nested shapes, including
`PreconnectHint` for the `metadata.preconnect` / `metadata.dnsPrefetch`
connection-warming hints, #243) lives in
`src/metadata.d.ts`; the typed page / layout / route-handler props plus the
opt-in route union (`PageProps`, `LayoutProps`, `RouteHandlerContext`, `Route`,
`RouteParams`, and the `WebjsRoutes` / `RouteParamMap` augmentation targets,
#258) live in `src/routes.d.ts`. The `webjs` package.json config-block typing
(`WebjsConfig` plus the nested `WebjsHeaderRule` / `WebjsRedirectRule` /
`WebjsCspConfig` / `WebjsTrailingSlash`, #259) lives in
`src/webjs-config.d.ts`; it mirrors the `@webjsdev/server` config readers and
the companion JSON Schema (`packages/server/webjs-config.schema.json`), and
those three MUST stay in lockstep (the procedure is documented in
`packages/server/AGENTS.md`). The opt-in server-action serializability guard
(`Serializable`, `SerializableArgs`, `SerializableResult`, `SerializableActionFn`,
`NonSerializable`, #488) lives in `src/serializable.d.ts`: it maps a fully
serializable type to itself and a non-serializable position (a function / method)
to a branded marker, so an author who annotates an action with
`SerializableActionFn` gets a compile-time error on a non-serializable arg /
return instead of a silent wire loss. All are pure declaration files (erased at
runtime, zero build cost). A page imports them with `import type { Metadata,
PageProps } from '@webjsdev/core'`. The `Metadata` and `PageProps` /
`LayoutProps` shapes MUST stay in lockstep with what
`packages/server/src/ssr.js` actually reads / constructs, never Next.js's
superset. `routes.d.ts`'s `WebjsRoutes` / `RouteParamMap` are EMPTY by default
(so `Route = string`); `webjs types` generates `.webjs/routes.d.ts` to augment
them per app.

## Package-specific invariants

1. **No build step in your edit-and-refresh loop.** `.js` only,
   plain JSDoc types. What you grep in `node_modules/@webjsdev/core/
   src/` is what served as source IS what runs when the browser
   fetches per-file. Workspace dev (this monorepo) serves per-file
   from `packages/core/src/` until you opt into the bundle by
   running `npm run build:dist --workspace=@webjsdev/core`.
   Published-to-npm copies ship pre-built `dist/` bundles alongside
   `src/`; the browser fetches them when `dist/` is present
   (`scripts/build-framework-dist.js` is wired to the `prepare`
   lifecycle so `npm publish` always rebuilds). The browser surface is
   ONE self-contained file, `dist/webjs-core-browser.js` (built with
   `splitting` off, so no `chunk-*.js`): it re-exports the whole browser
   API, so the bare specifier and the `/directives`, `/context`,
   `/task`, `/client-router` subpaths all resolve to it. `dist/` also
   carries `webjs-core.js` (the full Node surface), the on-demand
   `webjs-core-lazy-loader.js`, and the test-only `webjs-core-testing.js`.
   Only `@webjsdev/core` has this dual-layout. Other framework packages
   stay source-only. `index-browser.js` (and its `dist/webjs-core-browser.js`
   build) strip `render-server.js` and the three server-side setters
   (`setCspNonceProvider`, `setAssetUrlProvider`, `setFormActionResolver`)
   from the public surface. `packages/server/src/importmap.js` routes the
   bare specifier `@webjsdev/core` to that browser entry on the
   client side; Node-side consumers (SSR pipeline, framework
   internals, unit tests) keep landing on `index.js` via the
   package.json `default` condition and still see the full surface.
   `renderToString` / `renderToStream` are reachable from Node via
   the canonical `@webjsdev/core/server` subpath when an explicit
   import is desired.
2. **`html\`\`` returns an inert `TemplateResult`.** Templates don't
   touch the DOM until a renderer (server or client) consumes them.
3. **The renderer is the boundary between server and client.** Server
   code: `renderToString`, `renderToStream`. Client code: `render`.
   Never import client renderer code from server-only paths.
4. **Custom-element tags must contain a hyphen** (HTML spec). See
   `registry.js` `register()`. The framework convention validator
   enforces this.
5. **Reactive properties are declared via the base-class factory
   `extends WebComponent({ propName: Type })`** (the `prop()` helper
   carries options), with defaults set via the `default` option or the
   constructor, never class-field initializers (those clobber the
   framework's accessor under modern class-field semantics). A direct
   `static properties` block throws at runtime. See `component.js`, the
   `no-static-properties` rule, and `reactive-props-no-class-field`.
6. **New interactivity surfaces must update the elision analyser.**
   WebJs elides display-only component modules from the browser by
   static analysis (`packages/server/src/component-elision.js`). It is a
   conservative denylist of interactivity signals. When you add a new
   overridable lifecycle hook, reactive primitive, or client-only
   directive to core, add its marker to the matching exported list in
   `component-elision.js` (`CLIENT_LIFECYCLE_HOOKS`, `CLIENT_METHOD_CALLS`,
   or `REACTIVE_IMPORTS`). When you add a new template binding SIGIL,
   register it in core's `BINDING_PREFIXES`
   (`packages/core/src/binding-prefixes.js`, the single source both
   renderers read) and classify it in `component-elision.js` as a
   client-behaviour ship signal (`SSR_DROPPED_PREFIXES`, like `@event`,
   which drops at SSR) or an SSR-safe round-trip (`ROUND_TRIP_PREFIXES`,
   like `.prop` / `?bool`, which survives into the served HTML). When you
   add an interactivity STATIC field, add it to
   `INTERACTIVITY_STATIC_FIELDS`. Skipping any of these lets the analyser
   wrongly elide a component that now does client work. Two guard tests
   fail until the new surface is classified:
   `packages/server/test/elision/lifecycle-coverage.test.js` (prototype
   methods and hooks) and `.../sigil-coverage.test.js` (binding sigils and
   static fields, asserting the classification partitions `BINDING_PREFIXES`
   exactly).
   Note (#474): an `async render()` is NOT, by itself, a ship signal. A
   bare async leaf (no other client signal, light DOM) is elided like any
   display-only component, since SSR bakes its data into the first paint.
   It ships only on an independent signal (the lists above, an `@event`, a
   non-`state` prop, a `<slot>`, cross-module observation, an interactive
   child) or one of the two static carve-outs in the
   `INTERACTIVITY_STATIC_FIELDS` registry: `static shadow = true`
   (Declarative Shadow DOM must re-attach on a client-side DOM insertion)
   and `static interactive = true` (the explicit author override that
   forces a ship when the analyser cannot see a component's interactivity
   statically). `renderFallback` stays a ship signal via
   `CLIENT_LIFECYCLE_HOOKS`.

7. **`<slot>` works identically in light and shadow DOM, through the
   NATIVE DOM API. No WebJs-specific slot methods.** Light-DOM slots get
   the full shadow surface: named + default slots, fallback content,
   first-wins resolution, dynamic `name=${...}`, LIVE post-mount writes
   (`appendChild` / `insertBefore` / `removeChild` / `el.remove()` /
   `innerHTML` / `el.slot=` flips / `HTMLSlotElement.assign()`), and the
   reads (`assignedNodes` / `assignedElements` / `{flatten}` /
   `assignedSlot` / `slotchange`, with native async-coalesced slotchange).
   Flip `static shadow` and nothing else changes. A FORWARDED slot (a
   template forwarding `<slot>` into a nested component) projects its
   content on the client and through hydration (#1023): the renderer
   stamps each slot with its template owner (`SLOT_OWNER`), carried across
   SSR as `data-wj-slot-owner`, so a forwarded slot routes to the OUTER
   host that rendered it. The core invariant that
   keeps this robust (unlike the pre-#1016 third-writer observer that
   caused the #906 / #1006 / #994 cascade): the component's renderer is the
   ONLY actor that moves authored nodes into slots (`applySlotAssignments`);
   `authored` is the ordered source of truth, `assignedByName` is derived
   (`repartition`), and liveness re-runs that one writer via per-instance
   method interception + a renderer-write window + two read-only sensors +
   a parent-keyed prune rule + a self-heal resync (a parent hole or a
   library writing inside an assigned container is folded back into the
   record with node-scoped order authority, never destroyed). One caveat
   rides `assign()` specifically. The light-DOM `assign()` is an extension
   (element-bound overlay; native shadow `assign()` needs slotAssignment
   `manual`, which WebJs does not set), so avoid `assign()` in a component
   meant to flip modes. The runtime gates every polyfill on the
   `data-webjs-light` attribute, so real shadow-DOM slots are untouched.
   SSR (`injectDSD`) projects light-DOM children into the rendered template
   before the response, so PE and JS-disabled clients see the content.
   Four inherent gaps, all from light DOM having no shadow boundary: structural
   host reads (`host.children` / the `innerHTML` getter show the rendered
   template), `assignedChild.parentNode` is the `<slot>`, `::slotted()`
   CSS (use normal selectors), and initial-projection lifecycle timing
   (`firstUpdated` sees the `<slot>` element with EMPTY `assignedNodes()`;
   the projection lands one microtask later, so read assigned content from
   `slotchange` or after a microtask; shadow DOM projects natively before
   `firstUpdated`). A layout's `${children}` rendered inside a slotted
   shell keeps its NAMED slots in sync across a soft-nav swap too (#1024):
   the boundary swap resyncs every own slot of the enclosing host from the
   incoming parsed doc, not just the default slice. When you add a slot
   behaviour, extend
   the light-vs-shadow CONTRAST tests in
   `packages/core/test/slots/browser/slot.test.js` (the same component
   asserted in both modes) so the parity claim stays proven.

## Tests

Tests for this package live in **`packages/core/test/`**,
organised by feature: `signals/`, `rendering/`, `directives/`,
`slots/`, `lifecycle/`, `context/`, `task/`, `suspense/`,
`routing/`, `serializer/`, `styling/`, `registry/`, `nav/`,
`websocket-client/`, `rich-fetch/`, `seed/`. Each feature folder has a
`browser/` subfolder when there are real-browser tests for it (run on
Chromium, Firefox, and WebKit via web-test-runner).

A browser test that clicks a real `<a href>` or submits a real `<form>`
MUST install the shared guard from `test/browser-nav-guard.js`
(`installNavGuard()`, returning `{ fallbacks, hardNavigations, remove }`). web-test-runner
aborts the whole session when the page navigates, so an escaped click
takes down every browser file rather than failing one test. The guard
listens on `window` in the BUBBLE phase, which is load-bearing: capture
would set `defaultPrevented` before the router's document-level listener
runs, and `onClick` returns on that flag, so every guarded router test
would pass while testing nothing. Full rule in
[`references/testing.md`](../../.agents/skills/webjs/references/testing.md).

The guard also covers the SECOND channel, the router's own hard navigation on
a degradation. `preventDefault` cannot cancel a script assignment, and
`location.href` is non-configurable on all three engines so its setter cannot
be redefined, so `router-client.js` routes every hard navigation through one
`hardNavigate` indirection with a `setHardNavigate(fn)` seam. The guard
installs an override that records the attempt into `hardNavigations` instead of
performing it, so a degradation fails one test with its `cause` slug rather
than aborting the whole session. `setHardNavigate` is TEST-ONLY and is
deliberately not re-exported from `index.js` / `index-browser.js`; tests reach
it through the same direct `src/router-client.js` import they already use.

There is exactly ONE sanctioned exception to the MUST above, and it holds only
when BOTH halves are true: the submission being measured cannot navigate at
all, AND the test is measuring a native default action that the guard's own
`preventDefault()` would cancel. Rung 7 of the submit bail ladder
(`test/routing/browser/submit-bail-ladder.test.js`) is the case it was written
for: a `method="dialog"` submission dismisses its `<dialog>` instead of
navigating, and asserting `dialog.open === false` is the whole point of the
test, so a guard there would cancel the very effect under test. A test taking
the exception owes the second channel separately, because the exception buys
out only the `preventDefault` half: that file holds a `setHardNavigate`
recorder for its whole lifetime and re-arms it after each guard is removed,
since an async swap from a NEIGHBOURING test can degrade during the unguarded
one and a real page load there aborts the session. It did, on Firefox, before
the recorder was added. If either half of the condition fails, install the
guard.

Cross-package tests that exercise core through the SSR pipeline
or scaffolds live at the repo root in `test/ssr/`,
`test/scaffolds/`, etc. See [`references/testing.md`](../../.agents/skills/webjs/references/testing.md).

Run `npm test` from the repo root for node tests, `npm run test:browser`
for the browser tests.

---

Framework-wide rules and full API reference:

@../../AGENTS.md
