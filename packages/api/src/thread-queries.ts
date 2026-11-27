import {
	type ActiveRun,
	activeRunStatuses,
	type InputRequest,
	type LinkTarget,
	type Run,
	type RunEvent,
	type ThreadDetail,
	type ThreadLink,
	type ThreadLinkType,
	type ThreadSummary,
} from "@braise/core";
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, type SQL } from "drizzle-orm";
import type { Database } from "./db/client.ts";
import {
	agentProfiles,
	assumptions,
	bets,
	inputRequests,
	objectives,
	runEvents,
	runs,
	spaces,
	threadLinks,
	threadMessages,
	threads,
	ventures,
	workItems,
} from "./db/schema.ts";
import { AppError } from "./errors.ts";

type LinkRow = { threadId: string; subjectType: ThreadLinkType; subjectId: string };

type ThreadRow = typeof threads.$inferSelect;

type RunRow = typeof runs.$inferSelect;

const workKinds = ["Initiative", "Task", "Subtask"];

const ventureColumns = { ventureId: ventures.id, ventureSlug: ventures.slug, ventureName: ventures.name };

function idsOf(rows: LinkRow[], type: ThreadLinkType) {
	return rows.filter((row) => row.subjectType === type).map((row) => row.subjectId);
}

async function linkLabels(db: Database, rows: LinkRow[]) {
	const labels = new Map<string, Omit<ThreadLink, "type" | "id">>();
	const workIds = idsOf(rows, "work_item");
	const objectiveIds = idsOf(rows, "objective");
	const assumptionIds = idsOf(rows, "assumption");
	const betIds = idsOf(rows, "bet");
	const ventureIds = idsOf(rows, "venture");

	const [work, objectiveRows, assumptionRows, betRows, ventureRows] = await Promise.all([
		workIds.length === 0
			? []
			: db
					.select({
						id: workItems.id,
						label: workItems.title,
						archivedAt: workItems.archivedAt,
						...ventureColumns,
					})
					.from(workItems)
					.innerJoin(ventures, eq(ventures.id, workItems.ventureId))
					.where(inArray(workItems.id, workIds)),
		objectiveIds.length === 0
			? []
			: db
					.select({
						id: objectives.id,
						label: objectives.statement,
						archivedAt: objectives.archivedAt,
						...ventureColumns,
					})
					.from(objectives)
					.innerJoin(ventures, eq(ventures.id, objectives.ventureId))
					.where(inArray(objectives.id, objectiveIds)),
		assumptionIds.length === 0
			? []
			: db
					.select({
						id: assumptions.id,
						label: assumptions.statement,
						archivedAt: assumptions.archivedAt,
						...ventureColumns,
					})
					.from(assumptions)
					.innerJoin(ventures, eq(ventures.id, assumptions.ventureId))
					.where(inArray(assumptions.id, assumptionIds)),
		betIds.length === 0
			? []
			: db
					.select({ id: bets.id, label: bets.action, archivedAt: bets.archivedAt, ...ventureColumns })
					.from(bets)
					.innerJoin(ventures, eq(ventures.id, bets.ventureId))
					.where(inArray(bets.id, betIds)),
		ventureIds.length === 0
			? []
			: db
					.select({ id: ventures.id, label: ventures.name, archivedAt: ventures.archivedAt, ...ventureColumns })
					.from(ventures)
					.where(inArray(ventures.id, ventureIds)),
	]);

	for (const [type, found] of [
		["work_item", work],
		["objective", objectiveRows],
		["assumption", assumptionRows],
		["bet", betRows],
		["venture", ventureRows],
	] as const) {
		for (const row of found) {
			labels.set(`${type}:${row.id}`, {
				label: row.label,
				ventureId: row.ventureId,
				ventureSlug: row.ventureSlug,
				ventureName: row.ventureName,
				archived: row.archivedAt !== null,
			});
		}
	}

	return labels;
}

async function linksByThread(db: Database, threadIds: string[]) {
	const grouped = new Map<string, ThreadLink[]>();

	if (threadIds.length === 0) return grouped;

	const rows = await db
		.select({
			threadId: threadLinks.threadId,
			subjectType: threadLinks.subjectType,
			subjectId: threadLinks.subjectId,
		})
		.from(threadLinks)
		.where(inArray(threadLinks.threadId, threadIds))
		.orderBy(asc(threadLinks.createdAt));

	const labels = await linkLabels(db, rows);

	for (const row of rows) {
		const label = labels.get(`${row.subjectType}:${row.subjectId}`);

		if (label === undefined) continue;

		grouped.set(row.threadId, [
			...(grouped.get(row.threadId) ?? []),
			{ type: row.subjectType, id: row.subjectId, ...label },
		]);
	}

	return grouped;
}

function toRun(row: RunRow) {
	return {
		...row,
		usage: row.usage as Run["usage"],
		createdAt: row.createdAt.toISOString(),
		startedAt: row.startedAt?.toISOString() ?? null,
		firstTokenAt: row.firstTokenAt?.toISOString() ?? null,
		finishedAt: row.finishedAt?.toISOString() ?? null,
		cancelRequestedAt: row.cancelRequestedAt?.toISOString() ?? null,
	} satisfies Run;
}

