---
title: "Next.js 16 File-Routing Parity in WebJs: forbidden(), unauthorized(), and Nearest not-found"
date: 2026-07-08T10:00:00+05:30
slug: nextjs-16-file-routing-parity
description: "WebJs closed the last Next.js 15/16 file-routing parity gaps. forbidden() and unauthorized() control-flow throws, nearest-wins not-found boundaries, sync-or-await params, and an instrumentation.js boot hook, explained for anyone migrating from Next.js."
tags: nextjs, routing, web-standards, migration, auth
author: Vivek
---

When you move over from Next.js, you do not arrive empty-handed. You bring routing reflexes that are pure muscle memory. Throw `notFound()` and a boundary renders. Drop a file in a folder and it wires itself. Read `params` off the page props. WebJs has matched the shape of Next's file router from early on, so most of those reflexes already fire on the first try. A handful of the newer Next 15 and 16 primitives were the exceptions, the calls you make without thinking that used to do nothing at all. Those are the ones that bite mid-migration, because you write the line you have written a hundred times and get silence.

So here is the checklist of habits you can carry over, and what each one does now that it lands.

# You throw forbidden() and unauthorized(), and a boundary renders

Next 15 added `forbidden()` and `unauthorized()` next to the older `notFound()`. Both work in WebJs now, and they behave the way `notFound()` already trained you to expect. You throw them, the framework catches the throw, sets the HTTP status, and renders the matching boundary file.

```ts
// app/dashboard/page.ts
import { html, forbidden, unauthorized } from '@webjsdev/core';

export default async function Dashboard() {
  const session = await getSession();
  if (!session) unauthorized();          // 401, not authenticated
  if (!session.canSeeDashboard) forbidden(); // 403, authenticated but not allowed
  return html`<h1>Dashboard</h1>`;
}
```

The distinction is the reflex worth keeping sharp, and it is the one HTTP always drew. `unauthorized()` returns a 401, for a request that is not authenticated at all, nobody logged in. `forbidden()` returns a 403, for a user who IS logged in but lacks permission for this particular thing. Pick the right one and you get honest status codes without thinking about the numbers.

Each renders the nearest boundary walking up from where you threw. A `forbidden()` finds the closest `forbidden.{js,ts}`, an `unauthorized()` the closest `unauthorized.{js,ts}`, innermost wins, and if you have written none WebJs renders a sensible default page. So a single `app/forbidden.ts` at the root covers the whole app, or an `app/admin/forbidden.ts` takes over inside the admin subtree.

```ts
// app/admin/forbidden.ts
import { html } from '@webjsdev/core';
export default function AdminForbidden() {
  return html`<p>You need admin access for this area.</p>`;
}
```

This is the one place the habit needs adjusting, because the throw model has edges. These work from a page or layout render, and from a form-bound server action (the no-JS write path, the action a `<form action=${fn}>` submits to). They do NOT belong in a `route.ts` handler, which is raw HTTP and should return a `Response` itself. And inside a `'use server'` RPC action, a raw `forbidden()` throw becomes a generic 500, because an action's job is to return a value, not to throw control flow. For an auth failure inside an action, return an `ActionResult`.

```ts
// modules/posts/actions/delete-post.server.ts
'use server';
export async function deletePost(id: string) {
  const session = await getSession();
  if (!session) return { success: false, error: 'Sign in first.', status: 401 };
  if (!session.isAdmin) return { success: false, error: 'Not allowed.', status: 403 };
  // ...delete
  return { success: true };
}
```

The same rule already governs `notFound()` and `redirect()`. Throw in a render path, return an envelope in an action, return a `Response` in a route.

# Your deep not-found file finally wins

This is the habit that used to break most quietly. In Next a `not-found.tsx` is nearest-wins, so a `not-found` deep in the tree takes over for the pages beneath it. WebJs used to render the single root `not-found` no matter where you threw. It matches Next now.

```
app/
  not-found.ts                 root 404
  blog/
    [slug]/
      page.ts                  throws notFound() for a missing post
    not-found.ts               renders THIS for a missing post
```

Throw `notFound()` from `app/blog/[slug]/page.ts` and you get `app/blog/not-found.ts`, the nearest one walking up from the throwing page. No blog-specific boundary in that subtree? It keeps walking and lands on the root. So a section gets its own styled 404, a missing product looking different from a missing blog post, with nothing to wire beyond dropping the file in the right folder.

There is also a root-only `global-not-found.{js,ts}`, which renders for a URL that matches nothing anywhere in your app. That is the catch-all for an address that never resolves to a route at all, as opposed to a route that ran and decided the thing it wanted does not exist.

# Your await params code runs, and the sync version too

Next 15 made `params` and `searchParams` async, so you `await params` before reading it. Plenty of existing code, and plenty of tutorials, still read them synchronously. WebJs accepts both, on the same object, so a migrating Next dev does not have to think about which era a snippet came from.

```ts
// Both of these work, in the same codebase, on the same object.
export default async function Post({ params }) {
  const { slug } = await params;   // the Next 15/16 way
  // ...
}

export default function Post2({ params }) {
  const slug = params.slug;        // the synchronous way
  // ...
}
```

Paste your `await params` code from a Next project and it runs. Prefer the plainer synchronous read and that runs too. The object is awaitable AND directly subscriptable at once, so neither style is wrong and you never hit the confusing "params is a Promise now" error partway through a migration.

# Your instrumentation.js still boots your monitoring

The last reflex is the boot hook. WebJs reads an optional `instrumentation.{js,ts}` at your app root, the same file Next uses. It exports a `register()` function that runs once at server boot, which is where you wire up APM (application performance monitoring), tracing, or any one-time setup.

```ts
// instrumentation.ts
import { setOnError } from '@webjsdev/server';

export function register() {
  setOnError((err, ctx) => {
    myApm.captureException(err, { url: ctx.url });
  });
}
```

`setOnError` registers the hook the framework calls on an unhandled request error, so your monitoring tool sees every server-side failure with its request context. There is also an `instrumentation-client.{js,ts}` that runs first on the client, before your app modules, for the browser half of the same idea, a client error reporter or an analytics init.

# Bring your routing habits over

WebJs already matched Next's file router in shape, and these four changes close the gaps a migrator actually trips on. `forbidden()` and `unauthorized()` are control-flow throws that render the nearest boundary with honest 403 and 401 codes, under the same rule `notFound()` and `redirect()` already taught you, throw in a render, return an `ActionResult` in an action, return a `Response` in a route. `not-found` is nearest-wins now, so a section owns its own 404. `params` and `searchParams` read synchronously or awaited, so your Next code just works. And `instrumentation.js` gives you the boot hook for wiring monitoring. Bring your Next.js routing habits over, and the ones that used to fall through now land.
