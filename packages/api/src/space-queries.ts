import {
	type Capacity,
	type InboxNeedsInput,
	type LimitReading,
	type MemberState,
	maxWakesSinceOwner,
	memberStateOf,
	type RuntimeDay,
	type RuntimePause,
	type SpaceDetail,
	type SpaceMember,
	type SpaceSummary,
} from "@braise/core";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { concurrencyOf, pauseThreshold, runtimeNamesInOrder, runtimeQueues } from "./agent/queue.ts";
import type { Database } from "./db/client.ts";
import {
	agentProfiles,
	inputRequests,
	limitReadings,
	runs,
	runtimePauses,
	spaces,
	threads,
	ventures,
} from "./db/schema.ts";
import { AppError } from "./errors.ts";
import { toThread } from "./thread-queries.ts";

type SpaceRow = typeof spaces.$inferSelect;

const decidedLimit = 30;

const readingDays = 7;

const performanceDays = 14;

function toSpace(row: SpaceRow) {
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		archivedAt: row.archivedAt?.toISOString() ?? null,
	};
}

async function membersOf(db: Database, spaceIds: string[]) {
	if (spaceIds.length === 0) return [];

	const rows = await db
		.select({ thread: threads, agentName: agentProfiles.name, runtime: agentProfiles.runtime })
		.from(threads)
		.innerJoin(agentProfiles, eq(agentProfiles.id, threads.agentProfileId))
		.where(and(inArray(threads.spaceId, spaceIds), isNull(threads.archivedAt)))
		.orderBy(asc(threads.createdAt));

	const ids = rows.map((row) => row.thread.id);

	const [latest, questions] =
		ids.length === 0
			? [[], []]
			: await Promise.all([
					db
						.selectDistinctOn([runs.threadId], {
							threadId: runs.threadId,
							id: runs.id,
							status: runs.status,
							createdAt: runs.createdAt,
							startedAt: runs.startedAt,
							finishedAt: runs.finishedAt,
							error: runs.error,
						})
						.from(runs)
						.where(inArray(runs.threadId, ids))
						.orderBy(runs.threadId, desc(runs.createdAt), desc(runs.id)),
					db
						.select({ threadId: inputRequests.threadId, question: inputRequests.question })
						.from(inputRequests)
						.where(and(inArray(inputRequests.threadId, ids), eq(inputRequests.status, "pending"))),
				]);

	return rows.map((row) => {
		const run = latest.find((found) => found.threadId === row.thread.id);
		const question = questions.find((found) => found.threadId === row.thread.id)?.question ?? null;

		return {
			spaceId: row.thread.spaceId,
			member: {
				thread: toThread(row.thread),
				agent: { id: row.thread.agentProfileId, name: row.agentName, runtime: row.runtime },
				state: memberStateOf(run?.status ?? null, question !== null),
				latestRun:
					run === undefined
						? null
						: {
								id: run.id,
								status: run.status,
								createdAt: run.createdAt.toISOString(),
								startedAt: run.startedAt?.toISOString() ?? null,
								finishedAt: run.finishedAt?.toISOString() ?? null,
								error: run.error,
							},
				question,
			} satisfies SpaceMember,
		};
	});
}

function countStates(members: SpaceMember[]) {
	const counts: Record<MemberState, number> = { needs_you: 0, running: 0, queued: 0, done: 0 };

	for (const member of members) counts[member.state] += 1;

	return counts;
}

async function summaries(db: Database, rows: SpaceRow[]) {
	const ids = rows.map((row) => row.id);

	const [members, chatRuns, profiles, ventureRows] = await Promise.all([
		membersOf(db, ids),
		ids.length === 0
			? []
			: db
					.select({ threadId: runs.threadId })
					.from(runs)
					.where(
						and(
							inArray(
								runs.threadId,
								rows.map((row) => row.chatThreadId),
							),
							inArray(runs.status, ["queued", "running"]),
						),
					),
		db.select({ id: agentProfiles.id, name: agentProfiles.name }).from(agentProfiles),
		db.select({ id: ventures.id, slug: ventures.slug, name: ventures.name }).from(ventures),
	]);

	return rows.map((row) => {
		const own = members.filter((entry) => entry.spaceId === row.id).map((entry) => entry.member);

		return {
			summary: {
				...toSpace(row),
				venture: ventureRows.find((venture) => venture.id === row.ventureId) ?? null,
				agent: profiles.find((profile) => profile.id === row.agentProfileId) ?? {
					id: row.agentProfileId,
					name: row.agentProfileId,
				},
				counts: countStates(own),
				chatActive: chatRuns.some((run) => run.threadId === row.chatThreadId),
				pausedForOwner: row.wakesSinceOwner >= maxWakesSinceOwner,
			} satisfies SpaceSummary,
			members: own,
		};
	});
}

