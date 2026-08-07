# Data and Actions

## What This Covers

- The `modules/<feature>/` architecture (thin `app/` adapters, `actions/` mutations, `queries/` reads, one function per file)
- `'use server'` RPC actions, the serializer-safe wire, and how a client import becomes a typed stub
- Input validation at the boundary via `export const validate`
- HTTP-verb config exports (`method`, `cache`, `tags`, `invalidates`, `middleware`), the middleware `ctx` shape, and `actionSignal()` cancellation
- The `ActionResult<T>` envelope and its robust failure detection
- The `route()` REST adapter that exposes an action over HTTP
- Drizzle rc.3 reads (`db.query.*`) and mutations (`.returning()`)
- Keeping server-only types off the client (`import type` vs a value import)

Read this when a task touches a server mutation, a data read, input validation, a REST endpoint, or the shape a component consumes. Sibling refs: `routing-and-pages.md` (where a bound form lives on a page, `route.ts` handlers), `auth-and-sessions.md` (protecting an action or endpoint), `optimistic-ui.md` (consuming `ActionResult` on the client), `typescript.md` (erasable syntax, full-stack types).

## The Architecture (read this first)

`app/` is routing ONLY: thin adapters that import from `modules/`. Feature logic lives under `modules/<feature>/`.

- `modules/<feature>/actions/*.server.ts` mutations (create, update, delete)
- `modules/<feature>/queries/*.server.ts` reads
- `modules/<feature>/components/*.ts` feature-owned components (shared UI goes in top-level `components/`)
- `modules/<feature>/utils/*.ts` pure helpers (no `'use server'`, no DB)
- `modules/<feature>/types.ts` browser-safe typedefs (no runtime server import)

**One exported function per action / query file, named after the file.** A configured `.server.ts` file with more than one callable function is a `webjs check` error. App-internal imports use the `#` root alias (`#modules/...`, `#db/...`), not deep `../../../` relatives.

## The `.server.ts` boundary

`.server.ts` is the one server boundary. It is BOTH source protection (the file router never serves the source) AND, with `'use server'`, an RPC mechanism.

| File | `'use server'`? | What it is |
|---|---|---|
| `*.server.ts` | yes | Server action. Source-protected AND RPC-callable; the browser import becomes a stub POSTing to `/__webjs/action/<hash>/<fn>`. |
| `*.server.ts` | no | Server-only utility. Source-protected; the browser import is a throw-at-load stub. |
| plain `.ts` | yes | Lint violation (`use-server-needs-extension`). Rename to add `.server.`. |
| plain `.ts` | no | Browser-safe. |

**Importing the action IS the API.** The dev server rewrites a client import into a typed RPC stub, so you write `await createPost({ title })` and never hand-write `fetch()`. REST over HTTP is a `route.ts` that calls the action (below). Never import a no-`'use server'` utility directly into a shipping page / layout / component; its browser stub throws at load. Reach it through a `'use server'` action instead.

## A query and an action

Reads live in `queries/`, mutations in `actions/`. Both are `.server.ts` with `'use server'`, so their browser imports become typed RPC stubs. Args and returns round-trip through the serializer (it carries `Date` / `Map` / `Set` / `BigInt` / `Error` / typed arrays / `Blob` / `File` / `FormData` / cycles), so a query may return a `Date` and the client receives a real `Date`.

```ts
// modules/posts/queries/list-posts.server.ts
'use server';
import { db } from '#db/connection.server.ts';
export async function listPosts() {
  return db.query.posts.findMany({
    where: { published: true },
    orderBy: { createdAt: 'desc' },
  });
}
```

```ts
// modules/posts/actions/create-post.server.ts
'use server';
import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';
export async function createPost(input: { title: string; body: string }) {
  const title = String(input?.title || '').trim();
  if (!title) return { success: false, error: 'title required', status: 400 };
  const [row] = await db.insert(posts).values({ title, body: String(input?.body || '') }).returning();
  return { success: true, data: row };
}
```

A page runs on the server, so it imports the query directly and awaits it. A client component imports the action and calls it (rewritten to an RPC stub).

## The Drizzle query surface (rc.3)

**Reads go through the relational query API** (`db.query.<table>.findFirst` / `.findMany`), NOT `db.select().from()`. Filter with a plain object `where` (the RQBv2 shape), order with an `orderBy` object, and pull relations with `with`.

