import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Transaction } from "./db/client.ts";
import { inputRequests, runs, runtimePauses, spaces, threads } from "./db/schema.ts";
import { AppError } from "./errors.ts";
import type { HandlerContext, Handlers } from "./pipeline.ts";
import {
	addLinks,
	appendMessage,
	assertInScope,
	assertLive,
	assertMemberOf,
	assertNoActiveRun,
	delegatingSpace,
	lockSpace,
	lockThread,
	notifyChat,
	profileOf,
	runJobOf,
	type SpaceRow,
	spaceOfChat,
	type ThreadRow,
	threadOutcome,
} from "./thread-handlers.ts";

function noChanges() {
	return new AppError("rule_violated", "Nothing changed", { rule: "no_changes" });
}

async function assertOwnSpace(context: HandlerContext, spaceId: string) {
	const delegating = await delegatingSpace(context);

	if (delegating !== null && delegating.id !== spaceId) {
		throw new AppError("rule_violated", "An agent changes only its own space", { rule: "not_own_space", spaceId });
	}
}

async function chatOf(tx: Transaction, spaceId: string) {
	const [space] = await tx.select({ chatThreadId: spaces.chatThreadId }).from(spaces).where(eq(spaces.id, spaceId));

	if (space === undefined) throw new AppError("not_found", "Space not found", { spaceId });

	const chat = await lockThread(tx, space.chatThreadId);

	return { chat, space: await lockSpace(tx, spaceId) };
}

async function assertJoinable(tx: Transaction, space: SpaceRow, thread: ThreadRow) {
	const threadId = thread.id;

	assertLive(thread);

	if ((await spaceOfChat(tx, thread.id)) !== undefined) {
		throw new AppError("rule_violated", "A space's chat can't be a member of a space", {
			rule: "chat_not_member",
			threadId,
		});
	}

	if (thread.operatorVentureId !== null) {
		throw new AppError("rule_violated", "An operator session can't be a member of a space", {
			rule: "operator_not_member",
			threadId,
		});
	}

	if (thread.spaceId === space.id) throw noChanges();

	if (thread.spaceId !== null) {
		throw new AppError("rule_violated", "The thread is already in another space", {
			rule: "thread_in_other_space",
			threadId,
			spaceId: thread.spaceId,
		});
	}

	assertInScope(space, thread.ventureId);
}

async function setMembership(tx: Transaction, thread: ThreadRow, spaceId: string | null) {
	const [updated] = await tx
		.update(threads)
		.set({ spaceId, updatedAt: sql`now()` })
		.where(eq(threads.id, thread.id))
		.returning();

	if (updated === undefined) throw new AppError("internal_error", "Thread disappeared");

	return updated;
}

async function touchSpace(tx: Transaction, spaceId: string, changes: Partial<typeof spaces.$inferInsert> = {}) {
	const [updated] = await tx
		.update(spaces)
		.set({ ...changes, updatedAt: sql`now()` })
		.where(eq(spaces.id, spaceId))
		.returning();

	if (updated === undefined) throw new AppError("internal_error", "Space disappeared");

	return updated;
}

function globalCapacity(result: unknown) {
	return { global: true as const, channel: "capacity" as const, result };
}

