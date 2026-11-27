import { type ServerType, serve } from "@hono/node-server";
import { Cause, Effect, Exit, Layer } from "effect";
import { claudeRuntime } from "./agent/claude.ts";
import { createPiRuntime } from "./agent/pi.ts";
import { fileCredentialStore, piAuthFile } from "./agent/pi-credentials.ts";
import { Boss, RunQueue } from "./agent/queue.ts";
import { AgentReader } from "./agent/reader.ts";
import type { AgentRuntime } from "./agent/runtime.ts";
import { agentWorkerLayer } from "./agent/worker.ts";
import { createApp } from "./app.ts";
import { type CodeConfig, readCodeConfig } from "./code/config.ts";
import { Code } from "./code/service.ts";
import { codeWorkerLayer } from "./code/worker.ts";
import { Database } from "./db/effect.ts";
import { readEnv } from "./env.ts";
import { HintHub } from "./hints.ts";

export function infrastructureLayer(connectionString: string, options: { max?: number; code?: CodeConfig } = {}) {
	return Layer.mergeAll(RunQueue.layer, AgentReader.layer(connectionString)).pipe(
		Layer.provideMerge(Code.layer(options.code ?? readCodeConfig())),
		Layer.provideMerge(
			Layer.mergeAll(
				Database.layer(connectionString, options),
				Boss.layer(connectionString),
				HintHub.layer(connectionString),
			),
		),
	);
}

function httpLayer(port: number) {
	return Layer.effectDiscard(
		Effect.gen(function* () {
			const app = createApp({ db: yield* Database, hub: yield* HintHub, services: yield* RunQueue });

			yield* Effect.acquireRelease(
				Effect.callback<ServerType, Error>((resume) => {
					const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
						console.log(`braise api listening on http://127.0.0.1:${info.port}`);

						resume(Effect.succeed(server));
					});

					server.once("error", (error) => resume(Effect.fail(error)));
				}),
				(server) => Effect.sync(() => server.close()),
			);
		}),
	);
}

export function serverLayer(env: { DATABASE_URL: string; PORT: number }, runtimes: AgentRuntime[]) {
	return Layer.mergeAll(agentWorkerLayer(runtimes), codeWorkerLayer, httpLayer(env.PORT)).pipe(
		Layer.provide(infrastructureLayer(env.DATABASE_URL)),
	);
}

export function startServer() {
	const env = readEnv();

	const runtimes = [claudeRuntime, createPiRuntime(fileCredentialStore(piAuthFile()))];

	const fiber = Effect.runFork(Layer.launch(serverLayer(env, runtimes)));

	const shutdown = () => fiber.interruptUnsafe();

	process.once("SIGINT", shutdown);

	process.once("SIGTERM", shutdown);

	fiber.addObserver((exit) => {
		if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
			console.error(Cause.pretty(exit.cause));

			process.exit(1);
		}

		process.exit(0);
	});
}
