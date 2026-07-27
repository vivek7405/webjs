---
title: "Server-Side Caching for Beginners (ETags, Tags, and 304s)"
date: 2026-06-25T11:00:00+05:30
slug: server-side-caching-explained
description: "A beginner guide to server-side caching in WebJs. Learn HTTP Cache-Control, the cache() helper, tag-based invalidation, and conditional GET with ETags and 304s."
tags: caching, performance, etag, http, no-build
author: Vivek
---

Here is a pattern I see in almost every new app. A page loads a list of posts. Each request opens the database, runs the same query, gets the same rows, and renders the same HTML. Ten visitors in one second means ten identical trips to the database for a result that did not change. That is slow, and it is wasteful.

Caching is the fix. A cache stores a computed or fetched result so you can skip the work next time. The hard part was never storing the value. The hard part is knowing when the stored value is stale and throwing it away at the right moment. That second half is called invalidation, and it is where most caching bugs live.

WebJs gives you a few caching layers, each aimed at a different kind of "same work repeated." This post walks through all of them from scratch, in plain language, and is careful about the one safety rule that matters most (never cache one user's data where another user can see it).

# Layer 1: HTTP Cache-Control on responses

The cheapest cache is the one you never run yourself. Browsers, CDNs, and reverse proxies already know how to hold onto a response if you tell them it is safe to. You tell them with a `Cache-Control` header.

```js
// app/api/posts/route.js
export async function GET() {
  const posts = await db.query.posts.findMany();
  return new Response(JSON.stringify(posts), {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'Content-Type': 'application/json',
    },
  });
}
```

`public, max-age=60` means "anyone may reuse this for 60 seconds." For an SSR page, you set the same idea through page metadata with `cacheControl: 'public, max-age=60'`. No framework cache layer runs here at all. You are handing the job to the standards that already ship in every browser and every CDN.

# Layer 2: cache() for query results, with tags

The HTTP header caches a whole response. Often you want to cache one expensive thing inside the request instead, like a database query. WebJs ships a `cache()` helper for that. You wrap an async function, give it a key, and give it a time-to-live in seconds.

```ts
// modules/posts/queries/list-posts.server.ts
'use server';
import { cache } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';

export const listPosts = cache(
  async () => db.query.posts.findMany({ orderBy: { createdAt: 'desc' } }),
  { key: 'posts', ttl: 60 }
);
```

The first call runs the query and stores the result. Every call within the next 60 seconds returns the stored value without touching the database. Values round-trip through webjs's rich serializer, so a row's `createdAt` stays a real `Date` on a warm hit, not a string.

Time-to-live handles the "eventually go stale" case. But what about "go stale the instant someone edits a post"? That is where tags come in. Tag-based invalidation means you label cached data so a write can evict exactly the entries it affected, instead of guessing or clearing everything.

```ts
export const postById = cache(
  async (id: string) => db.query.posts.findFirst({ where: { id } }),
  { key: 'post', ttl: 300, tags: (id) => ['post:' + id] } // per-entity tag
);
```

Now a mutation calls `revalidateTag` after it writes, and it works across modules with no import of the query wrapper.

```ts
// modules/comments/actions/create-comment.server.ts
'use server';
import { revalidateTag } from '@webjsdev/server';

export async function createComment(input) {
  await db.insert(comments).values(input);
  await revalidateTag('post:' + input.postId); // recompute just this post
  return { success: true };
}
```

`revalidateTag('post:5')` evicts only the id-5 entry and leaves every other id cached. That precision is the whole point. An untagged `cache()` is never touched by `revalidateTag`, so tagging is opt-in per query.

# Layer 3: caching the whole page's HTML (revalidate)

For a page that renders identical HTML for everyone, you can cache the finished HTML so the SSR pipeline runs once per window instead of once per request. This is webjs's no-build take on Next.js's ISR. You declare a window on the page module.

```ts
// app/blog/page.ts
export const revalidate = 60;   // cache this page's HTML for 60 seconds

export default async function Blog() {
  const posts = await listPosts();
  return html`...`;
}
```

Evict it early on a write with `revalidatePath('/blog')` from a server action. Time-based eviction happens on its own when the window expires.

# The safety rule you must not skip

Read this part twice. `export const revalidate` is you asserting "this page is the same for every visitor for N seconds." The HTML cache is keyed by the full URL only, with no per-user keying. So a page that reads `cookies()`, a session, or any per-user data MUST NOT set `revalidate`. If it does, the first visitor's rendered HTML can be served to the next visitor. A wrongly-cached per-user page is a data leak, plain and simple.

WebJs backs this with a framework defense. When your render reads per-user state through a framework helper (`cookies()`, `headers()`, `getSession()`, or `auth()`), the framework auto-marks the request dynamic and refuses to cache it even if you set `revalidate`, warning you once. So a dashboard page that does `const session = await auth()` fails safe. The loud caveat: this only catches reads THROUGH those helpers. If you read an auth cookie raw instead of via `cookies()`, the page can still be cached wrongly. The rule holds regardless. Read per-user state through the helpers, or never set `revalidate` on a per-user page.

# Layer 4: conditional GET (ETags and 304s)

The layers above avoid recomputing. This last one avoids re-sending bytes the client already has.

An ETag is a short fingerprint of a response, like a version stamp. WebJs puts one on every cacheable response. The browser stores it, and on the next request it sends it back in an `If-None-Match` header, effectively asking "do you still have exactly this?" If the fingerprint still matches, the server replies `304 Not Modified` with an empty body, meaning "unchanged, reuse what you have." A tiny 304 instead of the full payload.

This is on by default and needs no code. It covers cacheable SSR pages, static assets in `public/`, your app's source modules, and the core and vendor runtime uniformly. The ETag is the hash of the response body, so an identical body always produces an identical ETag.

Crucially, it distinguishes what cannot be stored from what merely cannot be SHARED. A `no-store` page (the default for dynamic and per-user pages) gets no ETag and never 304s, because `no-store` forbids storage outright and so leaves nothing to validate. A `private` response is validated normally: `private` forbids only SHARED storage, and the ETag hashes that response's own body, so one user's validator can never match another's. The same storability instinct as the `revalidate` rule, applied one layer down.

# Layer 5: content-hash asset URLs

One more, for completeness. In production webjs appends a per-file content hash to asset URLs as `?v=<hash>` and serves those with `Cache-Control: public, max-age=31536000, immutable`. Because the hash changes whenever the file's bytes change, the browser can cache the file forever and still pick up a new version after a deploy (the URL changes, so it fetches fresh). This is a no-op in dev, so your source stays byte-identical to what you wrote.

# Four caching layers, one rule

Recomputing or refetching the same result on every request is slow and wasteful, and webjs gives you four honest ways to stop doing it plus asset fingerprinting on top. Use `Cache-Control` to let browsers and CDNs hold whole responses, `cache()` with tags to memoize expensive queries and evict them precisely, `export const revalidate` to cache a page's HTML, and conditional GET (ETags into 304s) to skip re-sending unchanged bytes, all of it standing on plain HTTP. The one rule to internalize before you cache anything: a cache keyed by URL is shared across users, so only cache data that is truly the same for every visitor, and read per-user state through the framework helpers so webjs can fail safe for you.
