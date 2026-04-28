import { html } from '@webjskit/core';

export const metadata = { title: 'TypeScript — webjs' };

export default function TypeScript() {
  return html`
    <h1>TypeScript</h1>
    <p>webjs is built for TypeScript from the ground up, but never forces a build step you run. The dev server transforms TypeScript via esbuild for both server-side imports and browser-bound modules — same transformer for both, so SSR and hydration always produce equivalent JS. No compilation step, no output directory, full TypeScript feature support.</p>

    <h2>No-Build TypeScript</h2>
    <p>When the dev server starts, it registers an esbuild loader hook with Node (<code>module.register()</code>). From that point on, every <code>.ts</code> import — whether from a server-side route file or a browser fetch of <code>/components/foo.ts</code> — flows through esbuild's <code>transform()</code> API. The transform takes roughly 1ms per file and the result is cached by file mtime, so subsequent loads are instant.</p>
    <p>Because the same transformer runs on both sides, you can use any TypeScript feature esbuild supports (enums, decorators, parameter properties, namespaces, generics) without worrying about a mismatch between SSR and hydration. On the server side, your pages, layouts, server actions, and middleware run as-is. On the client side, browsers fetch <code>.ts</code> URLs and receive the transformed JS — the URL keeps its <code>.ts</code> extension; only the response body is JS.</p>
    <p>In production, <code>webjs build</code> bundles everything into a single <code>.webjs/bundle.js</code> via esbuild for optimal cold-start performance. The build step is opt-in — <code>webjs start</code> will fall back to per-request transforms if no bundle is present.</p>

    <h2>Use .ts or .js — Both Are First-Class</h2>
    <p>webjs treats <code>.ts</code>, <code>.mts</code>, <code>.js</code>, and <code>.mjs</code> identically for routing and module resolution. The router recognises <code>page.ts</code> and <code>page.js</code> the same way. The action scanner recognises <code>create-post.server.ts</code> and <code>create-post.server.js</code>. Pick your preference and be consistent, or mix them freely across your project.</p>

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
    "verbatimModuleSyntax": false
  },
  "include": [
    "app/**/*",
    "components/**/*",
    "modules/**/*",
    "lib/**/*",
    "middleware.ts"
  ],
  "exclude": ["node_modules", ".webjs", "prisma/migrations"]
}</pre>
    <p>Key settings explained:</p>
    <ul>
      <li><strong>noEmit: true</strong> — webjs never compiles TypeScript to JavaScript on disk. The TypeScript compiler is used only for type-checking (<code>tsc --noEmit</code>). Node runs your <code>.ts</code> files directly.</li>
      <li><strong>allowImportingTsExtensions: true</strong> — lets you write <code>import { foo } from './bar.ts'</code> with the explicit <code>.ts</code> extension. This is the webjs convention (see below).</li>
      <li><strong>checkJs: true</strong> — type-check your <code>.js</code> files too, using JSDoc annotations. Enables a mixed codebase where both <code>.ts</code> and <code>.js</code> files participate in the same type graph.</li>
      <li><strong>allowJs: true</strong> — include <code>.js</code> files in the project. Required alongside <code>checkJs</code>.</li>
      <li><strong>module / moduleResolution: NodeNext</strong> — matches how Node resolves ESM imports, including <code>.ts</code> extensions.</li>
      <li><strong>isolatedModules: true</strong> — ensures every file can be transpiled independently, matching esbuild's per-file transform model.</li>
    </ul>

    <h2>Import Convention: Explicit .ts Extensions</h2>
    <p>In webjs projects, always use the real file extension in your imports:</p>
    <pre>// Good — explicit .ts extension
import { prisma } from '../lib/prisma.ts';
import { createPost } from '../../modules/posts/actions/create-post.server.ts';
import type { PostFormatted } from '../types.ts';

// Also fine — .js files
import { slugify } from '../utils/slugify.js';

// Avoid — extensionless imports don't work with Node's ESM or in browsers
import { prisma } from '../lib/prisma';       // ERROR</pre>
    <p>This convention works because:</p>
    <ul>
      <li>The webjs esbuild loader hook handles <code>.ts</code> imports server-side with full TypeScript feature support.</li>
      <li>The browser dev server knows to look for <code>.ts</code> files and transforms them via the same esbuild instance before serving.</li>
      <li>When the browser requests a <code>.js</code> file that doesn't exist but a sibling <code>.ts</code> does, webjs falls back to the <code>.ts</code> version automatically. This means libraries that import without extensions can still work.</li>
    </ul>

    <h2>Full-Stack Type Safety</h2>
    <p>Server actions in webjs provide end-to-end type safety without code generation. When a client component imports from a <code>.server.ts</code> file, TypeScript sees the real function signature:</p>
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
    <pre>// components/new-post-form.ts — client component
import { createPost } from '../modules/posts/actions/create-post.server.ts';

// TypeScript knows createPost accepts (input: unknown)
// and returns Promise&lt;ActionResult&lt;PostFormatted&gt;&gt;
const result = await createPost({ title, body });
if (result.success) {
  // result.data is typed as PostFormatted
  console.log(result.data.slug);
}</pre>
    <p>At runtime, the browser never receives the server code. webjs replaces the import with a thin RPC stub that calls <code>POST /__webjs/action/:hash/createPost</code>. But TypeScript's type checker sees through the <code>.server.ts</code> boundary and validates argument/return types at compile time.</p>

    <h2>Rich Types Across the Wire</h2>
    <p>Standard JSON cannot represent <code>Date</code>, <code>Map</code>, <code>Set</code>, <code>BigInt</code>, <code>undefined</code>, <code>NaN</code>, <code>Infinity</code>, <code>TypedArray</code>, <code>Blob</code>, <code>File</code>, or <code>FormData</code>. webjs ships its own pure-ESM serializer (in <code>@webjskit/core</code>) used for all server action RPC calls and for the <code>json()</code> / <code>richFetch()</code> helpers, so rich types survive the network round-trip — including binary content (file uploads through actions just work).</p>
    <pre>// Server action
export async function getEvents(): Promise&lt;Event[]&gt; {
  return prisma.event.findMany(); // createdAt is a Date
}

// Client — createdAt arrives as a real Date, not a string
const events = await getEvents();
events[0].createdAt instanceof Date; // true
events[0].createdAt.toLocaleDateString(); // works</pre>
    <p>For API routes, the same content negotiation applies. Use <code>json()</code> from <code>@webjskit/server</code> on the server side and <code>richFetch()</code> from <code>webjs</code> on the client side to get rich-type encoding. External consumers (curl, other services) get plain JSON automatically.</p>

    <h2>JSDoc Alternative</h2>
    <p>If you prefer <code>.js</code> files, you can achieve the same type safety using JSDoc annotations with <code>checkJs: true</code> in your tsconfig:</p>
    <pre>// lib/prisma.js
/** @type {import('@prisma/client').PrismaClient} */
export const prisma = new PrismaClient();

/**
 * @param {{ title: string, body: string }} input
 * @returns {Promise&lt;{ success: boolean, data?: Post, error?: string }&gt;}
 */
export async function createPost(input) {
  // TypeScript checks types via JSDoc — same strictness
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

    <h2>TypeScript Feature Support</h2>
    <p>Because webjs uses esbuild on both the server side (loader hook) and the browser side (per-request transform), you can use any TypeScript feature esbuild supports — including features that Node's built-in type stripper rejects:</p>
    <ul>
      <li><strong>Enums</strong> — <code>enum Direction { Up, Down }</code> compiles to a runtime object. Both string and numeric enums are supported.</li>
      <li><strong>Namespaces</strong> with runtime value exports — <code>namespace Util { export const VERSION = '1.0'; }</code> compiles to an IIFE.</li>
      <li><strong>Parameter properties</strong> — <code>constructor(public name: string)</code> desugars to <code>this.name = name</code> in the constructor body.</li>
      <li><strong>Decorators</strong> — both legacy <code>experimentalDecorators</code> and Stage-3 standard decorators work.</li>
      <li><strong>Generics</strong>, type aliases, interfaces, type assertions, satisfies, const assertions — all supported.</li>
    </ul>
    <p>That said, you may still prefer erasable TypeScript (no enums, no namespaces, no parameter properties) for stylistic reasons or if you also want your code to run unchanged with TypeScript's <code>erasableSyntaxOnly</code> mode or Node's built-in stripper. Most modern TypeScript codebases trend that way anyway:</p>
    <pre>// Erasable equivalent of an enum:
const Direction = { Up: 'up', Down: 'down', Left: 'left', Right: 'right' } as const;
type Direction = (typeof Direction)[keyof typeof Direction];

// Erasable equivalent of parameter properties:
class User {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}</pre>

    <h2>Mixed Codebases</h2>
    <p><code>.js</code> and <code>.ts</code> files can coexist in the same webjs project and import each other without restriction:</p>
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
lib/
  prisma.ts
  utils.js                 # JSDoc-typed JavaScript
middleware.ts              # TypeScript
tsconfig.json</pre>
    <pre>// app/page.js can import from .ts files
import '../components/counter.ts';

// lib/utils.js can import from .ts files
import { prisma } from './prisma.ts';

// app/blog/page.ts can import from .js files
import '../components/footer.js';</pre>
    <p>The router, action scanner, dev server, and production bundler all accept <code>.ts</code>, <code>.mts</code>, <code>.js</code>, and <code>.mjs</code> interchangeably. Type-check the whole project with a single <code>tsc --noEmit</code>.</p>

    <h2>Running Type Checks</h2>
    <p>webjs does not type-check at runtime or during dev serving. Add a type-check command to your workflow:</p>
    <pre>{
  "scripts": {
    "dev": "webjs dev",
    "start": "webjs start",
    "typecheck": "tsc --noEmit",
    "typecheck:watch": "tsc --noEmit --watch"
  }
}</pre>
    <p>Run <code>npm run typecheck</code> in CI or as a pre-commit hook. The dev server stays fast because it only strips types; full type analysis is a separate, parallelizable step.</p>
  `;
}
