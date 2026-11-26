import type { Capacity, Inbox, Run, SpaceDetail, SpaceSummary, ThreadDetail, ThreadSummary } from "@braise/core";
import { eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { afterAll, describe, expect, it } from "vitest";
import { liftPause, openPauseOf, recordLimit } from "../src/agent/limits.ts";
import { braiseTools } from "../src/agent/tools.ts";
import { claimRun, finishRun } from "../src/agent/worker.ts";
import { runs, runtimePauses, spaces, threadMessages, threads } from "../src/db/schema.ts";
import { handlers } from "../src/handlers.ts";
import { executeCommand } from "../src/pipeline.ts";
import { runtimeDays } from "../src/space-queries.ts";
import { createVenture, freshKey, openTestDatabase } from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

interface Sent<Result> {
	status: number;
	body: { result: Result; error?: { code: string; details: Record<string, unknown> } };
}

async function send<Result>(name: string, payload: Record<string, unknown>) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name) });

	return { status: response.status, body: await response.json() } as Sent<Result>;
}

async function ok<Result>(name: string, payload: Record<string, unknown>) {
	const sent = await send<Result>(name, payload);

	expect(sent.status, JSON.stringify(sent.body)).toBe(200);

	return sent.body.result;
}

async function refused(name: string, payload: Record<string, unknown>) {
	const sent = await send(name, payload);

	return { status: sent.status, code: sent.body.error?.code, rule: sent.body.error?.details.rule };
}

async function read<Body>(path: string) {
	const response = await database.app.request(`/api${path}`);

	expect(response.status).toBe(200);

	return (await response.json()) as Body;
}

interface Created {
	space: { id: string; chatThreadId: string; ventureId: string | null };
	thread: { id: string };
}

interface Started {
	thread: { id: string; spaceId: string | null };
	message: { id: string };
	run: Run;
}

async function createSpace(ventureId: string | null, title = "Pricing page") {
	return ok<Created>("space.create", {
		...(ventureId === null ? {} : { ventureId }),
		title,
		goal: "Ship the pricing page",
		agentProfileId: "claude",
	});
}

async function startThread(payload: Record<string, unknown>) {
	return ok<Started>("thread.start", { body: "Research a competitor", ...payload });
}

async function chatRun(space: Created["space"], body = "Research three competitors") {
	const posted = await ok<{ run: Run }>("thread.post", { threadId: space.chatThreadId, body });

	return posted.run;
}

function agentCommand(name: string, payload: Record<string, unknown>, runId: string, actor = "agent:claude") {
	return executeCommand(database.db, handlers, database.services, {
		name,
		body: { payload, idempotencyKey: freshKey(name) },
		actor,
		runId,
	}).then(
		(response) => ({ status: 200, result: response.result as Record<string, unknown>, code: undefined }),
		(error: { status: number; code: string; details: Record<string, unknown> }) => ({
			status: error.status,
			result: error.details,
			code: error.code,
		}),
	);
}

function toolsFor(run: Run, chatOf: { spaceId: string; ventureId: string | null } | null) {
	const tools = braiseTools({
		db: database.db,
		reader: database.reader,
		services: database.services,
		actor: run.actor,
		runId: run.id,
		threadId: run.threadId,
		chatOf,
	});

	return (name: string, args: unknown) => {
		const found = tools.find((tool) => tool.name === name);

		if (found === undefined) throw new Error(`No tool ${name}`);

		return found.execute(args);
	};
}

async function finish(runId: string, status: "succeeded" | "failed" | "interrupted" = "succeeded") {
	await database.run(claimRun(runId));

	await database.run(
		finishRun(runId, { status, usage: null, error: status === "failed" ? { message: "boom" } : null }),
	);
}

async function chatMessages(chatThreadId: string) {
	return database.db
		.select()
		.from(threadMessages)
		.where(eq(threadMessages.threadId, chatThreadId))
		.orderBy(threadMessages.seq);
}

