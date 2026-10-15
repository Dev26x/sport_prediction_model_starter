import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const cacheEntries = sqliteTable('cache_entries', { key: text('key').primaryKey(), value: text('value').notNull(), updatedAt: text('updated_at').notNull() });
export const savedSlips = sqliteTable('saved_slips', { userId: text('user_id').primaryKey(), value: text('value').notNull(), updatedAt: text('updated_at').notNull() });
export const refreshLeases = sqliteTable('refresh_leases', { key: text('key').primaryKey(), expires: integer('expires').notNull(), token: text('token').notNull() });
