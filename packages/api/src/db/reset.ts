import { sql } from "drizzle-orm";
import { type Database, migrateDatabase } from "./client.ts";

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function assertLocalDatabase(connectionString: string) {
	const { hostname } = new URL(connectionString);

	if (!localHosts.has(hostname)) throw new Error(`Refusing to reset a non-local database (${hostname})`);
}

export async function resetDatabase(db: Database) {
	await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);

	await db.execute(sql`DROP SCHEMA IF EXISTS pgboss CASCADE`);

	await db.execute(sql`DROP SCHEMA public CASCADE`);

	await db.execute(sql`CREATE SCHEMA public`);

	await migrateDatabase(db);
}