export const spaceHandlers = {
	"space.create": async ({ tx, actor, venture }, payload) => {
		const profile = await profileOf(tx, payload.agentProfileId);

		const [chat] = await tx
			.insert(threads)
			.values({
				id: uuidv7(),
				ventureId: venture?.id ?? null,
				agentProfileId: profile.id,
				title: payload.title,
				createdBy: actor,
			})
			.returning();

		if (chat === undefined) throw new AppError("internal_error", "Thread insert returned nothing");

		await addLinks(tx, chat, payload.links, actor);

		const [space] = await tx
			.insert(spaces)
			.values({
				id: uuidv7(),
				ventureId: venture?.id ?? null,
				title: payload.title,
				goal: payload.goal === undefined || payload.goal === "" ? null : payload.goal,
				agentProfileId: profile.id,
				chatThreadId: chat.id,
				createdBy: actor,
			})
			.returning();

		if (space === undefined) throw new AppError("internal_error", "Space insert returned nothing");

		return threadOutcome(chat, chat.lastSeq, { space, thread: chat });
	},
	"space.update": async ({ tx }, payload) => {
		const { chat, space } = await chatOf(tx, payload.spaceId);

		const changes: Partial<typeof spaces.$inferInsert> = {};

		if (payload.title !== undefined && payload.title !== space.title) changes.title = payload.title;

		const goal = payload.goal === "" ? null : payload.goal;

		if (goal !== undefined && goal !== space.goal) changes.goal = goal;

		if (payload.agentProfileId !== undefined && payload.agentProfileId !== space.agentProfileId) {
			changes.agentProfileId = (await profileOf(tx, payload.agentProfileId)).id;
		}

		if (Object.keys(changes).length === 0) throw noChanges();

		const updated = await touchSpace(tx, space.id, changes);

		await tx
			.update(threads)
			.set({ title: updated.title, agentProfileId: updated.agentProfileId, updatedAt: sql`now()` })
			.where(eq(threads.id, chat.id));

		return threadOutcome(chat, chat.lastSeq, { space: updated });
	},
	"space.archive": async ({ tx }, payload) => {
		const { chat, space } = await chatOf(tx, payload.spaceId);

		await assertNoActiveRun(tx, chat.id);

		const released = await tx
			.update(threads)
			.set({ spaceId: null, updatedAt: sql`now()` })
			.where(eq(threads.spaceId, space.id))
			.returning({ id: threads.id });

		await tx.update(threads).set({ archivedAt: sql`now()`, updatedAt: sql`now()` }).where(eq(threads.id, chat.id));

		const archived = await touchSpace(tx, space.id, { archivedAt: new Date() });

		return threadOutcome(chat, chat.lastSeq, { space: archived, releasedThreadIds: released.map((row) => row.id) });
	},
	"space.add_thread": async (context, payload) => {
		await assertOwnSpace(context, payload.spaceId);

		const thread = await lockThread(context.tx, payload.threadId);

		const space = await lockSpace(context.tx, payload.spaceId);

		await assertJoinable(context.tx, space, thread);

		const updated = await setMembership(context.tx, thread, space.id);

		await touchSpace(context.tx, space.id);

		await notifyChat(context.tx, space);

		return threadOutcome(updated, updated.lastSeq, { thread: updated });
	},
	"space.remove_thread": async (context, payload) => {
		await assertOwnSpace(context, payload.spaceId);

		const thread = await lockThread(context.tx, payload.threadId);

		const space = await lockSpace(context.tx, payload.spaceId);

		assertMemberOf(space, thread);

		const updated = await setMembership(context.tx, thread, null);

		await touchSpace(context.tx, space.id);

		await notifyChat(context.tx, space);

		return threadOutcome(updated, updated.lastSeq, { thread: updated });
	},
	"input.request": async ({ tx, actor, runId }, payload) => {
		if (runId === null) throw new AppError("validation_failed", "A question needs a run", { scope: "run" });

		const [run] = await tx.select().from(runs).where(eq(runs.id, runId));

		if (run === undefined || run.actor !== actor) {
			throw new AppError("validation_failed", "The run doesn't belong to this agent", { runId });
		}

		const thread = await lockThread(tx, run.threadId);

		assertLive(thread);

		const [pending] = await tx
			.select({ id: inputRequests.id })
			.from(inputRequests)
			.where(and(eq(inputRequests.threadId, thread.id), eq(inputRequests.status, "pending")));

		if (pending !== undefined) {
			throw new AppError("rule_violated", "This thread already has a question waiting for the owner", {
				rule: "input_pending",
				inputRequestId: pending.id,
			});
		}

		const [request] = await tx
			.insert(inputRequests)
			.values({ id: uuidv7(), threadId: thread.id, runId, question: payload.question, status: "pending" })
			.returning();

		if (request === undefined) throw new AppError("internal_error", "Input request insert returned nothing");

		const message = await appendMessage(tx, thread, {
			author: actor,
			body: payload.question,
			runId,
			meta: { kind: "question", inputRequestId: request.id },
		});

		return threadOutcome(thread, message.seq, { inputRequest: request });
	},
	"runtime.pause": async ({ tx }, payload) => {
		const [pause] = await tx
			.insert(runtimePauses)
			.values({ id: uuidv7(), runtime: payload.runtime, reason: "owner" })
			.onConflictDoNothing({ target: runtimePauses.runtime, where: sql`${runtimePauses.liftedAt} IS NULL` })
			.returning();

		if (pause === undefined) throw noChanges();

		return globalCapacity({ pause });
	},
	"runtime.resume": async (context, payload) => {
		const [lifted] = await context.tx
			.update(runtimePauses)
			.set({ liftedAt: sql`now()` })
			.where(and(eq(runtimePauses.runtime, payload.runtime), isNull(runtimePauses.liftedAt)))
			.returning();

		if (lifted === undefined) throw noChanges();

		const queued = await context.tx
			.select()
			.from(runs)
			.where(and(eq(runs.runtime, payload.runtime), eq(runs.status, "queued")));

		for (const run of queued) context.queueRun(await runJobOf(context.tx, run));

		return globalCapacity({ pause: lifted, requeued: queued.length });
	},
} satisfies Pick<
	Handlers,
	| "space.create"
	| "space.update"
	| "space.archive"
	| "space.add_thread"
	| "space.remove_thread"
	| "input.request"
	| "runtime.pause"
	| "runtime.resume"
>;
