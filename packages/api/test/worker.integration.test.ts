import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import type { Run, ThreadDetail } from "@braise/core";
import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { functionCallStream, replyStream, toolCallStream, usageHeaders } from "../src/agent/pi.fixture.ts";
import { createPiRuntime, piProvider } from "../src/agent/pi.ts";
import { fileCredentialStore } from "../src/agent/pi-credentials.ts";
import { agentWorkerLayer } from "../src/agent/worker.ts";
import { runs, workItems } from "../src/db/schema.ts";
import {
	createBuildObjective,
	createIsolatedDatabase,
	createVenture,
	freshKey,
	openTestDatabase,
} from "./database.test-utils.ts";

const codexUrl = "https://chatgpt.com/backend-api/codex/responses";

const database = await openTestDatabase(await createIsolatedDatabase("braise_worker_test"));

const dir = await mkdtemp(join(tmpdir(), "braise-worker-"));

const authFile = join(dir, "auth.json");

type Responder = (body: string) => Response | Promise<Response>;

function sse(stream: string) {
	return new HttpResponse(stream, { headers: { ...usageHeaders, "content-type": "text/event-stream" } });
}

const reply: Responder = () => sse(replyStream);

let respond: Responder = reply;

function stallAfterToolCall() {
	const stalled = Promise.withResolvers<void>();
	let requests = 0;

	respond = () => {
		requests += 1;

		if (requests === 1) return sse(toolCallStream);

		stalled.resolve();

		return new Promise<never>(() => undefined);
	};

	return stalled.promise;
}

function threadIdOf(body: string) {
	return /Thread id: ([0-9a-f-]{36})/u.exec(body)?.[1] ?? "";
}

function holdReplies() {
	const held: { threadId: string; release: () => void }[] = [];
	const waiters: { count: number; resolve: () => void }[] = [];

	respond = (body) => {
		const release = Promise.withResolvers<Response>();

		held.push({ threadId: threadIdOf(body), release: () => release.resolve(sse(replyStream)) });

		for (const waiter of waiters.filter((entry) => entry.count <= held.length)) waiter.resolve();

		return release.promise;
	};

	return {
		held,
		reached(count: number) {
			const reached = Promise.withResolvers<void>();

			if (held.length >= count) reached.resolve();
			else waiters.push({ count, resolve: reached.resolve });

			return reached.promise;
		},
	};
}

const codex = setupServer(
	http.post(codexUrl, async ({ request }) => {
		const raw = Buffer.from(await request.arrayBuffer());

		const body = request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(raw) : raw;

		return respond(body.toString("utf8"));
	}),
);

const worker = ManagedRuntime.make(
	agentWorkerLayer([createPiRuntime(fileCredentialStore(authFile))]).pipe(
		Layer.provide(Layer.succeedContext(await database.runtime.context())),
	),
);

function base64Url(value: unknown) {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

beforeAll(async () => {
	codex.listen({ onUnhandledFrame: "error" });

	const access = [
		base64Url({ alg: "none" }),
		base64Url({ "https://api.openai.com/auth": { chatgpt_account_id: "a" } }),
		"s",
	];

	await writeFile(
		authFile,
		JSON.stringify({
			[piProvider]: { type: "oauth", access: access.join("."), refresh: "r", expires: Date.now() + 3_600_000 },
		}),
	);

	await worker.runPromise(Effect.void);
});

beforeEach(() => {
	respond = reply;
});

afterAll(async () => {
	codex.close();

	await database.close();

	await rm(dir, { recursive: true, force: true });
});

interface Started {
	thread: { id: string };
	run: Run;
}

async function ok<Result>(name: string, payload: Record<string, unknown>) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name) });

	const body = (await response.json()) as { result: Result };

	expect(response.status, JSON.stringify(body)).toBe(200);

	return body.result;
}

function startThread(body: string, agentProfileId?: string, extra: Record<string, unknown> = {}) {
	return ok<Started>("thread.start", {
		...(agentProfileId === undefined ? { body } : { body, agentProfileId }),
		...extra,
	});
}

async function activeRunsOf(threadId: string) {
	const rows = await database.db
		.select({ id: runs.id, status: runs.status })
		.from(runs)
		.where(eq(runs.threadId, threadId));

	return rows.filter((row) => row.status === "queued" || row.status === "running").map((row) => row.id);
}

async function statusesOf(runIds: string[]) {
	const rows = await database.db.select({ id: runs.id, status: runs.status }).from(runs);

	return runIds.map((id) => rows.find((row) => row.id === id)?.status);
}

function heldByGate(runId: () => string) {
	return new Promise<void>((resolve) => {
		const unsubscribe = database.subscribe((message) => {
			if (message.type !== "capacity" || message.heldRunId !== runId()) return;

			unsubscribe();

			resolve();
		});
	});
}

async function runStatus(runId: string) {
	const [row] = await database.db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));

	return row?.status;
}

