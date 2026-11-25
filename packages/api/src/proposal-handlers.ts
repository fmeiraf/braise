import {
	type AppliedChange,
	type ChangeBase,
	type CommandPayload,
	commandSchemas,
	decisionLine,
	isBetRef,
	type ProposableCommand,
	type ProposalChange,
	samePayload,
	systemAuthor,
} from "@braise/core";
import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Database, Transaction } from "./db/client.ts";
import { bets, goals, proposals, runs, strategyVersions, threads } from "./db/schema.ts";
import { AppError } from "./errors.ts";
import {
	type Handler,
	type HandlerContext,
	type Handlers,
	notifyThread,
	type PendingEvent,
	type VentureRow,
} from "./pipeline.ts";
import { appendMessage, lockThread } from "./thread-handlers.ts";

export type ProposableHandlers = Pick<Handlers, ProposableCommand>;

type ProposalRow = typeof proposals.$inferSelect;

interface IndexedChange extends AppliedChange {
	index: number;
}

function requireVenture(context: HandlerContext) {
	if (context.venture === null) throw new AppError("internal_error", "Command ran without a venture lock");

	return context.venture;
}

function outOfScope(message: string, details: Record<string, unknown>) {
	return new AppError("rule_violated", message, { rule: "proposal_out_of_scope", ...details });
}

function withoutVenture(venture: VentureRow, index: number, payload: Record<string, unknown>) {
	const { ventureId, ...rest } = payload;

	if (ventureId !== undefined && ventureId !== venture.id) {
		throw outOfScope("Every change must be for the proposal's venture", { change: index });
	}

	return rest;
}

function assertRefs(changes: AppliedChange[]) {
	changes.forEach((change, index) => {
		const betId = change.payload.betId;

		if (!isBetRef(betId)) return;

		const target = changes[betId.ref];

		if (
			(change.command !== "goal.create" && change.command !== "goal.update") ||
			betId.ref >= index ||
			target?.command !== "bet.create"
		) {
			throw new AppError("rule_violated", "A bet reference must point at an earlier new bet in this proposal", {
				rule: "proposal_ref_invalid",
				change: index,
			});
		}
	});
}

function resolveRefs(payload: Record<string, unknown>, created: Map<number, string>, index: number) {
	const betId = payload.betId;

	if (!isBetRef(betId)) return payload;

	const resolved = created.get(betId.ref);

	if (resolved === undefined) {
		throw new AppError("rule_violated", "The referenced new bet is not part of what gets applied", {
			rule: "proposal_ref_dropped",
			change: index,
			ref: betId.ref,
		});
	}

	return { ...payload, betId: resolved };
}

function parseChange<Name extends ProposableCommand>(name: Name, payload: unknown, index: number) {
	const parsed = commandSchemas[name].safeParse(payload);

	if (!parsed.success) {
		throw new AppError("validation_failed", "A proposed change is not valid", {
			scope: "change",
			change: index,
			issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
		});
	}

	return parsed.data as CommandPayload<Name>;
}

function handlerFor(apply: ProposableHandlers, name: ProposableCommand) {
	return apply[name] as Handler<ProposableCommand>;
}

async function applyChanges(
	apply: ProposableHandlers,
	context: HandlerContext,
	venture: VentureRow,
	changes: IndexedChange[],
	proposalId: string | null,
) {
	const created = new Map<number, string>();
	const applied: PendingEvent[] = [];

	for (const change of changes) {
		const payload = parseChange(
			change.command,
			{ ...resolveRefs(change.payload, created, change.index), ventureId: venture.id },
			change.index,
		);

		const outcome = await handlerFor(apply, change.command)(context, payload);

		if (!("events" in outcome)) {
			throw new AppError("internal_error", "A proposable command returned a non-venture outcome");
		}

		if (change.command === "bet.create") {
			const result = outcome.result as { id: string };

			created.set(change.index, result.id);
		}

		applied.push(
			...outcome.events.map((event) =>
				proposalId === null ? event : { ...event, payload: { ...event.payload, proposalId } },
			),
		);
	}

	return applied;
}

async function dryRun(
	apply: ProposableHandlers,
	context: HandlerContext,
	venture: VentureRow,
	changes: IndexedChange[],
) {
	await context.tx.execute(sql`SAVEPOINT proposal_dry_run`);

	try {
		await applyChanges(apply, context, venture, changes, null);
	} finally {
		await context.tx.execute(sql`ROLLBACK TO SAVEPOINT proposal_dry_run`);
	}
}