export async function listSpaces(db: Database, filter: { ventureId: string | null }) {
	const rows = await db
		.select()
		.from(spaces)
		.where(
			and(isNull(spaces.archivedAt), filter.ventureId === null ? undefined : eq(spaces.ventureId, filter.ventureId)),
		)
		.orderBy(desc(spaces.updatedAt))
		.limit(100);

	return (await summaries(db, rows)).map((entry) => entry.summary);
}

export async function getSpace(db: Database, spaceId: string) {
	const [row] = await db.select().from(spaces).where(eq(spaces.id, spaceId));

	if (row === undefined) throw new AppError("not_found", "Space not found", { spaceId });

	const [entry] = await summaries(db, [row]);

	if (entry === undefined) throw new AppError("internal_error", "Space summary missing", { spaceId });

	const [stats] = await db
		.select({
			runs: sql<number>`count(*)::int`,
			inputTokens: sql<number>`coalesce(sum((${runs.usage}->>'inputTokens')::numeric), 0)::float8`,
			outputTokens: sql<number>`coalesce(sum((${runs.usage}->>'outputTokens')::numeric), 0)::float8`,
			costUsd: sql<number>`coalesce(sum((${runs.usage}->>'costUsd')::numeric), 0)::float8`,
		})
		.from(runs)
		.innerJoin(threads, eq(threads.id, runs.threadId))
		.where(sql`${threads.spaceId} = ${row.id} OR ${threads.id} = ${row.chatThreadId}`);

	return {
		space: entry.summary,
		members: entry.members,
		stats: stats ?? { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
	} satisfies SpaceDetail;
}

function toReading(row: typeof limitReadings.$inferSelect) {
	return {
		runtime: row.runtime,
		window: row.window,
		status: row.status,
		utilization: row.utilization,
		resetsAt: row.resetsAt?.toISOString() ?? null,
		observedAt: row.observedAt.toISOString(),
	} satisfies LimitReading;
}

function toPause(row: typeof runtimePauses.$inferSelect) {
	return {
		id: row.id,
		runtime: row.runtime,
		reason: row.reason,
		until: row.until?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
	} satisfies RuntimePause;
}

interface DayRow extends Record<string, unknown> {
	runtime: string;
	day: string;
	runs: number;
	failed: number;
	interrupted: number;
	queue_p50: number | null;
	queue_p95: number | null;
	first_p50: number | null;
	first_p95: number | null;
	duration_p50: number | null;
	duration_p95: number | null;
	input_tokens: number;
	output_tokens: number;
	cost_usd: number;
}

const millis = (from: string, to: string) => `extract(epoch from (${to} - ${from})) * 1000`;

export async function runtimeDays(db: Database, days = performanceDays) {
	const percentile = (fraction: number, from: string, to: string) =>
		sql.raw(
			`percentile_cont(${fraction}) WITHIN GROUP (ORDER BY ${millis(from, to)}) FILTER (WHERE ${to} IS NOT NULL AND ${from} IS NOT NULL)`,
		);

	const result = await db.execute<DayRow>(sql`
		SELECT
			runtime,
			to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
			count(*)::int AS runs,
			(count(*) FILTER (WHERE status = 'failed'))::int AS failed,
			(count(*) FILTER (WHERE status = 'interrupted'))::int AS interrupted,
			${percentile(0.5, "created_at", "started_at")} AS queue_p50,
			${percentile(0.95, "created_at", "started_at")} AS queue_p95,
			${percentile(0.5, "started_at", "first_token_at")} AS first_p50,
			${percentile(0.95, "started_at", "first_token_at")} AS first_p95,
			${percentile(0.5, "started_at", "finished_at")} AS duration_p50,
			${percentile(0.95, "started_at", "finished_at")} AS duration_p95,
			coalesce(sum((usage->>'inputTokens')::numeric), 0)::float8 AS input_tokens,
			coalesce(sum((usage->>'outputTokens')::numeric), 0)::float8 AS output_tokens,
			coalesce(sum((usage->>'costUsd')::numeric), 0)::float8 AS cost_usd
		FROM runs
		WHERE created_at >= now() - make_interval(days => ${days})
		GROUP BY runtime, day
		ORDER BY runtime, day DESC`);

	const round = (value: number | null) => (value === null ? null : Math.round(Number(value)));

	return result.rows.map((row) => ({
		runtime: row.runtime,
		day: {
			day: row.day,
			runs: row.runs,
			failed: row.failed,
			interrupted: row.interrupted,
			queueWaitP50Ms: round(row.queue_p50),
			queueWaitP95Ms: round(row.queue_p95),
			firstTokenP50Ms: round(row.first_p50),
			firstTokenP95Ms: round(row.first_p95),
			durationP50Ms: round(row.duration_p50),
			durationP95Ms: round(row.duration_p95),
			inputTokens: Number(row.input_tokens),
			outputTokens: Number(row.output_tokens),
			costUsd: Number(row.cost_usd),
		} satisfies RuntimeDay,
	}));
}

export async function getCapacity(db: Database) {
	const [live, pauses, recent, days] = await Promise.all([
		db
			.select({
				runtime: runs.runtime,
				running: sql<number>`(count(*) FILTER (WHERE ${runs.status} = 'running'))::int`,
				queued: sql<number>`(count(*) FILTER (WHERE ${runs.status} = 'queued'))::int`,
				oldestQueuedAt: sql<string | null>`min(${runs.createdAt}) FILTER (WHERE ${runs.status} = 'queued')`,
			})
			.from(runs)
			.where(inArray(runs.status, ["queued", "running"]))
			.groupBy(runs.runtime),
		db.select().from(runtimePauses).where(isNull(runtimePauses.liftedAt)),
		db
			.select()
			.from(limitReadings)
			.where(gte(limitReadings.observedAt, sql`now() - make_interval(days => ${readingDays})`))
			.orderBy(desc(limitReadings.observedAt))
			.limit(2_000),
		runtimeDays(db),
	]);

	const latestWindows = await db
		.selectDistinctOn([limitReadings.runtime, limitReadings.window])
		.from(limitReadings)
		.orderBy(limitReadings.runtime, limitReadings.window, desc(limitReadings.observedAt));

	return {
		pauseAt: pauseThreshold(),
		runtimes: runtimeNamesInOrder.map((runtime) => {
			const counts = live.find((row) => row.runtime === runtime);
			const pause = pauses.find((row) => row.runtime === runtime);
			const oldest = counts?.oldestQueuedAt ?? null;

			return {
				runtime,
				label: runtimeQueues[runtime].label,
				limit: concurrencyOf(runtime),
				running: counts?.running ?? 0,
				queued: counts?.queued ?? 0,
				oldestQueuedAt: oldest === null ? null : new Date(oldest).toISOString(),
				pause: pause === undefined ? null : toPause(pause),
				windows: latestWindows.filter((row) => row.runtime === runtime).map(toReading),
				readings: recent.filter((row) => row.runtime === runtime).map(toReading),
				days: days.filter((row) => row.runtime === runtime).map((row) => row.day),
			};
		}),
	} satisfies Capacity;
}

export async function needsInputInbox(db: Database) {
	const rows = (status: "pending" | "answered") =>
		db
			.select({
				request: inputRequests,
				threadTitle: threads.title,
				spaceId: threads.spaceId,
				agentId: agentProfiles.id,
				agentName: agentProfiles.name,
				venture: { id: ventures.id, slug: ventures.slug, name: ventures.name },
				spaceTitle: spaces.title,
			})
			.from(inputRequests)
			.innerJoin(threads, eq(threads.id, inputRequests.threadId))
			.innerJoin(agentProfiles, eq(agentProfiles.id, threads.agentProfileId))
			.leftJoin(ventures, eq(ventures.id, threads.ventureId))
			.leftJoin(spaces, eq(spaces.id, threads.spaceId))
			.where(and(eq(inputRequests.status, status), status === "pending" ? isNull(threads.archivedAt) : undefined));

	const [pending, decided] = await Promise.all([
		rows("pending").orderBy(asc(inputRequests.createdAt)),
		rows("answered").orderBy(desc(inputRequests.answeredAt)).limit(decidedLimit),
	]);

	const toItem = (row: Awaited<ReturnType<typeof rows>>[number]) =>
		({
			kind: "needs_input",
			id: row.request.id,
			agent: { id: row.agentId, name: row.agentName },
			question: row.request.question,
			venture: row.venture,
			thread: { id: row.request.threadId, title: row.threadTitle, ventureSlug: row.venture?.slug ?? null },
			space: row.spaceId === null || row.spaceTitle === null ? null : { id: row.spaceId, title: row.spaceTitle },
			runId: row.request.runId,
			status: row.request.status,
			createdAt: row.request.createdAt.toISOString(),
			decidedAt: row.request.answeredAt?.toISOString() ?? null,
		}) satisfies InboxNeedsInput;

	return { pending: pending.map(toItem), decided: decided.map(toItem) };
}
