import { html } from '@webjsdev/core';

export const metadata = { title: 'Database (Drizzle) | WebJs' };

export default function Database() {
  return html`
    <h1>Database (Drizzle)</h1>
    <p>WebJs uses <strong>Drizzle</strong> as the default ORM. It fits the buildless thesis: there is <strong>no codegen and no engine binary</strong> (what you write is what runs), it runs on Node and Bun, and the types are inferred straight from your schema. SQLite is the default; Postgres is a flag away. The scaffold wires it all up under a <code>db/</code> folder.</p>

    <h2>What the scaffold gives you</h2>
    <pre>db/
  columns.server.ts      column helpers (the few bits that differ per dialect)
  schema.server.ts       your models + relations
  connection.server.ts   opens the driver, exports \`db\`
  seed.server.ts         optional seed (run via \`webjs db seed\`)
  migrations/            generated SQL (committed)
drizzle.config.ts        drizzle-kit config (root)</pre>
    <p>Only <code>db/columns.server.ts</code> and <code>db/connection.server.ts</code> are dialect-specific. <code>schema.server.ts</code>, your queries, and your actions are identical whether you run SQLite or Postgres.</p>

    <h2>The schema</h2>
    <p>Write models against the helpers in <code>db/columns.server.ts</code> (which re-export the raw Drizzle builders like <code>text</code> / <code>integer</code> plus thin helpers for the columns that differ across dialects: <code>table</code>, <code>pk</code>, <code>uuidPk</code>, <code>bool</code>, <code>createdAt</code>, <code>updatedAt</code>, <code>index</code>):</p>
    <pre>// db/schema.server.ts
import { defineRelations } from 'drizzle-orm';
import { table, pk, text, integer, createdAt, index } from './columns.server.ts';

export const users = table('users', {
  id: pk(),
  email: text().notNull().unique(),
  name: text(),
  createdAt: createdAt(),
});

export const posts = table('posts', {
  id: pk(),
  slug: text().notNull().unique(),
  title: text().notNull(),
  body: text().notNull(),
  authorId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (t) => [index(t.authorId), index(t.createdAt)]);

export const relations = defineRelations({ users, posts }, (r) => ({
  users: { posts: r.many.posts({ from: r.users.id, to: r.posts.authorId }) },
  posts: { author: r.one.users({ from: r.posts.authorId, to: r.users.id }) },
}));

export type Post = typeof posts.$inferSelect;</pre>
    <p>Column keys map to <code>snake_case</code> SQL automatically (no per-column name strings). A primary key is <code>pk()</code> (auto-increment integer, <code>id: number</code>) or <code>uuidPk()</code> (<code>id: string</code>). <code>createdAt()</code> defaults to now at the database level.</p>

    <h2>Migrations</h2>
    <p>Drizzle has no client to generate. <code>generate</code> turns your schema into SQL; <code>migrate</code> applies it.</p>
    <pre>npm run db:generate     # webjs db generate -> drizzle-kit generate (schema to SQL)
npm run db:migrate      # webjs db migrate  -> drizzle-kit migrate (apply)</pre>
    <p>Both <code>webjs dev</code> and <code>webjs start</code> run <code>webjs db migrate</code> before serving (the <code>webjs.dev.before</code> / <code>webjs.start.before</code> steps, idempotent), so after you <code>db:generate</code> a migration it is applied on the next boot with no manual <code>db:migrate</code>, and a deploy applies pending migrations before serving. <code>generate</code> stays a deliberate, manual step (it authors migration files from a schema diff), never auto-run on boot.</p>

    <h2>The connection</h2>
    <pre>// db/connection.server.ts (SQLite, runtime-neutral)
import * as schema from './schema.server.ts';

const url = process.env.DATABASE_URL?.replace(/^file:/, '') ?? 'db/dev.db';
const g = globalThis as unknown as { __webjs_db?: unknown };

// node:sqlite and bun:sqlite default busy_timeout to 0, so a contended write
// throws "database is locked". Set a 5s wait (+ WAL) so it waits instead.
function tune&lt;T extends { exec(sql: string): unknown }&gt;(client: T): T {
  client.exec('PRAGMA busy_timeout = 5000');
  client.exec('PRAGMA journal_mode = WAL');
  return client;
}

async function open() {
  if ((globalThis as { Bun?: unknown }).Bun) {
    const { Database } = await import('bun:sqlite');
    const { drizzle } = await import('drizzle-orm/bun-sqlite');
    return drizzle({ client: tune(new Database(url)), relations: schema.relations });
  }
  const { DatabaseSync } = await import('node:sqlite');
  const { drizzle } = await import('drizzle-orm/node-sqlite');
  return drizzle({ client: tune(new DatabaseSync(url)), relations: schema.relations });
}

export const db = (g.__webjs_db ??= await open()) as Awaited&lt;ReturnType&lt;typeof open&gt;&gt;;</pre>
    <p>The <code>globalThis</code> cache reuses one connection across dev-server reloads. This is the only file that opens the driver, and it is server-only (<code>.server.ts</code>), so it never reaches the browser.</p>

    <h2>Queries and mutations</h2>
    <p>Reads use the relational query builder with object filters; writes use the builder with <code>.returning()</code> (both SQLite and Postgres support it).</p>
    <pre>// modules/posts/queries/list-posts.server.ts
'use server';
import { db } from '#db/connection.server.ts';

export async function listPosts() {
  return db.query.posts.findMany({
    orderBy: { createdAt: 'desc' },
    with: { author: { columns: { name: true } } },
  });
}</pre>
    <pre>// modules/posts/actions/create-post.server.ts
'use server';
import { db } from '#db/connection.server.ts';
import { posts } from '#db/schema.server.ts';

export async function createPost(input: { slug: string; title: string; body: string; authorId: number }) {
  const [row] = await db.insert(posts).values(input).returning();
  return { success: true as const, data: row };
}</pre>
    <p>Import the query or action from a page or component as a normal import; WebJs rewrites it into a typed RPC stub on the client.</p>
    <pre>// app/page.ts
import { listPosts } from '#modules/posts/queries/list-posts.server.ts';

export default async function Home() {
  const posts = await listPosts();
  return html\`&lt;ul&gt;\${posts.map(p =&gt; html\`&lt;li&gt;\${p.title}&lt;/li&gt;\`)}&lt;/ul&gt;\`;
}</pre>

    <p><strong>Why the <code>.server.ts</code> boundary?</strong> Page modules (and layouts, loading, error, not-found, plus all components) load in the browser so transitively imported components register. A top-level import of <code>db/connection.server.ts</code> would pull the DB driver (<code>pg</code>, or the built-in <code>node:sqlite</code>, which need Node APIs) into the browser graph and crash. The <code>.server.{js,ts}</code> extension lets the framework rewrite the import into an RPC stub; the driver and your DB code never reach the client. The rule across the framework: server-only code goes in <code>.server.{js,ts}</code> files, <code>route.ts</code> handlers, or <code>middleware.ts</code>. Never in pages, layouts, or components.</p>

    <h2>Type safety</h2>
    <p>Types are inferred from the schema, never hand-written. <code>typeof posts.$inferSelect</code> is the row type; a <code>.ts</code> server action's return type flows through the RPC boundary to the client, and webjs's rich-type serializer keeps a <code>Date</code> a <code>Date</code> on both sides.</p>

    <h2>Switching to Postgres</h2>
    <p>Scaffold with the dialect you want:</p>
    <pre>webjs create my-app --db postgres</pre>
    <p>That writes the Postgres variants of <code>db/columns.server.ts</code> and <code>db/connection.server.ts</code> (and the <code>pg</code> driver). Your <code>schema.server.ts</code>, queries, and actions are unchanged. To move an existing app, swap those two files for the Postgres variants and point <code>DATABASE_URL</code> at your Postgres instance. Migrations are generated per dialect, and runtime behaviour differs (case-sensitivity, constraints), so run your tests against the production engine before relying on a dev-SQLite / prod-Postgres setup.</p>

    <h2>CLI</h2>
    <pre>webjs db generate    # schema -> SQL migration (drizzle-kit generate)
webjs db migrate     # apply pending migrations (drizzle-kit migrate)
webjs db push        # push the schema straight to the dev DB (drizzle-kit push)
webjs db studio      # visual DB browser (drizzle-kit studio)
webjs db seed        # run db/seed.server.ts</pre>
  `;
}
