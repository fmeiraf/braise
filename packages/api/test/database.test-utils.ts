import { runQueueServices, startBoss } from "../src/agent/queue.ts";
import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/client.ts";
import { assertLocalDatabase, resetDatabase } from "../src/db/reset.ts";
import { readEnv, testDatabaseUrl } from "../src/env.ts";
import { handlers } from "../src/handlers.ts";
import { createHintHub } from "../src/hints.ts";
import { executeCommand } from "../src/pipeline.ts";

export function testUrl() {
	return testDatabaseUrl(readEnv().DATABASE_URL);
}

export async function setup() {
	const url = testUrl();

	assertLocalDatabase(url);

	const { db, pool } = createDatabase(url, { max: 1 });

	await resetDatabase(db);

	await pool.end();
}

export async function openTestDatabase() {
	const { db, pool } = createDatabase(testUrl(), { max: 20 });
	const hub = createHintHub(testUrl());

	const boss = await startBoss(testUrl());

	const services = runQueueServices(boss);
	const app = createApp({ db, hub, services });

	return {
		db,
		pool,
		hub,
		boss,
		services,
		app,
		command(name: string, body: Record<string, unknown>, actor = "owner") {
			return executeCommand(db, handlers, services, { name, body, actor });
		},
		post(name: string, body: Record<string, unknown>) {
			return app.request(`/api/commands/${name}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		},
		async close() {
			await boss.stop({ graceful: false });

			await hub.close();

			await pool.end();
		},
	};
}

export type TestDatabase = Awaited<ReturnType<typeof openTestDatabase>>;

let keyCounter = 0;

export function freshKey(label = "key") {
	keyCounter += 1;

	return `test:${label}:${process.pid}:${keyCounter}:${crypto.randomUUID()}`;
}

export async function createVenture(database: TestDatabase, name = `Venture ${crypto.randomUUID().slice(0, 8)}`) {
	const response = (await database.command("venture.create", {
		payload: { name, kind: "for_profit", why: "Because it matters", what: "A useful thing" },
		idempotencyKey: freshKey("venture"),
	})) as { result: { venture: { id: string; slug: string } }; seq: number };

	return response.result.venture;
}
