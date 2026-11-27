import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Fiber, ManagedRuntime, Scope, Stream } from "effect";
import pg from "pg";
import { Boss, RunQueue } from "../src/agent/queue.ts";
import { AgentReader } from "../src/agent/reader.ts";
import { createApp } from "../src/app.ts";
import { type CodeConfig, readCodeConfig } from "../src/code/config.ts";
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

/** Code settings for a test: a fresh braise home in the temp folder, never the owner's ~/.braise. */
export function testCodeConfig(overrides: Partial<CodeConfig> = {}) {
	return {
		...readCodeConfig({ ...process.env, BRAISE_HOME: mkdtempSync(join(tmpdir(), "braise-home-")) }),
		...overrides,
	} satisfies CodeConfig;
}

export async function openTestDatabase(url = testUrl(), code: CodeConfig = testCodeConfig()) {
	const runtime = ManagedRuntime.make(infrastructureLayer(url, { max: 20, code }));

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

async function resultOf(database: TestDatabase, name: string, payload: Record<string, unknown>, reason?: string) {
	const response = (await database.command(name, { payload, idempotencyKey: freshKey(name), reason })) as {
		result: { id: string };
	};

	return response.result;
}

export function createBuildObjective(database: TestDatabase, ventureId: string, statement = "A thing exists") {
	return resultOf(database, "objective.create", {
		ventureId,
		kind: "build",
		statement,
		doneList: ["It works"],
		byDate: "2027-01-31",
	});
}

export function createMetricObjective(database: TestDatabase, ventureId: string, statement = "A number moves") {
	return resultOf(database, "objective.create", {
		ventureId,
		kind: "metric",
		statement,
		measure: "Weekly orders",
		baseline: 10,
		target: 50,
		byDate: "2027-01-31",
	});
}

export function createAssumption(
	database: TestDatabase,
	ventureId: string,
	objectiveId: string | null,
	statement = "People want it",
) {
	return resultOf(database, "assumption.create", { ventureId, objectiveId, statement, function: "product" });
}

export function betPayload(ventureId: string, assumptionId: unknown, action = "Run the test") {
	return {
		ventureId,
		assumptionId,
		function: "product",
		action,
		signal: "Orders a week",
		passAt: 30,
		failAt: 12,
		method: "before_after",
		deadline: "2026-12-31",
	};
}

/** A venture with a metric objective, one assumption under it and one open bet on that assumption. */
export async function createLoop(database: TestDatabase) {
	const venture = await createVenture(database);

	const objective = await createMetricObjective(database, venture.id);

	const assumption = await createAssumption(database, venture.id, objective.id);

	const bet = await resultOf(database, "bet.create", betPayload(venture.id, assumption.id));

	return { venture, ventureId: venture.id, slug: venture.slug, objective, assumption, bet };
}

export function recordReading(database: TestDatabase, ventureId: string, betId: string, value: number) {
	return resultOf(database, "reading.record", {
		ventureId,
		subject: { type: "bet", id: betId },
		value,
		takenOn: "2026-12-01",
		source: "Order sheet",
	});
}
