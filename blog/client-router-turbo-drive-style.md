---
title: "Client-Side Routing Without the Full-Page Reload"
date: 2026-02-22T10:30:00+05:30
slug: client-router-turbo-drive-style
description: "How WebJs does client-side routing by default. SPA navigation with no full-page reload and no white flash, keeping nested layouts mounted across page changes."
tags: client-router, navigation, ssr, layouts
author: Vivek
---

You know the quick white blink when you click a link and the whole page reloads? WebJs did not always avoid it. The first version had no client router (the bit of code that swaps pages in place instead of reloading the whole document), so each `<a>` click did a full page navigation. The HTML came back fast (SSR, or server-side rendering, is quick), the page rendered, life was fine. Except for one thing.

The page flickered white between navigations.

That white flash is the browser repainting between document loads. Chromium has the "paint holding" feature, but it still happens noticeably for ~100ms on most navigations. On a slow connection it is longer. The page feels janky even when the server is fast.

The fix is to intercept link clicks, fetch the next page over fetch(), and patch the DOM in place. Hotwire calls this Turbo Drive. WebJs's version is at `packages/core/src/router-client.js`. The docstring at the top spells out the design; the rest of this post is the commentary.


# The mechanism

The client router turns itself on as soon as `@webjsdev/core` loads, which any page carrying a component already does, so there is nothing to import and nothing to opt into. Once it is live, every same-origin `<a>` click goes through this path. The docstring describes it in five steps:

1. SSR injects `<!--wj:children:<segment-path>:<route-key>-->...<!--/wj:children:<segment-path>-->` comment markers around each layout's `${children}` interpolation, one pair per layout in the chain, plus one around the page itself (skipped when the page's segment would collide with the innermost layout's). The route key is the resolved path with param values filled in.
2. On link click, walk both the live DOM and the incoming HTML for these markers and build a path-to-range map.
3. Compare the two maps. A shared boundary whose route key CHANGED wins first, and the swap is anchored at the parent of the shallowest such change, which remounts that layout the way Next does. Only when no key changed does the deepest shared boundary become the target.
4. Apply the swap. A replace tears the live range out and inserts the incoming nodes, which is a real remount, and only elements marked `data-webjs-permanent` are carried across. A morph instead reconciles the two ranges with a keyed reconciler that preserves DOM identity, input values, scroll, and popover state; it is the more expensive path and it exists precisely to keep that state. Morphing is chosen only when the target boundary is the leaf on both sides and no route key changed.
5. Merge head tags, re-run scripts, upgrade custom elements, `history.pushState`.

The whole loop runs in a microtask. The body never repaints between pages.


# Why layouts staying mounted matters

Three things you keep for free.

Header state survives. A sticky header with a search box and a current value stays exactly where it was. The agent does not have to plumb state into a global store to survive nav.

Web component state survives. A `<theme-toggle>` holding its theme as an instance signal does not lose its state. The layout it lives in did not unmount, so neither did the component.

Scroll position is preserved on the parts of the page that did not change. If you have a sidenav with a scroll position, navigation within the sidenav's sub-section does not snap it back to the top.

The naive alternative (full page reload) breaks all three. The slightly-less-naive alternative (fetch + replace `<body>`) breaks them too because the layout itself unmounts. Swapping the narrowest range that actually changed is what preserves them, and the route key is what decides how narrow that is: a layout still showing the same resolved path is left alone, while one whose params changed is remounted on purpose.


# How it knows what to swap

The framework auto-emits the HTML comment markers at SSR time. You do not write them. The renderer detects `${children}` interpolations inside layout functions and emits `<!--wj:children:<segment-path>:<route-key>-->` before and `<!--/wj:children:<segment-path>-->` after. The page gets its own pair too, which is what makes a bare param change remount the page.

The path encoding (`/<segment-path>`) lets the client distinguish between nested layouts. Root `/`, then `/dashboard`, then `/dashboard/settings`, each as its own marker pair. Where no route key changed, the deepest matching pair between the current and incoming DOM is where the swap happens.

The route key on the opening marker carries the resolved path with its param values, and it takes precedence over that deepest-pair rule. `/users/7` and `/users/9` share a segment path but not a route key, so the router replaces at the parent of that boundary rather than morphing one user's chrome into another's. Segment membership alone would have called those two the same layout.

This is automatic. The user does not write the markers. The framework adds them at SSR time wherever a layout interpolates `${children}`. The router uses them as nav-stable swap points.


