---
title: "A Web Framework That Works Without JavaScript"
date: 2026-06-23T10:00:00+05:30
slug: works-without-javascript
description: "In WebJs, progressive enhancement is the default architecture. Pages SSR and never hydrate, forms submit through server actions with JS off, and interactivity is opt-in."
tags: progressive-enhancement, ssr, forms, server-actions, accessibility
author: Vivek
---

Turn JavaScript off and load a WebJs app. The content is there and readable. Links navigate. Forms submit and save. Display-only components render exactly as they did with JavaScript on. Nothing shows a spinner that never resolves, because nothing was waiting on a script to paint.

That is not a feature I added. It is the default shape of the framework, and getting there was mostly a matter of not doing the thing that breaks it. This post is about what that shape is and why it is the floor rather than an achievement.

# The execution model that makes it possible

In WebJs, pages and layouts run only on the server. They produce HTML and are never invoked again in the browser. Components are isomorphic and DO run again in the browser, but only to upgrade into interactivity. The important consequence is that the server-rendered HTML is the real artifact. It is not a placeholder that JavaScript fills in. It is the finished page.

So "works without JavaScript" is not something the framework has to reconstruct. The no-JS experience is just the page before the optional enhancement layer runs. Interactivity is added per behavior, not per page: an `@click`, a signal read, a reactive property. Each of those is a specific opt-in that a specific component makes. Everything you did not explicitly make interactive stays static, which means it stays working with the script layer removed.

# The rule that keeps it true

The whole thing holds on one discipline: never write a first paint that depends on hydration. The moment a component renders a blank placeholder on the server and fills it in from a `connectedCallback` fetch, the no-JS experience is broken, because with JS off the placeholder is all you get.

WebJs is built to make the correct path the easy one. Server-known data arrives through the page function and is in the SSR HTML. A component that needs request-time data can `await` it directly in `render()`, and SSR blocks on that await so the resolved data is in the first paint with no fallback markup. Browser-only data (something from `localStorage`, the viewport, `navigator`) goes in `connectedCallback` and writes a signal, so it enhances a page that already rendered without it. The framework even elides display-only components from the browser entirely, which is only sound because their SSR HTML is already the complete output.

# Forms are the write path

Reading without JavaScript is the easy half. The harder half is writing, and this is where a lot of frameworks quietly give up and require a client fetch. WebJs keeps the write path working with a plain form.

You bind a server action into the form:

```ts
// modules/leads/actions/save-lead.server.ts
'use server';
export async function saveLead(formData: FormData) {
  const email = String(formData.get('email') || '');
  if (!email) return { success: false, fieldErrors: { email: 'required' } };
  await db.insert(leads).values({ email });
  return { success: true, redirect: '/thanks' };
}

// app/contact/page.ts
import { saveLead } from '#modules/leads/actions/save-lead.server.ts';
export default function Contact({ actionData }) {
  return html`<form action=${saveLead}>
    <input name="email" />
    ${actionData?.fieldErrors?.email ? html`<p>${actionData.fieldErrors.email}</p>` : ''}
    <button>Send</button>
  </form>`;
}
```

That binding is the whole wiring. There is no `method`, no `enctype`, and no adapter in the page. What the browser receives is a plain HTML form: the framework drops the `action` attribute so the form posts to its own URL, adds the attributes a submission needs, and writes one hidden field naming the action to run. The action's code never goes anywhere near the browser.

With JavaScript off, that is a normal HTML form. It POSTs to its own URL, the action runs on the server, and a success returns a `303` redirect (the post-redirect-get pattern, so a refresh does not resubmit) while a failure re-renders the same page at `422` with the result on `actionData`. No JavaScript touched any of it. The validation errors render server-side. The submission is origin-checked, so there is no CSRF token to add either.

With JavaScript on, the client router intercepts the same submission and applies the response in place: a `303` is followed via fetch without a full reload, a `422` swaps the re-rendered page without losing scroll position. Same form, same server action, same result, because with JavaScript on the router posts the same body to the same URL rather than taking a second code path. The enhancement is that it happens without a page flash, not that it happens at all. You opt a form out of the router with `data-no-router` and it falls back to the native submit, which still works.

# Why this is worth the discipline

Three things fall out of building this way, and they are the reason it is the default and not an option.

The first paint is correct for everyone. A slow device, a flaky network, a script that fails to load, a crawler, a reader-mode extension: all of them get the real content, because the real content was never gated behind the script. Accessibility improves for the same reason, since assistive tech reads a fully-formed document instead of racing a hydration pass.

It composes with the framework's other bets. Elision is only safe because display-only components produce their complete output at SSR. The client router is only safe because a failed navigation can fall back to a real link. Each of these depends on the page being genuinely finished before JavaScript runs.

And it is honest about what JavaScript is for. JavaScript is the enhancement that makes an already-working page snappier and more interactive. It is not the thing that makes the page exist. When you treat it that way, the app degrades gracefully by construction, because there is a real page underneath to degrade to.

Progressive enhancement is usually described as extra work: build the no-JS version, then layer the JS version on top. WebJs inverts that. The server-rendered page is the artifact, interactivity is opt-in per behavior, and forms submit through server actions whether or not a script is running. You do not build the no-JS path separately. You get it by not writing a first paint that depends on hydration, and the framework spends its effort making that the easy way to build. The result is an app that works with JavaScript off because it was never pretending the JavaScript was load-bearing.
