---
title: "CSRF Protection Without Tokens, Cookies, or Config"
date: 2026-06-04T11:00:00+05:30
slug: csrf-protection-without-tokens
description: "How WebJs does CSRF protection with a Sec-Fetch-Site and Origin check instead of a token cookie. CSRF without a token keeps your SSR pages same-origin safe and CDN-edge-cacheable, the modern browser-native approach explained for beginners."
tags: security, csrf, sec-fetch-site, server-actions, caching
author: Vivek
---

Let me start with the attack, because the name is scarier than the idea.

CSRF stands for Cross-Site Request Forgery. Here is the whole thing in one sentence. You are logged into your bank in one tab. You open a malicious page in another tab. That page quietly submits a form (or fires a request) at your bank, and because your browser helpfully attaches your bank's cookies to any request headed for your bank, the bank sees a fully authenticated "transfer money" request that you never meant to send.

The malicious site never sees your cookies. It does not need to. It just needs your browser to send them for it. That is the trick. The request is forged to look like it came from you, because in a cookie sense it did.

So every framework needs an answer to "was this state-changing request actually initiated by my own site, or by some other site riding on the user's session?"


# The classic answer, and why it is fiddly

The traditional fix is the anti-CSRF token. The server generates a random secret, embeds it in a hidden form field on every page, and also stores a copy (often in a cookie). When the form submits, the server checks that the hidden field matches the stored copy. A malicious cross-site page cannot read your pages, so it cannot know the token, so its forged request fails the check.

This works. It has protected the web for two decades. But it is a lot of moving parts for a beginner to wire up correctly.

- Every form needs the hidden token field, so you need a way to inject it everywhere.
- The token has to be tied to the session, rotated sensibly, and validated on every mutating request.
- The "double-submit cookie" variant sets the token as a cookie and asks the form to echo it back, which means you now have a cookie you must set on the SSR response.

That last point is the one that quietly hurts, and I will come back to it, because it is the reason WebJs went a different way.


# The modern answer: ask the browser where the request came from

Here is the thing that changed. Modern browsers now tell the server, on every request, whether the request came from the same site or a different one. They send a header called `Sec-Fetch-Site`, and its value is one of `same-origin`, `same-site`, `cross-site`, or `none` (a direct navigation, like typing the URL or clicking a bookmark).

The malicious page cannot forge this header. It is set by the browser itself, and JavaScript is not allowed to touch it. So the server can just read it. If a state-changing request claims to come from `cross-site`, it is exactly the forgery you were worried about, and you reject it.

This is the Remix 3 and Go 1.25 model, and it is what WebJs server actions use. No token to generate, no hidden field to inject, no extra cookie to set.


# What WebJs actually checks

In WebJs, a server action is a function in a `*.server.ts` file marked `'use server'`. When you import it from client code, the import is rewritten into a typed RPC stub that POSTs to `/__webjs/action/<hash>/<fn>`. That RPC boundary is where the CSRF check lives.

For a state-changing verb (POST, PUT, PATCH, DELETE), the request passes only when one of these is true.

1. `Sec-Fetch-Site` is `same-origin` or `none`. Your own site, or a direct navigation.
2. The browser is older and sent no `Sec-Fetch-Site`, but the `Origin` header's host matches the request host. A same-host fallback.
3. The source origin is listed in `webjs.allowedOrigins` in your `package.json`. An explicit opt-in for a trusted cross-origin caller.

Otherwise the request is rejected with a `403`. That is the entire policy.

```jsonc
// package.json
{
  "webjs": {
    "allowedOrigins": ["https://admin.example.com"]
  }
}
```

Most apps never touch `allowedOrigins` at all. The default (same-origin or a matching host) is what you want almost always.

And a safe read is exempt. A GET action is CSRF-exempt by design, because a GET is not supposed to change state, so there is nothing to forge. (If a GET of yours does mutate state, that is the bug to fix, not the check to loosen.)


# The payoff nobody advertises: your pages stay cacheable at the edge

Now back to the cookie problem, because this is the part I actually find exciting.

Remember the double-submit token needs a cookie on the SSR response. The moment your server sends a `Set-Cookie` header with an HTML page, that page becomes per-user by definition. A CDN cannot cache it, because caching one visitor's cookie and serving it to the next visitor would be a security disaster. So the token approach quietly makes your HTML uncacheable at the edge.

WebJs sends no `Set-Cookie` riding the SSR HTML for CSRF, because there is no token to plant. That means a page that is genuinely identical for every visitor can opt into a public `Cache-Control` and be cached at the CDN edge.

```ts
// app/layout.ts (root layout for a visitor-identical app)
import { html } from '@webjsdev/core';
import type { Metadata, LayoutProps } from '@webjsdev/core';

export const metadata: Metadata = {
  cacheControl: 'public, max-age=300',
};

export default function RootLayout({ children }: LayoutProps) {
  return html`<main class="max-w-[760px]">${children}</main>`;
}
```

You can set `metadata.cacheControl` on a single page, or on a root layout to cover a whole visitor-identical app. The edge serves the cached HTML, your origin does less work, and the first paint is faster. This is the real argument. The Sec-Fetch-Site approach is not just simpler to write, it keeps your SSR output CDN-cacheable, which a CSRF-token cookie fundamentally would not.


# CORS is a separate control (do not confuse the two)

CSRF protection guards your own site's mutating requests. CORS is a different concern, which is letting a browser on another origin read your responses on purpose. For that, WebJs ships a `cors()` middleware in `@webjsdev/server`.

```ts
// middleware.ts
import { cors } from '@webjsdev/server';

export default cors({
  origin: ['https://app.example.com'],
  credentials: true,
});
```

One hard rule here. If you set `credentials: true` (so the browser sends cookies on the cross-origin request), you MUST pass an explicit origin allowlist. Never combine `credentials: true` with `origin: '*'`. A credentialed wildcard effectively hands cookie-authenticated access to every origin on the web, which is the exact footgun CORS is supposed to prevent. WebJs will narrow a wildcard-plus-credentials combination to the reflected origin and warn you, but the correct fix is a real allowlist.


# The one caveat: this covers actions, not your hand-written routes

The Sec-Fetch-Site check protects the action RPC boundary. It does NOT automatically cover a `route.ts` REST endpoint you write by hand.

A `route.ts` handler is a raw HTTP handler (named `GET` / `POST` exports). It is the right tool when you are building a public API, and precisely because it is public and raw, WebJs does not impose the action CSRF policy on it. So if a `route.ts` endpoint mutates state, that is on you. Authenticate every mutating route, validate the input, and rate-limit it. The framework gives you the pieces (`validate`, the auth helpers, `rateLimit()`), but it will not second-guess a route you wrote deliberately.

The rule of thumb: reach for a server action for in-app mutations (you get CSRF protection for free), and reach for `route.ts` when you are exposing a real HTTP API to the outside world (you own the security).


# A browser fact beats tokens

CSRF is a browser trick, so the cleanest defense is a browser fact. Modern browsers stamp every request with `Sec-Fetch-Site`, which JavaScript cannot forge, so WebJs server actions simply reject any state-changing request that is not same-origin (with an Origin-host fallback for old browsers and an `allowedOrigins` escape hatch). There is no token to generate, no hidden field to inject, and no CSRF cookie to set. That last absence is the quiet win, because with no `Set-Cookie` on the SSR HTML, a visitor-identical page can opt into a public `Cache-Control` and be cached at the CDN edge, which a token-cookie approach would break. Just remember that this protection lives on the action boundary, so if you hand-write a mutating `route.ts`, you secure that one yourself.