async function chatRuns(chatThreadId: string) {
	return database.db.select().from(runs).where(eq(runs.threadId, chatThreadId)).orderBy(runs.createdAt, runs.id);
}

async function wakes(spaceId: string) {
	const [row] = await database.db.select({ wakes: spaces.wakesSinceOwner }).from(spaces).where(eq(spaces.id, spaceId));

	return row?.wakes;
}

describe("space membership", () => {
	it("creates a space with its own chat thread, which never lists as a loose thread", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const listed = await read<{ threads: ThreadSummary[] }>(`/threads?ventureId=${venture.id}`);

		expect(listed.threads.map((thread) => thread.id)).not.toContain(space.chatThreadId);

		const detail = await read<ThreadDetail>(`/threads/${space.chatThreadId}`);

		expect(detail.space).toEqual({ id: space.id, title: "Pricing page", isChat: true });

		const spacesList = await read<{ spaces: SpaceSummary[] }>(`/spaces?ventureId=${venture.id}`);

		expect(spacesList.spaces).toMatchObject([{ id: space.id, title: "Pricing page", agent: { name: "Claude" } }]);
	});

	it("adds and removes a thread with one column, keeping its history", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const loose = await startThread({ ventureId: venture.id, agentProfileId: "gpt" });

		await ok("space.add_thread", { spaceId: space.id, threadId: loose.thread.id });

		const detail = await read<SpaceDetail>(`/spaces/${space.id}`);

		expect(detail.members.map((member) => member.thread.id)).toEqual([loose.thread.id]);

		expect(detail.members[0]?.agent.name).toBe("GPT");

		expect(detail.space.counts.queued).toBe(1);

		expect(await refused("space.add_thread", { spaceId: space.id, threadId: loose.thread.id })).toMatchObject({
			rule: "no_changes",
		});

		await ok("space.remove_thread", { spaceId: space.id, threadId: loose.thread.id });

		const after = await read<ThreadDetail>(`/threads/${loose.thread.id}`);

		expect(after.space).toBeNull();

		expect(after.messages.map((message) => message.body)).toEqual(["Research a competitor"]);
	});

	it("keeps a thread in one space, refuses a chat as a member and a thread from another scope", async () => {
		const venture = await createVenture(database);

		const other = await createVenture(database);

		const first = await createSpace(venture.id);

		const second = await createSpace(venture.id, "Second");

		const member = await startThread({ ventureId: venture.id, spaceId: first.space.id });

		expect(member.thread.spaceId).toBe(first.space.id);

		expect(await refused("space.add_thread", { spaceId: second.space.id, threadId: member.thread.id })).toMatchObject(
			{ status: 422, rule: "thread_in_other_space" },
		);

		expect(
			await refused("space.add_thread", { spaceId: second.space.id, threadId: first.space.chatThreadId }),
		).toMatchObject({ status: 422, rule: "chat_not_member" });

		const outside = await startThread({ ventureId: other.id });

		expect(await refused("space.add_thread", { spaceId: first.space.id, threadId: outside.thread.id })).toMatchObject(
			{
				status: 422,
				rule: "space_out_of_scope",
			},
		);

		expect(await refused("thread.start", { body: "Holding thread", spaceId: first.space.id })).toMatchObject({
			rule: "space_out_of_scope",
		});
	});

	it("archives a space and releases its members", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const member = await startThread({ ventureId: venture.id, spaceId: space.id });

		await ok("space.archive", { spaceId: space.id });

		const [row] = await database.db.select().from(threads).where(eq(threads.id, member.thread.id));

		expect(row?.spaceId).toBeNull();

		const chat = await read<ThreadDetail>(`/threads/${space.chatThreadId}`);

		expect(chat.thread.archivedAt).not.toBeNull();

		expect(await refused("space.add_thread", { spaceId: space.id, threadId: member.thread.id })).toMatchObject({
			rule: "space_archived",
		});
	});
});

