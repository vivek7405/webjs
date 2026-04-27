import { html } from '@webjskit/core';

export const metadata = { title: 'Database (Prisma) — webjs' };

export default function Database() {
  return html`
    <h1>Database (Prisma)</h1>
    <p>webjs recommends <strong>Prisma</strong> as the default ORM. It's schema-first (single source of truth), generates a fully-typed client, and works with SQLite, PostgreSQL, MySQL, and more. The only non-runtime step in a webjs app is <code>prisma generate</code> after schema edits — everything else is no-build.</p>

    <h2>Setup</h2>
    <pre>npm install prisma @prisma/client
npx prisma init --datasource-provider sqlite</pre>
    <p>This creates <code>prisma/schema.prisma</code> with a SQLite datasource. Edit it to define your models:</p>
    <pre>// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}

model Post {
  id        Int      @id @default(autoincrement())
  slug      String   @unique
  title     String
  body      String
  createdAt DateTime @default(now())
}</pre>

    <h3>Run Migrations</h3>
    <pre>npx prisma migrate dev --name init
# or via the webjs CLI wrapper:
webjs db migrate init</pre>

    <h3>Generate the Client</h3>
    <pre>npx prisma generate
# or:
webjs db generate</pre>
    <p>This writes the typed client to <code>node_modules/.prisma/client</code>. Run it once after schema changes — it's not in the request hot path.</p>

    <h2>Using Prisma in Server Actions</h2>
    <pre>// lib/prisma.ts
import { PrismaClient } from '@prisma/client';

declare global {
  var __prisma: PrismaClient | undefined;
}

// Singleton: reuse across dev-mode module reloads.
export const prisma: PrismaClient =
  globalThis.__prisma ?? (globalThis.__prisma = new PrismaClient());</pre>

    <pre>// modules/posts/queries/list-posts.server.ts
'use server';
import { prisma } from '../../../lib/prisma.ts';

export async function listPosts() {
  return prisma.post.findMany({ orderBy: { createdAt: 'desc' } });
}</pre>

    <p>Import the query from a page or component — webjs handles the rest:</p>
    <pre>// app/page.ts
import { listPosts } from '../modules/posts/queries/list-posts.server.ts';

export default async function Home() {
  const posts = await listPosts();
  return html\`&lt;ul&gt;\${posts.map(p =&gt; html\`&lt;li&gt;\${p.title}&lt;/li&gt;\`)}&lt;/ul&gt;\`;
}</pre>

    <h2>Type Safety</h2>
    <p>Prisma generates TypeScript types for every model. In a <code>.ts</code> server action, the return type flows through the RPC boundary to the client component — <code>Post.createdAt</code> is a <code>Date</code> on the server, and thanks to superjson, it's a <code>Date</code> on the client too.</p>
    <p>For DTOs (where you want to control the exact shape returned to the client), create a <code>format*</code> function in your module's <code>utils/</code>:</p>
    <pre>// modules/posts/utils/format.ts
import type { PostFormatted } from '../types.ts';

export function formatPost(row: any): PostFormatted {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    body: row.body,
    authorName: row.author?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}</pre>

    <h2>The globalThis Singleton Pattern</h2>
    <p>In dev mode, webjs cache-busts module imports so file edits take effect immediately. But this means <code>new PrismaClient()</code> runs on every import — creating too many DB connections. The fix: stash the client on <code>globalThis</code>, which persists across module reloads:</p>
    <pre>export const prisma =
  globalThis.__prisma ?? (globalThis.__prisma = new PrismaClient());</pre>
    <p>Use the same pattern for any stateful singleton (WebSocket client sets, pub/sub buses, etc.).</p>

    <h2>Switching Databases</h2>
    <p>Change the <code>provider</code> and <code>url</code> in <code>schema.prisma</code>:</p>
    <pre>datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}</pre>
    <p>Then re-run <code>npx prisma migrate dev</code>. The rest of your code stays the same — Prisma abstracts the SQL dialect.</p>

    <h2>CLI Integration</h2>
    <p>The webjs CLI wraps common Prisma commands:</p>
    <pre>webjs db generate      # prisma generate
webjs db migrate init  # prisma migrate dev --name init
webjs db studio        # prisma studio (visual DB browser)</pre>
  `;
}