export function toInputRequest(row: typeof inputRequests.$inferSelect) {
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		answeredAt: row.answeredAt?.toISOString() ?? null,
	} satisfies InputRequest;
}

export function toThread(row: ThreadRow) {
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		archivedAt: row.archivedAt?.toISOString() ?? null,
	};
}

export async function summarize(db: Database, rows: ThreadRow[]) {
	const ids = rows.map((row) => row.id);

	if (ids.length === 0) return [];

	const [links, lastMessages, active, pending] = await Promise.all([
		linksByThread(db, ids),
		db
			.selectDistinctOn([threadMessages.threadId], {
				threadId: threadMessages.threadId,
				author: threadMessages.author,
				body: threadMessages.body,
				createdAt: threadMessages.createdAt,
			})
			.from(threadMessages)
			.where(inArray(threadMessages.threadId, ids))
			.orderBy(threadMessages.threadId, desc(threadMessages.seq)),
		db
			.select({ id: runs.id, threadId: runs.threadId, status: runs.status })
			.from(runs)
			.where(and(inArray(runs.threadId, ids), inArray(runs.status, [...activeRunStatuses]))),
		db
			.select({ threadId: inputRequests.threadId })
			.from(inputRequests)
			.where(and(inArray(inputRequests.threadId, ids), eq(inputRequests.status, "pending"))),
	]);

	const lastByThread = new Map(lastMessages.map((message) => [message.threadId, message]));
	const activeByThread = new Map(active.map((run) => [run.threadId, run]));
	const asking = new Set(pending.map((row) => row.threadId));

	return rows.map((row) => {
		const last = lastByThread.get(row.id);
		const run = activeByThread.get(row.id);

		return {
			...toThread(row),
			links: links.get(row.id) ?? [],
			lastMessage:
				last === undefined
					? null
					: { author: last.author, body: last.body.slice(0, 280), createdAt: last.createdAt.toISOString() },
			activeRun: run === undefined ? null : { id: run.id, status: run.status },
			needsInput: asking.has(row.id),
		} satisfies ThreadSummary;
	});
}

export async function listThreads(
	db: Database,
	filter: {
		ventureId: string | null;
		subject: { type: ThreadLinkType; id: string } | null;
		space?: "none" | string | null;
	},
) {
	const conditions: SQL[] = [
		isNull(threads.archivedAt),
		isNull(threads.operatorVentureId),
		notInArray(threads.id, db.select({ id: spaces.chatThreadId }).from(spaces)),
	];

	if (filter.ventureId !== null) conditions.push(eq(threads.ventureId, filter.ventureId));

	if (filter.space === "none") conditions.push(isNull(threads.spaceId));
	else if (filter.space !== undefined && filter.space !== null) conditions.push(eq(threads.spaceId, filter.space));

	if (filter.subject !== null) {
		conditions.push(
			inArray(
				threads.id,
				db
					.select({ id: threadLinks.threadId })
					.from(threadLinks)
					.where(
						and(eq(threadLinks.subjectType, filter.subject.type), eq(threadLinks.subjectId, filter.subject.id)),
					),
			),
		);
	}

	const rows = await db
		.select()
		.from(threads)
		.where(and(...conditions))
		.orderBy(desc(threads.updatedAt))
		.limit(200);

	return summarize(db, rows);
}

export async function getThread(db: Database, threadId: string) {
	const [row] = await db.select().from(threads).where(eq(threads.id, threadId));

	if (row === undefined) throw new AppError("not_found", "Thread not found", { threadId });

	const [agent, venture, links, messages, runRows, chatOf, memberOf, pending] = await Promise.all([
		db
			.select({ id: agentProfiles.id, name: agentProfiles.name })
			.from(agentProfiles)
			.where(eq(agentProfiles.id, row.agentProfileId))
			.then(([found]) => found),
		row.ventureId === null
			? undefined
			: db
					.select({ id: ventures.id, slug: ventures.slug, name: ventures.name })
					.from(ventures)
					.where(eq(ventures.id, row.ventureId))
					.then(([found]) => found),
		linksByThread(db, [row.id]),
		db.select().from(threadMessages).where(eq(threadMessages.threadId, row.id)).orderBy(asc(threadMessages.seq)),
		db.select().from(runs).where(eq(runs.threadId, row.id)).orderBy(asc(runs.createdAt), asc(runs.id)),
		db
			.select({ id: spaces.id, title: spaces.title })
			.from(spaces)
			.where(eq(spaces.chatThreadId, row.id))
			.then(([found]) => found),
		row.spaceId === null
			? undefined
			: db
					.select({ id: spaces.id, title: spaces.title })
					.from(spaces)
					.where(eq(spaces.id, row.spaceId))
					.then(([found]) => found),
		db
			.select()
			.from(inputRequests)
			.where(and(eq(inputRequests.threadId, row.id), eq(inputRequests.status, "pending")))
			.then(([found]) => found),
	]);

	const eventRows =
		runRows.length === 0
			? []
			: await db
					.select()
					.from(runEvents)
					.where(
						inArray(
							runEvents.runId,
							runRows.map((run) => run.id),
						),
					)
					.orderBy(asc(runEvents.runId), asc(runEvents.seq));

	if (agent === undefined) throw new AppError("internal_error", "The thread's agent profile is missing", { threadId });

	return {
		thread: toThread(row),
		agent,
		venture: venture ?? null,
		space:
			chatOf === undefined
				? memberOf === undefined
					? null
					: { ...memberOf, isChat: false }
				: { ...chatOf, isChat: true },
		inputRequest: pending === undefined ? null : toInputRequest(pending),
		links: links.get(row.id) ?? [],
		messages: messages.map((message) => ({ ...message, createdAt: message.createdAt.toISOString() })),
		runs: runRows.map((run) => ({
			...toRun(run),
			events: eventRows
				.filter((event) => event.runId === run.id)
				.map((event) => ({ ...event, createdAt: event.createdAt.toISOString() }) as RunEvent),
		})),
	} satisfies ThreadDetail;
}

