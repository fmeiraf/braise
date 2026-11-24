import type { ActiveRun, LinkTarget, Run, ThreadDetail, ThreadSummary, WorkItem } from "@braise/core";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { braiseTools, maxQueryRows, readOnly } from "../src/agent/tools.ts";
import { claimRun, recoverRuns } from "../src/agent/worker.ts";
import { deltaChannel } from "../src/channels.ts";
import { commands, events, workItems } from "../src/db/schema.ts";
import { createVenture, freshKey, openTestDatabase, testUrl } from "./database.test-utils.ts";

const database = await openTestDatabase();

beforeAll(() => database.hub.start());

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

interface Started {
	thread: { id: string; ventureId: string | null };
	message: { id: string };
	run: Run;
}

async function ventureWithWork() {
	const venture = await createVenture(database);

	const goal = await ok<{ id: string }>("goal.create", {
		ventureId: venture.id,
		betId: null,
		outcome: "Bread sells out",
		signal: "Loaves left at close",
		horizon: null,
	});

	const item = await ok<WorkItem>("work.create", {
		ventureId: venture.id,
		goalId: goal.id,
		title: "Bake sourdough",
		function: "ops",
	});

	return { venture, goal, item };
}

async function jobFor(runId: string) {
	const result = await database.db.execute<{ count: number }>(
		sql`SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'agent-run' AND data->>'runId' = ${runId}`,
	);

	return result.rows[0]?.count ?? 0;
}

function finishQueuedRun(runId: string) {
	return ok("run.cancel", { runId });
}

describe("threads", () => {
	it("starts a thread with its first message, links and a queued run with a job", async () => {
		const { venture, item } = await ventureWithWork();

		const started = await ok<Started>("thread.start", {
			ventureId: venture.id,
			body: "Split the sourdough task\nDetails follow",
			links: [{ type: "work_item", id: item.id }],
		});

		expect(started.thread.ventureId).toBe(venture.id);

		expect(started.run).toMatchObject({ status: "queued", actor: "agent:claude", runtime: "claude-agent-sdk" });

		expect(await jobFor(started.run.id)).toBe(1);

		const detail = await read<ThreadDetail>(`/threads/${started.thread.id}`);

		expect(detail.thread.title).toBe("Split the sourdough task");

		expect(detail.links).toEqual([
			expect.objectContaining({
				type: "work_item",
				id: item.id,
				label: "Bake sourdough",
				ventureSlug: venture.slug,
			}),
		]);

		expect(detail.messages.map((message) => [message.seq, message.author])).toEqual([[1, "owner"]]);

		expect(detail.runs.map((run) => run.status)).toEqual(["queued"]);
	});

	it("refuses a new message while a run is active, and accepts it after", async () => {
		const started = await ok<Started>("thread.start", { body: "First question" });

		expect(await refused("thread.post", { threadId: started.thread.id, body: "Another" })).toEqual({
			status: 422,
			code: "rule_violated",
			rule: "run_active",
		});

		await finishQueuedRun(started.run.id);

		const posted = await ok<{ message: { seq: number }; run: Run }>("thread.post", {
			threadId: started.thread.id,
			body: "Another",
		});

		expect(posted.message.seq).toBe(2);

		expect(posted.run.status).toBe("queued");
	});

	it("keeps venture threads to their venture's items; Holding threads link anything", async () => {
		const first = await ventureWithWork();

		const second = await ventureWithWork();

		const ventureThread = await ok<Started>("thread.start", { ventureId: first.venture.id, body: "Venture thread" });

		const holdingThread = await ok<Started>("thread.start", { body: "Holding thread" });

		const foreign = { type: "work_item", id: second.item.id };

		expect(await refused("thread.link", { threadId: ventureThread.thread.id, link: foreign })).toMatchObject({
			status: 422,
			rule: "link_out_of_scope",
		});

		await ok("thread.link", { threadId: holdingThread.thread.id, link: foreign });

		await ok("thread.link", { threadId: holdingThread.thread.id, link: { type: "goal", id: first.goal.id } });

		expect(await refused("thread.link", { threadId: holdingThread.thread.id, link: foreign })).toMatchObject({
			rule: "no_changes",
		});

		expect(
			await refused("thread.link", {
				threadId: holdingThread.thread.id,
				link: { type: "bet", id: crypto.randomUUID() },
			}),
		).toMatchObject({ rule: "link_not_found" });

		await ok("thread.unlink", { threadId: holdingThread.thread.id, link: foreign });

		const detail = await read<ThreadDetail>(`/threads/${holdingThread.thread.id}`);

		expect(detail.links.map((link) => link.type)).toEqual(["goal"]);
	});

	it("renames and archives a thread, refusing archive while a run is active", async () => {
		const started = await ok<Started>("thread.start", { body: "To be archived" });

		await ok("thread.rename", { threadId: started.thread.id, title: "Renamed" });

		expect(await refused("thread.archive", { threadId: started.thread.id })).toMatchObject({ rule: "run_active" });

		await finishQueuedRun(started.run.id);

		await ok("thread.archive", { threadId: started.thread.id });

		expect(await refused("thread.post", { threadId: started.thread.id, body: "Hello?" })).toMatchObject({
			rule: "thread_archived",
		});

		const { threads } = await read<{ threads: ThreadSummary[] }>("/threads");

		expect(threads.some((thread) => thread.id === started.thread.id)).toBe(false);
	});
});

