---
title: "A Strict CSP Nonce That Survives Client-Side Navigation"
date: 2026-07-12T10:00:00+05:30
slug: strict-csp-nonce-across-soft-navigation
description: "Strict Content-Security-Policy with a per-request nonce is the thing client-side routers classically break, because the browser keeps enforcing the original document's nonce. How WebJs keeps a strict CSP intact across soft navigations, with a header-enforced policy and a meta-tag nonce carrier the router re-stamps."
tags: security, csp, nonce, client-router, soft-navigation
author: Vivek
---

Here is a bug that only shows up on the second page.

You turn on a strict Content-Security-Policy. The first page loads, scripts run, everything is fine. You click a link, the client router swaps the content in place, and the new page's JavaScript silently does not run. No exception in your code, nothing in the network tab, just a component that never upgrades and a console line about a script violating the policy. Reload the same URL and it works perfectly.

That gap between "works on reload, dead on click" is the CSP nonce problem, and it is old enough that Turbo, Rails, and every SPA-shaped stack have all had to answer it. This is how WebJs answers it, and the answer turns out to be smaller than the problem sounds.

# What a nonce is doing in the first place

CSP (Content-Security-Policy) is the browser-enforced allowlist for what a page may load and execute. The strong version of it bans inline scripts outright, because an injected `<script>alert(document.cookie)</script>` is the whole XSS attack in one tag.

But a server-rendered page legitimately has inline scripts. WebJs emits three of them on a normal page: an importmap, a public-env shim, and a small boot script. Banning inline entirely would ban the framework's own output.

A nonce (number used once) is the escape hatch. The server mints a fresh random value per request, puts it on the scripts it emitted itself, and names that same value in the policy header. The browser then runs exactly the scripts carrying that value and refuses everything else. An attacker injecting a script cannot guess the nonce, because it is fresh CSPRNG bytes on every response.

In WebJs it is off by default and one key turns it on.

```jsonc
// package.json
{
  "webjs": {
    "csp": true
  }
}
```

That mints 16 random bytes per request, base64-encoded to a 24-character value, and one value flows from the mint through the render to the header. Here is a real response with it enabled.

```
content-security-policy: default-src 'self';
  script-src 'nonce-PHnV6C8xj3wFBaEaNxEXVw==' 'strict-dynamic' 'self' https:;
  style-src 'self' 'unsafe-inline'; img-src 'self' data: https:;
  base-uri 'self'; form-action 'self'; object-src 'none'
```

Every inline `<script>` in that response body carries `nonce="PHnV6C8xj3wFBaEaNxEXVw=="`, and so does every `<link rel="modulepreload">`. Request the same URL again and every one of those values has changed together. Nothing is shared between two requests, which is the entire point.

# The rule that breaks the second page

Now the client router enters. On a link click it fetches the next page as HTML, finds the deepest layout boundary the two pages share, and swaps the content between them. Nested layouts stay mounted, no white flash, no full document load. The mechanics of that swap are [their own post](/blog/client-router-turbo-drive-style); what matters here is the last step, where the head tags merge and the new page's scripts run.

That incoming HTML was rendered by the server, so it carries a brand new nonce. Its own header carries a matching one. Everything about that response is internally consistent.

It is also completely useless, because of a rule that catches almost everyone the first time: **a fetched response's CSP header does not apply to the document that fetched it.** A policy binds to a document at the moment that document is created. Your live document was created by the first page load, so the first page load's policy is the one the browser will keep enforcing until the document goes away. `fetch()` does not renegotiate it. Nothing does.

So the browser is still looking for `PHnV6C8xj3wFBaEaNxEXVw==`, and the fragment you just fetched is stamped with something else entirely. Insert those scripts as they arrived and every one of them is a policy violation. Reload the URL and the problem vanishes, because a reload creates a NEW document that enforces that response's own fresh nonce. Consistency either way, which is exactly why the bug hides until someone clicks instead of typing.

The fix, stated plainly, is that the router has to ignore the nonce the server just sent it and re-stamp every element it inserts with the nonce the original document declared.

# You cannot read the nonce back off the page

Which raises the question of where the router gets that original nonce, and here the platform is deliberately unhelpful.

The browser hides the nonce after it has used it. Once the document has loaded, reading `getAttribute('nonce')` on a script that definitely had one returns an empty string. I measured it on a live page, all three inline scripts, all empty. This is a spec'd anti-exfiltration behaviour, and it is a good one: a CSS attribute-selector attack could otherwise leak the nonce character by character and defeat the whole mechanism.

The real value moves to the `.nonce` IDL property, which is same-origin script-readable. But the practical answer everyone converges on is simpler. Publish the nonce once, in a place designed to be read.

