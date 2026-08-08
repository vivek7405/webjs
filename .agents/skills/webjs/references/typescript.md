# TypeScript

## What This Covers

- TypeScript at runtime with **no build step**: `.ts` / `.mts` is stripped in place, not compiled.
- **Erasable syntax only** (`erasableSyntaxOnly: true`) and the exact list of banned constructs, with their allowed rewrites.
- The **pluggable stripper** (Node 24+ built-in vs `amaro` on Bun) and how the browser gets stripped source.
- **Full-stack type safety**: the rule (derive the type at every boundary, never `unknown` / `any`), server-action types flowing to the call site, and the `import type` carrier rule across the `.server` boundary.
- **Typing pages, layouts, and route handlers** with `PageProps` / `LayoutProps` / `RouteHandlerContext` and the generated route union (`npx webjsdev types`).

Read this when you are writing `.ts` in a WebJs app, hit a strip-time 500, or want typed params and hrefs. For action signatures and the serializer wire see `data-and-actions.md`. For typing reactive props see `components.md`.

TypeScript is optional. JS + JSDoc gets the same call-site safety (the language server reads `@typedef` / `@param` / `@returns` identically). Add `"checkJs": true` to enforce it.

## No build step: how `.ts` runs

`.ts` works everywhere `.js` does, same routing conventions, same server-action behaviour. There is no user-visible `tsc` run and no build output.

- **Server-side** `.ts` imports are stripped by the runtime automatically (Node exposes `process.features.typescript === 'strip'`, Bun runs `.ts` natively).
- **Browser-bound** `.ts` requests go through the pluggable stripper on the dev server, which does whitespace replacement (every source position maps to the same output position, so stack traces stay byte-exact with no sourcemap shipped). Cached by mtime.

The stripper backs onto **Node 24+'s built-in `module.stripTypeScriptTypes`** (itself SWC's WASM transform in strip-only mode) or, on **Bun**, `amaro` loaded directly (byte-identical output). Force one with `WEBJS_TS_STRIPPER=builtin|amaro`.

## Erasable syntax only

The stripper supports **erasable TypeScript only**: type annotations, `interface`, `type`, `declare`, generics, `import type`, `as` casts, and `satisfies`. Non-erasable syntax is rejected at strip time (a 500 naming the file), so set `erasableSyntaxOnly: true` in `tsconfig.json` to catch it as an editor squiggle first. `webjs check`'s `erasable-typescript-only` rule verifies the flag is set.

Banned constructs and their erasable rewrites:

```ts
// BANNED (rejected at compile + runtime)
enum Color { Red, Green, Blue }
class Foo { constructor(public x: number) {} }   // parameter property
namespace Util { export const helper = 1; }       // value namespace
import fs = require('fs');                         // import = require
@legacyDecorator class C {}                        // legacy decorator + emitDecoratorMetadata

// ALLOWED (canonical erasable forms)
const Color = { Red: 'Red', Green: 'Green', Blue: 'Blue' } as const;
type Color = typeof Color[keyof typeof Color];

class Foo {
  x: number;
  constructor(x: number) { this.x = x; }
}

const Util = { helper: 1 };

import * as fs from 'fs';
```

A third-party `.ts` dependency shipping non-erasable syntax fails the same way (rare, most npm packages publish compiled `.js`). WebJs is buildless end-to-end with no bundler fallback, so keep `erasableSyntaxOnly` on and your own code never hits it.

Prefer explicit `.ts` extensions in imports. A `.js` specifier pointing at a `.ts` sibling also resolves in the dev server, but explicit `.ts` is clearer.

