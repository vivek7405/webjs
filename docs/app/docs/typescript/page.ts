import { html } from 'webjs';

export const metadata = { title: 'TypeScript — webjs' };

export default function TypeScript() {
  return html`
    <h1>TypeScript</h1>
    <p>webjs is built for TypeScript from the ground up, but never forces a build step. Thanks to Node 23.6+ native type stripping, your <code>.ts</code> files run directly on the server. On the client side, the dev server strips types via esbuild (~1ms per file, cached by mtime). The result: full type safety with zero configuration and instant feedback.</p>

    <h2>No-Build TypeScript</h2>
    <p>Node 23.6 introduced <code>--experimental-strip-types</code> (enabled by default since 23.6). When Node encounters a <code>.ts</code> file, it strips the type annotations at parse time and runs the resulting JavaScript. No compilation, no output directory, no source maps to manage.</p>
    <p>On the server side, webjs leverages this directly. Your pages, layouts, server actions, and middleware all run as-is.</p>
    <p>On the client side, browsers cannot parse TypeScript, so the webjs dev server transforms <code>.ts</code> files via esbuild's <code>transform()</code> API before serving them. This takes roughly 1ms per file and the result is cached by file mtime, so subsequent requests are instant. In production, <code>webjs build</code> bundles everything into a single <code>.webjs/bundle.js</code> via esbuild anyway.</p>

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
      <li><strong>module / moduleResolution: NodeNext</strong> — matches how Node 23.6+ resolves ESM imports, including <code>.ts</code> extensions.</li>
      <li><strong>isolatedModules: true</strong> — ensures every file can be transpiled independently, which matches how both Node's type stripping and esbuild operate.</li>
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
      <li>Node 23.6+ type stripping resolves <code>.ts</code> extensions natively.</li>
      <li>The browser dev server knows to look for <code>.ts</code> files and transform them.</li>
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

    <h2>superjson: Rich Types Across the Wire</h2>
    <p>Standard JSON cannot represent <code>Date</code>, <code>Map</code>, <code>Set</code>, <code>BigInt</code>, <code>RegExp</code>, <code>undefined</code>, or <code>NaN</code>. webjs uses <a href="https://github.com/blitz-js/superjson">superjson</a> for all server action RPC calls and for the <code>json()</code> / <code>richFetch()</code> helpers, so rich types survive the network round-trip.</p>
    <pre>// Server action
export async function getEvents(): Promise&lt;Event[]&gt; {
  return prisma.event.findMany(); // createdAt is a Date
}

// Client — createdAt arrives as a real Date, not a string
const events = await getEvents();
events[0].createdAt instanceof Date; // true
events[0].createdAt.toLocaleDateString(); // works</pre>
    <p>For API routes, the same content negotiation applies. Use <code>json()</code> from <code>@webjs/server</code> on the server side and <code>richFetch()</code> from <code>webjs</code> on the client side to get superjson encoding. External consumers (curl, other services) get plain JSON automatically.</p>

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

    <h2>What Node's Type Stripping Doesn't Handle</h2>
    <p>Node 23.6+ strips type annotations, but it does not transform TypeScript-only syntax that changes runtime semantics. These features will cause a syntax error at runtime:</p>
    <ul>
      <li><strong>Enums</strong> — <code>enum Direction { Up, Down }</code> generates runtime code that Node's strip-types pass cannot handle. Use a const object or union type instead:</li>
    </ul>
    <pre>// Instead of: enum Direction { Up, Down, Left, Right }
// Use a const object:
const Direction = { Up: 'up', Down: 'down', Left: 'left', Right: 'right' } as const;
type Direction = (typeof Direction)[keyof typeof Direction];

// Or a union type:
type Direction = 'up' | 'down' | 'left' | 'right';</pre>
    <ul>
      <li><strong>Namespaces</strong> — <code>namespace Foo { ... }</code> with runtime value exports. Pure type-only namespaces (containing only type declarations) are fine.</li>
      <li><strong>Parameter properties</strong> — <code>constructor(public name: string)</code> is TypeScript sugar that generates assignment code. Write the assignment explicitly:</li>
    </ul>
    <pre>// Instead of: constructor(public name: string) {}
class User {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}</pre>
    <ul>
      <li><strong>Legacy decorators</strong> — the TC39 Stage 3 decorator proposal works, but the older <code>experimentalDecorators</code> emit does not.</li>
    </ul>
    <p>esbuild (used for the browser-side transform) has the same limitations. These are not webjs restrictions but constraints of any strip-only TypeScript approach. In practice, avoiding <code>enum</code> and <code>namespace</code> is the main adjustment for most codebases.</p>

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
