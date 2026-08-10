---
title: "No Double Fetch: Seeding SSR Data So Hydration Does Not Re-Request"
date: 2026-06-05T13:00:00+05:30
slug: ssr-action-seeding-no-refetch
description: "The classic SSR double-fetch problem, where the server renders with data and the client hydrates and fetches the same data again. How WebJs eliminates it with automatic SSR action-result seeding, no props to pass down and no query-cache hydration boundary."
tags: ssr, hydration, server-actions, performance, no-build
author: Vivek
---

Some bugs get filed. This one almost never does, because nobody notices they are paying for it. Your app server-renders a component with real data, ships the HTML, the browser paints it, and then the component hydrates and quietly fetches the exact same data a second time. The result is already on screen. The query already ran. And the client fires another request at the network to fetch a copy of what the user is looking at.

I only started calling it "the double fetch" once I went looking for it. Before that it lived in the background as a wasted round trip, a maybe-flicker when the second result swaps in, and a server answering the same question twice per page. It ships constantly in server-rendered apps precisely because it is invisible. Everything works. The page is just slower and busier than it has any reason to be.

I did not want WebJs to have a shape where that bug can hide, and the fix turned out to be a feature you never reach for. It is SSR action-result seeding.

# Why the bug is so easy to ship

In React or Next, the server fetch and the client fetch are two different pieces of code, and the only thing stopping the second one is your discipline. You fetch on the server, then you physically carry that value into the client so hydration does not go get it again. Either you thread it down as a prop through every layer between the fetch and the component that needs it, or you stand up a query-cache hydration boundary and dehydrate and rehydrate the cache across the wire.

```tsx
// the manual version: fetch on the server, then pass it down by hand
export default async function Page() {
  const user = await getUser(uid);          // server fetch
  return <UserProfile initialUser={user} />; // now prop-drill it in
}

function UserProfile({ initialUser }) {
  const { data } = useQuery(['user', uid], () => fetchUser(uid), {
    initialData: initialUser,               // and remember to seed the cache
  });
  // ...
}
```

Look at what those two extra lines are for. `initialUser` exists only to stop the refetch. `initialData` exists only to stop the refetch. Forget either one and the page still works, it just fetches twice, silently, forever. That is the whole reason the bug ships so often. The framework did the server query and then handed you the job of carrying the answer across, so the correctness of the optimization rides on a human remembering a prop.

# In WebJs there is nothing to carry

You write the fetch inside the component and pass nothing.

```ts
class UserProfile extends WebComponent({ uid: String }) {
  async render() {
    const user = await getUser(this.uid);   // a 'use server' action
    return html`<h3>${user.name}</h3>`;
  }
}
UserProfile.register('user-profile');
```

`getUser` is a `'use server'` action, so during SSR it runs on the server as the real function and its result goes into the HTML. When this component ships to the browser and hydrates, its first call to `getUser(this.uid)` does not hit the network. It reads a seed the server already put in the page. The query ran once, on the server, and the client's first render reuses the result. No prop, no `initialData`, no cache boundary. There is no glue to forget because there is no glue.

# What the seed actually is

The mechanism is small enough to say in a sentence. Every `'use server'` action result computed during a non-streamed SSR render is serialized into the page, and the generated client RPC stub (the typed stub WebJs rewrites your action import into) reads that seed on its first call for a given set of arguments.

Three properties are what let me leave it on and stop thinking about it:

- It is keyed by the action hash, the function name, and the serialized arguments. The seed for `getUser(7)` is never handed to `getUser(9)`. The arguments have to match exactly.
- It is consume-once. The seed answers the first call and then it is spent. A later refetch, or a call with different arguments, goes to the network like any other request. Seeding removes the redundant hydration fetch, not your real fetches.
- It fails open. If a seed is missing for any reason, the stub just makes a normal RPC call. A miss costs you one network request, never wrong data. A mismatched key simply misses, and a navigation evicts whatever the previous page left unconsumed, so a departed render's value is never served.

The capture is the part I am happiest with, because it is exactly where a build-based framework would reach for a code transform. WebJs captures the seed through a transparent server-side `'use server'` facade that sits at the action boundary at runtime and records what SSR computed. No source transform, no build step. The file on disk is unchanged and the source in the browser network tab is unchanged. Nothing rewrites your code to inject an initial-data payload. It runs on Bun the same as on Node.

# The other half, where most of these never ship

Seeding is one side of the story. The other side is that a lot of these components do not reach the browser at all. A display-only component, one that fetches and renders with no click handlers, no signals, no interactivity, is elided. Its server-rendered HTML is already the complete and final output, so WebJs drops its JavaScript module from the page. Nothing to hydrate means nothing to refetch, and the data is already sitting in the HTML.

So the split is clean. A display-only async component ships no JavaScript, so it cannot double-fetch by construction. Seeding is the safety net for the components that do ship, the ones that are also interactive and therefore have to hydrate. Those hydrate without re-requesting what SSR already fetched. Between the two, the double fetch has nowhere left to live.

# If you ever want it off

It is on by default and I rarely touch it, but you can. Set `"webjs": { "seed": false }` in `package.json`, or `WEBJS_SEED=0` in the environment, and the stub always goes to the network on its first call. The only reason I have reached for it is to watch the raw RPC path in isolation while debugging. In normal operation the default is the thing you want.

The server already ran the query, already had the answer, already wrote it into the page the browser is showing. Asking the client to go fetch that same answer a second time was never a real requirement, just the shape most frameworks happen to have. WebJs closes the gap where the bug lives, at the action boundary, so the fastest thing and the default thing end up being the same thing. You get it by writing the obvious code and none of the glue.
