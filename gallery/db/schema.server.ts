import { defineRelations } from 'drizzle-orm';
import { table, pk, uuidPk, text, bool, json, createdAt } from './columns.server.ts';

export const users = table('users', {
  id: pk(),
  email: text().notNull().unique(),
  name: text(),
  settings: json<{ theme?: string }>(),
  passwordHash: text(),
  createdAt: createdAt(),
});

export const todos = table('todos', {
  id: uuidPk(),
  title: text().notNull(),
  completed: bool().notNull().default(false),
  createdAt: createdAt(),
});

export const relations = defineRelations({ users, todos }, () => ({}));

export type User = typeof users.$inferSelect;
export type Todo = typeof todos.$inferSelect;
