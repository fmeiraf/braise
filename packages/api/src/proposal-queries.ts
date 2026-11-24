import type { Inbox, InboxProposal, Proposal, ProposalChange, ProposalDetail } from "@braise/core";
import { and, asc, desc, eq, isNull, ne } from "drizzle-orm";
import type { Database } from "./db/client.ts";
import { bets, goals, proposals, strategyVersions, threads, ventures } from "./db/schema.ts";
import { AppError } from "./errors.ts";
import { staleness } from "./proposal-handlers.ts";

const decidedLimit = 20;

type ProposalRow = typeof proposals.$inferSelect;

function toProposal(row: ProposalRow) {
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		decidedAt: row.decidedAt?.toISOString() ?? null,
	} satisfies Proposal;
}

const inboxColumns = {
	proposal: proposals,
	venture: { id: ventures.id, slug: ventures.slug, name: ventures.name },
	thread: { id: threads.id, title: threads.title },
};

function inboxRows(db: Database) {
	return db
		.select(inboxColumns)
		.from(proposals)
		.innerJoin(ventures, eq(ventures.id, proposals.ventureId))
		.innerJoin(threads, eq(threads.id, proposals.threadId));
}

async function staleCount(db: Database, ventureId: string, changes: ProposalChange[]) {
	const reasons = await Promise.all(changes.map((change) => staleness(db, ventureId, change)));

	return reasons.filter((reason) => reason !== null).length;
}

async function toInboxItem(db: Database, row: Awaited<ReturnType<typeof inboxRows>>[number]) {
	const { proposal } = row;

	return {
		id: proposal.id,
		venture: row.venture,
		thread: row.thread,
		title: proposal.title,
		createdBy: proposal.createdBy,
		status: proposal.status,
		changeCount: proposal.changes.length,
		staleCount: proposal.status === "pending" ? await staleCount(db, proposal.ventureId, proposal.changes) : 0,
		createdAt: proposal.createdAt.toISOString(),
		decidedAt: proposal.decidedAt?.toISOString() ?? null,
	} satisfies InboxProposal;
}

export async function getInbox(db: Database) {
	const [pending, decided] = await Promise.all([
		inboxRows(db)
			.where(and(eq(proposals.status, "pending"), isNull(ventures.archivedAt)))
			.orderBy(asc(proposals.createdAt)),
		inboxRows(db).where(ne(proposals.status, "pending")).orderBy(desc(proposals.decidedAt)).limit(decidedLimit),
	]);

	return {
		pending: await Promise.all(pending.map((row) => toInboxItem(db, row))),
		decided: await Promise.all(decided.map((row) => toInboxItem(db, row))),
	} satisfies Inbox;
}

async function currentValues(db: Database, ventureId: string, change: ProposalChange) {
	switch (change.command) {
		case "strategy.revise": {
			const [strategy] = await db
				.select({
					version: strategyVersions.version,
					why: strategyVersions.why,
					what: strategyVersions.what,
					diagnosis: strategyVersions.diagnosis,
					guidingPolicy: strategyVersions.guidingPolicy,
				})
				.from(strategyVersions)
				.where(and(eq(strategyVersions.ventureId, ventureId), eq(strategyVersions.status, "active")));

			return strategy ?? null;
		}
		case "bet.update":
		case "bet.set_status": {
			const betId = change.payload.betId;

			if (typeof betId !== "string") return null;

			const [bet] = await db
				.select({
					hypothesis: bets.hypothesis,
					action: bets.action,
					killCriteria: bets.killCriteria,
					status: bets.status,
				})
				.from(bets)
				.where(and(eq(bets.id, betId), eq(bets.ventureId, ventureId)));

			return bet ?? null;
		}
		case "goal.update": {
			const goalId = change.payload.goalId;

			if (typeof goalId !== "string") return null;

			const [goal] = await db
				.select({ outcome: goals.outcome, signal: goals.signal, horizon: goals.horizon, betId: goals.betId })
				.from(goals)
				.where(and(eq(goals.id, goalId), eq(goals.ventureId, ventureId)));

			return goal ?? null;
		}
		default:
			return null;
	}
}

export async function getProposal(db: Database, proposalId: string) {
	const [row] = await db
		.select({
			proposal: proposals,
			venture: { id: ventures.id, slug: ventures.slug, name: ventures.name, lastSeq: ventures.lastSeq },
			thread: { id: threads.id, title: threads.title, ventureId: threads.ventureId },
		})
		.from(proposals)
		.innerJoin(ventures, eq(ventures.id, proposals.ventureId))
		.innerJoin(threads, eq(threads.id, proposals.threadId))
		.where(eq(proposals.id, proposalId));

	if (row === undefined) throw new AppError("not_found", "Proposal not found", { proposalId });

	const pending = row.proposal.status === "pending";

	const [changes, betRows] = await Promise.all([
		Promise.all(
			row.proposal.changes.map(async (change) => ({
				...change,
				current: pending ? await currentValues(db, row.venture.id, change) : null,
				stale: pending ? await staleness(db, row.venture.id, change) : null,
			})),
		),
		db
			.select({ id: bets.id, hypothesis: bets.hypothesis, status: bets.status })
			.from(bets)
			.where(eq(bets.ventureId, row.venture.id))
			.orderBy(asc(bets.createdAt)),
	]);

	return {
		proposal: toProposal(row.proposal),
		venture: row.venture,
		thread: {
			id: row.thread.id,
			title: row.thread.title,
			ventureSlug: row.thread.ventureId === null ? null : row.venture.slug,
		},
		changes,
		bets: betRows,
	} satisfies ProposalDetail;
}
