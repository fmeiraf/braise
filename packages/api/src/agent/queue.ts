import { Context, Effect, Layer } from "effect";
import { PgBoss } from "pg-boss";
import type { Services } from "../pipeline.ts";

export const runQueue = "agent-run";

const runExpirySeconds = 30 * 60;

export async function startBoss(connectionString: string) {
	const boss = new PgBoss({ connectionString, schedule: false });

	boss.on("error", (error) => console.error("pg-boss:", error));

	await boss.start();

	await boss.createQueue(runQueue, { retryLimit: 0, expireInSeconds: runExpirySeconds });

	return boss;
}

export function runQueueServices(boss: PgBoss) {
	return {
		async enqueueRun(runId) {
			await boss.send(runQueue, { runId }, { singletonKey: runId });
		},
	} satisfies Services;
}

const stopTimeoutMs = 10_000;

export class Boss extends Context.Service<Boss, PgBoss>()("braise/Boss") {
	static layer(connectionString: string) {
		return Layer.effect(
			Boss,
			Effect.acquireRelease(
				Effect.promise(() => startBoss(connectionString)),
				(boss) => Effect.promise(() => boss.stop({ graceful: true, timeout: stopTimeoutMs })),
			),
		);
	}
}

export class RunQueue extends Context.Service<RunQueue, Services>()("braise/RunQueue") {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			return runQueueServices(yield* Boss);
		}),
	);
}