describe("runs", () => {
	it("cancels a queued run once", async () => {
		const started = await ok<Started>("thread.start", { body: "Cancel me" });

		const cancelled = await ok<{ run: Run }>("run.cancel", { runId: started.run.id });

		expect(cancelled.run.status).toBe("cancelled");

		expect(await refused("run.cancel", { runId: started.run.id })).toMatchObject({ rule: "run_not_active" });
	});

	it("marks running runs interrupted on recovery, and retries only the latest failed run", async () => {
		const started = await ok<Started>("thread.start", { body: "Interrupted work" });

		const claimed = await claimRun(database.db, started.run.id);

		expect(claimed?.status).toBe("running");

		expect(await claimRun(database.db, started.run.id)).toBeUndefined();

		await recoverRuns(database.db, database.services);

		const detail = await read<ThreadDetail>(`/threads/${started.thread.id}`);

		expect(detail.runs[0]).toMatchObject({
			status: "interrupted",
			error: { message: "braise stopped while the agent was working" },
		});

		expect(detail.runs[0]?.events.map((event) => event.type)).toEqual(["run.finished"]);

		const retried = await ok<{ run: Run }>("run.retry", { runId: started.run.id });

		expect(retried.run).toMatchObject({ status: "queued", retryOf: started.run.id, messageId: started.message.id });

		expect(await jobFor(retried.run.id)).toBe(1);

		await finishQueuedRun(retried.run.id);

		expect(await refused("run.retry", { runId: started.run.id })).toMatchObject({ rule: "run_not_latest" });

		expect(await refused("run.retry", { runId: retried.run.id })).toMatchObject({ rule: "run_not_retryable" });
	});

	it("records a cancel request on a running run and refuses it once finished", async () => {
		const started = await ok<Started>("thread.start", { body: "Running cancel" });

		await claimRun(database.db, started.run.id);

		const requested = await ok<{ run: Run }>("run.cancel", { runId: started.run.id });

		expect(requested.run.status).toBe("running");

		expect(requested.run.cancelRequestedAt).not.toBeNull();

		await recoverRuns(database.db, database.services);

		expect(await refused("run.cancel", { runId: started.run.id })).toMatchObject({ rule: "run_not_active" });
	});

	it("lists active runs across braise", async () => {
		const started = await ok<Started>("thread.start", { body: "Active run" });

		const { runs } = await read<{ runs: ActiveRun[] }>("/runs/active");

		expect(runs).toContainEqual(
			expect.objectContaining({ id: started.run.id, threadTitle: "Active run", status: "queued" }),
		);

		await finishQueuedRun(started.run.id);
	});
});

