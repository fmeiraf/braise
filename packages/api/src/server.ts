import { serve } from "@hono/node-server";
import { claudeRuntime } from "./agent/claude.ts";
import { createPiRuntime } from "./agent/pi.ts";
import { fileCredentialStore, piAuthFile } from "./agent/pi-credentials.ts";
import { runQueueServices, startBoss } from "./agent/queue.ts";
import { openReader } from "./agent/reader.ts";
import { createAgentWorker } from "./agent/worker.ts";
import { createApp } from "./app.ts";
import { createDatabase, migrateDatabase } from "./db/client.ts";
import { readEnv } from "./env.ts";
import { createHintHub } from "./hints.ts";

export async function startServer() {
	const env = readEnv();
	const { db, pool } = createDatabase(env.DATABASE_URL);

	await migrateDatabase(db);

	const hub = createHintHub(env.DATABASE_URL);

	await hub.start();

	const boss = await startBoss(env.DATABASE_URL);

	const services = runQueueServices(boss);

	const reader = await openReader(db, env.DATABASE_URL);

	const runtimes = [claudeRuntime, createPiRuntime(fileCredentialStore(piAuthFile()))];

	const worker = createAgentWorker({ db, reader, hub, boss, services, runtimes });

	await worker.start();

	const server = serve(
		{ fetch: createApp({ db, hub, services }).fetch, port: env.PORT, hostname: "127.0.0.1" },
		(info) => {
			console.log(`braise api listening on http://127.0.0.1:${info.port}`);
		},
	);

	const shutdown = () => {
		server.close();

		worker
			.stop()
			.then(() => Promise.all([hub.close(), reader.end(), pool.end()]))
			.then(
				() => process.exit(0),
				(error: unknown) => {
					console.error(error);

					process.exit(1);
				},
			);
	};

	process.once("SIGINT", shutdown);

	process.once("SIGTERM", shutdown);
}
