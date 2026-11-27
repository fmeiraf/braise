import type { Inbox, InboxDraft, InboxProposal, Proposal, ProposalChange, ProposalDetail } from "@braise/core";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { accessInbox } from "./access-queries.ts";
import type { Database } from "./db/client.ts";
import { assumptions, bets, objectives, proposals, strategyVersions, threads, ventures } from "./db/schema.ts";
import { changesOf } from "./draft-handlers.ts";
import { AppError } from "./errors.ts";
import { staleness } from "./proposal-handlers.ts";
import { needsInputInbox } from "./space-queries.ts";

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
		kind: "proposal",
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

function toInboxDraft(row: Awaited<ReturnType<typeof inboxRows>>[number]) {
	const { proposal } = row;
	const changes = changesOf(proposal);

	const stamps = changes.flatMap((change) => [change.createdAt, change.editedAt ?? change.createdAt]);

	return {
		kind: "draft",
		id: proposal.id,
		venture: row.venture,
		status: proposal.status,
		changeCount: changes.filter((change) => change.state === "open").length,
		kept: changes.filter((change) => change.state === "kept").length,
		dropped: changes.filter((change) => change.state === "dropped").length,
		latestChangeAt: stamps.toSorted().at(-1) ?? proposal.createdAt.toISOString(),
		createdAt: proposal.createdAt.toISOString(),
		decidedAt: proposal.decidedAt?.toISOString() ?? null,
	} satisfies InboxDraft;
}

export async function getInbox(db: Database) {
	const notDraft = isNull(threads.operatorVentureId);
	const isDraft = isNotNull(threads.operatorVentureId);

	const [pending, decided, drafting, closedDrafts] = await Promise.all([
		inboxRows(db)
			.where(and(eq(proposals.status, "pending"), isNull(ventures.archivedAt), notDraft))
			.orderBy(asc(proposals.createdAt)),
		inboxRows(db)
			.where(and(ne(proposals.status, "pending"), notDraft))
			.orderBy(desc(proposals.decidedAt))
			.limit(decidedLimit),
		inboxRows(db)
			.where(and(eq(proposals.status, "drafting"), isNull(ventures.archivedAt)))
			.orderBy(asc(proposals.createdAt)),
		inboxRows(db)
			.where(and(inArray(proposals.status, ["approved", "rejected"]), isDraft))
			.orderBy(desc(proposals.decidedAt))
			.limit(decidedLimit),
	]);

	const [pendingProposals, decidedProposals, access, questions] = await Promise.all([
		Promise.all(pending.map((row) => toInboxItem(db, row))),
		Promise.all(decided.filter((row) => row.proposal.status !== "drafting").map((row) => toInboxItem(db, row))),
		accessInbox(db),
		needsInputInbox(db),
	]);

	return {
		pending: [...pendingProposals, ...drafting.map(toInboxDraft), ...access.pending, ...questions.pending].toSorted(
			(left, right) => left.createdAt.localeCompare(right.createdAt),
		),
		decided: [...decidedProposals, ...closedDrafts.map(toInboxDraft), ...access.decided, ...questions.decided]
			.toSorted((left, right) => (right.decidedAt ?? "").localeCompare(left.decidedAt ?? ""))
			.slice(0, decidedLimit),
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
		case "objective.update":
		case "objective.close": {
			const objectiveId = change.payload.objectiveId;

			if (typeof objectiveId !== "string") return null;

			const [objective] = await db
				.select()
				.from(objectives)
				.where(and(eq(objectives.id, objectiveId), eq(objectives.ventureId, ventureId)));

			return objective ?? null;
		}
		case "assumption.update": {
			const assumptionId = change.payload.assumptionId;

			if (typeof assumptionId !== "string") return null;

			const [assumption] = await db
				.select()
				.from(assumptions)
				.where(and(eq(assumptions.id, assumptionId), eq(assumptions.ventureId, ventureId)));

			return assumption ?? null;
		}
		case "bet.update":
		case "bet.close": {
			const betId = change.payload.betId;

			if (typeof betId !== "string") return null;

			const [bet] = await db
				.select()
				.from(bets)
				.where(and(eq(bets.id, betId), eq(bets.ventureId, ventureId)));

			return bet ?? null;
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

	const [changes, objectiveRows, assumptionRows, betRows] = await Promise.all([
		Promise.all(
			row.proposal.changes.map(async (change) => ({
				...change,
				current: pending ? await currentValues(db, row.venture.id, change) : null,
				stale: pending ? await staleness(db, row.venture.id, change) : null,
			})),
		),
		db
			.select({
				id: objectives.id,
				statement: objectives.statement,
				kind: objectives.kind,
				status: objectives.status,
			})
			.from(objectives)
			.where(eq(objectives.ventureId, row.venture.id))
			.orderBy(asc(objectives.createdAt)),
		db
			.select({
				id: assumptions.id,
				statement: assumptions.statement,
				confidence: assumptions.confidence,
				objectiveId: assumptions.objectiveId,
			})
			.from(assumptions)
			.where(eq(assumptions.ventureId, row.venture.id))
			.orderBy(asc(assumptions.createdAt)),
		db
			.select({
				id: bets.id,
				action: bets.action,
				status: bets.status,
				assumptionId: bets.assumptionId,
				method: bets.method,
			})
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
		objectives: objectiveRows,
		assumptions: assumptionRows,
		bets: betRows,
	} satisfies ProposalDetail;
}