async function activeVersion(tx: Transaction | Database, ventureId: string) {
	const [strategy] = await tx
		.select({ version: strategyVersions.version })
		.from(strategyVersions)
		.where(and(eq(strategyVersions.ventureId, ventureId), eq(strategyVersions.status, "active")));

	return strategy?.version ?? null;
}

async function row(tx: Transaction | Database, table: "bet" | "goal", id: unknown) {
	if (typeof id !== "string") return undefined;

	const source = table === "bet" ? bets : goals;

	const [found] = await tx
		.select({ ventureId: source.ventureId, updatedAt: source.updatedAt, archivedAt: source.archivedAt })
		.from(source)
		.where(eq(source.id, id));

	return found;
}

function subjectOf(change: AppliedChange) {
	switch (change.command) {
		case "bet.update":
		case "bet.set_status":
			return { table: "bet" as const, id: change.payload.betId };
		case "goal.update":
			return { table: "goal" as const, id: change.payload.goalId };
		default:
			return null;
	}
}

export async function baseOf(tx: Transaction, ventureId: string, change: AppliedChange) {
	if (change.command === "strategy.revise") {
		const version = await activeVersion(tx, ventureId);

		return version === null ? null : ({ strategyVersion: version } satisfies ChangeBase);
	}

	const subject = subjectOf(change);

	if (subject === null) return null;

	const found = await row(tx, subject.table, subject.id);

	return found === undefined || found.ventureId !== ventureId
		? null
		: ({ updatedAt: found.updatedAt.toISOString() } satisfies ChangeBase);
}

export async function staleness(tx: Transaction | Database, ventureId: string, change: ProposalChange) {
	const base = change.base;

	if (base === null) return null;

	if ("strategyVersion" in base) {
		const version = await activeVersion(tx, ventureId);

		return version === base.strategyVersion ? null : `The strategy is now v${version}`;
	}

	const subject = subjectOf(change);

	if (subject === null) return null;

	const found = await row(tx, subject.table, subject.id);

	if (found === undefined || found.archivedAt !== null) return `The ${subject.table} was archived`;

	return found.updatedAt.toISOString() === base.updatedAt ? null : `The ${subject.table} changed since`;
}

async function lockProposal(tx: Transaction, venture: VentureRow, proposalId: string) {
	const [proposal] = await tx
		.select()
		.from(proposals)
		.where(and(eq(proposals.id, proposalId), eq(proposals.ventureId, venture.id)))
		.for("update");

	if (proposal === undefined) throw new AppError("not_found", "Proposal not found", { proposalId });

	if (proposal.status !== "pending") {
		throw new AppError("rule_violated", "The proposal was already decided", {
			rule: "proposal_decided",
			status: proposal.status,
		});
	}

	return proposal;
}

async function postDecision(tx: Transaction, proposal: ProposalRow, line: string) {
	const thread = await lockThread(tx, proposal.threadId);

	if (thread.archivedAt !== null) return;

	await appendMessage(tx, thread, { author: systemAuthor, body: line, runId: null });

	await notifyThread(tx, thread);
}

async function proposingThread(tx: Transaction, venture: VentureRow, threadId: string, runId: string) {
	const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId));

	if (thread === undefined) throw new AppError("not_found", "Thread not found", { threadId });

	if (thread.archivedAt !== null) {
		throw new AppError("rule_violated", "The thread is archived", { rule: "thread_archived", threadId });
	}

	if (thread.ventureId !== null && thread.ventureId !== venture.id) {
		throw outOfScope("A venture thread proposes only for its venture", { threadId });
	}

	const [run] = await tx.select({ threadId: runs.threadId }).from(runs).where(eq(runs.id, runId));

	if (run?.threadId !== threadId) throw outOfScope("The run does not belong to the thread", { threadId, runId });
}

