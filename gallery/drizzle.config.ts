import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './db/schema.server.ts',
  out: './db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL?.replace(/^file:/, '') ?? 'db/dev.db' },
});