describe("delegate", () => {
	it("is refused outside a space chat and in member threads, without an access request", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const loose = await startThread({ ventureId: venture.id });

		const outside = await agentCommand("thread.start", { ventureId: venture.id, body: "Go" }, loose.run.id);

		expect(outside).toMatchObject({ status: 403, code: "not_in_space_chat" });

		expect(outside.result.accessRequestId).toBeUndefined();

		const member = await startThread({ ventureId: venture.id, spaceId: space.id });

		const inMember = await agentCommand("thread.message", { threadId: member.thread.id, body: "Hi" }, member.run.id);

		expect(inMember).toMatchObject({ status: 403, code: "not_in_space_chat" });
	});

	it("lets the space's agent start member threads, at most eight per run", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const run = await chatRun(space);

		const call = toolsFor(run, { spaceId: space.id, ventureId: venture.id });

		for (let index = 0; index < 8; index += 1) {
			const started = await call("start_thread", {
				agentProfileId: index % 2 === 0 ? "gpt" : "claude",
				title: `Research ${index}`,
				message: `Research competitor ${index}`,
			});

			expect(started.isError, started.text).toBe(false);
		}

		const ninth = await call("start_thread", { agentProfileId: "gpt", title: "One more", message: "Again" });

		expect(ninth.isError).toBe(true);

		expect(ninth.text).toContain("thread_start_cap");

		const members = await database.db.select().from(threads).where(eq(threads.spaceId, space.id));

		expect(members).toHaveLength(8);

		expect(members.every((member) => member.startedByRunId === run.id)).toBe(true);

		expect(new Set(members.map((member) => member.agentProfileId))).toEqual(new Set(["gpt", "claude"]));

		const target = members[0];

		if (target === undefined) throw new Error("No member");

		await finish((await database.db.select().from(runs).where(eq(runs.threadId, target.id)))[0]?.id ?? "");

		const messaged = await call("message_thread", { threadId: target.id, message: "Look at their annual plan too" });

		expect(messaged.isError, messaged.text).toBe(false);

		const detail = await read<ThreadDetail>(`/threads/${target.id}`);

		expect(detail.messages.at(-1)).toMatchObject({ author: "agent:claude", body: "Look at their annual plan too" });
	});

	it("refuses to message a thread outside its own space", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const loose = await startThread({ ventureId: venture.id });

		await finish(loose.run.id);

		const run = await chatRun(space);

		const outcome = await agentCommand("thread.message", { threadId: loose.thread.id, body: "Hi" }, run.id);

		expect(outcome).toMatchObject({ status: 422, result: { rule: "not_a_member" } });
	});
});

describe("reports and waking", () => {
	it("writes one report line per member run and queues at most one wake", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const first = await startThread({ ventureId: venture.id, spaceId: space.id, title: "Research Acme" });

		const second = await startThread({ ventureId: venture.id, spaceId: space.id, title: "Research Beta" });

		await finish(first.run.id);

		await finish(second.run.id, "failed");

		const reports = (await chatMessages(space.chatThreadId)).filter((message) => message.meta?.kind === "report");

		expect(reports.map((message) => message.body)).toEqual([
			"“Research Acme” finished",
			"“Research Beta” failed: boom",
		]);

		expect(reports.map((message) => message.meta)).toEqual([
			{ kind: "report", threadId: first.thread.id, runId: first.run.id, outcome: "succeeded" },
			{ kind: "report", threadId: second.thread.id, runId: second.run.id, outcome: "failed" },
		]);

		const queued = await chatRuns(space.chatThreadId);

		expect(queued.map((run) => run.status)).toEqual(["queued"]);

		expect(queued[0]?.messageId).toBe(reports[0]?.id);

		expect(await wakes(space.id)).toBe(1);
	});

	it("coalesces reports that arrive while the space's agent runs into one wake after it", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const member = await startThread({ ventureId: venture.id, spaceId: space.id, title: "Research Acme" });

		const owner = await chatRun(space);

		await database.run(claimRun(owner.id));

		await database.db.execute(sql`
			INSERT INTO run_events (run_id, seq, type, payload)
			VALUES (${owner.id}, 0, 'run.started', ${JSON.stringify({ model: "m", seenSeq: 1 })}::jsonb)`);

		await finish(member.run.id);

		expect((await chatRuns(space.chatThreadId)).map((run) => run.status)).toEqual(["running"]);

		await database.run(finishRun(owner.id, { status: "succeeded", usage: null, error: null }));

		const after = await chatRuns(space.chatThreadId);

		expect(after.map((run) => run.status)).toEqual(["succeeded", "queued"]);

		expect(await wakes(space.id)).toBe(1);
	});

	it("stops waking after five wakes without the owner, until the owner writes", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const woken: boolean[] = [];

		for (let index = 0; index < 6; index += 1) {
			const member = await startThread({ ventureId: venture.id, spaceId: space.id, title: `Member ${index}` });

			await finish(member.run.id);

			const queued = (await chatRuns(space.chatThreadId)).filter((run) => run.status === "queued");

			woken.push(queued.length === 1);

			for (const wake of queued) await finish(wake.id);
		}

		expect(woken).toEqual([true, true, true, true, true, false]);

		expect(await wakes(space.id)).toBe(5);

		const summary = await read<SpaceDetail>(`/spaces/${space.id}`);

		expect(summary.space.pausedForOwner).toBe(true);

		await chatRun(space, "Carry on");

		expect(await wakes(space.id)).toBe(0);
	});
});

