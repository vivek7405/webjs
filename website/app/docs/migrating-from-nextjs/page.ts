import { html } from '@webjsdev/core';

export const metadata = {
  title: 'Migrating from Next.js | WebJs',
  description:
    'A concept map from Next.js to webjs: the no-RSC execution model, isomorphic modules and the .server boundary instead of Server/Client Components, plain <a> instead of next/link, an async page function instead of getServerSideProps, and a before/after example.',
};

export default function MigratingFromNextjs() {
  return html`
    <h1>Migrating from Next.js</h1>
    <p>WebJs is deliberately Next-adjacent: the <code>app/</code> router, the <code>page</code> / <code>layout</code> / <code>error</code> / <code>loading</code> / <code>not-found</code> / <code>route</code> / <code>middleware</code> file conventions, the metadata API, and server actions will all feel familiar. So most of the file layout ports over directly. The one thing you must un-learn is the React Server Components mental model, because WebJs does not have it.</p>

    <h2>The mental-model shift: there is no RSC</h2>
    <p>WebJs has <strong>no server/client component split</strong>. There is no server-component render tree, no Flight protocol, no <code>'use client'</code> / <code>'use server'</code> component boundary, and no per-component server-versus-client identity. Stop reasoning about a component as "server" or "client".</p>
    <p>Instead, pages, layouts, and components are <strong>isomorphic modules</strong> (the same source on server and client), and the distinction that matters is how they run:</p>
    <ul>
      <li><strong>Components hydrate.</strong> A component's module loads in the browser, the custom element upgrades, and its <code>render()</code>, lifecycle, <code>@event</code> handlers, and signals run on the client. This is islands-style, per element, and it is where ALL interactivity lives. A Next "Client Component" maps here, but you do not write a directive: writing a <code>@click</code> or a signal read is what requests the JavaScript for that behavior.</li>
      <li><strong>Pages and layouts do NOT hydrate.</strong> Their function runs only on the server to produce HTML and is never re-invoked in the browser. So a page or layout cannot be interactive in its own markup. An <code>@click</code> in a page template is dropped at SSR. To make something interactive, put it in a component and render that component's tag. A Next "Server Component" page maps here.</li>
    </ul>
    <p>The single server boundary is the <code>.server.{js,ts}</code> FILE, and it is an RPC plus source-protection mechanism, NOT an RSC server component. A file with <code>'use server'</code> exposes its exports as typed RPC stubs that the browser calls; a file without it is a server-only utility whose source never reaches the browser. So the way to keep your database client or a secret off the client is the <code>.server</code> file boundary, not a component annotation. See <a href="/docs/architecture">Architecture</a> for the full execution model and <a href="/docs/server-actions">Server Actions</a> for the RPC model.</p>

    <h2>Concept map</h2>
    <table>
      <thead><tr><th>Next.js</th><th>webjs</th></tr></thead>
      <tbody>
        <tr><td>Server Component</td><td>An isomorphic page / layout / component (no split). Server-only data comes from a <code>.server</code> action, not a server component.</td></tr>
        <tr><td>Client Component / <code>'use client'</code></td><td>A <code>WebComponent</code>. Interactivity lives in components, which hydrate. No directive: a <code>@click</code> or signal read requests the JavaScript.</td></tr>
        <tr><td><code>'use server'</code> action (in a component file)</td><td>A <code>.server.{js,ts}</code> file with <code>'use server'</code>. It is a FILE boundary, not an in-component directive. Import it and call it; the browser import is rewritten to a typed RPC stub.</td></tr>
        <tr><td>React hooks (<code>useState</code>, <code>useEffect</code>)</td><td>Signals (<code>signal</code> / <code>computed</code> from <code>@webjsdev/core</code>) plus the lit-style lifecycle hooks (<code>connectedCallback</code>, <code>updated</code>, ...). State lives in components.</td></tr>
        <tr><td><code>next/link</code></td><td>A plain <code>&lt;a href&gt;</code>. The client router auto-enhances same-origin links into partial-swap navigations. Prefetch is on by default; tune it with <code>data-prefetch</code>.</td></tr>
        <tr><td><code>next/image</code></td><td>Not provided. Use a plain <code>&lt;img&gt;</code> (with <code>width</code> / <code>height</code> / <code>loading="lazy"</code>) and layer an image service if you need one. WebJs ships no image optimizer.</td></tr>
        <tr><td><code>getServerSideProps</code> / <code>getStaticProps</code></td><td>An async page function: <code>export default async function Page({ params, searchParams, url })</code>. It runs on the server; fetch your data there (through a <code>.server</code> action) and return the markup.</td></tr>
        <tr><td><code>generateStaticParams</code> / static export</td><td>Not needed. Pages render per request. Opt a same-for-everyone page into the HTML cache with <code>export const revalidate = N</code>, the no-build equivalent of ISR.</td></tr>
        <tr><td><code>generateMetadata</code> / <code>metadata</code></td><td>The same exports, near-Next parity. Type them with the exported <code>Metadata</code> / <code>MetadataContext</code> types. JSON-LD via <code>metadata.jsonLd</code>.</td></tr>
        <tr><td>Route Handler (<code>route.ts</code>)</td><td><code>route.{js,ts}</code> exporting named <code>GET</code> / <code>POST</code> / ... functions. Nearly identical. Add a <code>WS</code> export for a WebSocket endpoint.</td></tr>
        <tr><td><code>middleware.ts</code></td><td><code>middleware.{js,ts}</code>, default-exporting <code>async (req, next) =&gt; Response</code>. Per-segment middleware is supported too.</td></tr>
        <tr><td><code>layout.tsx</code> / <code>loading.tsx</code> / <code>error.tsx</code> / <code>not-found.tsx</code></td><td>The same file names (<code>.{js,ts}</code>). <code>loading</code> auto-wraps the sibling page in a Suspense boundary.</td></tr>
        <tr><td><code>next.config.js</code></td><td>A <code>"webjs"</code> block in <code>package.json</code> (<code>headers</code>, <code>redirects</code>, <code>trailingSlash</code>, <code>basePath</code>, <code>csp</code>, the body / timeout knobs). Typed by <code>WebjsConfig</code>.</td></tr>
        <tr><td><code>unstable_cache</code> / <code>'use cache'</code></td><td><code>cache(fn, { key, ttl, tags })</code> from <code>@webjsdev/server</code>. Invalidate with <code>revalidateTag</code> / <code>revalidatePath</code> (same names as Next).</td></tr>
        <tr><td>Suspense / streaming</td><td><code>Suspense</code> from <code>@webjsdev/core</code>, plus the auto <code>loading.{js,ts}</code> boundary.</td></tr>
        <tr><td>Font / image optimization, i18n</td><td>Not provided. Layer libraries on top. WebJs stays small and standards-based.</td></tr>
      </tbody>
    </table>

    <h2>Before and after</h2>
    <p>A Next.js App Router page that fetches on the server and renders an interactive counter, split across a Server Component and a Client Component:</p>
    <pre>// app/dashboard/page.tsx  (Next.js)
import { getStats } from '@/lib/stats';
import { Counter } from './counter';

export default async function Dashboard() {
  const stats = await getStats();          // runs on the server
  return (
    &lt;main&gt;
      &lt;h1&gt;{stats.title}&lt;/h1&gt;
      &lt;Counter start={stats.count} /&gt;     // a Client Component
    &lt;/main&gt;
  );
}

// app/dashboard/counter.tsx  (Next.js)
'use client';
import { useState } from 'react';
export function Counter({ start }: { start: number }) {
  const [n, setN] = useState(start);
  return &lt;button onClick={() =&gt; setN(n + 1)}&gt;{n}&lt;/button&gt;;
}</pre>
    <p>The WebJs equivalent. The page is an async server function that reads data through a <code>.server</code> query, and the interactive part is a web component that hydrates:</p>
    <pre>// modules/stats/queries/get-stats.server.ts  (webjs: the server boundary)
'use server';
import { db } from '#db/connection.server.ts';
export async function getStats() {
  return db.query.stats.findFirst();
}

// app/dashboard/page.ts  (webjs: an async page function, no hydration)
import { html } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { getStats } from '#modules/stats/queries/get-stats.server.ts';
import '#components/counter.ts';     // register the element

export default async function Dashboard(_props: PageProps) {
  const stats = await getStats();          // runs on the server
  return html\`
    &lt;main&gt;
      &lt;h1&gt;\${stats.title}&lt;/h1&gt;
      &lt;my-counter start=\${stats.count}&gt;&lt;/my-counter&gt;
    &lt;/main&gt;
  \`;
}

// components/counter.ts  (webjs: a component, this is where JS ships)
import { WebComponent, html } from '@webjsdev/core';
export class Counter extends WebComponent({ start: Number }) {
  constructor() { super(); this.start = 0; }
  render() {
    return html\`&lt;button @click=\${() =&gt; { this.start = this.start + 1; }}&gt;\${this.start}&lt;/button&gt;\`;
  }
}
Counter.register('my-counter');</pre>
    <p>The shape is the same (a server-rendered shell with an interactive island), but there is no <code>'use client'</code> directive and no Server/Client Component pair. The page renders on the server and never hydrates; the <code>&lt;my-counter&gt;</code> element hydrates and owns its interactivity; the data crosses the <code>.server</code> boundary as an RPC-backed query.</p>

    <h2>What ports cleanly, and what does not</h2>
    <p><strong>Ports directly:</strong> the <code>app/</code> directory layout, dynamic segments (<code>[id]</code>, <code>[...rest]</code>, <code>[[...rest]]</code>), route groups (<code>(group)</code>), the metadata API, route handlers, middleware, and the <code>loading</code> / <code>error</code> / <code>not-found</code> conventions.</p>
    <p><strong>Needs rethinking:</strong> anything written as a Client Component becomes a web component; anything fetching server data moves into a <code>.server</code> action; React state becomes signals; <code>next/link</code> becomes a plain link. Write progressive-enhancement-first: a <code>&lt;form&gt;</code> plus a server action instead of a <code>fetch</code> in a click handler, since the form works without JavaScript and the client router upgrades it automatically.</p>
    <p><strong>Not provided:</strong> image and font optimization, i18n, and a static export. WebJs is a no-build, standards-based framework, so these are libraries you layer on, not built-ins.</p>
    <p>Next steps: read <a href="/docs/getting-started">Getting Started</a> to scaffold an app, <a href="/docs/architecture">Architecture</a> for the execution model in depth, and <a href="/docs/progressive-enhancement">Progressive Enhancement</a> for the design posture that replaces the Client Component habit.</p>
  `;
}
