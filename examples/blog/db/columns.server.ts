/**
 * Column helpers for the Drizzle schema (SQLite variant).
 *
 * Most builders are raw drizzle, re-exported as-is so the schema reads like
 * drizzle. Only the columns that genuinely differ between SQLite and Postgres
 * get a thin helper (table casing factory, pk, uuid, bool, timestamp). To move
 * this app to Postgres, swap this file for the pg variant (same export names);
 * the schema, queries, and actions do not change.
 *
 * Pinned to drizzle-orm 1.0.0-rc.3. See research #562 for the full rationale.
 */
import { sqliteTableCreator, integer, text, real, blob, index as _index } from 'drizzle-orm/sqlite-core';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { getTableName, type Table } from 'drizzle-orm';

// Raw drizzle builders, re-exported (identical call sites on both dialects).
// Re-export the LOCAL bindings, not a second `export ... from`: that form
// creates no local binding, so uuidPk() and uuid() below would call an
// undefined `text` and throw at runtime.
export { text, integer, real, blob };

/** Table factory: column keys map to snake_case SQL names (casing lives here in rc.3). */
export const table = sqliteTableCreator((name) => name, 'snake_case');

/** Integer autoincrement primary key (id: number). */
export const pk = () => integer().primaryKey({ autoIncrement: true });

/** Text uuid primary key, app-generated (id: string). Postgres uses a native uuid. */
export const uuidPk = () => text().primaryKey().$defaultFn(() => crypto.randomUUID());

/** A uuid column (for a foreign key to a uuidPk, or any uuid field). */
export const uuid = () => text();

/** Boolean (stored as integer on SQLite, native boolean on Postgres). */
export const bool = () => integer({ mode: 'boolean' });

/** A timestamp column with no default (e.g. an expiry set per row). */
export const timestamp = () => integer({ mode: 'timestamp_ms' });

/** created_at: DB-level default to now (ms). */
export const createdAt = () => timestamp().notNull().defaultNow();

/** updated_at: defaults on insert, auto-bumps on every drizzle update (app-level). */
export const updatedAt = () => timestamp().notNull().defaultNow().$onUpdate(() => new Date());

/**
 * Anonymous-style index: pass columns, get a table-qualified auto name (matches
 * drizzle-kit's own convention, collision-free). Works around rc.3's index()
 * requiring a name arg the runtime auto-fills; replace with plain index() once
 * 1.0 stable exposes the no-arg overload.
 */
export const index = (...cols: SQLiteColumn[]) =>
  _index(
    `${getTableName((cols[0] as unknown as { table: Table }).table)}_${cols.map((c) => c.name).join('_')}_idx`,
  ).on(...(cols as [SQLiteColumn, ...SQLiteColumn[]]));