describe("needs input", () => {
	it("opens one pending question, which the owner's reply answers and resumes", async () => {
		const venture = await createVenture(database);

		const { space } = await createSpace(venture.id);

		const member = await startThread({ ventureId: venture.id, spaceId: space.id, title: "Research Acme" });

		await database.run(claimRun(member.run.id));

		const asked = await agentCommand("input.request", { question: "Which tier matters?" }, member.run.id);

		expect(asked.status).toBe(200);

		const again = await agentCommand("input.request", { question: "And another?" }, member.run.id);

		expect(again).toMatchObject({ status: 422, result: { rule: "input_pending" } });

		await database.run(finishRun(member.run.id, { status: "succeeded", usage: null, error: null }));

		const inbox = await read<Inbox>("/inbox");

		expect(
			inbox.pending.filter((item) => item.kind === "needs_input" && item.thread.id === member.thread.id),
		).toEqual([
			expect.objectContaining({ question: "Which tier matters?", space: { id: space.id, title: "Pricing page" } }),
		]);

		const report = (await chatMessages(space.chatThreadId)).at(-1);

		expect(report).toMatchObject({
			body: "“Research Acme” needs you: Which tier matters?",
			meta: { kind: "report", outcome: "needs_input" },
		});

		const detail = await read<SpaceDetail>(`/spaces/${space.id}`);

		expect(detail.members[0]).toMatchObject({ state: "needs_you", question: "Which tier matters?" });

		const wakesBefore = await chatRuns(space.chatThreadId);

		const answered = await ok<{ run: Run; answered: { status: string } }>("thread.post", {
			threadId: member.thread.id,
			body: "The pro tier",
		});

		expect(answered.answered.status).toBe("answered");

		expect(answered.run).toMatchObject({ threadId: member.thread.id, status: "queued" });

		expect(await chatRuns(space.chatThreadId)).toHaveLength(wakesBefore.length);

		const later = await read<Inbox>("/inbox");

		expect(later.pending.some((item) => item.kind === "needs_input" && item.thread.id === member.thread.id)).toBe(
			false,
		);
	});
});