```html
<meta name="csp-nonce" content="PHnV6C8xj3wFBaEaNxEXVw==">
```

WebJs emits that tag during SSR whenever CSP is enabled, and it is worth being precise about what it is and is not. It is not enforcement. The policy is enforced by the response header, always, never by a `<meta http-equiv>` tag, which is what lets directives like `frame-ancestors` and `report-uri` work at all (a meta-tag CSP cannot express them). The `csp-nonce` meta is purely a carrier: the server publishes the document's nonce there once, and the client reads it for the life of the document.

Turbo and Rails landed on the same shape independently. When three codebases arrive at one answer from different directions, that is usually the answer.

# Three things the router does on every swap

Three things, and the third is the one I did not anticipate.

**It never lets the incoming nonce win.** The head merge reconciles page-scoped meta tags across a navigation, so a page can change its description or its Open Graph tags. The `csp-nonce` meta is the single framework-owned exception, excluded from add, update, and remove alike. The original tag survives every swap verbatim. A soft navigation to a second page leaves the live document holding the first page's nonce while the response that produced it carried a different one, which is the correct outcome even though it looks wrong.

**It re-stamps everything it inserts.** Any script the router moves into the live document is rebuilt: every attribute copied except the nonce, then the document's own nonce applied from the meta tag. The same treatment goes to `<link rel="modulepreload">`, which is easy to miss because a preload is not a script. Browsers gate module preloads through `script-src` too, so a preload carrying the wrong nonce is blocked the same way, and on a no-build framework where a page's modules arrive as a preload graph, that failure is not a minor one.

**It strips the nonce before diffing the head.** This is the part that only appears once the rest works. The head merge decides what is new by comparing serialized elements, and a per-request nonce makes every single script and preload look changed on every single navigation. Left alone, the head grows a duplicate preload set per click. So the comparison runs against a nonce-free copy of each element, and the nonce is applied to the clone that actually gets inserted.

There is one more piece that lives on the server rather than the router. WebJs has an HTML response cache that a page opts into with `export const revalidate`. A CSP-enabled page is excluded from it, unconditionally. Caching a rendered page means caching the nonce inside it and serving that nonce to a later visitor under a header minted fresh for them, and a nonce that gets replayed is not a nonce.

# Running the whole path against a real app

Two routes, a counter component on both, `webjs.csp` set to `true`, production mode, a real browser.

The first load hands the document nonce `D9iggnKIqu4izYAiZvYdAA==`. Clicking through to the second route swaps the content, and afterwards the live document still holds `D9igg...`, exactly one `csp-nonce` meta tag, and every script and preload in the document reporting `D9igg...` through the `.nonce` property the browser checks against. Fetching that second route directly shows what the server actually sent for it, `KWD2gZxz5OISAFl66gj2Xw==`, in both its meta tag and its header. The router threw that away, which is the whole job. Zero CSP violations in the console, and the counter increments on click, so the component genuinely upgraded rather than merely rendering.

None of that needed configuration. The one key turns the policy on, and staying valid across navigation is what the router does.

# Signing your own inline script

If you write your own inline `<script>`, it needs the nonce too, and `cspNonce()` reads the value minted for the current request during SSR.

```ts
// app/analytics/page.ts
import { html, cspNonce } from '@webjsdev/core';

export default function Analytics() {
  return html`
    <h1>Analytics</h1>
    <script nonce="${cspNonce()}">window.__analyticsReady = true;</script>
  `;
}
```

Pages and layouts are the right home for this, since they render only on the server. In a component, interpolating into a `<style>` or `<script>` body breaks for an unrelated reason (the server emits it, the client drops the raw-text hole, and the content wipes on hydration), so component styling goes through `static styles` or Tailwind instead.

For a staged rollout, `reportOnly` sends the violations to your logs without enforcing anything, and directives merge one at a time over the strict defaults rather than being restated wholesale.

```jsonc
{
  "webjs": {
    "csp": {
      "reportOnly": true,
      "directives": { "connect-src": "'self' https://api.example.com" }
    }
  }
}
```

A malformed config disables CSP and says so rather than throwing, because a security knob that takes the app down on a typo teaches people to leave it off.

# The control everyone turns off again

The reason I care about this one out of proportion to its size is that a strict CSP is the security control teams most often skip, and they skip it because the first thing it does is break their app in a way that is genuinely confusing to debug. Works on reload, dead on click, no useful stack trace. Two days of that and the ticket gets closed as not worth it.

The nonce mismatch is not something an application developer should have to know about. The router already knows which document it is in and which elements it inserted. It has everything it needs to get this right without being told, so it does.

Turn it on, click a link, and nothing happens. That is the feature.
