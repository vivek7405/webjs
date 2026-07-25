import { html } from '@webjsdev/core';

export const metadata = { title: 'TypeScript | WebJs' };

export default function TypeScript() {
  return html`
    <h1>TypeScript</h1>
    <p>WebJs is built for TypeScript from the ground up, but never forces a build step you run. It runs on <strong>Node 24+ or Bun</strong>; on Node the type-stripping is the built-in (<code>process.features.typescript === 'strip'</code>), on Bun it is <code>amaro</code> (byte-identical). Server-side <code>.ts</code> imports work without any loader registration; browser-bound <code>.ts</code> requests go through the runtime stripper on the dev server. Both paths perform whitespace replacement: every (line, column) in the source maps to the same position in the stripped output, so no sourcemap is shipped and stack traces are byte-exact.</p>

    <h2>No-Build TypeScript</h2>
    <p>The runtime's type stripping does the heavy lifting: Node 24+'s built-in <code>module.stripTypeScriptTypes</code>, or <code>amaro</code> on Bun (the same engine Node wraps internally, so the output is byte-identical). The dev server reads each <code>.ts</code> request from disk, strips it, and serves the result. Transform time is around 1ms per file; the result is cached by mtime, so subsequent loads are instant. SSR and hydration produce identical JS because both halves use the same stripper.</p>
    <p>On the server side, your pages, layouts, server actions, and middleware run as-is. On the client side, browsers fetch <code>.ts</code> URLs and receive whitespace-stripped JS with no sourcemap appended. The URL keeps its <code>.ts</code> extension; only the response body changes. In production, <code>webjs start</code> uses the same code path, with the same mtime cache.</p>
    <p>The "no build" promise is literal: every position in source maps to itself in runtime. DevTools shows accurate stack traces without consulting a sourcemap, and wire bytes drop by roughly 70% vs a bundler-with-sourcemap pipeline.</p>

    <h2>Use .ts or .js: both are first-class</h2>
    <p>WebJs treats <code>.ts</code>, <code>.mts</code>, <code>.js</code>, and <code>.mjs</code> identically for routing and module resolution. The router recognises <code>page.ts</code> and <code>page.js</code> the same way. The action scanner recognises <code>create-post.server.ts</code> and <code>create-post.server.js</code>. Pick your preference and be consistent, or mix them freely across your project.</p>

    <h2>tsconfig.json Setup</h2>
    <p>TypeScript type-checking is entirely optional, but recommended. Here is the recommended <code>tsconfig.json</code>:</p>
    <pre>{
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
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "erasableSyntaxOnly": true
  },
  "include": [
    "app/**/*",
    "components/**/*",
    "modules/**/*",
    "lib/**/*",
    "middleware.ts"
  ],
  "exclude": ["node_modules", ".webjs", "db/migrations"]
}</pre>
    <p>Key settings explained:</p>
    <ul>
      <li><strong>erasableSyntaxOnly: true</strong>: rejects non-erasable TypeScript syntax (<code>enum</code>, <code>namespace</code> with values, constructor parameter properties, legacy decorators, <code>import = require</code>) at compile time. Required because Node's built-in stripper only supports erasable TypeScript. Violations surface as red squiggles in the editor. See <strong>TypeScript Feature Support</strong> below for the erasable equivalents.</li>
      <li><strong>noEmit: true</strong>: WebJs never compiles TypeScript to JavaScript on disk. The TypeScript compiler is used only for type-checking (<code>tsc --noEmit</code>). Node runs your <code>.ts</code> files directly via its built-in stripper.</li>
      <li><strong>allowImportingTsExtensions: true</strong>: lets you write <code>import { foo } from './bar.ts'</code> with the explicit <code>.ts</code> extension. This is the WebJs convention (see below).</li>
      <li><strong>checkJs: true</strong>: type-check your <code>.js</code> files too, using JSDoc annotations. Enables a mixed codebase where both <code>.ts</code> and <code>.js</code> files participate in the same type graph.</li>
      <li><strong>allowJs: true</strong>: include <code>.js</code> files in the project. Required alongside <code>checkJs</code>.</li>
      <li><strong>module / moduleResolution: NodeNext</strong>: matches how Node resolves ESM imports, including <code>.ts</code> extensions.</li>
      <li><strong>isolatedModules: true</strong>: ensures every file can be transpiled independently, matching the per-file transform model of Node's stripper.</li>
    </ul>

    <h2>Import Convention: the # root alias and explicit .ts extensions</h2>
    <p>WebJs apps address top-level folders through the <code>#</code> root alias (<code>#db/...</code>, <code>#lib/...</code>, <code>#modules/...</code>, <code>#components/...</code>) rather than deep <code>../../</code> relative paths. It is Node's native <code>package.json</code> <code>"imports"</code> map (the scaffold ships a single <code>"#*": "./*"</code> entry, so every top-level folder is aliased), resolved with no build step and no tsconfig <code>paths</code> on Node 24+ and Bun. The sigil is <code>#</code> with no slash after it (<code>#lib/...</code>, never <code>#/lib/...</code>). A same-directory import stays relative (<code>./sibling.ts</code>).</p>
    <p>Always use the real file extension in your imports:</p>
    <pre>// Good: explicit .ts extension
import { db } from '#db/connection.server.ts';
import { createPost } from '#modules/posts/actions/create-post.server.ts';
import type { PostFormatted } from '#modules/posts/types.ts';

// Also fine: .js files
import { slugify } from '#lib/utils/slugify.js';

// Avoid: extensionless imports don't work with Node's ESM or in browsers
import { db } from '#db/connection.server';       // ERROR</pre>
    <p>This convention works because:</p>
    <ul>
      <li>The runtime strips types from <code>.ts</code> imports server-side natively (Node 24+, or Bun). No loader hook required.</li>
      <li>The dev server reads <code>.ts</code> files from disk, strips them (Node's <code>module.stripTypeScriptTypes</code> or <code>amaro</code> on Bun), and serves the result with position-preserving whitespace replacement.</li>
      <li>When the browser requests a <code>.js</code> file that doesn't exist but a sibling <code>.ts</code> does, WebJs falls back to the <code>.ts</code> version automatically. This means libraries that import without extensions can still work.</li>
    </ul>

    <h2>Full-Stack Type Safety</h2>
    <p>Server actions in WebJs provide end-to-end type safety without code generation. When a client component imports from a <code>.server.ts</code> file, TypeScript sees the real function signature:</p>
    <pre>// modules/posts/actions/create-post.server.ts
'use server';

export type ActionResult&lt;T&gt; =
  | { success: true; data: T }
  | { success: false; error: string; status: number };

export async function createPost(
  input: unknown
): Promise&lt;ActionResult&lt;PostFormatted&gt;&gt; {
  // server-only code: database queries, auth checks, etc.
  const me = await currentUser();
  if (!me) return { success: false, error: 'Not signed in', status: 401 };
  // ...
}</pre>
    <pre>// components/new-post-form.ts: client component
import { createPost } from '#modules/posts/actions/create-post.server.ts';

// TypeScript knows createPost accepts (input: unknown)
// and returns Promise&lt;ActionResult&lt;PostFormatted&gt;&gt;
const result = await createPost({ title, body });
if (result.success) {
  // result.data is typed as PostFormatted
  console.log(result.data.slug);
}</pre>
    <p>At runtime, the browser never receives the server code. WebJs replaces the import with a thin RPC stub that calls <code>POST /__webjs/action/:hash/createPost</code>. But TypeScript's type checker sees through the <code>.server.ts</code> boundary and validates argument/return types at compile time.</p>

    <h2>Typed metadata and page props</h2>
    <p>The same isomorphic <code>@webjsdev/core</code> surface a page already imports <code>html</code> from also exports the types for its routing files, so metadata, page / layout / route-handler props, and client-router hrefs all type-check. Every one is a pure type (zero runtime, erased at strip time, no build cost).</p>

    <h3>Page metadata: <code>Metadata</code> and <code>generateMetadata</code></h3>
    <p>A page or layout exports <code>metadata</code> (static) or <code>generateMetadata(ctx)</code> (request-scoped). Annotate the return with the exported <code>Metadata</code> type so a misspelled field (<code>titel</code>, <code>descripton</code>) or a wrong-typed value (<code>themeColor: 123</code>) is a compile-time error, the same ergonomics as Next.js's <code>import type { Metadata } from 'next'</code> (#257). <code>MetadataContext</code> types the <code>generateMetadata</code> argument.</p>
    <pre>import type { Metadata, MetadataContext } from '@webjsdev/core';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Latest posts',
  openGraph: { type: 'website', image: '/og.png' },
  twitter: { card: 'summary_large_image' },
};

export async function generateMetadata(ctx: MetadataContext): Promise&lt;Metadata&gt; {
  return { title: ${'`Post: ${ctx.params.slug}`'}, metadataBase: new URL(ctx.url).origin };
}</pre>
    <p><code>Metadata</code> covers every field the SSR pipeline reads. Each field is optional, and string-or-object fields (<code>title</code>, <code>viewport</code>, <code>robots</code>, <code>appleWebApp</code>, <code>icons</code>) are unions, so both forms type-check. <code>MetadataContext</code> is <code>{ params, searchParams, url, actionData }</code> (where <code>actionData</code> is set only on a failed-page-action re-render). See <a href="/docs/metadata-routes">Metadata Routes</a> for the full field reference.</p>

    <h3>Page / layout / route-handler props (<code>PageProps</code>, <code>LayoutProps</code>, <code>RouteHandlerContext</code>)</h3>
    <p>A page default export receives <code>{ params, searchParams, url, actionData }</code>; a layout receives the same plus <code>children</code>; a <code>route.ts</code> handler receives <code>(request, { params })</code>. Type each with the exported helpers so a typo in a param name or a wrong-typed field is a compile-time error (#258).</p>
    <pre>import type { PageProps, LayoutProps, RouteHandlerContext } from '@webjsdev/core';

// A static route: params is Record&lt;string, string&gt;.
export default function About({ searchParams }: PageProps) { /* ... */ }

// A dynamic route: pass the route literal to narrow params.
export default function Post({ params }: PageProps&lt;'/blog/[slug]'&gt;) {
  const slug = params.slug; // typed string
  /* ... */
}

// A layout adds children: TemplateResult.
export default function RootLayout({ children }: LayoutProps) { /* ... */ }

// A route handler's 2nd arg.
export async function GET(req: Request, ctx: RouteHandlerContext) {
  return Response.json({ id: ctx.params.id });
}</pre>
    <p><code>PageProps&lt;R&gt;</code> / <code>LayoutProps&lt;R&gt;</code> / <code>RouteHandlerContext&lt;R&gt;</code> take an optional route literal <code>R</code>. With no <code>R</code> (or in an app that has not generated route types), <code>params</code> is <code>Record&lt;string, string&gt;</code>, the runtime default. With <code>R</code> set to a generated dynamic route, <code>params</code> narrows to its exact shape (<code>{ slug: string }</code>, <code>{ rest: string[] }</code>, <code>{ slug?: string[] }</code>). The shapes mirror what the server actually passes, NOT Next.js's superset.</p>

    <h3>The generated route union (<code>webjs types</code>)</h3>
    <p>Run <code>webjs types</code> to generate <code>.webjs/routes.d.ts</code>, an opt-in overlay that augments <code>@webjsdev/core</code> with one key per route in <code>app/</code>. It narrows two things at tsserver time.</p>
    <ul>
      <li>The <code>Route</code> href type that <code>navigate()</code> and a typed <code>&lt;a href&gt;</code> accept: <code>navigate('/blog/anything')</code> is accepted, <code>navigate('/nonexistent')</code> is a type error. Until you generate the types, <code>Route</code> is <code>string</code>, so <code>navigate()</code> is unconstrained, non-breaking for JSDoc apps and un-generated apps alike.</li>
      <li>Per-route <code>params</code>: <code>PageProps&lt;'/blog/[slug]'&gt;['params']</code> becomes <code>{ slug: string }</code>, derived from the generated <code>RouteParamMap</code>.</li>
    </ul>
    <pre>webjs types     # writes .webjs/routes.d.ts (count of routes printed)</pre>
    <p><code>webjs dev</code> also emits it automatically at startup and re-emits after each route rebuild, so an editor always has fresh route types. The file is gitignored (regenerated per machine, like Next's <code>.next/types</code>); the scaffold <code>tsconfig.json</code> lists <code>.webjs/routes.d.ts</code> in <code>include</code> so tsserver picks it up. To opt in for an existing app, run <code>webjs types</code> once and ensure your <code>tsconfig.json</code> <code>include</code> lists <code>.webjs/routes.d.ts</code>. This is webjs's no-build equivalent of Next 15's <code>typedRoutes</code>, achieved via interface declaration-merging rather than a bundler. Output is deterministic (sorted keys), so re-running yields a byte-identical file.</p>

    <h2>Rich Types Across the Wire</h2>
    <p>Standard JSON cannot represent <code>Date</code>, <code>Map</code>, <code>Set</code>, <code>BigInt</code>, <code>undefined</code>, <code>NaN</code>, <code>Infinity</code>, <code>TypedArray</code>, <code>Blob</code>, <code>File</code>, or <code>FormData</code>. WebJs ships its own pure-ESM serializer (in <code>@webjsdev/core</code>) used for all server action RPC calls and for the <code>json()</code> / <code>richFetch()</code> helpers, so rich types survive the network round-trip, including binary content (file uploads through actions just work).</p>
    <pre>// Server action
export async function getEvents(): Promise&lt;Event[]&gt; {
  return db.query.events.findMany(); // createdAt is a Date
}

// Client: createdAt arrives as a real Date, not a string
const events = await getEvents();
events[0].createdAt instanceof Date; // true
events[0].createdAt.toLocaleDateString(); // works</pre>
    <p>For API routes, the same content negotiation applies. Use <code>json()</code> from <code>@webjsdev/server</code> on the server side and <code>richFetch()</code> from <code>webjs</code> on the client side to get rich-type encoding. External consumers (curl, other services) get plain JSON automatically.</p>

    <h2>Typing the <code>auth()</code> Session User</h2>
    <p><code>auth()</code> resolves <code>{ user }</code>, and by default <code>user</code> is <code>Record&lt;string, unknown&gt;</code>, so reading a custom field your <code>session</code>/<code>jwt</code> callbacks set (such as <code>session.user.id</code>) needs a cast and a typo is not caught. Two opt-in, types-only ways make <code>user</code> typed.</p>
    <p>Augment the <code>AuthUser</code> interface (NextAuth/Auth.js style) to type every <code>auth()</code> call across the app:</p>
    <pre>declare module '@webjsdev/server' {
  interface AuthUser {
    id: string;
    role: 'admin' | 'member';
  }
}</pre>
    <p>Or parameterise the factory to type one instance without a global augmentation: <code>createAuth&lt;AppUser&gt;(...)</code> returns an <code>auth()</code> whose <code>user</code> is <code>AppUser</code>:</p>
    <pre>const { auth } = createAuth&lt;AppUser&gt;({ secret, providers });
const session = await auth();
session?.user.role; // typed, no cast</pre>
    <p>Un-augmented and un-parameterised, <code>AuthUser</code> is empty and resolves back to <code>Record&lt;string, unknown&gt;</code>, so pre-existing untyped code keeps compiling. The declared fields should mirror what the callbacks write onto <code>session.user</code>. See <a href="/docs/auth">Auth</a>.</p>

    <h2>JSDoc Alternative</h2>
    <p>If you prefer <code>.js</code> files, you can achieve the same type safety using JSDoc annotations with <code>checkJs: true</code> in your tsconfig:</p>
    <pre>// db/connection.server.js
import * as schema from './schema.server.js';
const { DatabaseSync } = await import('node:sqlite');
const { drizzle } = await import('drizzle-orm/node-sqlite');
export const db = drizzle({ client: new DatabaseSync('db/dev.db'), relations: schema.relations });

/**
 * @param {{ title: string, body: string }} input
 * @returns {Promise&lt;{ success: boolean, data?: Post, error?: string }&gt;}
 */
export async function createPost(input) {
  // TypeScript checks types via JSDoc, same strictness
}</pre>
    <p>You can also define complex types with <code>@typedef</code>:</p>
    <pre>/**
 * @typedef {{
 *   id: number,
 *   title: string,
 *   slug: string,
 *   body: string,
 *   createdAt: Date,
 *   author: { name: string, email: string }
 * }} PostFormatted
 */

/** @param {PostFormatted} post */
export function formatDate(post) {
  return post.createdAt.toLocaleDateString();
}</pre>
    <p>JSDoc-typed <code>.js</code> files and <code>.ts</code> files can import each other freely. The type checker treats them as part of the same project.</p>

    <h2>TypeScript Feature Support: Erasable Only</h2>
    <p>WebJs uses Node 24+'s built-in <code>module.stripTypeScriptTypes</code> as its primary stripper. That stripper only supports <strong>erasable TypeScript</strong>: type annotations, <code>interface</code>, <code>type</code>, <code>declare</code>, generics, <code>import type</code>, <code>as</code> casts, <code>satisfies</code>. Non-erasable syntax is rejected at compile time (via <code>erasableSyntaxOnly: true</code>) and at runtime.</p>
    <p>What's not allowed, and what to write instead:</p>
    <ul>
      <li><strong>Enums</strong> are not allowed. Use a <code>const</code> object plus a derived union type.</li>
      <li><strong>Namespaces with values</strong> are not allowed. Use a plain object or an ES module.</li>
      <li><strong>Constructor parameter properties</strong> are not allowed. Declare the field explicitly and assign in the constructor body.</li>
      <li><strong>Legacy decorators with <code>emitDecoratorMetadata</code></strong> are not allowed. Stage-3 standard decorators work fine.</li>
      <li><strong><code>import = require()</code></strong> is not allowed. Use standard ES import.</li>
      <li><strong>Generics</strong>, type aliases, interfaces, type assertions, satisfies, const assertions: all supported (these are erasable).</li>
    </ul>
    <pre>// Not allowed (red squiggle with erasableSyntaxOnly):
enum Direction { Up, Down, Left, Right }
class User { constructor(public name: string) {} }
namespace Util { export const VERSION = '1.0'; }

// Erasable equivalents:
const Direction = { Up: 'up', Down: 'down', Left: 'left', Right: 'right' } as const;
type Direction = (typeof Direction)[keyof typeof Direction];

class User {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}

const Util = { VERSION: '1.0' };</pre>
    <p>This constraint exists because Node's stripper performs whitespace replacement, not AST regeneration. <code>enum</code> requires emitting a real runtime object, which would change line numbers and require shipping a sourcemap. Banning it preserves the byte-exact position property.</p>
    <p>WebJs is buildless end-to-end: there is no bundler fallback for non-erasable syntax. If a <code>.ts</code> file uses <code>enum</code>, <code>namespace</code> with values, parameter properties, legacy decorators with <code>emitDecoratorMetadata</code>, or <code>import = require</code>, Node's stripper throws and the dev server returns a 500 naming the file and pointing at the <code>no-non-erasable-typescript</code> lint rule. The companion <code>erasable-typescript-only</code> rule additionally warns when <code>erasableSyntaxOnly</code> is missing or off in <code>tsconfig.json</code>, so the compiler catches the same constructs at edit time. The realistic edge case (a third-party package shipping raw non-erasable <code>.ts</code>) is rare in practice: published packages compile to <code>.js</code> with sidecar <code>.d.ts</code> files, which the runtime serves as plain JavaScript with no transform.</p>

    <h2>Mixed Codebases</h2>
    <p><code>.js</code> and <code>.ts</code> files can coexist in the same WebJs project and import each other without restriction:</p>
    <pre>my-app/
app/
  layout.ts                # TypeScript
  page.js                  # JavaScript
  blog/
    page.ts                # TypeScript
    [slug]/
      page.ts
components/
  counter.ts               # TypeScript component
  footer.js                # JavaScript component
db/
  connection.server.ts
lib/
  utils.js                 # JSDoc-typed JavaScript
middleware.ts              # TypeScript
tsconfig.json</pre>
    <pre>// app/page.js can import from .ts files
import '#components/counter.ts';

// lib/utils.js can import from .ts files
import { db } from '#db/connection.server.ts';

// app/blog/page.ts can import from .js files
import '#components/footer.js';</pre>
    <p>The router, action scanner, dev server, and production bundler all accept <code>.ts</code>, <code>.mts</code>, <code>.js</code>, and <code>.mjs</code> interchangeably. Type-check the whole project with a single <code>tsc --noEmit</code>.</p>

    <h2>Running Type Checks</h2>
    <p>WebJs does not type-check at runtime or during dev serving. Add a type-check command to your workflow:</p>
    <pre>{
  "scripts": {
    "dev": "webjs dev",
    "start": "webjs start",
    "typecheck": "tsc --noEmit",
    "typecheck:watch": "tsc --noEmit --watch"
  }
}</pre>
    <p>Run <code>npm run typecheck</code> in CI or as a pre-commit hook. The dev server stays fast because it only strips types. Full type analysis is a separate, parallelizable step.</p>
  `;
}