export function proposalHandlers(apply: ProposableHandlers) {
	return {
		"proposal.create": async (context, payload) => {
			const venture = requireVenture(context);

			if (context.runId === null) {
				throw new AppError("rule_violated", "A proposal comes from an agent run", { rule: "proposal_needs_run" });
			}

			await proposingThread(context.tx, venture, payload.threadId, context.runId);

			const changes = payload.changes.map((change, index) => ({
				command: change.command,
				payload: withoutVenture(venture, index, change.payload),
			}));

			assertRefs(changes);

			const based: ProposalChange[] = [];

			for (const change of changes) based.push({ ...change, base: await baseOf(context.tx, venture.id, change) });

			await dryRun(
				apply,
				{ ...context, reason: payload.reason },
				venture,
				changes.map((change, index) => ({ ...change, index })),
			);

			const [proposal] = await context.tx
				.insert(proposals)
				.values({
					id: uuidv7(),
					ventureId: venture.id,
					threadId: payload.threadId,
					runId: context.runId,
					createdBy: context.actor,
					title: payload.title,
					reason: payload.reason,
					changes: based,
					status: "pending",
				})
				.returning();

			if (proposal === undefined) throw new AppError("internal_error", "Proposal insert returned nothing");

			return {
				ventureId: venture.id,
				result: proposal,
				events: [
					{
						type: "proposal.created",
						subject: `proposal:${proposal.id}`,
						payload: {
							proposalId: proposal.id,
							title: proposal.title,
							changeCount: based.length,
							threadId: payload.threadId,
						},
					},
				],
			};
		},

		"proposal.approve": async (context, payload) => {
			const venture = requireVenture(context);

			const proposal = await lockProposal(context.tx, venture, payload.proposalId);

			if (payload.changes.length !== proposal.changes.length) {
				throw new AppError("validation_failed", "Send one entry per proposed change", {
					scope: "payload",
					issues: [{ path: "changes", message: `Expected ${proposal.changes.length} entries` }],
				});
			}

			const kept = proposal.changes.flatMap((change, index) => {
				const decision = payload.changes[index];

				return decision === null || decision === undefined
					? []
					: [{ index, command: change.command, payload: withoutVenture(venture, index, decision.payload) }];
			});

			if (kept.length === 0) {
				throw new AppError("rule_violated", "Keep at least one change, or reject the proposal", {
					rule: "proposal_nothing_kept",
				});
			}

			const stale = [];

			for (const change of kept) {
				const original = proposal.changes[change.index];

				const reason = original === undefined ? null : await staleness(context.tx, venture.id, original);

				if (reason !== null) stale.push({ change: change.index, stale: reason });
			}

			if (stale.length > 0) {
				throw new AppError("rule_violated", "Part of the proposal is stale", { rule: "proposal_stale", stale });
			}

			const applied = await applyChanges(apply, context, venture, kept, proposal.id);

			const edited = kept.filter((change) => !samePayload(change.payload, proposal.changes[change.index]?.payload));
			const dropped = proposal.changes.length - kept.length;

			const appliedChanges = payload.changes.map((decision, index) => {
				const change = proposal.changes[index];

				return decision === null || change === undefined
					? null
					: { command: change.command, payload: withoutVenture(venture, index, decision.payload) };
			});

			const note = payload.note ?? null;

			const [decided] = await context.tx
				.update(proposals)
				.set({ status: "approved", applied: appliedChanges, note, decidedAt: sql`now()` })
				.where(eq(proposals.id, proposal.id))
				.returning();

			await postDecision(
				context.tx,
				proposal,
				decisionLine({ status: "approved", title: proposal.title, edited: edited.length, dropped, note }),
			);

			return {
				ventureId: venture.id,
				result: decided,
				events: [
					{
						type: "proposal.approved",
						subject: `proposal:${proposal.id}`,
						payload: {
							proposalId: proposal.id,
							title: proposal.title,
							applied: kept.length,
							dropped,
							edited: edited.length,
						},
					},
					...applied,
				],
			};
		},

		"proposal.reject": async (context, payload) => {
			const venture = requireVenture(context);

			const proposal = await lockProposal(context.tx, venture, payload.proposalId);

			const note = payload.note ?? null;

			const [decided] = await context.tx
				.update(proposals)
				.set({ status: "rejected", note, decidedAt: sql`now()` })
				.where(eq(proposals.id, proposal.id))
				.returning();

			await postDecision(
				context.tx,
				proposal,
				decisionLine({ status: "rejected", title: proposal.title, edited: 0, dropped: 0, note }),
			);

			return {
				ventureId: venture.id,
				result: decided,
				events: [
					{
						type: "proposal.rejected",
						subject: `proposal:${proposal.id}`,
						payload: { proposalId: proposal.id, title: proposal.title },
					},
				],
			};
		},
	} satisfies Pick<Handlers, "proposal.create" | "proposal.approve" | "proposal.reject">;
}
