import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "./db/client.ts";
import { bets, commands, events, goals, strategyVersions, ventures } from "./db/schema.ts";
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
			openBets: sql<number>`(SELECT count(*)::int FROM bets b WHERE b.venture_id = ventures.id AND b.status = 'open' AND b.archived_at IS NULL)`,
			goals: sql<number>`(SELECT count(*)::int FROM goals g WHERE g.venture_id = ventures.id AND g.archived_at IS NULL)`,
			unlinkedGoals: sql<number>`(SELECT count(*)::int FROM goals g WHERE g.venture_id = ventures.id AND g.archived_at IS NULL AND g.bet_id IS NULL)`,
		})
		.from(ventures)
		.where(isNull(ventures.archivedAt))
		.orderBy(desc(ventures.updatedAt));
}

async function ventureBySlug(db: Database, slug: string) {
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
	reason: commands.reason,
};

function strategiesWithReason(db: Database) {
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

export async function getCockpit(db: Database, slug: string) {
	const venture = await ventureBySlug(db, slug);

	const [strategy] = await strategiesWithReason(db).where(
		and(eq(strategyVersions.ventureId, venture.id), eq(strategyVersions.status, "active")),
	);

	const ventureBets = await db
		.select()
		.from(bets)
		.where(and(eq(bets.ventureId, venture.id), isNull(bets.archivedAt)))
		.orderBy(asc(bets.createdAt));

	const ventureGoals = await db
		.select()
		.from(goals)
		.where(and(eq(goals.ventureId, venture.id), isNull(goals.archivedAt)))
		.orderBy(asc(goals.createdAt));

	return { venture, strategy, bets: ventureBets, goals: ventureGoals };
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
			reason: commands.reason,
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
			reason: commands.reason,
			createdAt: events.createdAt,
		})
		.from(events)
		.innerJoin(commands, eq(commands.id, events.commandId))
		.innerJoin(ventures, eq(ventures.id, events.ventureId))
		.orderBy(desc(events.createdAt), desc(events.seq))
		.limit(limit);

	return { events: rows };
}