# The X-Webjs-Have optimization

A naive implementation would fetch the full HTML for every navigation. The client router does better. It sends an `X-Webjs-Have` header listing what it already holds, as `segment:route-key` entries rather than bare paths, so a dynamic layout it is holding for different params is re-rendered instead of wrongly short-circuited.

The server reads this header in `packages/server/src/ssr.js`. It iterates the target page's layout chain from innermost to outermost. Layouts at-or-above the deepest match are skipped. The response wraps only the divergent fragment in the deepest shared marker pair.

For most in-app navigations, that means smaller responses. The shared layout chrome (header, sidebar, footer) is not re-serialized on every nav. The browser-side patching is correspondingly cheaper because there is less HTML to parse and walk.

The optimization is opt-out via a header. Clients without `X-Webjs-Have` get the full response.


# Form submissions ride the same pipeline

A `<form action="/posts" method="post">` submission goes through the router. GET forms promote `FormData` to the query string. Non-GET forms send `FormData` as body, and the framework clears the snapshot cache on success so the next read returns fresh data.

Forms that already call `event.preventDefault()` in their `@submit` handler are untouched. The router checks for default-prevented submissions and bows out. This lets you opt out of router-handled submission when you need raw fetch control.

`data-no-router` on a link or form is the other escape hatch. The router skips it and the browser navigates normally.


# What the router does not do

Two explicit non-goals, plus one that used to be on this list and has since been built.

No view-transitions API by default. View Transitions are great when supported, but the spec is still evolving, so the default off-state matches what works in every browser. An app that wants them opts in with `<meta name="view-transition" content="same-origin">` in the root layout. The `content` value is load-bearing rather than decorative, since the router reads it and enables nothing unless it says `same-origin`.

No nested-route data deduplication. `X-Webjs-Have` trims the HTML a navigation pays for, but that is markup, not data. The router does not keep "data we already have" and refetch only the diff. The HTTP cache and the framework's `cache()` query memoization handle that at a different layer.

Prefetching was the one that changed. The router warms link targets on its own now, and it picks the strategy from the device rather than applying one everywhere: hover intent where there is a real pointer, and dwell-gated viewport entry on touch, where hover does not exist to hook. I wrote up how that choice gets made in [Device-adaptive link prefetch](/blog/device-adaptive-link-prefetch).


# What happens on a rapid click

The router handles rapid clicks correctly. Click link A, then click link B before A's response arrives. The router aborts A's fetch and proceeds with B. The DOM never patches A's content. A nav-token mechanism ensures that an out-of-order resolution (B resolves before A) does not accidentally revert to A's state.

This took two bug reports to get right. Race conditions in click-driven SPA navigation (a single-page app that swaps content in place instead of reloading) are subtle.


# Comparing to lit and Hotwire

lit ships no built-in router. You bring your own (vaadin-router, lit-router, etc.). Each has a different API.

Stencil ships a router closer in spirit to WebJs's, but it does not have the layouts-stay-mounted optimization. Every navigation re-mounts the full component tree.

Hotwire's Turbo Drive is the closest precedent. Same DOM-swap philosophy, same scroll-restoration logic, similar form integration. WebJs's version is written from scratch in plain JavaScript with JSDoc types, like the rest of the framework packages, and it is web-component aware (it walks `composedPath()` for shadow-DOM-piercing link detection), but the design borrows heavily.


# Why I shipped this in core

`@webjsdev/core` is small. Adding `router-client.js` to it is meaningful weight, and it has only grown since. I added it anyway because the white flash is what makes pages feel slow. If you measure with Lighthouse, metrics look fine without a client router. But the perceived speed is noticeably worse. Users say "it feels weird" not "it took 100ms longer." The fix is the router.

The other reason it lives in core: the boundary-detection trick (HTML comments at `${children}` interpolation points) is too tightly coupled to the SSR renderer to make sense in a separate package. The renderer emits the markers. The router reads them. Splitting them across packages would require synchronizing two version trees.

If you want to read the implementation, it is at [`packages/core/src/router-client.js`](https://github.com/webjsdev/webjs/blob/main/packages/core/src/router-client.js). The corresponding server-side marker emission and `X-Webjs-Have` handling lives in [`packages/server/src/ssr.js`](https://github.com/webjsdev/webjs/blob/main/packages/server/src/ssr.js).
