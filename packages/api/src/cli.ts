#!/usr/bin/env -S node --conditions=@braise/source
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordLimit } from "./agent/limits.ts";
import { isRuntimeName, runQueueServices, startBoss } from "./agent/queue.ts";
import { createDatabase, migrateDatabase } from "./db/client.ts";
import { assertLocalDatabase, resetDatabase } from "./db/reset.ts";
import { readEnv } from "./env.ts";
import { seedExample } from "./seed.ts";
import { startServer } from "./server.ts";

const usage = `Usage: braise <command>

  serve [--watch]   run the API (migrates first)
  migrate           apply pending migrations
  reset             drop and re-create the local database schema (no seed)
  seed              add the labelled example venture
  limit <runtime> <window> <use> [minutes]
                    record a subscription-limit reading, e.g. \`limit claude-agent-sdk five_hour 0.95 90\`
                    (pauses the runtime at or above BRAISE_LIMIT_PAUSE_AT until the reset)`;

async function withDatabase(task: (db: ReturnType<typeof createDatabase>["db"], url: string) => Promise<void>) {
	const { DATABASE_URL } = readEnv();
	const { db, pool } = createDatabase(DATABASE_URL, { max: 1 });

	try {
		await task(db, DATABASE_URL);
	} finally {
		await pool.end();
	}
}

async function main(args: string[]) {
	const [command, ...rest] = args;

	switch (command) {
		case "serve": {
			if (!rest.includes("--watch")) return startServer();

			const child = spawn(
				process.execPath,
				["--watch", "--conditions=@braise/source", fileURLToPath(import.meta.url), "serve"],
				{ stdio: "inherit" },
			);

			child.on("exit", (code) => process.exit(code ?? 0));

			return;
		}
		case "migrate":
			return withDatabase(async (db) => {
				await migrateDatabase(db);

				console.log("Migrations applied.");
			});
		case "reset":
			return withDatabase(async (db, url) => {
				assertLocalDatabase(url);

				await resetDatabase(db);

				console.log("Database reset. Run `npx braise seed` for the example venture.");
			});
		case "seed":
			return withDatabase(async (db) => {
				const venture = await seedExample(db);

				console.log(`Seeded ${venture.slug}.`);
			});
		case "limit": {
			const [runtime = "", window = "", use = "", minutes = "300"] = rest;
			const utilization = Number(use);

			if (!isRuntimeName(runtime) || window === "" || !(utilization >= 0 && utilization <= 1)) {
				console.log(usage);

				process.exitCode = 1;

				return;
			}

			return withDatabase(async (db) => {
				const resetsAt = new Date(Date.now() + Number(minutes) * 60_000);

				const boss = await startBoss(readEnv().DATABASE_URL);

				try {
					const { paused } = await recordLimit(db, runQueueServices(boss), {
						runtime,
						runId: null,
						reading: { window, status: utilization >= 1 ? "rejected" : "allowed", utilization, resetsAt },
					});

					console.log(
						paused
							? `Recorded; ${runtime} is paused until ${resetsAt.toLocaleTimeString()}`
							: `Recorded ${Math.round(utilization * 100)}% of ${window}.`,
					);
				} finally {
					await boss.stop({ graceful: true });
				}
			});
		}
		default:
			console.log(usage);

			process.exitCode = command === undefined || command === "help" ? 0 : 1;
	}
}

main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error);

	process.exit(1);
});
