import {
	activeRunStatuses,
	maxWakesSinceOwner,
	type ReportOutcome,
	type RunError,
	type RunStatus,
	reportLine,
	systemAuthor,
} from "@braise/core";
import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Transaction } from "../db/client.ts";
import { inputRequests, runEvents, runs, spaces, threadMessages } from "../db/schema.ts";
import { notifyThread, type RunJob } from "../pipeline.ts";
import { appendMessage, insertRun, lockThread, spaceOfChat, type ThreadRow } from "../thread-handlers.ts";

type RunRow = typeof runs.$inferSelect;

async function queueWake(tx: Transaction, spaceId: string, chat: ThreadRow, messageId: string) {
	const [active] = await tx
		.select({ id: runs.id })
		.from(runs)
		.where(and(eq(runs.threadId, chat.id), inArray(runs.status, [...activeRunStatuses])));

	if (active !== undefined) return null;

	const [space] = await tx
		.update(spaces)
		.set({ wakesSinceOwner: sql`${spaces.wakesSinceOwner} + 1`, updatedAt: sql`now()` })
		.where(and(eq(spaces.id, spaceId), isNull(spaces.archivedAt), lt(spaces.wakesSinceOwner, maxWakesSinceOwner)))
		.returning();

	if (space === undefined) {
		await notifyThread(tx, chat);

		return null;
	}

	const { job } = await insertRun(tx, chat, messageId);

	await notifyThread(tx, chat);

	return job;
}

async function outcomeOf(tx: Transaction, run: RunRow, status: RunStatus, error: RunError | null) {
	const [question] = await tx
		.select({ question: inputRequests.question })
		.from(inputRequests)
		.where(and(eq(inputRequests.runId, run.id), eq(inputRequests.status, "pending")));

	if (question !== undefined) return { outcome: "needs_input" as const, detail: question.question };

	const outcome = status as ReportOutcome;

	const detail = status === "failed" || status === "interrupted" ? (error?.message ?? null) : null;

	return { outcome, detail };
}

async function reportToSpace(
	tx: Transaction,
	run: RunRow,
	thread: ThreadRow,
	status: RunStatus,
	error: RunError | null,
) {
	if (thread.spaceId === null) return null;

	const [space] = await tx
		.select()
		.from(spaces)
		.where(and(eq(spaces.id, thread.spaceId), isNull(spaces.archivedAt)));

	if (space === undefined) return null;

	const { outcome, detail } = await outcomeOf(tx, run, status, error);

	const chat = await lockThread(tx, space.chatThreadId);

	const report = await appendMessage(tx, chat, {
		author: systemAuthor,
		body: reportLine({ title: thread.title, outcome, detail }),
		runId: null,
		meta: { kind: "report", threadId: thread.id, runId: run.id, outcome },
	});

	return queueWake(tx, space.id, chat, report.id);
}

async function seenSeqOf(tx: Transaction, run: RunRow) {
	const [started] = await tx
		.select({ payload: runEvents.payload })
		.from(runEvents)
		.where(and(eq(runEvents.runId, run.id), eq(runEvents.type, "run.started")));

	if (typeof started?.payload.seenSeq === "number") return started.payload.seenSeq;

	const [trigger] = await tx
		.select({ seq: threadMessages.seq })
		.from(threadMessages)
		.where(eq(threadMessages.id, run.messageId));

	return trigger?.seq ?? 0;
}

async function wakeForUnread(tx: Transaction, run: RunRow, thread: ThreadRow) {
	const space = await spaceOfChat(tx, thread.id);

	if (space === undefined || space.archivedAt !== null) return null;

	const [unread] = await tx
		.select({ id: threadMessages.id })
		.from(threadMessages)
		.where(
			and(
				eq(threadMessages.threadId, thread.id),
				gt(threadMessages.seq, await seenSeqOf(tx, run)),
				sql`${threadMessages.meta}->>'kind' = 'report'`,
			),
		)
		.orderBy(desc(threadMessages.seq))
		.limit(1);

	return unread === undefined ? null : queueWake(tx, space.id, thread, unread.id);
}

/** Posts a finished member run's report line in its space's chat and queues at most one wake there. */
export async function reportRunEnd(
	tx: Transaction,
	run: RunRow,
	thread: ThreadRow,
	status: RunStatus,
	error: RunError | null,
) {
	const jobs = [await reportToSpace(tx, run, thread, status, error), await wakeForUnread(tx, run, thread)].filter(
		(job): job is RunJob => job !== null,
	);

	return jobs;
}
