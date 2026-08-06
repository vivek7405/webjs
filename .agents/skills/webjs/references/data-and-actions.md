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
- A form whose buttons run DIFFERENT actions binds each on its submitter, `<button formaction=${publishDraft}>`, inside a form that is itself bound. **The enclosing form must be bound**, because `method="post"` and the enctype are supplied on the form's start tag and a per-button action cannot retrofit them. The renderer refuses an unbound host form it can see, but a submitter in a COMPONENT is a cannot-tell (the component renders in its own pass with no view of the host page) and binds anyway. What ships then is a form with no `method`, so the browser submits it as a GET, the reserved `__webjs_action` identity rides the query string, the action never runs, and the page re-renders with a 200. Nothing throws and nothing logs. `webjs check`'s `submitter-needs-bound-form` resolves this across modules and flags it at edit time; see `muscle-memory-gotchas.md` for the shape.

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
