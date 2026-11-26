import { Effect, Exit, Fiber, ManagedRuntime, Scope, Stream } from "effect";
import pg from "pg";
import { Boss, RunQueue } from "../src/agent/queue.ts";
import { AgentReader } from "../src/agent/reader.ts";
import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/client.ts";
import { Database } from "../src/db/effect.ts";
import { assertLocalDatabase, resetDatabase } from "../src/db/reset.ts";
import { readEnv, testDatabaseUrl } from "../src/env.ts";
import { handlers } from "../src/handlers.ts";
import { HintHub, type HubMessage } from "../src/hints.ts";
import { executeCommand } from "../src/pipeline.ts";
import { infrastructureLayer } from "../src/server.ts";

export function testUrl() {
	return testDatabaseUrl(readEnv().DATABASE_URL);
}

export function isolatedTestUrl(name: string) {
	const url = new URL(testUrl());

	url.pathname = `/${name}`;

	return url.toString();
}

export async function createIsolatedDatabase(name: string) {
	const url = isolatedTestUrl(name);

	assertLocalDatabase(url);

	const admin = new pg.Client({ connectionString: testUrl() });

	await admin.connect();

	try {
		const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);

		if (found.rowCount === 0) await admin.query(`CREATE DATABASE ${name}`);
	} finally {
		await admin.end();
	}

	const { db, pool } = createDatabase(url, { max: 1 });

	await resetDatabase(db);

	await pool.end();

	return url;
}

export async function setup() {
	const url = testUrl();

	assertLocalDatabase(url);

	const { db, pool } = createDatabase(url, { max: 1 });

	await resetDatabase(db);

	await pool.end();
}

export async function openTestDatabase(url = testUrl()) {
	const runtime = ManagedRuntime.make(infrastructureLayer(url, { max: 20 }));

	const { db, hub, boss, services, reader } = await runtime.runPromise(
		Effect.gen(function* () {
			return {
				db: yield* Database,
				hub: yield* HintHub,
				boss: yield* Boss,
				services: yield* RunQueue,
				reader: yield* AgentReader,
			};
		}),
	);

	const app = createApp({ db, hub, services });

	return {
		runtime,
		db,
		pool: db.$client,
		hub,
		boss,
		services,
		reader,
		app,
		run: runtime.runPromise,
		subscribe(listener: (message: HubMessage) => void) {
			const scope = Effect.runSync(Scope.make());
			const subscription = Effect.runSync(Scope.provide(hub.subscribe, scope));

			const fiber = Effect.runFork(
				Stream.fromSubscription(subscription).pipe(
					Stream.runForEach((message) => Effect.sync(() => listener(message))),
				),
			);

			return () => {
				Effect.runFork(Fiber.interrupt(fiber).pipe(Effect.andThen(Scope.close(scope, Exit.void))));
			};
		},
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
		close: runtime.dispose,
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