describe("agent tools", () => {
	async function toolsFor() {
		const work = await ventureWithWork();

		const started = await ok<Started>("thread.start", { ventureId: work.venture.id, body: "Tool test" });

		const tools = braiseTools({
			db: database.db,
			reader: database.reader,
			services: database.services,
			actor: "agent:claude",
			runId: started.run.id,
			threadId: started.thread.id,
		});

		const call = (name: string, args: unknown) => {
			const found = tools.find((tool) => tool.name === name);

			if (found === undefined) throw new Error(`No tool ${name}`);

			return found.execute(args);
		};

		return { ...work, started, call };
	}

	it("reads with SELECT only, as the reader role, capped and without the commands table", async () => {
		const { call } = await toolsFor();

		const series = await call("query", { sql: "SELECT generate_series(1, 250) AS n;" });

		expect(series.isError).toBe(false);

		expect(JSON.parse(series.text)).toMatchObject({ rowCount: maxQueryRows, truncated: true });

		expect(await call("query", { sql: "DELETE FROM ventures" })).toMatchObject({ isError: true });

		expect(await call("query", { sql: "SELECT 1; DELETE FROM ventures" })).toMatchObject({ isError: true });

		expect(await call("query", { sql: "SELECT * FROM commands" })).toMatchObject({
			isError: true,
			text: expect.stringContaining("permission denied"),
		});

		const appUser = new URL(testUrl()).username;

		expect(await call("query", { sql: `SELECT set_config('role', '${appUser}', true) AS escaped` })).toMatchObject({
			isError: true,
			text: expect.stringContaining("permission denied"),
		});

		const schema = await call("describe_schema", {});

		expect(schema.text).toContain("work_items(id uuid");

		expect(schema.text).not.toContain("commands(");
	});

	it("runs reads read-only with a statement timeout", async () => {
		const settings = await readOnly(database.reader, async (client) => {
			const timeout = await client.query<{ statement_timeout: string }>("SHOW statement_timeout");

			const readOnlyMode = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");

			const role = await client.query<{ current_user: string }>("SELECT current_user");

			return [
				timeout.rows[0]?.statement_timeout,
				readOnlyMode.rows[0]?.transaction_read_only,
				role.rows[0]?.current_user,
			];
		});

		expect(settings).toEqual(["5s", "on", "braise_agent_reader"]);
	});

	it("writes work items as the agent, recording the run, and applies repeated calls", async () => {
		const { call, item, venture, started } = await toolsFor();

		const args = { parentId: item.id, title: "Shape the loaves" };

		const first = await call("create_work_item", args);

		const again = await call("create_work_item", args);

		expect(first.isError).toBe(false);

		expect(JSON.parse(again.text).id).not.toBe(JSON.parse(first.text).id);

		const children = await database.db
			.select({ id: workItems.id })
			.from(workItems)
			.where(and(eq(workItems.parentId, item.id), eq(workItems.title, "Shape the loaves")));

		expect(children).toHaveLength(2);

		await call("set_work_item_status", { workItemId: item.id, status: "doing" });

		await call("set_work_item_status", { workItemId: item.id, status: "todo" });

		const repeated = await call("set_work_item_status", { workItemId: item.id, status: "doing" });

		expect(JSON.parse(repeated.text)).toMatchObject({ status: "doing" });

		const agentEvents = await database.db
			.select({ type: events.type, actor: events.actor, runId: events.runId })
			.from(events)
			.where(and(eq(events.ventureId, venture.id), eq(events.runId, started.run.id)));

		expect(agentEvents.map((event) => event.type)).toEqual([
			"work.created",
			"work.created",
			"work.status_set",
			"work.status_set",
			"work.status_set",
		]);

		expect(agentEvents.every((event) => event.actor === "agent:claude" && event.runId === started.run.id)).toBe(true);

		const recorded = await database.db
			.select({ runId: commands.runId })
			.from(commands)
			.where(eq(commands.runId, started.run.id));

		expect(recorded).toHaveLength(5);
	});

	it("links its own thread and reports API errors as tool errors", async () => {
		const { call, goal, started } = await toolsFor();

		expect(await call("link_thread", { type: "goal", id: goal.id })).toMatchObject({ isError: false });

		const missing = await call("update_work_item", { workItemId: crypto.randomUUID(), title: "Nope" });

		expect(missing.isError).toBe(true);

		expect(JSON.parse(missing.text)).toMatchObject({ code: "not_found" });

		const detail = await read<ThreadDetail>(`/threads/${started.thread.id}`);

		expect(detail.links.map((link) => link.id)).toEqual([goal.id]);
	});

	it("refuses commands outside the agent allowlist with not_granted", async () => {
		const { venture } = await ventureWithWork();

		await expect(
			database.command(
				"goal.create",
				{
					payload: { ventureId: venture.id, betId: null, outcome: "Agent goal", signal: "x", horizon: null },
					idempotencyKey: freshKey("agent-goal"),
				},
				"agent:claude",
			),
		).rejects.toMatchObject({ code: "not_granted", status: 403 });
	});
});

