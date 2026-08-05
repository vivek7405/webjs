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

When the framework's client router is loaded (one ES module import in your root layout), every same-origin `<a>` click goes through this path. The docstring describes it in five steps:

1. SSR injects `<!--wj:children:<segment-path>-->...<!--/wj:children-->` comment markers around each layout's `${children}` interpolation (one pair per layout in the chain).
2. On link click, walk both the live DOM and the incoming HTML for these markers and build a path-to-range map.
3. Find the longest shared marker path. That is the deepest layout both pages have in common.
4. Replace nodes between that marker pair in the live DOM with the equivalent range from the incoming HTML, using a keyed reconciler that preserves input values, scroll, popover state, and DOM identity where it can.
5. Merge head tags, re-run scripts, upgrade custom elements, `history.pushState`.

The whole loop runs in a microtask. The body never repaints between pages.


# Why layouts staying mounted matters

Three things you keep for free.

Header state survives. A sticky header with a search box and a current value stays exactly where it was. The agent does not have to plumb state into a global store to survive nav.

Web component state survives. A `<theme-toggle>` holding its theme as an instance signal does not lose its state. The layout it lives in did not unmount, so neither did the component.

Scroll position is preserved on the parts of the page that did not change. If you have a sidenav with a scroll position, navigation within the sidenav's sub-section does not snap it back to the top.

The naive alternative (full page reload) breaks all three. The slightly-less-naive alternative (fetch + replace `<body>`) breaks them too because the layout itself unmounts. Walking marker pairs and replacing only the innermost is what preserves them.


# How it knows what to swap

The framework auto-emits the HTML comment markers at SSR time. You do not write them. The renderer detects `${children}` interpolations inside layout functions and emits `<!--wj:children:<segment-path>-->` before and `<!--/wj:children-->` after.

The path encoding (`/<segment-path>`) lets the client distinguish between nested layouts. Root `/`, then `/dashboard`, then `/dashboard/settings`, each as its own marker pair. The deepest matching pair between the current and incoming DOM is where the swap happens.

This is automatic. The user does not write the markers. The framework adds them at SSR time wherever a layout interpolates `${children}`. The router uses them as nav-stable swap points.


# The X-Webjs-Have optimization

A naive implementation would fetch the full HTML for every navigation. The client router does better. It sends an `X-Webjs-Have` header listing the marker paths it already has.

The server reads this header in `packages/server/src/ssr.js`. It iterates the target page's layout chain from innermost to outermost. Layouts at-or-above the deepest match are skipped. The response wraps only the divergent fragment in the deepest shared marker pair.

For most in-app navigations, that means smaller responses. The shared layout chrome (header, sidebar, footer) is not re-serialized on every nav. The browser-side patching is correspondingly cheaper because there is less HTML to parse and walk.

The optimization is opt-out via a header. Clients without `X-Webjs-Have` get the full response.


# Form submissions ride the same pipeline

A `<form action="/posts" method="post">` submission goes through the router. GET forms promote `FormData` to the query string. Non-GET forms send `FormData` as body, and the framework clears the snapshot cache on success so the next read returns fresh data.

Forms that already call `event.preventDefault()` in their `@submit` handler are untouched. The router checks for default-prevented submissions and bows out. This lets you opt out of router-handled submission when you need raw fetch control.

`data-no-router` on a link or form is the other escape hatch. The router skips it and the browser navigates normally.


# What the router does not do

One explicit non-goal, plus two that used to be on this list and have since been built.

No view-transitions API by default. View Transitions are great when supported, but the spec is still evolving, so the default off-state matches what works in every browser. An app that wants them opts in with `<meta name="view-transition" content="same-origin">` in the root layout. The `content` value is load-bearing rather than decorative, since the router reads it and enables nothing unless it says `same-origin`.

Prefetching was the first of the two. The router warms link targets on its own now, and it picks the strategy from the device rather than applying one everywhere: hover intent where there is a real pointer, and dwell-gated viewport entry on touch, where hover does not exist to hook. I wrote up how that choice gets made in [Device-adaptive link prefetch](/blog/device-adaptive-link-prefetch).

Per-navigation full refetch was the second. The `X-Webjs-Have` mechanism described above is exactly the deduplication this section used to disclaim, so a navigation that shares a layout chain with the current page pays for the divergent fragment and nothing more.


# What happens on a rapid click

The router handles rapid clicks correctly. Click link A, then click link B before A's response arrives. The router aborts A's fetch and proceeds with B. The DOM never patches A's content. A nav-token mechanism ensures that an out-of-order resolution (B resolves before A) does not accidentally revert to A's state.

This took two bug reports to get right. Race conditions in click-driven SPA navigation (a single-page app that swaps content in place instead of reloading) are subtle.


# Comparing to lit and Hotwire

lit ships no built-in router. You bring your own (vaadin-router, lit-router, etc.). Each has a different API.

Stencil ships a router closer in spirit to WebJs's, but it does not have the layouts-stay-mounted optimization. Every navigation re-mounts the full component tree.

Hotwire's Turbo Drive is the closest precedent. Same DOM-swap philosophy, same scroll-restoration logic, similar form integration. WebJs's version is written from scratch in plain JavaScript with JSDoc types, like the rest of the framework packages, and it is web-component aware (it walks `composedPath()` for shadow-DOM-piercing link detection), but the design borrows heavily.


# Why I shipped this in core

`@webjsdev/core` is small. Adding a 1400-line file to it (`router-client.js`) is meaningful weight. I added it anyway because the white flash is what makes pages feel slow. If you measure with Lighthouse, metrics look fine without a client router. But the perceived speed is noticeably worse. Users say "it feels weird" not "it took 100ms longer." The fix is the router.

The other reason it lives in core: the boundary-detection trick (HTML comments at `${children}` interpolation points) is too tightly coupled to the SSR renderer to make sense in a separate package. The renderer emits the markers. The router reads them. Splitting them across packages would require synchronizing two version trees.

If you want to read the implementation, it is at [`packages/core/src/router-client.js`](https://github.com/webjsdev/webjs/blob/main/packages/core/src/router-client.js). The corresponding server-side marker emission and `X-Webjs-Have` handling lives in [`packages/server/src/ssr.js`](https://github.com/webjsdev/webjs/blob/main/packages/server/src/ssr.js).