## Minimum `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "erasableSyntaxOnly": true
  },
  "include": [
    "app/**/*",
    "components/**/*",
    "modules/**/*",
    "lib/**/*",
    "test/**/*",
    "middleware.js",
    "middleware.ts",
    ".webjs/routes.d.ts"
  ],
  "exclude": ["node_modules", ".webjs/vendor", "db/migrations"]
}
```

`erasableSyntaxOnly: true` is the non-negotiable line. It aligns the compiler's accepted syntax with the stripper's, so violations surface as diagnostics instead of a runtime 500.

`test/**/*` is in the `include` on purpose (#1299), the way Next / Remix / Astro's generated configs cover the whole tree. Leave it there. A test file outside the `include` is a file `webjs typecheck` never opens, so an implicitly-`any` parameter or a wrong argument shape in a test survives until somebody reads the line, which is exactly how one reached review here. Do not add a second `tsconfig.test.json` either: a config nobody remembers to run reproduces the same gap in a new place.

Note what is absent: `checkJs`, the flag mentioned at the top of this file for a JSDoc-typed codebase (it implies `allowJs`, so it is the only one you add). Turning it on makes `tsc` read your `.js` files, which is the point, but it also pulls in browser tests written as `.js`. Those run in a real browser through web-test-runner, so their test globals are not in scope for `tsc` and each one reports a `Cannot find name 'test'`. Turn it on deliberately, and give the browser tests a `types` entry or their own exclude when you do.

## Full-stack type safety

### The rule: derive the type, never `unknown` or `any`

Every value crossing an app boundary in WebJs already has a type you can reach, so reach for it. Writing `unknown` or `any` at a boundary throws away the framework's central guarantee, and it does so silently: the app still runs, the checker just stops helping. Nothing catches this for you. Both are valid TypeScript, so `webjs check` will not flag them (it is a correctness tool, and this is a convention), and `tsc --noEmit` passes happily.

`unknown` is the more dangerous of the two, because it reads as the safe choice. It is safe only in the sense that it forces a narrow at the read site. As a boundary type it is exactly as uninformative as `any`, and it pushes a cast into every consumer.

The ladder, in the order to climb it:

| Boundary | Write this | Not this |
|---|---|---|
| A database row | `export type Todo = typeof todos.$inferSelect` in `db/schema.server.ts` (`$inferInsert` for a write) | a hand-written interface that drifts from the schema |
| That row inside a shipping component | `import type { Todo } from '#db/schema.server.ts'` | `any[]`, or re-declaring the shape by hand |
| A server action's input | a named `interface CreatePostInput` | `input: unknown` / `input: any` |
| A server action's result | `Promise<ActionResult<Post>>` | `Promise<any>` |
| `export const validate` | `(input: unknown)`, narrowed in the body, returning `data` that `satisfies` the action's input type | `(input: any)`, which un-types the returned `data` too |
| A page | `PageProps<'/blog/[slug]'>` | `{ params: Record<string, any> }` |
| A layout | `LayoutProps` (whose `children` is a `TemplateResult`) | `{ children: unknown }` |
| A route handler's 2nd argument | `RouteHandlerContext<'/api/users/[id]'>` | `{ params: any }` |
| A client-router href | the generated `Route` union (`npx webjsdev types`; `npm run dev` also emits it) | a bare `string` |
| A reactive property | `prop<Student>(Object)`, `prop<Tag[]>(Array)` | `prop(Object)` plus a cast at every read |
| An optimistic temp row | the pending shape on the row type (`pending?: boolean`) | `as any` on the temp id |

One flow, end to end, with no escape hatch anywhere in it:

```ts
// db/schema.server.ts
export const posts = table('posts', { id: uuidPk(), title: text().notNull(), body: text().notNull() });
export type Post = typeof posts.$inferSelect;      // derived, never hand-written

// modules/posts/actions/create-post.server.ts
'use server';
import type { Post } from '#db/schema.server.ts';  // type-only: erased before the browser sees it
export interface CreatePostInput { title: string; body: string }
export const validate = (input: unknown) => { /* narrows, returns data satisfying CreatePostInput */ };
export async function createPost(input: CreatePostInput): Promise<ActionResult<Post>> { /* ... */ }

// modules/posts/components/new-post.ts
import { createPost } from '#modules/posts/actions/create-post.server.ts';
const r = await createPost({ title, body });
if (r.success && r.data) r.data.title;             // Post.title: string, checked at the call site
```

The payoff is not stylistic. A typo in `r.data.titel`, a renamed column, a changed action signature, and a page reading `params.slugg` are all compile errors in that version and all silent runtime `undefined` in the `unknown` version.

### Where `unknown` is still the right type

There are two cases, and only the first is about narrowing.

**Case one: a value that genuinely has no type yet, at the moment before it is narrowed.**

```ts
// app/api/webhook/route.ts
export async function POST(req: Request) {
  const body: unknown = await req.json();   // correct: nothing has vouched for this yet
  const parsed = parseWebhook(body);        // narrowed on the very next line
  return Response.json({ ok: parsed.kind });
}
```

The test is what the next line does. Correct `unknown` here is narrowed immediately by a parse, a validator, or a type guard, and the narrowed type is what the rest of the function sees. Anything standing at that boundary qualifies: a `route.ts` handler's `await req.json()` (above), a `catch (e)` binding (already `unknown` under `strict`), an action's `export const validate`, and any validator function those delegate to. In a validator, returning `data` that `satisfies` the action's input type is what carries a real type into the action body. See `data-and-actions.md`.

**Case two: a parameter of YOUR OWN helper that forwards its argument into an `html` template hole, which is NOT narrowed.** A hole renders a string, a number, a `TemplateResult`, an array of those, a directive result, or nothing, so a helper like `lede(content: unknown)` is correctly typed and `TemplateResult` alone would be too narrow. Narrow it only when the helper genuinely accepts one shape (`backLink(href: string, ...)`).

This case is about a value YOU accept, never one the framework hands you. A layout's `children` also ends up in a hole, but the framework already types it (`LayoutProps.children` is a `TemplateResult`), so `{ children: unknown }` is a discarded type, not this carve-out.

Everywhere else `unknown` is a missing type, not a safe one: surviving into a return type, a component prop, a layout's `children`, or an action signature is the shape to fix.

`any` gets no carve-out at all in app code. It does not defer checking, it disables it, so a validator typed `(input: any)` un-types everything downstream of the call.

### Server actions type-check automatically

Calling a server action from a client component resolves at type-check time to the action's real source file. The runtime stub swap is invisible to the checker, and the RPC serializer makes runtime match the types (`Date` stays `Date`, `Map` stays `Map`, `BigInt` stays `BigInt`; see `data-and-actions.md` for the full supported set).

```ts
// modules/posts/actions/create-post.server.ts
export async function createPost(
  input: { title: string; body: string },
): Promise<ActionResult<PostFormatted>> { /* ... */ }

