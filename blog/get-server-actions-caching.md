---
title: "Cacheable Server Actions With GET, ETags, and 304s"
date: 2026-06-13T11:00:00+05:30
slug: get-server-actions-caching
description: "Make a server action cacheable in WebJs by declaring it a GET. Args ride the URL, it is CSRF-exempt, and a weak ETag answers 304 so repeat reads are nearly free."
tags: server-actions, caching, etag, http, rpc
author: Vivek
---

Most frameworks with server actions make them POST-only. That is a reasonable default for a mutation, but it means every server call is uncacheable, un-ETagged, and treated as a state change even when it is a pure read. WebJs lets a server action declare its HTTP verb, so a read can be a real GET: cacheable, ETagged, CSRF-exempt, and cheap to repeat. This post is about why that matters more in WebJs than in Next, and how the declaration works.

# The one-mechanism problem

In a React app with Server Components, reads and writes take different paths. A read is a Server Component fetch that runs during render. A write is a Server Action, which is POST. Because reads never go through the action mechanism, it is fine for actions to be POST-only. The read path already has its own caching story.

WebJs has no server/client component split. There is no separate read path. A component that needs data calls a server action, and a component that mutates data calls a server action. Reads and writes both flow through the one action mechanism. So if actions were POST-only, every read would be an uncacheable POST, which throws away the entire HTTP caching layer for exactly the calls that benefit from it most. The verb has to be part of the action.

That is the honest reason WebJs needs this and Next does not. It is not that WebJs is more capable here. It is that collapsing reads and writes into one mechanism creates a requirement that the two-path design never has.

# Declaring the verb

An action declares its HTTP semantics through reserved sibling exports that the framework reads statically, the same way a page declares `export const revalidate`. The function itself stays a plain `export async function`:

```ts
// modules/users/queries/get-user.server.ts
'use server';
export const method = 'GET';
export const cache = { maxAge: 60, public: false };
export const tags = (id: string) => [`user:${id}`];
export async function getUser(id: string) {
  return db.users.find(id);
}
```

The call site never changes. A component still writes `await getUser(7)`. The verb only changes the transport. Absent a `method` export, the action is a POST, so every existing action keeps working untouched. One function per file, because the config exports describe that one function.

# What a GET buys

Declaring `method = 'GET'` changes the wire in several ways, all of them the point:

The arguments ride in the URL as query parameters instead of a request body, with a POST fallback if they exceed a 4KB cap. That makes the call a genuine idempotent GET that a cache can key on.

It is CSRF-exempt. A safe read does not change state, so it does not need the Origin check that mutations get. That keeps it cacheable at a shared layer, because there is no per-request token in play.

It carries `Cache-Control` from the `cache` export and a weak ETag derived from the response. On the next call with a matching `If-None-Match`, the server answers `304 Not Modified` with no body. The browser reuses what it has. A repeated read costs a conditional request and an empty response, not a full round trip.

There is a safety rule attached to the cache export. Setting `public: true` shares the response across users, keyed only by URL and args, so it is only ever correct for data that is identical for every visitor. A per-user or session read must stay `private`. That is the same rule a page's `export const revalidate` carries, and it is the one place a careless setting leaks one user's data to another, so the framework makes you write it explicitly.

# One thing the verb does not buy

People credit SSR seeding to the GET declaration, and it is not a GET feature. Seeding sits at the action boundary, not the transport. WebJs wraps every exported function of a `'use server'` module the same way, so an action invoked during a non-streamed server render has its result written into the page and the component's first client call resolves from that seed with no network, whether it declared `method = 'GET'` or left the default POST. A write-shaped action you happen to call during a render is seeded too.

Three limits are worth knowing, and none of them is about the verb. (Seeding is also a default rather than a guarantee: an app can turn it off, and this site does.) Seeding applies to a fully buffered render, so a page holding any pending Suspense boundary emits no seed block at all, for every action on it rather than only the deferred region. A streamed action result is never seeded either, because there is no single settled value to serialize. And a seed is consume-once and fails open, so a miss costs one ordinary RPC call and never wrong data. The whole mechanism, and the double-fetch bug it removes, is in [No double fetch](/blog/ssr-action-seeding-no-refetch).

The distinction matters when you are deciding what to declare. If the reason you are reaching for `method = 'GET'` is that hydration should not refetch, a plain POST action already gets you that wherever seeding is on. Declare a GET when you want the response cacheable and ETagged by HTTP. Do not declare one to buy a seed you were getting anyway, because that reasoning ends with a `cache` export on a read that should never have been shared.

# What a mutation does instead

A mutation declares a state-changing verb and gets the opposite treatment:

```ts
// modules/users/actions/rename.server.ts
'use server';
export const method = 'PATCH';
export const invalidates = (id: string) => [`user:${id}`];
export async function rename(id: string, name: string) {
  return db.users.update(id, { name });
}
```

A `PATCH` sends the rich body, is CSRF-protected via the Origin check, and on completion evicts its `invalidates` tags from the server cache and reports them to the client in an `X-Webjs-Invalidate` header so the browser's cache coordinator knows to revalidate a later read of that data. A GET's `tags` and a mutation's `invalidates` are the two halves of the same tag system: the read declares what it is, the write declares what it invalidates, and the framework wires the eviction. A request with the wrong method gets a `405` with an `Allow` header.

# Validation is a boundary concern

There is one more reserved export, `validate`, and where it runs is deliberate. It runs on the RPC boundary and on a public `route.ts` endpoint, not on a direct server-to-server call. The framework only CALLS your validator and reads its verdict. It ships no validation library and takes no opinion on which one you use. A `{ success: false, fieldErrors }` returns a `422` without running the action body. This keeps validation at the untrusted edge, where the request actually arrives, and out of the path where one server function calls another with already-trusted input.

# The verb is not ceremony

If reads and writes share one mechanism, that mechanism has to know the difference, because a read wants to be cached and a write must not be. WebJs puts the HTTP verb and its caching, tagging, and validation into small static config exports next to the action, so a read becomes a real GET with an ETag and a write becomes a tagged, CSRF-protected mutation, all without changing how you call it. The verb is not ceremony. It is the thing that lets one action mechanism serve both jobs correctly.
