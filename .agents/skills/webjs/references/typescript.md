# TypeScript

## What This Covers

- TypeScript at runtime with **no build step**: `.ts` / `.mts` is stripped in place, not compiled.
- **Erasable syntax only** (`erasableSyntaxOnly: true`) and the exact list of banned constructs, with their allowed rewrites.
- The **pluggable stripper** (Node 24+ built-in vs `amaro` on Bun) and how the browser gets stripped source.
- **Full-stack type safety**: server-action types flow to the call site, `import type` crosses the `.server` boundary, plus the carrier rule.
- **Typing pages, layouts, and route handlers** with `PageProps` / `LayoutProps` / `RouteHandlerContext` and the generated route union (`webjs types`).

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
    "strict": true,
    "noEmit": true,
    "checkJs": true,
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "erasableSyntaxOnly": true
  }
}
```

`erasableSyntaxOnly: true` is the non-negotiable line. It aligns the compiler's accepted syntax with the stripper's, so violations surface as diagnostics instead of a runtime 500.

## Full-stack type safety

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

### The generated route union (`webjs types`)

Run `webjs types` to write `.webjs/routes.d.ts`, an opt-in overlay augmenting `@webjsdev/core` with one key per route in `app/`. It narrows two things at tsserver time:

- The `Route` href type: `navigate('/blog/anything')` passes, `navigate('/nonexistent')` is an error. Until you generate the types, `Route` is `string` (unconstrained, non-breaking for JSDoc and un-generated apps).
- Per-route `params`: `PageProps<'/blog/[slug]'>['params']` becomes `{ slug: string }`.

```sh
npx webjsdev types     # writes .webjs/routes.d.ts (route count printed)
```

`npm run dev` emits it at startup and re-emits after each route rebuild, so the editor always has fresh types. The file is gitignored (regenerated per machine, like Next's `.next/types`); the scaffold `tsconfig.json` already lists it in `include`. To opt in for an existing app, run `npx webjsdev types` once and add `.webjs/routes.d.ts` to `include`. This is webjs's no-build equivalent of Next 15's `typedRoutes`, achieved via interface declaration-merging rather than a bundler.

### The `webjs` config block and auth user

The `webjs` object in `package.json` has two typed references so a typo'd key is diagnosed instead of dropped: a JSON Schema (VS Code flags an unknown key while you edit) and the `WebjsConfig` type from `@webjsdev/core`. Type `auth()`'s session user by augmenting the `AuthUser` interface (types every `auth()` call) or by parameterising `createAuth<AppUser>(...)` (types one instance), both types-only. Un-augmented, `user` resolves to `Record<string, unknown>`.

Both `@webjsdev/core` and `@webjsdev/server` ship hand-authored `.d.ts` overlays with a `types` export condition, so a `strict` + `nodenext` app resolves real types for either import with no TS7016 error. The runtime stays plain `.js` + JSDoc; the overlays cost nothing at runtime.
