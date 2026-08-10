import { sqliteTableCreator, integer, text, real, blob, index as _index } from 'drizzle-orm/sqlite-core';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { getTableName, type Table } from 'drizzle-orm';

export { text, integer, real, blob };

export const table = sqliteTableCreator((name) => name, 'snake_case');
export const pk = () => integer().primaryKey({ autoIncrement: true });
export const uuidPk = () => text().primaryKey().$defaultFn(() => crypto.randomUUID());
export const uuid = () => text();
export const json = <T>() => text({ mode: 'json' }).$type<T>();
export const bool = () => integer({ mode: 'boolean' });
export const timestamp = () => integer({ mode: 'timestamp_ms' });
export const createdAt = () => timestamp().notNull().defaultNow();
export const updatedAt = () => timestamp().notNull().defaultNow().$onUpdate(() => new Date());

export const index = (...cols: SQLiteColumn[]) =>
  _index(
    `${getTableName((cols[0] as unknown as { table: Table }).table)}_${cols.map((c) => c.name).join('_')}_idx`,
  ).on(...(cols as [SQLiteColumn, ...SQLiteColumn[]]));
