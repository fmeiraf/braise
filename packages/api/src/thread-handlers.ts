import { activeRunStatuses, type ThreadLinkType, threadTitle } from "@braise/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { runControlChannel } from "./channels.ts";
import type { Database, Transaction } from "./db/client.ts";
import {
	agentProfiles,
	assumptions,
	bets,
	objectives,
	runs,
	threadLinks,
	threadMessages,
	threads,
	ventures,
	workItems,
} from "./db/schema.ts";
import { AppError } from "./errors.ts";
import type { HandlerContext, Handlers } from "./pipeline.ts";

type ThreadRow = typeof threads.$inferSelect;

interface LinkInput {
	type: ThreadLinkType;
	id: string;
}

export async function lockThread(tx: Transaction, threadId: string) {
	const [thread] = await tx.select().from(threads).where(eq(threads.id, threadId)).for("update");

	if (thread === undefined) throw new AppError("not_found", "Thread not found", { threadId });

	return thread;
}

function assertLive(thread: ThreadRow) {
	if (thread.archivedAt !== null) {
		throw new AppError("rule_violated", "The thread is archived", { rule: "thread_archived", threadId: thread.id });
	}
}

function noChanges() {
	return new AppError("rule_violated", "Nothing changed", { rule: "no_changes" });
}

async function linkTarget(tx: Transaction, link: LinkInput) {
	switch (link.type) {
		case "work_item": {
			const [row] = await tx
				.select({ ventureId: workItems.ventureId, archivedAt: workItems.archivedAt })
				.from(workItems)
				.where(eq(workItems.id, link.id));

			return row;
		}
		case "objective": {
			const [row] = await tx
				.select({ ventureId: objectives.ventureId, archivedAt: objectives.archivedAt })
				.from(objectives)
				.where(eq(objectives.id, link.id));

			return row;
		}
		case "assumption": {
			const [row] = await tx
				.select({ ventureId: assumptions.ventureId, archivedAt: assumptions.archivedAt })
				.from(assumptions)
				.where(eq(assumptions.id, link.id));

			return row;
		}
		case "bet": {
			const [row] = await tx
				.select({ ventureId: bets.ventureId, archivedAt: bets.archivedAt })
				.from(bets)
				.where(eq(bets.id, link.id));

			return row;
		}
		case "venture": {
			const [row] = await tx
				.select({ ventureId: ventures.id, archivedAt: ventures.archivedAt })
				.from(ventures)
				.where(eq(ventures.id, link.id));

			return row;
		}
	}
}

async function assertLinkable(tx: Transaction, thread: { ventureId: string | null }, link: LinkInput) {
	const target = await linkTarget(tx, link);

	if (target === undefined) {
		throw new AppError("rule_violated", "The link target does not exist", { rule: "link_not_found", link });
	}

	if (target.archivedAt !== null) {
		throw new AppError("rule_violated", "The link target is archived", { rule: "link_archived", link });
	}

	if (thread.ventureId !== null && target.ventureId !== thread.ventureId) {
		throw new AppError("rule_violated", "A venture thread links only to that venture's items", {
			rule: "link_out_of_scope",
			link,
		});
	}
}

function uniqueLinks(links: LinkInput[]) {
	const seen = new Map<string, LinkInput>();

	for (const link of links) seen.set(`${link.type}:${link.id}`, link);

	return [...seen.values()];
}

async function addLinks(tx: Transaction, thread: ThreadRow, links: LinkInput[], actor: string) {
	const unique = uniqueLinks(links);

	for (const link of unique) await assertLinkable(tx, thread, link);

	if (unique.length === 0) return;

	await tx
		.insert(threadLinks)
		.values(
			unique.map((link) => ({ threadId: thread.id, subjectType: link.type, subjectId: link.id, createdBy: actor })),
		)
		.onConflictDoNothing();
}

async function linkExists(tx: Transaction, threadId: string, link: LinkInput) {
	const [row] = await tx
		.select({ threadId: threadLinks.threadId })
		.from(threadLinks)
		.where(
			and(
				eq(threadLinks.threadId, threadId),
				eq(threadLinks.subjectType, link.type),
				eq(threadLinks.subjectId, link.id),
			),
		);

	return row !== undefined;
}