describe("thread reads", () => {
	it("lists threads by scope and by linked subject, with the last message and active run", async () => {
		const first = await ventureWithWork();

		const second = await ventureWithWork();

		const linked = await ok<Started>("thread.start", {
			ventureId: first.venture.id,
			body: "About sourdough",
			links: [{ type: "work_item", id: first.item.id }],
		});

		const other = await ok<Started>("thread.start", { ventureId: second.venture.id, body: "Elsewhere" });

		const scoped = await read<{ threads: ThreadSummary[] }>(`/threads?ventureId=${first.venture.id}`);

		expect(scoped.threads.map((thread) => thread.id)).toEqual([linked.thread.id]);

		expect(scoped.threads[0]).toMatchObject({
			lastMessage: { author: "owner", body: "About sourdough" },
			activeRun: { id: linked.run.id, status: "queued" },
		});

		const bySubject = await read<{ threads: ThreadSummary[] }>(`/threads?subject=work_item:${first.item.id}`);

		expect(bySubject.threads.map((thread) => thread.id)).toEqual([linked.thread.id]);

		const holding = await read<{ threads: ThreadSummary[] }>("/threads");

		expect(holding.threads.map((thread) => thread.id)).toEqual(
			expect.arrayContaining([linked.thread.id, other.thread.id]),
		);
	});

	it("suggests link targets with work items first, scoped to a venture", async () => {
		const { venture, item, goal } = await ventureWithWork();

		const { targets } = await read<{ targets: LinkTarget[] }>(`/link-targets?q=&ventureId=${venture.id}`);

		expect(targets.map((target) => [target.type, target.id])).toEqual([
			["work_item", item.id],
			["goal", goal.id],
			["venture", venture.id],
		]);

		const searched = await read<{ targets: LinkTarget[] }>(`/link-targets?q=sourd&ventureId=${venture.id}`);

		expect(searched.targets).toEqual([
			expect.objectContaining({ type: "work_item", label: "Bake sourdough", detail: "Initiative" }),
		]);

		const escaped = await read<{ targets: LinkTarget[] }>(
			`/link-targets?q=${encodeURIComponent("%")}&ventureId=${venture.id}`,
		);

		expect(escaped.targets).toEqual([]);
	});
});

describe("thread stream", () => {
	async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, name: string) {
		const decoder = new TextDecoder();
		let buffered = "";

		for (;;) {
			const chunk = await reader.read();

			if (chunk.done) throw new Error(`Stream ended before ${name}`);

			buffered += decoder.decode(chunk.value, { stream: true });

			const match = new RegExp(`event: ${name}\\ndata: (.*)\\n`, "u").exec(buffered);

			if (match?.[1] !== undefined) return JSON.parse(match[1]) as Record<string, unknown>;
		}
	}

	it("sends a hint after a thread change and forwards live deltas for that thread only", async () => {
		const started = await ok<Started>("thread.start", { body: "Stream me" });

		const response = await database.app.request(`/api/threads/${started.thread.id}/stream`);

		const reader = response.body?.getReader();

		if (reader === undefined) throw new Error("No stream body");

		await nextEvent(reader, "ready");

		await ok("thread.rename", { threadId: started.thread.id, title: "Streamed" });

		expect(await nextEvent(reader, "hint")).toEqual({ threadId: started.thread.id, ventureId: null });

		const delta = { threadId: started.thread.id, runId: started.run.id, block: 0, offset: 0, text: "Hel" };

		await database.db.execute(
			sql`SELECT pg_notify(${deltaChannel}, ${JSON.stringify({ ...delta, threadId: crypto.randomUUID() })})`,
		);

		await database.db.execute(sql`SELECT pg_notify(${deltaChannel}, ${JSON.stringify(delta)})`);

		expect(await nextEvent(reader, "delta")).toEqual(delta);

		await reader.cancel();

		await finishQueuedRun(started.run.id);
	});
});
