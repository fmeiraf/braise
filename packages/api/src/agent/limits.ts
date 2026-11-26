import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { capacityChannel } from "../channels.ts";
import type { Database } from "../db/client.ts";
import { limitReadings, runs, runtimePauses } from "../db/schema.ts";
import type { Services } from "../pipeline.ts";
import { runJobOf } from "../thread-handlers.ts";
import { isRuntimeName, pauseThreshold } from "./queue.ts";
import type { LimitSignal } from "./runtime.ts";

export function shouldPause(reading: LimitSignal, threshold = pauseThreshold()) {
	return reading.status === "rejected" || (reading.utilization !== null && reading.utilization >= threshold);
}

function notifyCapacity(db: Database) {
	return db.execute(sql`SELECT pg_notify(${capacityChannel}, '')`);
}

export async function openPause(db: Database, services: Services, runtime: string, until: Date | null) {
	if (!isRuntimeName(runtime)) return null;

	const opened = await db.transaction(async (tx) => {
		const [inserted] = await tx
			.insert(runtimePauses)
			.values({ id: uuidv7(), runtime, reason: "limit", until })
			.onConflictDoNothing({ target: runtimePauses.runtime, where: sql`${runtimePauses.liftedAt} IS NULL` })
			.returning();

		if (inserted !== undefined) return inserted;

		const [extended] = await tx
			.update(runtimePauses)
			.set({ until })
			.where(
				and(
					eq(runtimePauses.runtime, runtime),
					isNull(runtimePauses.liftedAt),
					eq(runtimePauses.reason, "limit"),
					until === null ? sql`true` : sql`${runtimePauses.until} < ${until}`,
				),
			)
			.returning();

		return extended ?? null;
	});

	if (opened?.until !== null && opened !== null) {
		await services.scheduleLift({ id: opened.id, until: opened.until });
	}

	return opened;
}

export async function recordLimit(
	db: Database,
	services: Services,
	entry: { runtime: string; runId: string | null; reading: LimitSignal },
) {
	if (!isRuntimeName(entry.runtime)) return { paused: false };

	await db.insert(limitReadings).values({
		id: uuidv7(),
		runtime: entry.runtime,
		window: entry.reading.window,
		status: entry.reading.status,
		utilization: entry.reading.utilization,
		resetsAt: entry.reading.resetsAt,
		runId: entry.runId,
	});

	const paused = shouldPause(entry.reading)
		? (await openPause(db, services, entry.runtime, entry.reading.resetsAt)) !== null
		: false;

	await notifyCapacity(db);

	return { paused };
}

export async function openPauseOf(db: Database, runtime: string) {
	if (!isRuntimeName(runtime)) return undefined;

	const [pause] = await db
		.select()
		.from(runtimePauses)
		.where(and(eq(runtimePauses.runtime, runtime), isNull(runtimePauses.liftedAt)));

	return pause;
}

export async function liftPause(db: Database, services: Services, pauseId: string) {
	const [lifted] = await db
		.update(runtimePauses)
		.set({ liftedAt: sql`now()` })
		.where(
			and(
				eq(runtimePauses.id, pauseId),
				isNull(runtimePauses.liftedAt),
				eq(runtimePauses.reason, "limit"),
				lte(runtimePauses.until, sql`now() + interval '1 second'`),
			),
		)
		.returning();

	if (lifted === undefined) return null;

	const queued = await db
		.select()
		.from(runs)
		.where(and(eq(runs.runtime, lifted.runtime), eq(runs.status, "queued")));

	for (const run of queued) await services.enqueueRun(await runJobOf(db, run));

	await notifyCapacity(db);

	return lifted;
}