function settledStatus(runId: string, statuses: string[]) {
	return new Promise<string>((resolve) => {
		const check = () => {
			runStatus(runId).then((status) => {
				if (status === undefined || !statuses.includes(status)) return;

				unsubscribe();

				resolve(status);
			}, console.error);
		};

		const unsubscribe = database.subscribe((message) => {
			if (message.type === "thread") check();
		});

		check();
	});
}

function streamedText(runId: string, until: string) {
	return new Promise<string>((resolve) => {
		let text = "";

		const unsubscribe = database.subscribe((message) => {
			if (message.type !== "delta" || message.runId !== runId) return;

			text += message.text;

			if (!text.endsWith(until)) return;

			unsubscribe();

			resolve(text);
		});
	});
}

async function detailOf(threadId: string) {
	const response = await database.app.request(`/api/threads/${threadId}`);

	return (await response.json()) as ThreadDetail;
}

describe("the agent worker", () => {
	it("runs a GPT thread to its reply and streams the text live", async () => {
		const started = await startThread("Say hello", "gpt");

		const streamed = streamedText(started.run.id, "Echoed hello.");

		expect(await settledStatus(started.run.id, ["succeeded", "failed"])).toBe("succeeded");

		expect(await streamed).toBe("Echoed hello.");

		const detail = await detailOf(started.thread.id);

		expect(detail.runs[0]?.events.map((event) => event.type)).toEqual(["run.started", "message", "run.finished"]);

		expect(detail.messages.at(-1)).toMatchObject({ author: "agent:gpt", body: "Echoed hello." });
	});

	it("fails a run whose runtime braise doesn't have", async () => {
		const started = await startThread("Nobody runs me");

		expect(await settledStatus(started.run.id, ["failed", "succeeded"])).toBe("failed");

		const detail = await detailOf(started.thread.id);

		expect(detail.runs[0]?.error).toEqual({ message: "braise has no runtime claude-agent-sdk" });
	});

	it("cancels a running run after its tool call", async () => {
		const stall = stallAfterToolCall();

		const started = await startThread("Start, then stop", "gpt");

		await stall;

		const cancelled = await database.post("run.cancel", {
			payload: { runId: started.run.id },
			idempotencyKey: freshKey("cancel"),
		});

		expect(cancelled.status).toBe(200);

		expect(await settledStatus(started.run.id, ["cancelled", "failed", "succeeded"])).toBe("cancelled");

		const detail = await detailOf(started.thread.id);

		expect(detail.runs[0]?.events.map((event) => event.type)).toEqual([
			"run.started",
			"tool.call",
			"tool.result",
			"run.finished",
		]);

		expect(detail.runs[0]?.events[1]).toMatchObject({ payload: { name: "echo", input: { text: "hello" } } });
	});

	it("runs more than two at once and never more than the runtime's limit, claiming chat runs first", async () => {
		const replies = holdReplies();

		const started = await Promise.all([0, 1, 2, 3, 4].map((index) => startThread(`Busy ${index}`, "gpt")));

		await replies.reached(4);

		const statuses = await statusesOf(started.map((entry) => entry.run.id));

		expect(statuses.filter((status) => status === "running")).toHaveLength(4);

		expect(statuses.filter((status) => status === "queued")).toHaveLength(1);

		const created = await ok<{ space: { id: string; chatThreadId: string } }>("space.create", {
			title: "Busy space",
			agentProfileId: "gpt",
		});

		const member = await startThread("A member", "gpt", { spaceId: created.space.id });

		const chat = await ok<{ run: Run }>("thread.post", { threadId: created.space.chatThreadId, body: "Plan it" });

		replies.held[0]?.release();

		await replies.reached(5);

		expect(replies.held[4]?.threadId).toBe(created.space.chatThreadId);

		expect(await statusesOf([chat.run.id, member.run.id])).toEqual(["running", "queued"]);

		const settled = settledStatus(member.run.id, ["succeeded", "failed"]);

		respond = reply;

		for (const entry of replies.held) entry.release();

		expect(await settled).toBe("succeeded");

		for (const entry of started) expect(await settledStatus(entry.run.id, ["succeeded", "failed"])).toBe("succeeded");

		for (let active = await activeRunsOf(created.space.chatThreadId); active.length > 0; ) {
			for (const id of active) await settledStatus(id, ["succeeded", "failed", "interrupted", "cancelled"]);

			active = await activeRunsOf(created.space.chatThreadId);
		}
	});

	it("keeps a paused runtime's runs queued while the other runtime's are claimed", async () => {
		await ok("runtime.pause", { runtime: "pi" });

		let pausedRunId = "";

		const held = heldByGate(() => pausedRunId);

		const paused = await startThread("Wait for the reset", "gpt");

		pausedRunId = paused.run.id;

		await held;

		const other = await startThread("Claude still runs");

		expect(await settledStatus(other.run.id, ["failed", "succeeded"])).toBe("failed");

		expect(await statusesOf([paused.run.id])).toEqual(["queued"]);

		const resumed = settledStatus(paused.run.id, ["succeeded", "failed"]);

		await ok("runtime.resume", { runtime: "pi" });

		expect(await resumed).toBe("succeeded");
	});

	it("retries an interrupted run without repeating its creates, listing every earlier attempt's calls", async () => {
		const venture = await createVenture(database);

		const objective = await createBuildObjective(database, venture.id);

		const parent = await ok<{ id: string }>("work.create", {
			ventureId: venture.id,
			home: { type: "objective", id: objective.id },
			title: "Pricing page",
			function: "product",
		});

		await database.command("grant.add", {
			payload: { profileId: "gpt", capability: "work" },
			idempotencyKey: freshKey("grant"),
		});

		const first = { parentId: parent.id, title: "Draft the copy" };
		const second = { parentId: parent.id, title: "Pick the screenshots" };
		const prompts: string[] = [];

		const limited = () =>
			new HttpResponse(
				JSON.stringify({
					error: { code: "usage_limit_reached", resets_at: Math.floor(Date.now() / 1000) + 3_600 },
				}),
				{ status: 429, headers: { ...usageHeaders, "content-type": "application/json" } },
			);

		const script = (create: Record<string, unknown> | null) => {
			let requests = 0;

			respond = (body) => {
				requests += 1;

				if (requests === 1) {
					prompts.push(body);

					return create === null ? sse(replyStream) : sse(functionCallStream("create_work_item", create));
				}

				return create === null || prompts.length === 3 ? sse(replyStream) : limited();
			};
		};

		script(first);

		const started = await startThread("Write the pricing page", "gpt", { ventureId: venture.id });

		expect(await settledStatus(started.run.id, ["interrupted", "failed", "succeeded"])).toBe("interrupted");

		const [interrupted] = await database.db.select().from(runs).where(eq(runs.id, started.run.id));

		expect(interrupted?.error).toMatchObject({ code: "limit" });

		await ok("runtime.resume", { runtime: "pi" });

		script(second);

		const retried = await ok<{ run: Run }>("run.retry", { runId: started.run.id });

		expect(await settledStatus(retried.run.id, ["interrupted", "failed", "succeeded"])).toBe("interrupted");

		await ok("runtime.resume", { runtime: "pi" });

		script(first);

		const third = await ok<{ run: Run }>("run.retry", { runId: retried.run.id });

		expect(await settledStatus(third.run.id, ["interrupted", "failed", "succeeded"])).toBe("succeeded");

		expect(prompts[1]).toContain("your previous attempt already did");

		expect(prompts[1]).toContain("Draft the copy");

		expect(prompts[2]).toContain("Draft the copy");

		expect(prompts[2]).toContain("Pick the screenshots");

		const children = await database.db
			.select({ title: workItems.title })
			.from(workItems)
			.where(eq(workItems.parentId, parent.id));

		expect(children.map((child) => child.title).toSorted()).toEqual(["Draft the copy", "Pick the screenshots"]);

		const detail = await detailOf(started.thread.id);

		const results = detail.runs
			.flatMap((run) => run.events)
			.filter((event) => event.type === "tool.result")
			.map((event) => JSON.parse(event.payload.output) as { id: string; title: string });

		expect(results.map((result) => result.title)).toEqual([
			"Draft the copy",
			"Pick the screenshots",
			"Draft the copy",
		]);

		expect(results[2]?.id).toBe(results[0]?.id);
	});

	it("ends a run that asks the owner, and the owner's answer starts the next one", async () => {
		let requests = 0;

		respond = () => {
			requests += 1;

			return requests === 1
				? sse(functionCallStream("ask_owner", { question: "Which tier should lead?" }))
				: sse(replyStream);
		};

		const started = await startThread("Draft the pricing copy", "gpt");

		expect(await settledStatus(started.run.id, ["succeeded", "failed", "interrupted"])).toBe("succeeded");

		expect(requests).toBe(1);

		const asked = await detailOf(started.thread.id);

		expect(asked.inputRequest).toMatchObject({ question: "Which tier should lead?", status: "pending" });

		expect(asked.messages.at(-1)).toMatchObject({ author: "agent:gpt", meta: { kind: "question" } });

		expect(asked.runs[0]?.events.map((event) => event.type)).toEqual([
			"run.started",
			"tool.call",
			"tool.result",
			"run.finished",
		]);

		const answered = await ok<{ run: Run }>("thread.post", { threadId: started.thread.id, body: "The pro tier" });

		expect(await settledStatus(answered.run.id, ["succeeded", "failed"])).toBe("succeeded");

		expect((await detailOf(started.thread.id)).inputRequest).toBeNull();
	});

	it("marks a running run interrupted when braise stops", async () => {
		const stall = stallAfterToolCall();

		const started = await startThread("Still working at shutdown", "gpt");

		await stall;

		await worker.dispose();

		expect(await runStatus(started.run.id)).toBe("interrupted");

		const detail = await detailOf(started.thread.id);

		expect(detail.runs[0]).toMatchObject({ error: { message: "braise stopped while the agent was working" } });

		expect(detail.runs[0]?.events.at(-1)).toMatchObject({ type: "run.finished", payload: { status: "interrupted" } });
	});
});