export async function getActiveRuns(db: Database) {
	const rows = await db
		.select({
			id: runs.id,
			threadId: runs.threadId,
			threadTitle: threads.title,
			ventureSlug: ventures.slug,
			status: runs.status,
			runtime: runs.runtime,
			createdAt: runs.createdAt,
			startedAt: runs.startedAt,
		})
		.from(runs)
		.innerJoin(threads, eq(threads.id, runs.threadId))
		.leftJoin(ventures, eq(ventures.id, threads.ventureId))
		.where(inArray(runs.status, [...activeRunStatuses]))
		.orderBy(asc(runs.createdAt));

	return rows.map(
		(row) =>
			({
				...row,
				createdAt: row.createdAt.toISOString(),
				startedAt: row.startedAt?.toISOString() ?? null,
			}) satisfies ActiveRun,
	);
}

function likePattern(query: string) {
	return `%${query.replaceAll(/[\\%_]/gu, (character) => `\\${character}`)}%`;
}

export async function getLinkTargets(db: Database, filter: { query: string; ventureId: string | null }) {
	const pattern = likePattern(filter.query.trim());

	const inScope = (column: typeof ventures.id) =>
		filter.ventureId === null
			? isNull(ventures.archivedAt)
			: and(isNull(ventures.archivedAt), eq(column, filter.ventureId));

	const [work, objectiveRows, assumptionRows, betRows, ventureRows] = await Promise.all([
		db
			.select({ id: workItems.id, label: workItems.title, depth: workItems.depth, ...ventureColumns })
			.from(workItems)
			.innerJoin(ventures, eq(ventures.id, workItems.ventureId))
			.where(and(isNull(workItems.archivedAt), ilike(workItems.title, pattern), inScope(ventures.id)))
			.orderBy(desc(workItems.updatedAt))
			.limit(8),
		db
			.select({ id: objectives.id, label: objectives.statement, ...ventureColumns })
			.from(objectives)
			.innerJoin(ventures, eq(ventures.id, objectives.ventureId))
			.where(and(isNull(objectives.archivedAt), ilike(objectives.statement, pattern), inScope(ventures.id)))
			.orderBy(desc(objectives.updatedAt))
			.limit(3),
		db
			.select({ id: assumptions.id, label: assumptions.statement, ...ventureColumns })
			.from(assumptions)
			.innerJoin(ventures, eq(ventures.id, assumptions.ventureId))
			.where(and(isNull(assumptions.archivedAt), ilike(assumptions.statement, pattern), inScope(ventures.id)))
			.orderBy(desc(assumptions.updatedAt))
			.limit(3),
		db
			.select({ id: bets.id, label: bets.action, ...ventureColumns })
			.from(bets)
			.innerJoin(ventures, eq(ventures.id, bets.ventureId))
			.where(and(isNull(bets.archivedAt), ilike(bets.action, pattern), inScope(ventures.id)))
			.orderBy(desc(bets.updatedAt))
			.limit(3),
		db
			.select({ id: ventures.id, label: ventures.name, ...ventureColumns })
			.from(ventures)
			.where(and(ilike(ventures.name, pattern), inScope(ventures.id)))
			.orderBy(asc(ventures.name))
			.limit(3),
	]);

	return [
		...work.map(({ depth, ...row }) => ({ type: "work_item" as const, ...row, detail: workKinds[depth] ?? "Work" })),
		...objectiveRows.map((row) => ({ type: "objective" as const, ...row, detail: "Objective" })),
		...assumptionRows.map((row) => ({ type: "assumption" as const, ...row, detail: "Assumption" })),
		...betRows.map((row) => ({ type: "bet" as const, ...row, detail: "Bet" })),
		...ventureRows.map((row) => ({ type: "venture" as const, ...row, detail: "Venture" })),
	] satisfies LinkTarget[];
}
