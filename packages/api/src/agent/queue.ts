import type { RuntimeName } from "@braise/core";
import { Context, Effect, Layer } from "effect";
import { PgBoss } from "pg-boss";
import { type CodeHost, codeQueue } from "../code/host.ts";
import { Code } from "../code/service.ts";
import type { Services } from "../pipeline.ts";

export type { RunJob } from "../pipeline.ts";

export const runtimeQueues = {
	"claude-agent-sdk": { queue: "runs.claude", env: "BRAISE_CLAUDE_CONCURRENCY", limit: 3, label: "Claude" },
	pi: { queue: "runs.pi", env: "BRAISE_PI_CONCURRENCY", limit: 4, label: "GPT" },
} as const satisfies Record<RuntimeName, { queue: string; env: string; limit: number; label: string }>;

export const runtimeNamesInOrder = Object.keys(runtimeQueues) as RuntimeName[];

export const liftQueue = "runtime.lift";

export const chatPriority = 1;

export const memberPriority = 0;

const defaultPauseAt = 0.9;

const runExpirySeconds = 30 * 60;

export function isRuntimeName(runtime: string): runtime is RuntimeName {
	return Object.hasOwn(runtimeQueues, runtime);
}

function positiveInteger(value: string | undefined) {
	const parsed = Number(value);

	return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function concurrencyOf(runtime: RuntimeName) {
	const config = runtimeQueues[runtime];

	return positiveInteger(process.env[config.env]) ?? config.limit;
}

export function pauseThreshold() {
	const parsed = Number(process.env.BRAISE_LIMIT_PAUSE_AT);

	return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : defaultPauseAt;
}

export function queueOf(runtime: string) {
	if (!isRuntimeName(runtime)) throw new Error(`braise has no queue for the runtime ${runtime}`);

	return runtimeQueues[runtime].queue;
}

export async function startBoss(connectionString: string) {
	const boss = new PgBoss({ connectionString, schedule: false, useListenNotify: true });

	boss.on("error", (error) => console.error("pg-boss:", error));

	await boss.start();

	for (const runtime of runtimeNamesInOrder) {
		const options = { retryLimit: 0, expireInSeconds: runExpirySeconds, notify: true };

		await boss.createQueue(queueOf(runtime), options);

		await boss.updateQueue(queueOf(runtime), options);
	}

	await boss.createQueue(liftQueue, { retryLimit: 3 });

	await boss.createQueue(codeQueue, { retryLimit: 0, expireInSeconds: runExpirySeconds });

	return boss;
}

export function runQueueServices(boss: PgBoss, code: CodeHost) {
	return {
		code,
		async enqueueCode(job) {
			await boss.send(codeQueue, job);
		},
		async enqueueRun(job) {
			await boss.send(
				queueOf(job.runtime),
				{ runId: job.runId },
				{ singletonKey: job.runId, priority: job.priority },
			);
		},
		async scheduleLift(pause) {
			await boss.send(
				liftQueue,
				{ pauseId: pause.id },
				{ singletonKey: `${pause.id}:${pause.until.getTime()}`, startAfter: pause.until },
			);
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
			return runQueueServices(yield* Boss, yield* Code);
		}),
	);
}
