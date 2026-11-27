import { type ProposedBet, workHomeKey } from "@braise/core";
import { and, asc, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database, Executor } from "./db/client.ts";
import {
	assumptions,
	bets,
	commands,
	events,
	learnings,
	objectives,
	proposals,
	readings,
	strategyVersions,
	ventures,
	workItems,
} from "./db/schema.ts";
import { AppError } from "./errors.ts";

export async function listVentures(db: Database) {
	return db
		.select({
			id: ventures.id,
			slug: ventures.slug,
			name: ventures.name,
			kind: ventures.kind,
			lastSeq: ventures.lastSeq,
			lastActivityAt: ventures.updatedAt,
			objective: sql<
				string | null
			>`(SELECT o.statement FROM objectives o WHERE o.venture_id = ventures.id AND o.status = 'active' AND o.archived_at IS NULL ORDER BY (o.kind = 'build'), o.created_at LIMIT 1)`,
			openBets: sql<number>`(SELECT count(*)::int FROM bets b WHERE b.venture_id = ventures.id AND b.status = 'open' AND b.archived_at IS NULL)`,
			openAssumptions: sql<number>`(SELECT count(*)::int FROM assumptions a WHERE a.venture_id = ventures.id AND a.status = 'open' AND a.objective_id IS NOT NULL AND a.archived_at IS NULL)`,
			strategyVersion: sql<number>`(SELECT coalesce(max(s.version), 0)::int FROM strategy_versions s WHERE s.venture_id = ventures.id AND s.status = 'active')`,
		})
		.from(ventures)
		.where(isNull(ventures.archivedAt))
		.orderBy(desc(ventures.updatedAt));
}

export async function ventureBySlug(db: Executor, slug: string) {
	const [venture] = await db.select().from(ventures).where(eq(ventures.slug, slug));

	if (venture === undefined) throw new AppError("not_found", "Venture not found", { slug });

	return venture;
}

const strategyColumns = {
	id: strategyVersions.id,
	ventureId: strategyVersions.ventureId,
	version: strategyVersions.version,
	status: strategyVersions.status,
	why: strategyVersions.why,
	what: strategyVersions.what,
	diagnosis: strategyVersions.diagnosis,
	guidingPolicy: strategyVersions.guidingPolicy,
	createdBy: strategyVersions.createdBy,
	createdAt: strategyVersions.createdAt,
	activatedAt: strategyVersions.activatedAt,
	reason: sql<string | null>`coalesce(${events.payload}->>'reason', ${commands.reason})`,
};

function strategiesWithReason(db: Executor) {
	return db
		.select(strategyColumns)
		.from(strategyVersions)
		.leftJoin(
			events,
			and(
				eq(events.ventureId, strategyVersions.ventureId),
				eq(events.type, "strategy.revised"),
				sql`${events.payload}->>'strategyVersionId' = ${strategyVersions.id}::text`,
			),
		)
		.leftJoin(commands, eq(commands.id, events.commandId))
		.$dynamic();
}

export async function getCockpit(db: Executor, slug: string) {
	const venture = await ventureBySlug(db, slug);

	const [strategy] = await strategiesWithReason(db).where(
		and(eq(strategyVersions.ventureId, venture.id), eq(strategyVersions.status, "active")),
	);

	const live = (table: { ventureId: AnyPgColumn; archivedAt: AnyPgColumn }) =>
		and(eq(table.ventureId, venture.id), isNull(table.archivedAt));

	const objectiveRows = await db.select().from(objectives).where(live(objectives)).orderBy(asc(objectives.createdAt));

	const assumptionRows = await db
		.select()
		.from(assumptions)
		.where(live(assumptions))
		.orderBy(asc(assumptions.createdAt), asc(assumptions.id));

	const betRows = await db.select().from(bets).where(live(bets)).orderBy(asc(bets.createdAt), asc(bets.id));

	const learningRows = await db
		.select()
		.from(learnings)
		.where(eq(learnings.ventureId, venture.id))
		.orderBy(desc(learnings.createdAt));

	const readingRows = await db
		.select()
		.from(readings)
		.where(eq(readings.ventureId, venture.id))
		.orderBy(asc(readings.takenOn), asc(readings.createdAt));

	const progressRows = await db
		.select({
			betId: workItems.betId,
			objectiveId: workItems.objectiveId,
			done: sql<number>`count(*) FILTER (WHERE ${workItems.status} = 'done')::int`,
			total: sql<number>`count(*)::int`,
		})
		.from(workItems)
		.where(live(workItems))
		.groupBy(workItems.betId, workItems.objectiveId);

	const pending = await db
		.select({ id: proposals.id, createdBy: proposals.createdBy, changes: proposals.changes })
		.from(proposals)
		.where(and(eq(proposals.ventureId, venture.id), eq(proposals.status, "pending")))
		.orderBy(asc(proposals.createdAt));

	const workProgress = Object.fromEntries(
		progressRows.map(({ done, total, ...home }) => [workHomeKey(home), { done, total }]),
	);

	const proposedBets = pending.flatMap((proposal) =>
		proposal.changes.flatMap((change) => {
			const { assumptionId, action } = change.payload;

			return change.command === "bet.create" && typeof assumptionId === "string" && typeof action === "string"
				? [{ proposalId: proposal.id, assumptionId, action, createdBy: proposal.createdBy } satisfies ProposedBet]
				: [];
		}),
	);

	return {
		venture,
		strategy,
		objectives: objectiveRows,
		assumptions: assumptionRows,
		bets: betRows,
		learnings: learningRows,
		readings: readingRows,
		proposedBets,
		workProgress,
	};
}