export async function appendMessage(
	tx: Transaction,
	thread: ThreadRow,
	message: { author: string; body: string; runId: string | null },
) {
	const seq = thread.lastSeq + 1;

	const [inserted] = await tx
		.insert(threadMessages)
		.values({ id: uuidv7(), threadId: thread.id, seq, ...message })
		.returning();

	await tx.update(threads).set({ lastSeq: seq, updatedAt: sql`now()` }).where(eq(threads.id, thread.id));

	if (inserted === undefined) throw new AppError("internal_error", "Message insert returned nothing");

	return inserted;
}

async function activeRun(tx: Transaction | Database, threadId: string) {
	const [run] = await tx
		.select()
		.from(runs)
		.where(and(eq(runs.threadId, threadId), inArray(runs.status, [...activeRunStatuses])));

	return run;
}

async function assertNoActiveRun(tx: Transaction, threadId: string) {
	const run = await activeRun(tx, threadId);

	if (run !== undefined) {
		throw new AppError("rule_violated", "The agent is still working on this thread", {
			rule: "run_active",
			runId: run.id,
		});
	}
}

async function profileOf(tx: Transaction, profileId: string) {
	const [profile] = await tx.select().from(agentProfiles).where(eq(agentProfiles.id, profileId));

	if (profile === undefined) throw new AppError("not_found", "Agent profile not found", { agentProfileId: profileId });

	return profile;
}

async function queueRun(context: HandlerContext, thread: ThreadRow, messageId: string, retryOf: string | null = null) {
	const profile = await profileOf(context.tx, thread.agentProfileId);

	const [run] = await context.tx
		.insert(runs)
		.values({
			id: uuidv7(),
			threadId: thread.id,
			messageId,
			retryOf,
			runtime: profile.runtime,
			model: profile.model,
			actor: profile.actor,
			status: "queued",
		})
		.returning();

	if (run === undefined) throw new AppError("internal_error", "Run insert returned nothing");

	context.queueRun(run.id);

	return run;
}

async function touch(tx: Transaction, thread: ThreadRow) {
	const [updated] = await tx
		.update(threads)
		.set({ updatedAt: sql`now()` })
		.where(eq(threads.id, thread.id))
		.returning();

	return updated ?? thread;
}

function threadOutcome(thread: ThreadRow, seq: number, result: unknown) {
	return { thread: { id: thread.id, ventureId: thread.ventureId, seq }, result };
}

async function lockRun(tx: Transaction, runId: string) {
	const [found] = await tx.select().from(runs).where(eq(runs.id, runId));

	if (found === undefined) throw new AppError("not_found", "Run not found", { runId });

	const thread = await lockThread(tx, found.threadId);

	const [run] = await tx.select().from(runs).where(eq(runs.id, runId));

	if (run === undefined) throw new AppError("internal_error", "Run disappeared");

	return { run, thread };
}

