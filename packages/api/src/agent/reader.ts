import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import pg from "pg";
import type { Database } from "../db/client.ts";
import { Database as DatabaseService } from "../db/effect.ts";

export const readerRole = "braise_agent_reader";

export const readerStatementTimeoutMs = 5_000;

function readerPassword(connectionString: string) {
	const url = new URL(connectionString);

	return createHash("sha256")
		.update(`braise-agent-reader:${url.username}:${decodeURIComponent(url.password)}`)
		.digest("hex");
}

export async function openReader(db: Database, connectionString: string) {
	const password = readerPassword(connectionString);

	await db.transaction(async (tx) => {
		await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${readerRole}))`);

		await tx.execute(sql.raw(`ALTER ROLE ${readerRole} WITH LOGIN PASSWORD '${password}'`));
	});

	const url = new URL(connectionString);

	url.username = readerRole;

	url.password = password;

	return new pg.Pool({
		connectionString: url.toString(),
		max: 2,
		options: `-c default_transaction_read_only=on -c statement_timeout=${readerStatementTimeoutMs}`,
	});
}

export type Reader = pg.Pool;

export class AgentReader extends Context.Service<AgentReader, Reader>()("braise/AgentReader") {
	static layer(connectionString: string) {
		return Layer.effect(
			AgentReader,
			Effect.gen(function* () {
				const db = yield* DatabaseService;

				return yield* Effect.acquireRelease(
					Effect.promise(() => openReader(db, connectionString)),
					(reader) => Effect.promise(() => reader.end()),
				);
			}),
		);
	}
}
