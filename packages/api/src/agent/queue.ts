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
