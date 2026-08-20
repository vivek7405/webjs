# Client Router and Streaming

## What This Covers

- The automatic client router (SPA-style partial swaps), how it opts out, and programmatic `navigate()` / `revalidate()` / `refreshPage()`.
- Link prefetch with device-adaptive defaults.
- `<webjs-frame>` partial-swap regions (WebJs's Turbo Frames).
- View Transitions opt-in.
- `<webjs-stream>` surgical element updates (WebJs's Turbo Streams) and streaming RPC results.
- `Suspense` page-level streaming and `<webjs-suspense>` component-level streaming.
- WebSockets (`connectWS`, the `WS` route export, `broadcast()`).
- The opt-in navigation-loading indicator.

Read this when a task touches client navigation, prefetch, partial-page swaps, streaming, or realtime. For the components that render inside these regions (async render, `renderFallback()`, signals) see `components.md`. For the server actions these features call see `data-and-actions.md`.

## The Client Router

The router auto-enables the moment `@webjsdev/core` loads in the browser, which is any page that ships a component. There is nothing to import or opt into. It intercepts same-origin `<a>` clicks (including inside shadow DOM), fetches the target HTML, and replaces only the inside of the deepest shared layout. Outer header, sidenav, and footer DOM is never re-rendered, so scroll positions, input values, and `<details>` state survive a navigation.

**The nav parse must preserve comments.** SSR wraps each layout's children AND the page itself in a KEYED boundary comment pair (open `<!--wj:children:<segment>:<route-key>-->`, close `<!--/wj:children:<segment>-->`, #1015). The route-key is the region's resolved concrete path with each substituted param value percent-encoded (so a user-controlled value can never terminate the comment or collide with the `:` delimiter). The router STRICTLY scans both the live and incoming DOM into segment maps: a close must id-match its innermost open, and ANY truncation, mispair, duplicate, or legacy anonymous open poisons the whole scan. The swap decision is two-tier with Next.js remount parity: a CHANGED route-key REPLACES (a fresh remount, permanents regrafted) at the PARENT of the shallowest changed boundary (a layout's boundary wraps only its children, so its own param-derived markup lives in the parent's range; anchoring there remounts the layout chrome too, exactly like Next re-rendering the layout with new params), else MORPH (the keyed state-preserving reconcile) at the deepest shared boundary when it is the leaf on both sides. The X-Webjs-Have header carries `segment:route-key` entries so the server re-renders (and re-ships) a dynamic layout the client holds for other params instead of short-circuiting past it. A poisoned scan or no shared segment degrades to a FULL PAGE LOAD (dev logs the cause), never a guessed recovery, so silent DOM corruption is structurally impossible. Hydration keys off another comment (`<!--webjs-hydrate-->`, which `__isHydrating()` reads as a component's first child). So the router and hydration both ride on comments SURVIVING the parse that turns a navigation response into a Document, which makes that parse a load-bearing correctness boundary rather than an implementation detail.

`Document.parseHTMLUnsafe` STRIPS every comment in Chromium 150 (#1007). No other parse API does: `DOMParser`, `setHTMLUnsafe`, `template.innerHTML`, and plain `innerHTML` all preserve them, and so does the document's own navigation parser, which is why a hard refresh always looked correct and only soft nav broke. With the boundaries gone the router degrades to a full page load (correct, just not soft); with `webjs-hydrate` gone a slotted light-DOM component misses the hydration adopt path. `parseHTML` therefore PROBES `parseHTMLUnsafe` once for losslessness instead of sniffing versions, uses it when it is lossless (it is the only single-pass API that also processes Declarative Shadow DOM), and otherwise parses with `DOMParser`, which preserves comments. A fixed browser silently returns to the fast path.

On that fallback, Declarative Shadow DOM is left UNPROCESSED (`DOMParser` does not attach it), a deliberate limitation tracked in #1011, because both ways of adding it back are worse than the gap. Re-serializing via `body.setHTMLUnsafe(body.innerHTML)` is not idempotent (Chromium omits the spec's LF-compensation, so a leading newline in `pre` / `textarea` is silently eaten, which in a `textarea` is form-data corruption), and attaching each root by hand yields a NON-declarative root, which makes any element whose constructor unconditionally calls `attachShadow()` throw `NotSupportedError` on upgrade. The gap costs a JS-less DSD-dependent element its shadow content on a full-body-swap nav, on a stripping browser only; a `static shadow = true` component attaches and renders its own root on upgrade, and a soft nav runs JS by definition.

Note for anyone testing this: **the Chromium web-test-runner currently resolves (148) is LOSSLESS, so CI cannot observe the bug at all** (and `playwright` is a caret range, so that version moves on any dependency refresh). A test that merely asserts "markers survive" passes there whether or not the fix exists. The guard in `packages/core/test/routing/browser/comment-preserving-parse.test.js` SIMULATES a stripping parser so it is provable on every engine.

**There is NO dropped-marker recovery (#1015 replaced #994's).** The pre-#1015 router "recovered" an orphaned open marker by guessing where its children ended (bounded by the other side's trailing-sibling count), which could guess wrong and corrupt silently. Keyed closes make a mispair DETECTABLE instead, and every integrity violation now degrades to a bounded, correct full page load. The historical producers of lost comments (our own comment-stripping parse #1007, mid-parse soft navs #1008) are fixed upstream, so the degradation is a rare backstop, not a common path. Wrapping `${children}` in a container element (the shipped idiom, `<main>${children}</main>` with the footer a sibling outside it) remains a fine layout pattern, though no correctness now depends on it.

**Opting out.** App-wide with config, or per moment at runtime.

```jsonc
// package.json
{ "webjs": { "clientRouter": false } }
```

```js
import { disableClientRouter, enableClientRouter } from '@webjsdev/core';
disableClientRouter();   // stop intercepting document <a> / <form> (plain links resume full loads)
enableClientRouter();    // turn soft navigation back on
```

`disableClientRouter()` / `enableClientRouter()` are a runtime pair that toggle only the document-level `<a>` / `<form>` interception. An explicit `navigate(url)` call still does a soft navigation either way (it is not gated by the toggle).

Per link, opt out with `data-no-router` (auth flows like `/logout`, OAuth redirects, print views, an experimental route with a different runtime). Cross-origin hrefs, `download`, a non-`_self` target, pure same-page hash jumps, and non-HTML extensions are auto-skipped.

**Programmatic navigation and cache eviction.**

```js
import { navigate, revalidate } from '@webjsdev/core';
await navigate('/about');                     // push history
await navigate('/login', { replace: true });  // replace history
revalidate('/products/123');                  // evict one URL from the snapshot cache
revalidate();                                 // clear the entire snapshot cache
```

The router keeps a URL-keyed snapshot cache (LRU, cap 16) so Back/Forward restores instantly, then refetches in the background. Call `revalidate(path)` after a server action mutates data a cached page depends on. Wire bytes are minimized by an `X-Webjs-Have` header, so the server returns only the divergent layout fragment. Concurrent navigations abort the prior in-flight fetch, and scroll is restored on Back/Forward. The popstate an in-page fragment CLICK produces is absorbed rather than re-navigated (#1437), so an anchor click restores nothing and re-fetches nothing, the repeat click of one anchor included (that one REPLACES its entry rather than pushing, so it arrives with the url unchanged). The gate is PROVENANCE, the router marking the click it bowed out of and the next popstate consuming that mark, rather than any comparison of urls: a Back between two entries differing only by fragment can still need a re-render, because `getSubmitAction` prefers the raw `action` ATTRIBUTE and that carries no fragment, so a bound-submitter form declaring `action="/p"` pushes its 422 re-render at `/p` while the reader sits at `/p#sec`. A popstate with no click behind it therefore stays on the normal path, which means an ordinary Back or Forward between two fragment states still re-renders. Telling those apart would need to know whether the DOM was replaced between the two ENTRIES, which is per-entry state the router does not keep.

**In-place refresh of the page you are on.** `refreshPage(mode)` re-renders the CURRENT url on the server and applies it without a page load.

```js
import { refreshPage } from '@webjsdev/core';
await refreshPage();          // 'page': morph the deepest shared boundary
await refreshPage('shell');   // replace the whole body (the layout's own markup changed)
```

It records no history entry and never scrolls, so the reader keeps their place and Back still goes to the previous page. `'page'` morphs the deepest shared boundary, so the outer layout's DOM and the hydrated state of its components survive; `'shell'` replaces the whole body, which is what a LAYOUT change needs, since a layout's own header, nav, and footer sit outside every children range and a boundary morph would leave them untouched. Component instances do not survive a `'shell'` refresh.

It sends no `X-Webjs-Have`, deliberately: the server short-circuits at the first layout the client already holds, and a same-url request matches every one of them, so the response would omit the very layout that changed. It resolves `false` when it did not apply (the router is disabled, or the fetch failed), so a caller falls back to a full load.

It does NOT reload changed component modules and cannot: `customElements.define` is once-per-tag and a module url is fetched once per document. A caller whose change touched browser code has to reload. This is exactly why the dev live-reload client calls `refreshPage` for a page or layout edit and `location.reload()` for a component edit (#1398, and see `references/runtime.md` for which dev modes get the refresh).

**Back/Forward scroll restore vs late layout growth.** The router SUPPRESSES the browser's scroll anchoring (`overflow-anchor`) for the duration of a Back/Forward restore, then puts it back. The saved offset was recorded against the page at its SETTLED height, while the DOM the restore swaps in is still shorter until its components upgrade and render. Without the suppression the browser treats that late growth as content appearing above a reader and adds it to the offset the router just replayed, so the reader lands BELOW where they left (the reported case was 763px, exactly the height a page gained after its swap). What follows for an app:

- **Do not write your own scroll restore.** A `popstate` listener that calls `scrollTo`, a saved offset in `sessionStorage`, a `scrollIntoView` on a remembered element: all of them fight the restore, which is the BROWSER's (see the next bullet) and which the router protects with a suppression window while the page settles. If Back lands in the wrong place, that is a framework bug to report, not something to patch in app code.
- **The BROWSER restores Back/Forward scroll, not the router, and an app must not set `history.scrollRestoration = 'manual'`** (#1428). The router FORCES `history.scrollRestoration` to `auto` on start (and puts the app's own value back on `disableClientRouter()`), so setting `'manual'` yourself does not take effect while the router runs. Under `auto` the browser records a scroll position per history entry, replays it on a traverse, and composes the iOS edge back-swipe GESTURE PREVIEW from that same recorded state. The router writes no scroll on a restore at all: it reserves the recorded height (below) so the browser's replay lands on a document that can hold the offset, and that is the whole mechanism. One writer, the same model Next and Remix 3 use. Taking `manual` suppresses the recording, so every scrolled page previews BLANK for the whole gesture. That is what the router itself used to do, inherited from Turbo Drive's `assumeControlOfScrollRestoration`, and it is why Turbo still previews blank the same way: Turbo is single-writer too, but the writer is the APP. An app that sets `manual` re-breaks the preview app-wide.
- **An app that sets `overflow-anchor` on `<html>` itself sees it overridden during a restore and restored afterwards**, including a value set inline by your own script. Setting it in a stylesheet is unaffected between restores. Nothing else on the page is touched, and the router never sets `overflow-anchor` anywhere but the root element.
- **A new PAGE navigation ends an open window.** The window outlives its own restore on purpose (a floor, then a ceiling), so a page navigation or a page-level form submission starting inside that span closes it first, and reopens only if it earns one. Otherwise a second Back, or a click, would inherit suppressed anchoring on a page it was never meant for. A FRAME-TARGETED navigation or submission is the exception, on exactly the rule that decides frame targeting everywhere else (the enclosing frame, an explicit `data-webjs-frame="<id>"` from anywhere, or the frame's own `src`; `_top` and an unresolvable id are page navigations and do close the window). It swaps one region and leaves the page, and so the restored offset, intact, so it leaves the restore running. Closing there would hand anchoring back mid-restore and bring the double count straight back, and it needs no user input to happen, since a component upgrading in the just-restored page can drive a frame on its own.
- **The recorded HEIGHT is reserved across the restore, so the offset is always reachable.** A snapshot records the page's settled `scrollHeight` alongside the offset, and the restore holds that height on the root element until the page has filled in. Without it the swapped-in markup is briefly shorter than the page it came from, the browser clamps the restore to whatever the short document allowed, and the reader lands short. The reservation removes that window rather than correcting for it afterwards, which is what retired the older catch-up that used to chase the offset as the page grew. It is released on the same settle that closes the anchoring window, on the same ceiling, and when another navigation supersedes the restore, but never on user input: releasing the height under a reader mid-scroll is the one harm an early release could do. An app's own inline `min-height` on the root is saved and put back, the same contract the anchoring window keeps.
- **The window closes on the first real input** (`wheel`, `touchmove`, `keydown`, `pointerdown`), so a reader who starts scrolling mid-restore immediately gets normal browser anchoring back. Absent that it closes once the restore is over, which is the LATER of the restore's own background revalidation settling and a short floor, and at the latest on a 2s ceiling. The floor is load-bearing: waiting on the revalidation alone ties the window's length to network latency rather than to the growth it guards, so a server answering faster than the page renders would close it early and the reader would land low again. Suppression only ever WITHHOLDS a browser correction, it never moves the viewport, so it cannot yank someone who has taken over.

Components that reach their final size only after they render (a chart, a media embed with no intrinsic dimensions, anything sized from measured content) are exactly the shape that triggers this, and they need no special handling: give them a placeholder height where you can, and let the router own the restore.

**Error recovery.** A 2xx/3xx swap applies in place, and an HTML error body of any status (a 422 re-rendered form, a 5xx error page) is ALSO applied in place with no reload. For a non-HTML error or a transport failure the router dispatches a cancelable `webjs:navigation-error` on `document` (detail `{ url, status, error }`). Call `preventDefault()` to own recovery, otherwise the router renders a minimal in-place alert into the layout slot.

```ts
document.addEventListener('webjs:navigation-error', (e) => {
  e.preventDefault();
  showToast(`Could not load ${e.detail.url} (status ${e.detail.status})`);
});
```

**Observing a degradation.** Some conditions make a soft nav impossible, and the router then degrades to a full page load rather than risk a corrupt DOM (the #1015 integrity model). Every such path dispatches `webjs:navigation-fallback` on `document`, in ALL environments including production, with `detail { cause, href, willReload }`. Causes: `no-shared-boundary`, `live-boundaries-malformed`, `incoming-boundaries-malformed`, `readyState-loading`, `deploy-mismatch`, `deploy-mismatch-reload-suppressed`, `navigation-error-unrecoverable`, `revalidation-discarded`, `pre-boot-navigation`. `willReload` is false for a degradation that does NOT reload (a dropped background revalidation), so a listener can tell "this click became a document load" from "a background op was skipped". Not cancelable: by the time it fires the degradation is the only safe option. In dev a deduped console warning also prints.

```ts
document.addEventListener('webjs:navigation-fallback', (e) => {
  // A full document load on a click is a UX regression worth knowing about in prod.
  if (e.detail.willReload) analytics.track('router_full_load', e.detail);
});
```

**`pre-boot-navigation` reports ABOUT a load, not during one (#1118).** The boot is a module script, which the HTML spec defers until parsing finishes, while the links it will intercept are clickable from first paint. A click in that window is a plain browser navigation, and the ARRIVING document reports it with `willReload: false` (the load already happened). The window is a few tens of milliseconds warm and network-sized on a cold, throttled first visit, which is why `@webjsdev/core` is hinted in the head with `<link rel="modulepreload">` (emitted only when the page actually ships a boot module) instead of being discovered a round trip later. Read the cause as a RATE: the check knows only that this document arrived by a same-origin navigation that was not a soft nav, so a `data-no-router` link, a `target="_blank"` open, a cross-document form post, and a `clientRouter: false` app all land here too. Excluded: a reload, a back/forward restore, an external or typed entry, and a full load the router itself chose (already reported under its own cause). The report rides the router's own boot, so a fully elided page that ships no client runtime reports nothing.

**Form state.** A form submitting through the router gets `aria-busy="true"` for the in-flight duration, plus bubbling `webjs:submit-start` and `webjs:submit-end` (detail `{ form, url, ok }`) events. Style `form[aria-busy="true"]` in pure CSS or listen for the events.

**Inline scripts in a swapped range re-execute, so write them to be re-runnable (#1102).** A script the swap brings in runs again on every navigation that swaps its range, whether it sits inside the swapped content or is a top-level node of the range itself (a layout emitting its enhancement script as a sibling of `${children}`). A script parsed out of the response carries the HTML spec's already-started flag and is inert, so the router replaces it with a fresh clone, and the clone is what runs; the clone carries the page-load CSP nonce rather than the one the response was rendered with. Giving the script an `id` does NOT make it run once: the keyed differ reuses the live element and the router still re-emits it. So a script that installs a listener or a `MutationObserver` must be idempotent or guard on a flag it sets the first time. The alternative default, running once and then never again, is the failure this replaced (a progressive-enhancement highlighter that stopped working after the first soft nav). When work genuinely must happen once, put it in the ROOT layout, whose markup is never swapped. `data-webjs-permanent` splits into two cases (#1252). A script that IS the marked element is re-emitted like any other, so the attribute is not an escape hatch for a script itself: its regraft only fires when the node exists on both sides, so exempting it would leave a script that runs on a cold load and never on a soft nav. A script INSIDE a marked element the swap actually preserved is left alone, because the attribute is SUBTREE-scoped and that node survived by identity. The exemption is conditional on real preservation, so a permanent element arriving for the first time, or one with no `id` (which can never be regrafted), still runs its scripts.

## Link Prefetch

Same-origin in-app links prefetch speculatively so a click resolves from a warm cache. A reduced fragment is served `private`, so no shared cache can store it even if the CDN ignores `Vary` (Cloudflare honours only `Accept-Encoding`); the `Vary: X-Webjs-Have` marking stays as belt-and-braces rather than as the guarantee (#1140). A full document keeps whatever `metadata.cacheControl` declared, so page-level edge caching is unaffected. Router fetches (navigation and prefetch alike) are sent with `cache: 'no-cache'`, so a page cached in the browser with a `max-age` is revalidated rather than replayed: the deploy check reads `x-webjs-build` / `x-webjs-src` off these responses, and a cached response would hand it pre-deploy ids and hide a deploy for the whole freshness window (#1131). The revalidation is answered with a cheap 304, so the cost is a conditional round-trip rather than a re-download: on a page that opted into caching a fragment is `private` but still carries a validator, since `private` forbids only SHARED storage and has no bearing on whether a response can be validated (#1140); a default `no-store` page has nothing to validate either way. On by default, no per-link opt-in needed. The default strategy is DEVICE-ADAPTIVE, because one strategy cannot serve both input modalities. On a hover-capable fine pointer the default is `intent` (warm on hover/focus after a ~100ms dwell). On touch the default is `viewport` (warm as links settle on-screen), because touch has no hover. Modality is detected with `matchMedia('(hover: hover) and (pointer: fine)')`, never a UA sniff.

Override per link with the `data-prefetch` attribute.

```html
<a href="/dashboard">adaptive default (intent on pointer, viewport on touch)</a>
<a href="/dashboard" data-prefetch="intent">hover / focus / touch</a>
<a href="/dashboard" data-prefetch="render">eager on insert</a>
<a href="/dashboard" data-prefetch="viewport">on scroll into view</a>
<a href="/dashboard" data-prefetch="none">never</a>
```

Next-style aliases work (`true` = `render`, `auto` = `viewport`, `false` = `none`). `viewport` uses an IntersectionObserver at threshold 0.5 with a ~250ms dwell, cancelled the instant a link scrolls back out, so a fast scroll spends no requests. Speculation is bounded by a concurrency cap, in-flight de-dupe, and an LRU + TTL cache, and is disabled entirely under `Save-Data`, `prefers-reduced-data`, or a 2g connection. The guiding rule is snappy but never at the cost of bloating the network tab, so when the two conflict the gate under-fetches.

A prefetch issues a real GET, so any mutating endpoint MUST be a POST or a `<form>` submission (which the router never prefetches), never a GET link. A `webjs:prefetch` event fires on `document` when a fragment lands in the cache.

**The cache is ANCHOR-VALIDATED, not just URL-keyed (#1114).** A prefetched fragment is a reduced response: the request carries `X-Webjs-Have` (the boundaries the client already holds) and the server returns only the divergent part from the deepest boundary it short-circuited on. That boundary is the fragment's ANCHOR, and the fragment applies to any live DOM that still offers it with the same route-key. So on consume the router checks the anchor, not the whole `have` string: a root-anchored fragment survives an unrelated navigation and stays a cache hit, while one anchored at `/docs` is discarded once you leave /docs, because applying it would hand the swap a tree sharing no boundary with the live DOM, which correctly degrades to a full page load. A discard costs one round-trip. The router also never prefetches the page it is already on (#1106), since that request cannot serve any later navigation and only occupies a capped cache slot; a hover's intent timer routinely fires after the click it belongs to has already swapped, which is when that happens. Both behaviours are internal; nothing to configure.

**The cache also carries a FRAME dimension (#1407).** A link that drives a `<webjs-frame>` is prefetched with the same `X-Webjs-Frame` header its click will send, so the cached body is the frame subtree the swap actually needs and the click resolves with no round trip. The server marks that sliced response `X-Webjs-Frame: <id>` on the way out, and varies on the request header, so the cache keys the entry by URL plus frame id: a page fragment can never be applied into a frame region, nor a frame subtree into a page swap, and each dimension is a separate entry for one URL. A frame entry is validated differently from a page one, because a subtree carries no boundary comment to anchor on: what has to hold is that a live `<webjs-frame>` with that id is still in the document, checked at consume time. Two responses are refused outright. A body answering a framed request WITHOUT the server's marker is a whole document (a streamed render skips the slice, and so does an id absent from the output), so it is discarded rather than stored under either key. The REFUSAL is remembered though, in a small memo kept outside the fragment cache, so a link on a streaming route re-asks about once per TTL instead of on every hover, without occupying a cache slot a real fragment could use (that memo set is itself capped, so a page with many distinct refused frame links can re-ask sooner). Only a detected deploy or an in-place `refreshPage` drops those memos early, since those are the two moments the SOURCE can have changed. `revalidate()` leaves them, because it is the post-mutation api and clearing there would drop every memo on every write; a mutation CAN change a render's streamed shape (a page may render `Suspense` conditionally on fetched data), but a memo that outlives that costs one skipped warm-up for that key until the TTL runs out, which is the cheaper side of the trade. And a framed link pointing at the URL the page is already on is a frame refresh, which must show fresh bytes, so #1106 excludes it in its own dimension.

One consequence to know when reading a network tab: dedupe is per dimension, so a page holding TWO links to one URL, one driving a frame and one not, warms both and issues two speculative requests where it previously issued one. That is not redundancy, since the two responses genuinely differ and a click on either link needs its own; suppressing one would leave whichever link lost unwarmed ahead of the click, which bites hardest on touch, where `viewport` is the default and the only thing left is the `touchstart` warm at tap time. Both stay inside the same cache cap, concurrency gate, TTL, and `Save-Data` gate as every other prefetch, and the change adds no new trigger and no per-link fan-out.

## `<webjs-frame>` Partial-Swap Regions

`<webjs-frame>` is WebJs's take on Turbo Frames, so most `<turbo-frame>` muscle memory transfers. It is a lazy, URL-addressable region that swaps on its own, driven by a link or form targeting its id, and it ships zero component JS. Use it for a region that loads or refreshes INDEPENDENTLY of a full-page navigation (a marketing widget, tabbed UI, a filtered results panel), which a page or layout cannot express.

```ts
html`<webjs-frame id="activity">…contents…</webjs-frame>`
```

On click the router walks `closest('webjs-frame')` from the target. If a frame is found and the response carries a matching `<webjs-frame id>`, the swap is scoped to that frame's children, and the server returns ONLY that subtree. A link that drives a frame participates in link prefetch like any other, in that frame's own dimension (#1407), so a hovered or viewport-warmed frame link swaps on click with no round trip. A `<webjs-frame src>` SELF-load is the exception: it neither reads nor keeps that cache, since asking a frame to load its own src is a freshness request rather than a hover being followed. See the prefetch section above for the frame dimension's rules.

**A frame swap never moves the window scroll.** A page navigation scrolls to top, the way a browser does; a frame swap changes one region and leaves the rest of the document standing, the reader's scroll offset included. That holds for a nested link, an external `data-webjs-frame` trigger, a frame-targeted form submission, and a `src` self-load alike, and it holds for a `#hash` on a frame link too, which rides the URL without moving the viewport. It does NOT cover a pure fragment link whose path and query match the page it sits on, because the router never sees one: the click handler bows out before `preventDefault`, so the browser does its own native fragment jump and the window moves.

**Every spelling of a fragment link is the browser's, the bare `#` included** (#1437). `href="#"` is the back-to-top idiom and it serializes with an EMPTY fragment, which reads identically to no fragment at all through `URL.hash`, so the bow-out tests the `href` for a `#` instead. A `<a href="#">Back to top</a>` therefore scrolls to top natively, inside a frame as well as outside one. `href=""` is NOT a fragment link: it resolves to the current url with the fragment REMOVED, which the spec reloads rather than jumps, so the router navigates it like any other link.

The escapes are page navigations and DO scroll: `data-webjs-frame="_top"`, and an id `resolveTargetFrameId` cannot match to a live frame, which warns and degrades to a normal nav. Do not read that second one as covering a RESPONSE that lacks the requested frame (the `webjs:frame-missing` warning). There the frame resolved and the nav stayed frame-scoped, so the offset holds and only the panel is left unchanged. Turbo's `autoscroll` opt-in, which scrolls the frame itself into view on swap, has no WebJs equivalent; the router simply never writes scroll for a frame.

**Read "never moves" as "WebJs never writes one", not as a guarantee the viewport cannot move.** A swap that makes the panel SHORTER shortens the document with it, and a reader parked near the bottom is then holding an offset the document can no longer reach, so the browser clamps it. Measured on the gallery's frames demo: filtering from All to Done at the bottom of the page moves the window from 474 to 405, exactly the 69px the document lost. The router wrote no scroll there (verified with every scrolling API instrumented), and any DOM change that shortens a page does the same thing. Keeping the frame a stable height across its states avoids it entirely.

**External targeting.** A trigger does not have to be nested inside the frame. An `<a>` or `<form>` carrying `data-webjs-frame="<id>"` drives that frame from anywhere (an explicit `data-webjs-frame` wins over the enclosing-frame default). `data-webjs-frame="_top"` is a reserved token forcing a full-page navigation that breaks out of the frame.

**Self-loading.** Give a frame a `src` and it self-fetches (through the same swap path).

```html
<webjs-frame id="rail" src="/widgets/rail"></webjs-frame>            <!-- eager on connect -->
<webjs-frame id="comments" src="/posts/42/comments" loading="lazy">  <!-- fetch on viewport entry -->
  <p>Loading comments...</p>
</webjs-frame>
```

A `src`-driven frame is JS-DEPENDENT (the browser does not natively fetch `<webjs-frame src>`), so use it for DEFERRED content where a JS-off placeholder is acceptable. For content that must exist without JS, render it server-side into the frame. A frame's route can itself use `<webjs-suspense>` to stream slow data behind a fallback. Frame events: `webjs:frame-busy` (both edges, `aria-busy` set for free) and a cancelable `webjs:frame-missing` when the response lacks the requested frame.

## View Transitions (opt-in)

The router can wrap a navigation's DOM mutation in the native View Transitions API so a swap cross-fades instead of snapping. It is OFF by default. Opt in with a meta in any page head (re-read per navigation), mirroring Turbo's convention.

```html
<meta name="view-transition" content="same-origin">
```

A page (or layout) does not write raw `<head>` markup, so emit that meta through the `other` metadata field, which scopes it to the page that declares it:

```ts
// app/gallery/page.ts
export const metadata = { other: { 'view-transition': 'same-origin' } };
```

The accepted value is `same-origin`. When enabled it wraps every swap path (the two-tier boundary swap, the `<webjs-frame>` swap, and the background-revalidation full-body path). When `startViewTransition` is unavailable the swap runs synchronously with no flash and no throw. To persist a live element (a playing `<audio>`, an open menu) across a swap by node identity, mark it `data-webjs-permanent` and give it an `id`. The attribute is SUBTREE-scoped, so once the element has actually been preserved, a `<script>` inside it is not re-emitted and does not re-run (#1252); a permanent element arriving for the first time, or one with no `id`, is ordinary new content and runs its scripts.

The opt-in is **per page**, so it is a page-scoped meta: put it on a page's metadata to animate that page, or on the root layout to animate the whole app. Navigating to a page that does NOT declare it turns transitions back off, because the soft-nav head merge reconciles page-scoped `<meta>` tags (a stale one the previous page declared is removed, not left to leak, #1046). View transitions **compose with Suspense streaming**: a streamed boundary (a `loading.{js,ts}` skeleton or a `<webjs-suspense>` region) navigated to under an active transition still resolves its content progressively, because the streamed resolve waits for the transition's DOM swap to commit before it applies (#1048).

## `<webjs-stream>` Surgical Updates

`<webjs-stream>` is WebJs's take on Turbo Streams, and the action set mirrors `<turbo-stream>`. It is the only SINGLE-element update primitive (append one row, remove one item, bump a count, insert a toast), whereas a frame or layout swap redraws a whole region.

```html
<webjs-stream action="append" target="comments">
  <template><li>Nice post!</li></template>
</webjs-stream>
```

Actions: `append` / `prepend` (child of the target id), `before` / `after` (sibling), `replace` (the target itself), `update` (the target's children), `remove` (no template). A `targets="<css-selector>"` applies to every match. There are two delivery paths sharing one applier. Over HTTP a form submission rides the router with `Accept: text/vnd.webjs-stream.html`, and the server returns a stream only when that Accept is present (JS off gets a normal render, so it stays progressive-enhancement-safe). Over a live channel, `renderStream(message)` applies a server-pushed payload.

```ts
// app/post/[id]/route.ts
import { stream, streamResponse, acceptsStream, broadcast } from '@webjsdev/server';
import { escapeText } from '@webjsdev/core';

export async function POST(req: Request, { params }) {
  const comment = await addComment(params.id, await req.formData());
  const parts = stream.append('comments', `<li>${escapeText(comment.text)}</li>`);
  broadcast(`post:${params.id}`, parts);              // fan out to every viewer
  if (acceptsStream(req)) return streamResponse(parts);
  return Response.redirect(new URL(`/post/${params.id}`, req.url), 303); // no-JS fallback
}
```

`stream.*` escapes the target id but NOT the content, so escape any user substring yourself with `escapeText` (from `@webjsdev/core`), exactly like an `html` hole.

## Streaming (Suspense and RPC)

**Page-level streaming (`Suspense`).** Pass a promise as `children` to defer a slow region behind a fallback. TTFB is the time to render everything outside the boundary, and the resolved content streams in as a `<template>` when the promise lands.

```js
import { html, Suspense } from '@webjsdev/core';
export default function Page() {
  return html`<h1>Catalogue</h1>
    ${Suspense({ fallback: html`<p>Loading…</p>`, children: fetchExpensive() })}`;
}
```

**Component-level streaming (`<webjs-suspense>`).** An `async render()` component BLOCKS the first byte by default (real data in the first paint). To STREAM a slow component behind a fallback instead, wrap it. Multiple boundaries fetch concurrently, and a throwing component is isolated to its own error state while siblings stream.

```js
html`<webjs-suspense .fallback=${html`<p>Loading section…</p>`}>
  <user-profile uid="42"></user-profile>
</webjs-suspense>`
```

**Streaming RPC results.** A `'use server'` action that RETURNS a `ReadableStream`, async iterable, or async generator streams its chunks over the single RPC response. Detection is purely on the return value, so no config export is needed. This is the token-stream or progress case consumed imperatively after an interaction.

```ts
'use server';
export async function* streamAnswer(prompt: string) {
  for await (const token of llm.complete(prompt)) yield token;
}
// inside a component:
for await (const token of await streamAnswer(q)) this.text.set(this.text.get() + token);
```

Back-pressure is respected, and the request `AbortSignal` cancels the source on a client disconnect or a superseded render. A mid-stream throw surfaces as an error from the iterable, so wrap the `for await` in `try/catch`. For a slow region you want behind a fallback on the FIRST paint, use `<webjs-suspense>` instead.

## WebSockets

**Server.** Export `WS` from a `route.{js,ts}` file. In dev the module re-imports per connection, so keep shared state on `globalThis`.

```js
export function WS(ws, req, { params }) {
  ws.on('message', (data) => ws.send('echo:' + data));
  ws.on('close', () => { /* cleanup */ });
}
```

**Client.** `connectWS(url, handlers)` from `@webjsdev/core` auto-reconnects with exponential backoff, handles JSON parse/stringify, and queues sends while disconnected. The handler set is `{ onOpen, onMessage, onClose }`, and it RETURNS a connection handle with `.send(data)` and `.close()`. Open it in `connectedCallback` and close it in `disconnectedCallback`, driving a connection-status signal from `onOpen` / `onClose`:

```js
import { connectWS, renderStream } from '@webjsdev/core';

connectedCallback() {
  super.connectedCallback();
  this.conn = connectWS('/feed', {
    onOpen:    () => (this.online = true),
    onClose:   () => (this.online = false),
    onMessage: (m) => renderStream(m),   // apply a server-pushed <webjs-stream> payload
  });
}
disconnectedCallback() { super.disconnectedCallback(); this.conn?.close(); }
send(text) { this.conn.send(text); }
```

**Gotcha: a component re-render clobbers surgical `renderStream()` updates.** `renderStream()` (and `<webjs-stream>` in general) mutates the DOM out of band, appending rows the component's own `render()` does not know about. If the component then re-renders, `render()` re-runs and wipes those out-of-band rows. So render the target container ONCE and drive any mutation counter with a PLAIN instance field, never a signal or reactive prop that `render()` reads (a read would re-render and blow away the streamed-in DOM).

**Broadcast.** `broadcast(path, data)` from `@webjsdev/server` fans a message to every connected client on that path (single-instance). For multi-instance, add Redis pub/sub yourself, there is no framework magic.

## Navigation-Loading Indicator (opt-in)

For a CSS-only progress affordance while a navigation is in flight, add `data-webjs-nav-progress` to `<html>` once in the root layout. The router then sets `data-navigating` on `<html>` during a nav (deferred 150ms, so quick navs never trigger it). Style off that attribute.

```html
<html data-webjs-nav-progress>
```

```css
html[data-navigating] { cursor: progress; }
html[data-navigating]::after {
  content: ''; position: fixed; top: 0; left: 0; right: 0; height: 2px;
  background: var(--accent); animation: progress 1s ease-in-out infinite;
}
```

It is opt-in because toggling an `<html>` attribute re-resolves `oklch()` / `color-mix()` tokens on WebKit (every iOS browser), which flashes the background for one frame on a token-driven theme. Enable it only when your theme does not lean on wide-gamut color tokens, otherwise use the JS path (listen for `webjs:navigate`, and `webjs:submit-start` for forms).