// modules/posts/components/new-post.ts
import { createPost } from '#modules/posts/actions/create-post.server.ts';
const r = await createPost({ title, body });
//        ^ Promise<ActionResult<PostFormatted>>
if (r.success) r.data.title;   // PostFormatted.title: string
```

Class instances arrive as plain objects (prototypes and methods lost, matching React Server Actions). The opt-in `SerializableActionFn` annotation turns that silent loss into a compile error (`Serializable<T>` / `SerializableArgs` / `SerializableResult` are also exported, all types-only).

### The carrier rule: `import type` across the `.server` boundary

A `.server.ts` file WITHOUT `'use server'` is a server-only utility whose browser stub throws at load. But a **type-only** `import type { Row } from '#db/schema.server.ts'` is safe: the stripper erases it before it can reach the browser, so sharing a derived row type from a `.server.ts` into a shipping component is fine and is not flagged. A **value** import of that same file into a shipping module is the crash the `no-server-import-in-browser-module` check catches. So carry TYPES over the boundary with `import type`, and carry DATA over it through a `'use server'` action (whose RPC stub loads safely client-side).

### Typed page / layout / route-handler props

Type each routing entry with the exported helpers so a param typo is a compile error.

```ts
import type { PageProps, LayoutProps, RouteHandlerContext } from '@webjsdev/core';

// Static route: params is Record<string, string>.
export default function About({ searchParams }: PageProps) { /* ... */ }

// Dynamic route: pass the route literal to narrow params.
export default function Post({ params }: PageProps<'/blog/[slug]'>) {
  const slug = params.slug; // typed string
}

// Layout adds children.
export default function RootLayout({ children }: LayoutProps) { /* ... */ }

// Route handler's 2nd arg.
export async function GET(req: Request, ctx: RouteHandlerContext) {
  return Response.json({ id: ctx.params.id });
}
```

With no route literal (or before you generate route types), `params` is `Record<string, string>`, the runtime default. With `R` set to a generated dynamic route, `params` narrows to its exact shape (`{ slug: string }`, `{ rest: string[] }`, `{ slug?: string[] }`). These are pure types, erased at runtime.

Type page metadata with the exported `Metadata` type (and `MetadataContext` for the `generateMetadata` argument), the same ergonomics as Next.js's `import type { Metadata } from 'next'`.

### The generated route union (`npx webjsdev types`)

Run `npx webjsdev types` to write `.webjs/routes.d.ts`, an opt-in overlay augmenting `@webjsdev/core` with one key per route in `app/`. It narrows two things at tsserver time:

- The `Route` href type: `navigate('/blog/anything')` passes, `navigate('/nonexistent')` is an error. Until you generate the types, `Route` is `string` (unconstrained, non-breaking for JSDoc and un-generated apps).
- Per-route `params`: `PageProps<'/blog/[slug]'>['params']` becomes `{ slug: string }`.

```sh
npx webjsdev types     # writes .webjs/routes.d.ts (route count printed)
```

`npm run dev` emits it at startup and re-emits after each route rebuild, so the editor always has fresh types. The file is gitignored (regenerated per machine, like Next's `.next/types`); the scaffold `tsconfig.json` already lists it in `include`. To opt in for an existing app, run `npx webjsdev types` once and add `.webjs/routes.d.ts` to `include`. This is the WebJs no-build equivalent of Next 15's `typedRoutes`, achieved via interface declaration-merging rather than a bundler.

### The `webjs` config block and auth user

The `webjs` object in `package.json` has two typed references so a typo'd key is diagnosed instead of dropped: a JSON Schema (VS Code flags an unknown key while you edit) and the `WebjsConfig` type from `@webjsdev/core`. Type `auth()`'s session user by augmenting the `AuthUser` interface (types every `auth()` call) or by parameterising `createAuth<AppUser>(...)` (types one instance), both types-only. Un-augmented, `user` resolves to `Record<string, unknown>`.

Both `@webjsdev/core` and `@webjsdev/server` ship hand-authored `.d.ts` overlays with a `types` export condition, so a `strict` + `nodenext` app resolves real types for either import with no TS7016 error. The runtime stays plain `.js` + JSDoc; the overlays cost nothing at runtime.
