import { serve } from "@hono/node-server";
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

	const server = serve({ fetch: createApp({ db, hub }).fetch, port: env.PORT, hostname: "127.0.0.1" }, (info) => {
		console.log(`braise api listening on http://127.0.0.1:${info.port}`);
	});

	const shutdown = () => {
		server.close();

		Promise.all([hub.close(), pool.end()]).then(
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