describe("limits and the pause gate", () => {
	it("opens a pause on a rejected reading and lifts it at the reset", async () => {
		const scheduled: { id: string; until: Date }[] = [];

		const services = {
			...database.services,
			scheduleLift: async (pause: { id: string; until: Date }) => {
				scheduled.push(pause);

				await database.services.scheduleLift(pause);
			},
		};

		const resetsAt = new Date(Date.now() - 1_000);

		const result = await recordLimit(database.db, services, {
			runtime: "pi",
			runId: null,
			reading: { window: "primary", status: "rejected", utilization: 1, resetsAt },
		});

		expect(result.paused).toBe(true);

		const pause = await openPauseOf(database.db, "pi");

		expect(pause).toMatchObject({ reason: "limit", until: resetsAt });

		expect(scheduled).toEqual([{ id: pause?.id, until: resetsAt }]);

		const capacity = await read<Capacity>("/capacity");

		expect(capacity.runtimes.find((runtime) => runtime.runtime === "pi")?.pause).toMatchObject({ reason: "limit" });

		expect(await liftPause(database.db, database.services, pause?.id ?? "")).not.toBeNull();

		expect(await openPauseOf(database.db, "pi")).toBeUndefined();
	});

	it("does not lift a pause before its reset", async () => {
		const pauseId = uuidv7();

		await database.db
			.insert(runtimePauses)
			.values({ id: pauseId, runtime: "pi", reason: "limit", until: new Date(Date.now() + 3_600_000) });

		expect(await liftPause(database.db, database.services, pauseId)).toBeNull();

		await ok("runtime.resume", { runtime: "pi" });

		expect(await openPauseOf(database.db, "pi")).toBeUndefined();
	});

	it("pauses at 90% use and records a reading below it without pausing", async () => {
		const below = await recordLimit(database.db, database.services, {
			runtime: "claude-agent-sdk",
			runId: null,
			reading: { window: "seven_day", status: "allowed", utilization: 0.5, resetsAt: null },
		});

		expect(below.paused).toBe(false);

		const above = await recordLimit(database.db, database.services, {
			runtime: "claude-agent-sdk",
			runId: null,
			reading: {
				window: "five_hour",
				status: "allowed",
				utilization: 0.95,
				resetsAt: new Date(Date.now() + 60_000),
			},
		});

		expect(above.paused).toBe(true);

		await ok("runtime.resume", { runtime: "claude-agent-sdk" });

		await ok("runtime.pause", { runtime: "claude-agent-sdk" });

		expect(await openPauseOf(database.db, "claude-agent-sdk")).toMatchObject({ reason: "owner", until: null });

		expect(await refused("runtime.pause", { runtime: "claude-agent-sdk" })).toMatchObject({ rule: "no_changes" });

		await ok("runtime.resume", { runtime: "claude-agent-sdk" });
	});
});

describe("instrumentation", () => {
	it("returns queue wait, time to first token and duration percentiles per runtime and day", async () => {
		const runtime = `test-${uuidv7()}`;

		const venture = await createVenture(database);

		const thread = await startThread({ ventureId: venture.id });

		await finish(thread.run.id);

		const base = new Date("2026-11-20T10:00:00Z").getTime();

		for (const [index, wait] of [1_000, 2_000, 3_000, 4_000, 10_000].entries()) {
			const createdAt = new Date(base + index * 60_000);
			const startedAt = new Date(createdAt.getTime() + wait);

			await database.db.insert(runs).values({
				id: uuidv7(),
				threadId: thread.thread.id,
				messageId: thread.message.id,
				runtime,
				model: "m",
				actor: "agent:claude",
				status: index === 4 ? "failed" : "succeeded",
				usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.5 },
				createdAt,
				startedAt,
				firstTokenAt: new Date(startedAt.getTime() + wait / 2),
				finishedAt: new Date(startedAt.getTime() + wait * 2),
			});
		}

		const days = (await runtimeDays(database.db, 3_650)).filter((row) => row.runtime === runtime);

		expect(days).toEqual([
			{
				runtime,
				day: {
					day: "2026-11-20",
					runs: 5,
					failed: 1,
					interrupted: 0,
					queueWaitP50Ms: 3_000,
					queueWaitP95Ms: 8_800,
					firstTokenP50Ms: 1_500,
					firstTokenP95Ms: 4_400,
					durationP50Ms: 6_000,
					durationP95Ms: 17_600,
					inputTokens: 500,
					outputTokens: 50,
					costUsd: 2.5,
				},
			},
		]);

		await database.db.delete(runs).where(eq(runs.runtime, runtime));
	});
});
