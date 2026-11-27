import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.ts";

const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname;

export function createDatabase(connectionString: string, options: { max?: number } = {}) {
	const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });

	return { db: drizzle(pool, { schema }), pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function migrateDatabase(db: Database) {
	await migrate(db, { migrationsFolder });
}

export type Executor = Database | Transaction;