export const threadHandlers = {
	"thread.start": async (context, payload) => {
		const { tx, actor } = context;
		const ventureId = context.venture?.id ?? null;

		const profile = await profileOf(tx, payload.agentProfileId);

		const [thread] = await tx
			.insert(threads)
			.values({
				id: uuidv7(),
				ventureId,
				agentProfileId: profile.id,
				title: threadTitle(payload.body),
				createdBy: actor,
			})
			.returning();

		if (thread === undefined) throw new AppError("internal_error", "Thread insert returned nothing");

		await addLinks(tx, thread, payload.links, actor);

		const message = await appendMessage(tx, thread, { author: actor, body: payload.body, runId: null });

		const run = await queueRun(context, thread, message.id);

		return threadOutcome(thread, message.seq, { thread: { ...thread, lastSeq: message.seq }, message, run });
	},
	"thread.post": async (context, payload) => {
		const { tx, actor } = context;

		const thread = await lockThread(tx, payload.threadId);

		assertLive(thread);

		await assertNoActiveRun(tx, thread.id);

		await addLinks(tx, thread, payload.links, actor);

		const message = await appendMessage(tx, thread, { author: actor, body: payload.body, runId: null });

		const run = await queueRun(context, thread, message.id);

		return threadOutcome(thread, message.seq, { message, run });
	},
	"thread.link": async ({ tx, actor }, payload) => {
		const thread = await lockThread(tx, payload.threadId);

		assertLive(thread);

		if (await linkExists(tx, thread.id, payload.link)) throw noChanges();

		await addLinks(tx, thread, [payload.link], actor);

		const updated = await touch(tx, thread);

		return threadOutcome(updated, updated.lastSeq, { link: payload.link });
	},
	"thread.unlink": async ({ tx }, payload) => {
		const thread = await lockThread(tx, payload.threadId);

		assertLive(thread);

		if (!(await linkExists(tx, thread.id, payload.link))) throw noChanges();

		await tx
			.delete(threadLinks)
			.where(
				and(
					eq(threadLinks.threadId, thread.id),
					eq(threadLinks.subjectType, payload.link.type),
					eq(threadLinks.subjectId, payload.link.id),
				),
			);

		const updated = await touch(tx, thread);

		return threadOutcome(updated, updated.lastSeq, { link: payload.link });
	},
	"thread.rename": async ({ tx }, payload) => {
		const thread = await lockThread(tx, payload.threadId);

		assertLive(thread);

		if (thread.title === payload.title) throw noChanges();

		const [updated] = await tx
			.update(threads)
			.set({ title: payload.title, updatedAt: sql`now()` })
			.where(eq(threads.id, thread.id))
			.returning();

		return threadOutcome(thread, thread.lastSeq, { thread: updated });
	},
	"thread.archive": async ({ tx }, payload) => {
		const thread = await lockThread(tx, payload.threadId);

		assertLive(thread);

		await assertNoActiveRun(tx, thread.id);

		const [updated] = await tx
			.update(threads)
			.set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(threads.id, thread.id))
			.returning();

		return threadOutcome(thread, thread.lastSeq, { thread: updated });
	},
	"run.cancel": async ({ tx }, payload) => {
		const { run, thread } = await lockRun(tx, payload.runId);

		if (run.status === "queued") {
			const [cancelled] = await tx
				.update(runs)
				.set({ status: "cancelled", finishedAt: sql`now()`, cancelRequestedAt: sql`now()` })
				.where(and(eq(runs.id, run.id), eq(runs.status, "queued")))
				.returning();

			if (cancelled !== undefined) return threadOutcome(thread, thread.lastSeq, { run: cancelled });
		}

		const [requested] = await tx
			.update(runs)
			.set({ cancelRequestedAt: sql`now()` })
			.where(and(eq(runs.id, run.id), eq(runs.status, "running")))
			.returning();

		if (requested === undefined) {
			throw new AppError("rule_violated", "The run is not active", { rule: "run_not_active", runId: run.id });
		}

		await tx.execute(sql`SELECT pg_notify(${runControlChannel}, ${run.id})`);

		return threadOutcome(thread, thread.lastSeq, { run: requested });
	},
	"run.retry": async (context, payload) => {
		const { run, thread } = await lockRun(context.tx, payload.runId);

		assertLive(thread);

		if (run.status !== "failed" && run.status !== "interrupted") {
			throw new AppError("rule_violated", "Only failed or interrupted runs can be retried", {
				rule: "run_not_retryable",
				runId: run.id,
			});
		}

		const [latest] = await context.tx
			.select({ id: runs.id })
			.from(runs)
			.where(eq(runs.threadId, thread.id))
			.orderBy(desc(runs.createdAt), desc(runs.id))
			.limit(1);

		if (latest?.id !== run.id) {
			throw new AppError("rule_violated", "Only the thread's latest run can be retried", {
				rule: "run_not_latest",
				runId: run.id,
			});
		}

		const retry = await queueRun(context, thread, run.messageId, run.id);

		return threadOutcome(thread, thread.lastSeq, { run: retry });
	},
} satisfies Pick<
	Handlers,
	| "thread.start"
	| "thread.post"
	| "thread.link"
	| "thread.unlink"
	| "thread.rename"
	| "thread.archive"
	| "run.cancel"
	| "run.retry"
>;