```ts
const post = await db.query.posts.findFirst({
  where: { slug: input.slug },
  with: { author: { columns: { name: true } } },
});
const rows = await db.query.posts.findMany({
  where: { authorId: me.id },
  orderBy: { createdAt: 'desc' },
  columns: { id: true, slug: true, title: true },
});
```

Two rc.3 removals trip older tutorials: `db.select({ ... })` with a projection object is a `TS2554` (call `select()` with NO argument for the full row, then narrow in JS), and `.returning({ ... })` with a field object is also `TS2554` (call `.returning()` bare).

**Mutations** use the query-builder with the imported SQL operators (`eq`, `and`, `inArray` from `drizzle-orm`) and read back with a no-arg `.returning()`:

```ts
import { eq } from 'drizzle-orm';
const [row] = await db.insert(posts).values({ title, body, authorId: me.id }).returning();
const [updated] = await db.update(posts).set({ title }).where(eq(posts.id, id)).returning();
await db.delete(posts).where(eq(posts.id, id));
```

A `.returning()` row is the table's own columns only, never `with` relations. When the caller wants a joined shape, re-read with `db.query.*` or splice the already-known related value in by hand. Full surface at https://webjs.dev/docs.

## Input validation at the boundary

Declare `export const validate` beside the action. It runs SERVER-SIDE before the action body on every BOUNDARY (the RPC endpoint, a `route()` REST endpoint, and a form submission), receiving the action's FIRST argument. On the form boundary that first argument is the `FormData`, and a `{ success: false, fieldErrors }` return becomes a 422 RE-RENDER of the page with the validator's result on `actionData`, rather than a JSON 422. The framework only CALLS the validator (it ships no validation library) and reads its return: `{ success: true, data? }` runs the action (an optional `data` replaces the input), `{ success: false, fieldErrors }` returns a 422 WITHOUT running the body, and a THROW becomes a sanitized error.

```ts
// modules/posts/actions/create-post.server.ts
'use server';
export interface CreatePostInput { title: string; body: string }

// `unknown` is CORRECT here and nowhere else in this file: the validator IS
// the narrowing site for an untrusted wire payload. Never `any`, which would
// un-type the returned `data` and with it the action's own input.
export const validate = (input: unknown) => {
  const raw = (input ?? {}) as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  const title = String(raw.title ?? '').trim();
  if (!title) fieldErrors.title = 'Title is required';
  if (String(raw.body ?? '').length < 10) fieldErrors.body = 'Too short';
  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  // `satisfies` ties the validator's output to the action's input, so the two
  // cannot drift apart.
  return { success: true, data: { title, body: String(raw.body) } satisfies CreatePostInput };
};
export async function createPost(input: CreatePostInput) { /* runs only when valid */ }
```

A client call resolves with the failure envelope (it does NOT throw), so the component reads `result.fieldErrors`. A zod adapter wraps `safeParse` so its result becomes the envelope; the framework stays zod-free.

## Binding an action to a form

A `<form action=${importedAction}>` is the one way a form submits to a server action, and it is the whole wiring:

```ts
import { createPost } from '#modules/posts/actions/create-post.server.ts';
html`<form action=${createPost}><input name="title"></form>`;
```

The renderer omits the `action` attribute so the form posts to the page's own url, supplies `method="post"` and an enctype, and emits a hidden `__webjs_action` field carrying the action's `<hash>/<fn>` identity, the same identity the RPC endpoint resolves. Nothing about the action's source reaches the browser. With JS off this is an ordinary HTML submission; with JS the client router posts the same body to the same url, so the two paths are identical by construction.

**A form-bound action always receives the `FormData`**, which is where it differs from the same function called over RPC (rich arguments) or server-to-server. `validate` is the typing seam: it takes the `FormData` and its transform-return becomes the action's typed input.

Everything the action declares applies here too, or an action would be protected over RPC and open over a form:

