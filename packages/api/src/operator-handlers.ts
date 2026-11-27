import {
	activeRunStatuses,
	defaultAgentProfileId,
	defaultOperatorIdleSeconds,
	isAgentActor,
	type OperatorSession,
	type OperatorState,
} from "@braise/core";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Executor, Transaction } from "./db/client.ts";
import { proposals, runs, threadMessages, threads, ventures } from "./db/schema.ts";
import { changesOf } from "./draft-handlers.ts";
import { AppError } from "./errors.ts";
import type { HandlerContext, Handlers, VentureRow } from "./pipeline.ts";
import { assertNoActiveRun, profileOf, type ThreadRow, threadHandlers, threadOutcome } from "./thread-handlers.ts";

export function operatorIdleSeconds() {
	const parsed = Number(process.env.BRAISE_OPERATOR_IDLE);

	return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultOperatorIdleSeconds;
}

function requireVenture(context: HandlerContext) {
	if (context.venture === null) throw new AppError("internal_error", "Command ran without a venture lock");

	return context.venture;
}

async function lockOpenSession(tx: Transaction, ventureId: string) {
	const [session] = await tx
		.select()
		.from(threads)
		.where(and(eq(threads.operatorVentureId, ventureId), isNull(threads.archivedAt)))
		.for("update");

	return session;
}

async function isIdle(tx: Transaction, session: ThreadRow) {
	const result = await tx.execute<{ idle: boolean }>(sql`
		SELECT coalesce(
			(SELECT max(created_at) FROM thread_messages WHERE thread_id = ${session.id}),
			${session.createdAt.toISOString()}::timestamptz
		) < now() - make_interval(secs => ${operatorIdleSeconds()}) AS idle`);

	return result.rows[0]?.idle === true;
}

async function hasActiveRun(tx: Transaction, threadId: string) {
	const [active] = await tx
		.select({ id: runs.id })
		.from(runs)
		.where(and(eq(runs.threadId, threadId), inArray(runs.status, [...activeRunStatuses])));

	return active !== undefined;
}

async function endSession(tx: Transaction, session: ThreadRow) {
	await tx.update(threads).set({ archivedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(threads.id, session.id));
}

async function startSession(tx: Transaction, venture: VentureRow, actor: string, agentProfileId: string) {
	const profile = await profileOf(tx, agentProfileId);

	const [thread] = await tx
		.insert(threads)
		.values({
			id: uuidv7(),
			ventureId: venture.id,
			operatorVentureId: venture.id,
			agentProfileId: profile.id,
			title: `${venture.name} operator`,
			createdBy: actor,
		})
		.returning();

	if (thread === undefined) throw new AppError("internal_error", "Session insert returned nothing");

	return thread;
}

async function currentSession(tx: Transaction, venture: VentureRow, actor: string, agentProfileId?: string) {
	const open = await lockOpenSession(tx, venture.id);

	if (open !== undefined && !(await isIdle(tx, open))) return { session: open, opened: false };

	if (open !== undefined && (await hasActiveRun(tx, open.id))) return { session: open, opened: false };

	if (open !== undefined) await endSession(tx, open);

	const profile = agentProfileId ?? open?.agentProfileId ?? defaultAgentProfileId;

	return { session: await startSession(tx, venture, actor, profile), opened: true };
}

async function lockVentureOf(tx: Transaction, ventureId: string) {
	const [venture] = await tx.select().from(ventures).where(eq(ventures.id, ventureId)).for("update");

	if (venture === undefined) throw new AppError("not_found", "Venture not found", { ventureId });

	return venture;
}

export const operatorHandlers = {
	"operator.open": async (context, payload) => {
		const venture = requireVenture(context);

		const { session, opened } = await currentSession(context.tx, venture, context.actor, payload.agentProfileId);

		return threadOutcome(session, session.lastSeq, { session, opened });
	},

	"operator.new_session": async (context, payload) => {
		const venture = requireVenture(context);

		const open = await lockOpenSession(context.tx, venture.id);

		if (open !== undefined) {
			await assertNoActiveRun(context.tx, open.id);

			await endSession(context.tx, open);
		}

		const session = await startSession(
			context.tx,
			venture,
			context.actor,
			payload.agentProfileId ?? open?.agentProfileId ?? defaultAgentProfileId,
		);

		return threadOutcome(session, session.lastSeq, { session, opened: true, ended: open?.id ?? null });
	},

	"thread.post": async (context, payload) => {
		const [peek] = await context.tx
			.select({ operatorVentureId: threads.operatorVentureId })
			.from(threads)
			.where(eq(threads.id, payload.threadId));

		if (peek?.operatorVentureId === null || peek === undefined || isAgentActor(context.actor)) {
			return threadHandlers["thread.post"](context, payload);
		}

		const venture = await lockVentureOf(context.tx, peek.operatorVentureId);

		const { session } = await currentSession(context.tx, venture, context.actor);

		const outcome = await threadHandlers["thread.post"](context, { ...payload, threadId: session.id });

		return { ...outcome, result: { ...(outcome.result as object), session } };
	},
} satisfies Pick<Handlers, "operator.open" | "operator.new_session" | "thread.post">;

function toSession(row: {
	id: string;
	title: string;
	agentProfileId: string;
	createdAt: Date;
	archivedAt: Date | null;
	messageCount: number;
	lastMessageAt: Date | string | null;
}) {
	return {
		id: row.id,
		title: row.title,
		agentProfileId: row.agentProfileId,
		createdAt: row.createdAt.toISOString(),
		archivedAt: row.archivedAt?.toISOString() ?? null,
		messageCount: row.messageCount,
		lastMessageAt: row.lastMessageAt === null ? null : new Date(row.lastMessageAt).toISOString(),
	} satisfies OperatorSession;
}

/** The venture's operator sessions, newest first, with the open one picked out. */
export async function getOperator(db: Executor, ventureId: string) {
	const rows = await db
		.select({
			id: threads.id,
			title: threads.title,
			agentProfileId: threads.agentProfileId,
			createdAt: threads.createdAt,
			archivedAt: threads.archivedAt,
			messageCount: count(threadMessages.id),
			lastMessageAt: max(threadMessages.createdAt),
		})
		.from(threads)
		.leftJoin(threadMessages, eq(threadMessages.threadId, threads.id))
		.where(eq(threads.operatorVentureId, ventureId))
		.groupBy(threads.id)
		.orderBy(desc(threads.createdAt), asc(threads.id))
		.limit(50);

	const sessions = rows.map(toSession);

	const drafts = await db
		.select({ changes: proposals.changes })
		.from(proposals)
		.innerJoin(threads, eq(threads.id, proposals.threadId))
		.where(and(eq(proposals.ventureId, ventureId), isNotNull(threads.operatorVentureId)))
		.orderBy(desc(proposals.createdAt))
		.limit(10);

	const changeStates = Object.fromEntries(
		drafts.flatMap((draft) => changesOf(draft).map((change) => [change.id, change.state] as const)),
	);

	return {
		ventureId,
		session: sessions.find((session) => session.archivedAt === null) ?? null,
		sessions,
		idleSeconds: operatorIdleSeconds(),
		changeStates,
	} satisfies OperatorState;
}