function liveWorkItems(db: Executor, ventureIds: string[]) {
	if (ventureIds.length === 0) return Promise.resolve([]);

	return db
		.select()
		.from(workItems)
		.where(and(inArray(workItems.ventureId, ventureIds), isNull(workItems.archivedAt)))
		.orderBy(asc(workItems.depth), asc(workItems.position));
}

function liveObjectives(db: Executor, ventureIds: string[]) {
	if (ventureIds.length === 0) return Promise.resolve([]);

	return db
		.select()
		.from(objectives)
		.where(and(inArray(objectives.ventureId, ventureIds), isNull(objectives.archivedAt)))
		.orderBy(asc(objectives.createdAt));
}

function liveBets(db: Executor, ventureIds: string[]) {
	if (ventureIds.length === 0) return Promise.resolve([]);

	return db
		.select()
		.from(bets)
		.where(and(inArray(bets.ventureId, ventureIds), isNull(bets.archivedAt)))
		.orderBy(asc(bets.createdAt), asc(bets.id));
}

export async function getVentureWork(db: Executor, slug: string) {
	const venture = await ventureBySlug(db, slug);

	return {
		ventureId: venture.id,
		lastSeq: venture.lastSeq,
		objectives: await liveObjectives(db, [venture.id]),
		bets: await liveBets(db, [venture.id]),
		workItems: await liveWorkItems(db, [venture.id]),
	};
}

export async function getHoldingWork(db: Database) {
	const live = await db
		.select({ id: ventures.id, slug: ventures.slug, name: ventures.name, lastSeq: ventures.lastSeq })
		.from(ventures)
		.where(isNull(ventures.archivedAt))
		.orderBy(desc(ventures.updatedAt));

	const ids = live.map((venture) => venture.id);

	return {
		ventures: live,
		objectives: await liveObjectives(db, ids),
		bets: await liveBets(db, ids),
		workItems: await liveWorkItems(db, ids),
	};
}

export async function getStrategyVersions(db: Database, slug: string, version: number | null) {
	const venture = await ventureBySlug(db, slug);

	const scope = eq(strategyVersions.ventureId, venture.id);

	const versions = await strategiesWithReason(db)
		.where(version === null ? scope : and(scope, eq(strategyVersions.version, version)))
		.orderBy(desc(strategyVersions.version));

	if (version !== null && versions.length === 0) {
		throw new AppError("not_found", "Strategy version not found", { slug, version });
	}

	return { ventureId: venture.id, lastSeq: venture.lastSeq, versions };
}

export async function getEvents(db: Database, slug: string, page: { before: number | null; limit: number }) {
	const venture = await ventureBySlug(db, slug);

	const scope = eq(events.ventureId, venture.id);

	const rows = await db
		.select({
			ventureId: events.ventureId,
			seq: events.seq,
			type: events.type,
			subject: events.subject,
			payload: events.payload,
			actor: events.actor,
			runId: events.runId,
			reason: sql<string | null>`coalesce(${events.payload}->>'reason', ${commands.reason})`,
			createdAt: events.createdAt,
		})
		.from(events)
		.innerJoin(commands, eq(commands.id, events.commandId))
		.where(page.before === null ? scope : and(scope, lt(events.seq, page.before)))
		.orderBy(desc(events.seq))
		.limit(page.limit);

	return { ventureId: venture.id, lastSeq: venture.lastSeq, events: rows };
}

export async function getRecentEvents(db: Database, limit: number) {
	const rows = await db
		.select({
			ventureId: events.ventureId,
			ventureSlug: ventures.slug,
			ventureName: ventures.name,
			seq: events.seq,
			type: events.type,
			subject: events.subject,
			payload: events.payload,
			actor: events.actor,
			runId: events.runId,
			reason: sql<string | null>`coalesce(${events.payload}->>'reason', ${commands.reason})`,
			createdAt: events.createdAt,
		})
		.from(events)
		.innerJoin(commands, eq(commands.id, events.commandId))
		.innerJoin(ventures, eq(ventures.id, events.ventureId))
		.orderBy(desc(events.createdAt), desc(events.seq))
		.limit(limit);

	return { events: rows };
}