- `validate` runs on the submitted `FormData`.
- the `middleware` chain runs, with the page's route context (`params`, `searchParams`, `url`) added to `ctx`.
- `invalidates` is evicted when the action actually RAN (a middleware short-circuit does not evict), and the evicted tags are reported on the response so the browser's tag coordinator bypasses a stale cached GET. One reach limit: `fetch` follows the success `303` transparently, so JS cannot read a redirect's headers; the tags are on the wire and the `422` re-render carries them, and the redirect's own render is server-side and seeds fresh data.
- `invalidates` and `tags` receive the SAME first argument the action does, so on a form boundary they receive the `FormData`. `invalidates: (input) => ['post:' + input.id]` returns `post:undefined` for a submission and evicts nothing. Either read the field (`(fd) => ['post:' + fd.get('id')]`), declare a `validate` that transforms the `FormData` into the typed input first (the transform result is what the config functions then see), or use an argument-independent tag.
- `method = 'GET'` cannot be bound to a form: a GET action rides its args in the url and is CSRF-exempt, so it cannot answer a form POST. That is a `405` at runtime and the `form-action-not-a-get-action` error in `webjs check`.

The response drives the page: a success is a `303` PRG (to `result.redirect` when it is a same-site local path, else the page's own url), a failure re-renders the SAME page with `status` (default `422`) and the result on `actionData`, a submission carrying no identity is a `405`, and one whose hash no longer resolves is a `422` with a resubmit message (a form held open across a deploy). The submission is Origin-verified like an RPC call, so no token field is needed.

A streamed return (#489) is refused from a form-bound action: the RPC stub decodes frames, but a submission is answered with a redirect or a page, and with JS off there is no consumer at all. Stream from a programmatic call instead.

## HTTP-verb config exports

A `'use server'` action is a POST by default. Reserved sibling exports, read statically (the same way a page reads `export const revalidate`), change its HTTP semantics WITHOUT changing the call site (you still write `await getUser(7)`).

```ts
// modules/users/queries/get-user.server.ts: a cached, tagged GET read
'use server';
export const method = 'GET';                       // absent = POST
export const cache = 60;                            // seconds, or { maxAge, swr, public }
export const tags = (id: number) => ['user:' + id];
export async function getUser(id: number) { return db.query.users.findFirst({ where: { id } }); }
```

```ts
// a mutation evicts the tags it touches
'use server';
export const invalidates = (id: number) => ['user:' + id];
export const middleware = [requireAuth];           // async (ctx, next) => result; read ctx via actionContext()
export async function updateUser(id: number, patch: Partial<User>) { /* ... */ }
```

- A **GET** rides args in the URL (POST fallback over a 4KB cap), is CSRF-exempt, and carries a weak `ETag` (304 on `If-None-Match`); with a `cache` export it also carries `Cache-Control` + `X-Webjs-Tags` (without one it is `no-store`, so caching is opted into by `cache`, not by the verb). A **mutation** (POST/PUT/PATCH/DELETE) sends the rich body (DELETE rides the URL), is CSRF-protected, and once it completes without throwing evicts its `invalidates` tags and reports them via `X-Webjs-Invalidate` (a returned `{ success: false }` envelope still evicts, since the action ran). A method mismatch is a `405` + `Allow`.
- The `cache` object maps onto the `Cache-Control` header. The number shorthand `cache = 60` means `{ maxAge: 60 }`. `maxAge` is the freshness window in seconds (`max-age=<n>`), `swr` is a stale-while-revalidate grace window in seconds (`stale-while-revalidate=<n>`, an expired response is still served instantly while the browser revalidates in the background, usually a bodyless 304 thanks to the ETag), and `public` flips the scope from the default `private`. So `{ maxAge: 60, swr: 300 }` emits `private, max-age=60, stale-while-revalidate=300`.
- **SAFETY.** `cache` with `public: true` SHARES one response across ALL users, keyed only by URL + args. Use it ONLY for data identical for every visitor (the same rule as a page's `export const revalidate`), never for a session or per-user read.
- Per-action `middleware` short-circuits by returning an `ActionResult` instead of calling `next()`, and accumulates context the action reads via `actionContext()` from `@webjsdev/server`. Each middleware is `async (ctx, next) => result` where `ctx` is `{ request, args, signal, context }`. It writes to the shared bag `ctx.context.<key>` (for example `ctx.context.user = user`), which is exactly what `actionContext().user` reads back in the action. A direct server-to-server call skips the RPC boundary (so its middleware does NOT run), so the action must guard rather than assume a middleware-set value is present.

### Cancellation with `actionSignal()`

Inside an action, `actionSignal()` from `@webjsdev/server` returns the request's `AbortSignal`. It fires when the client disconnects OR when a newer client render supersedes this one (the RPC stub aborts the previous in-flight fetch). Thread it into the work you start, and re-check it after an await to map an abort to a cancelled envelope:

```ts
'use server';
import { actionSignal } from '@webjsdev/server';
export async function search(q: string) {
  const signal = actionSignal();
  const res = await fetch(`https://api/x?q=${q}`, { signal });   // aborts the fetch on disconnect
  if (signal.aborted) return { success: false, error: 'Request cancelled.', status: 499 };
  return { success: true, data: await res.json() };
}
```

A guard placed BEFORE any await can never fire (nothing has yielded yet). Outside an action the signal never aborts, so a server-to-server call stays safe.

## The `ActionResult<T>` envelope

Every action returns this additive envelope.

```ts
type ActionResult<T> =
  | { success: true; data?: T; redirect?: string }   // redirect MUST be a same-site local path
  | { success: false; error?: string; fieldErrors?: Record<string, string>;
      values?: Record<string, string>; status?: number };
```

**Failure detection is robust.** A result is a FAILURE when `result.success === false`, OR `result.fieldErrors` is present, OR `result.error` is present and `result.success !== true`. Everything else is a success (an explicit `success: true`, or a bare value with no error markers). This means an error is never swallowed just because the author omitted a literal `success: false`.

**`result.redirect` must be a same-site local path** (a single leading `/`). A protocol-relative `//host` or an absolute `scheme://host` URL is rejected (open-redirect guard); for a real external redirect, throw `redirect(absoluteUrl)` instead. A user-facing error message belongs on the envelope (`{ success: false, error }`), never on a raw throw, because prod sanitizes a thrown action error to a generic message plus a digest.

## Exposing an action over REST: the `route()` adapter

A public REST endpoint is a `route.ts` that imports and calls the action, optionally through the `route()` adapter from `@webjsdev/server` (it merges query + route params + JSON body into one input object and JSON-responds).

```ts
// app/api/posts/route.ts
import { route } from '@webjsdev/server';
import * as postActions from '#modules/posts/actions/create-post.server.ts';
export const POST = route(postActions);   // module namespace: applies the action's OWN validate + middleware
```

Passing the MODULE NAMESPACE lets the adapter read the action's declared `middleware` and `validate`, so a guard declared once next to the action protects the RPC and REST boundaries alike. Passing the imported FUNCTION (`route(createPost, { validate })`) cannot see sibling config exports, so it applies only what you pass. A `{ success: false, fieldErrors }` return becomes a 422 JSON response; a validator that THROWS becomes a 400.

A `route.ts` endpoint is NOT covered by the RPC CSRF check, so authenticate every mutating endpoint, use `validate`, and rate-limit (see `auth-and-sessions.md`).

## Keeping server-only types off the client

An interactive component needs the SHAPE of the data it renders, and those shapes derive from server-only modules. The one rule: **a type crossing to the browser is a TYPE, never a runtime value.** An `import type { ... }` is erased by the TypeScript stripper before the module reaches the browser. A plain `import { ... }` (a value import) survives stripping, pins the server module into the browser closure, and trips the `no-server-import-in-browser-module` check.

```ts
// SAFE: type-only, erased before it reaches the browser.
import type { Post } from '#db/schema.server.ts';
// UNSAFE: a value import survives stripping and pins the server schema. Throws at load.
import { posts } from '#db/schema.server.ts';
```

Keep the wire shape in a browser-safe `modules/<feature>/types.ts` with NO runtime import from a `.server.ts` file or from `db/`. Define a hand-written DTO, or a type-only derivation (`import type { Post } ...; export type PostFormatted = Omit<Post, 'createdAt'> & { createdAt: string }`). Never `export *` or a value re-export from a `.server.ts` in `types.ts`; that carries the runtime table bindings and breaks any component importing the types. Full reference at https://webjs.dev/docs.

## SSR action seeding, and how to tell it is working

When a shipping component's `async render()` awaits an action during SSR, WebJs serializes that result into the page and the generated RPC stub reads it on its FIRST client call. So `const u = await getUser(this.id)` runs once, on the server, and hydration reuses the result with no network round-trip.

**You write nothing for this.** It is automatic, on by default, and there is no API to call. The only thing you can do is break it, so the section below is about noticing when you have.

### The correctness boundary

A seed hit returns the value the SSR render that produced this page computed for exactly this action, function, and argument list, so a hit cannot show the user something different from the HTML they are already looking at. A page navigation evicts whatever the outgoing page left unconsumed, both the block still in the DOM and anything already ingested from it, so a departed render's value is never served. On an HTML-cached page (`export const revalidate`) the seed rides inside the cached bytes, so it is exactly as fresh as the HTML it came with. A miss simply re-fetches.

There is one shape where a hit can differ from the paint, and WebJs warns about it in dev: **an action that returns a DIFFERENT result for the SAME arguments twice in one render.** The seed carries the last result while the first component painted the first one. So keep an action deterministic for a given argument list. A counter, a `Math.random()`, a `new Date()` in the return value, or a read of mutable module state all break that rule, and dev prints:

```
[webjs] SSR action seeding: "getUser" returned two DIFFERENT results for the SAME arguments during one render. ...
```

The fix is to make the action deterministic, or to move the varying part into an argument so the two calls get different keys.

### Reading the dev diagnostics

A miss is invisible from the outside: the page still renders correctly, it just pays a round-trip per async component on every first load. Two channels make it visible in dev, and neither exists in production.

**Server side, per request.** The `X-Webjs-Seed` response header, also folded into the dev access-log line as a `seed` field:

| Value | What it means |
|---|---|
| `off` | Seeding is switched off (`"webjs": { "seed": false }` or `WEBJS_SEED=0`). Not a defect. |
| `html-cache` | The #241 HTML response cache answered. The seeds rode inside the cached bytes. |
| `collected=3, emitted=3` | Healthy. Three action results were captured and all three reached the page. |
| `collected=3, emitted=0` | The serializer threw and dropped the whole block. Something in a returned value is not serializer-safe. |
| `collected=3, emitted=0, streamed` | The page streams, so nothing could be emitted (see below). |

Check it with `curl -sSI localhost:3000/` or in the network tab.

**Browser side, per page view.** One `console.warn` at the first idle after hydration, and only when a call missed AND the client can be certain why. It stays silent otherwise, including on a page that emitted no seeds at all: every action call routes through the seed lookup, including ones that were never SSR-invoked and never could have been seeded (a mutation, a `Task` autorun, a `connectedCallback` read), so a miss there is not evidence of a defect. That case is the server header's job, where `collected=0` is unambiguous. The line names one of these:

- *"This page streams"*, so no seeds could be emitted. Expected, not a bug (see below).
- *"The page's seeds could not be serialized."* Something an action returned is not serializer-safe, so the whole block was dropped. The response header shows `collected` above `emitted` for the same reason.
- *"The page seeded these actions under DIFFERENT arguments."* The key is `hash(action file) / function name / serialized arguments`, so the client asked with an argument the SSR render never used. Common cause: the component computes its argument from browser-only state (a `localStorage` read, a `connectedCallback` assignment), which the server render could not have known. A miss on an action the page never seeded at all is NOT reported, because a mutation or a client-only read routes through the same lookup and could never have been seeded.

A miss AFTER hydration is correct and is not reported: the seed is consume-once, so a deliberate refetch or an argument change is supposed to go to the network.

`seedStats()` from `@webjsdev/core` returns `{ ingested, replaced, hits, misses, keyMisses, pending }` (`keyMisses` being the provable subset of `misses`, a call for an action the page seeded under other arguments) if you want to assert this in a browser test or read it from the console. A non-zero `pending` at rest usually means the seeding component ELIDED, so its module never shipped and nothing on the client was ever going to consume the seed. `pending` covers the page you are on: a page navigation evicts whatever the outgoing page left unconsumed, both the block still sitting in the DOM and anything already ingested from it, since those values belong to a render no longer on screen.

### The streamed-page exception

A page carrying a `Suspense` or `<webjs-suspense>` boundary emits NO seed block at all, not just none for the streamed region: a streamed render's deferred boundaries resolve after the first flush, so their results cannot ride the block. Every action call on that page goes to the network on hydration. That is a real trade, so make it deliberately: reach for a streaming boundary when a slow region would otherwise block the first byte, and leave a fast page buffered so it seeds.

### Switching it off

`"webjs": { "seed": false }` in `package.json`, or `WEBJS_SEED=0`. The client then re-fetches on hydration exactly as it did before the feature, and stale-while-revalidate hides the flicker. Turn it off only to isolate a problem; there is no reason to ship with it off.
