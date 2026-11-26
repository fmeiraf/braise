import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run, ThreadDetail } from "@braise/core";
import { eq } from "drizzle-orm";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replyStream, toolCallStream } from "../src/agent/pi.fixture.ts";
import { createPiRuntime, piProvider } from "../src/agent/pi.ts";
import { fileCredentialStore } from "../src/agent/pi-credentials.ts";
import { agentWorkerLayer } from "../src/agent/worker.ts";
import { runs } from "../src/db/schema.ts";
import { createIsolatedDatabase, freshKey, openTestDatabase } from "./database.test-utils.ts";

const codexUrl = "https://chatgpt.com/backend-api/codex/responses";

const database = await openTestDatabase(await createIsolatedDatabase("braise_worker_test"));

const dir = await mkdtemp(join(tmpdir(), "braise-worker-"));

const authFile = join(dir, "auth.json");

let answer: "reply" | "stall" = "reply";

let stalled = Promise.withResolvers<void>();

let stallRequests = 0;

function stallAfterToolCall() {
	answer = "stall";

	stallRequests = 0;

	stalled = Promise.withResolvers<void>();

	return stalled.promise;
}

const codex = setupServer(
	http.post(codexUrl, () => {
		if (answer === "reply")
			return new HttpResponse(replyStream, { headers: { "content-type": "text/event-stream" } });

		stallRequests += 1;

		if (stallRequests === 1) {
			return new HttpResponse(toolCallStream, { headers: { "content-type": "text/event-stream" } });
		}

		stalled.resolve();

		return new Promise<never>(() => undefined);
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

afterAll(async () => {
	codex.close();

	await database.close();

	await rm(dir, { recursive: true, force: true });
});

interface Started {
	thread: { id: string };
	run: Run;
}

async function startThread(body: string, agentProfileId?: string) {
	const response = await database.post("thread.start", {
		payload: agentProfileId === undefined ? { body } : { body, agentProfileId },
		idempotencyKey: freshKey("worker"),
	});

	expect(response.status).toBe(200);

	return ((await response.json()) as { result: Started }).result;
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
