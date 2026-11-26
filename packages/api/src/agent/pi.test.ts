import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { Effect, Fiber } from "effect";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { replyStream, toolCallStream, usageHeaders, usageLimitBody } from "./pi.fixture.ts";
import { codexLimitReadings, createPiRuntime, piLoginHint, piProvider } from "./pi.ts";
import { fileCredentialStore } from "./pi-credentials.ts";
import type { AgentTool, RunSignal } from "./runtime.ts";

const codexUrl = "https://chatgpt.com/backend-api/codex/responses";

const requests: Record<string, unknown>[] = [];

let stallSecond = false;

let answer: "stream" | "limited" = "stream";

let stalled = Promise.withResolvers<void>();

function stallSecondRequest() {
	stallSecond = true;

	stalled = Promise.withResolvers<void>();

	return stalled.promise;
}

const server = setupServer(
	http.post(codexUrl, async ({ request }) => {
		const raw = Buffer.from(await request.arrayBuffer());

		const body = request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(raw) : raw;

		requests.push(JSON.parse(body.toString("utf8")) as Record<string, unknown>);

		if (answer === "limited") {
			return new HttpResponse(usageLimitBody, {
				status: 429,
				headers: { ...usageHeaders, "x-codex-primary-used-percent": "100", "content-type": "application/json" },
			});
		}

		if (stallSecond && requests.length === 2) {
			stalled.resolve();

			return new Promise<never>(() => undefined);
		}

		return new HttpResponse(requests.length === 1 ? toolCallStream : replyStream, {
			headers: { ...usageHeaders, "x-codex-primary-used-percent": "42", "content-type": "text/event-stream" },
		});
	}),
);

function base64Url(value: unknown) {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const accessToken = [
	base64Url({ alg: "none" }),
	base64Url({ "https://api.openai.com/auth": { chatgpt_account_id: "account-test" } }),
	"signature",
].join(".");

let dir = "";

let authFile = "";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));

afterAll(() => server.close());

beforeEach(async () => {
	requests.length = 0;

	stallSecond = false;

	answer = "stream";

	dir = await mkdtemp(join(tmpdir(), "braise-pi-"));

	authFile = join(dir, "auth.json");
});

afterEach(async () => {
	server.resetHandlers();

	await rm(dir, { recursive: true, force: true });
});

async function logIn() {
	const credential = { type: "oauth", access: accessToken, refresh: "refresh-test", expires: Date.now() + 3_600_000 };

	await writeFile(authFile, JSON.stringify({ anthropic: { type: "api_key", key: "kept" }, [piProvider]: credential }));
}

const echoes: string[] = [];

const echo = {
	name: "echo",
	description: "Echo text back",
	input: { text: z.string() },
	async execute(args) {
		const { text } = z.object({ text: z.string() }).parse(args);

		echoes.push(text);

		return { text: `echo: ${text}`, isError: false };
	},
} satisfies AgentTool;

function input() {
	return {
		model: "gpt-6.2-sol",
		systemPrompt: "You are a test agent. Follow instructions exactly.",
		prompt: 'Call the echo tool once with text "hello". After it returns, reply with exactly: Echoed hello.',
		tools: [echo],
		workDir: dir,
	};
}

describe("the Pi runtime", () => {
	it("runs a tool call and a reply and maps them to run signals", async () => {
		await logIn();

		const signals: RunSignal[] = [];

		await Effect.runPromise(
			createPiRuntime(fileCredentialStore(authFile)).run(input(), (signal) =>
				Effect.sync(() => {
					signals.push(signal);
				}),
			),
		);

		expect(echoes).toContain("hello");

		const settled = signals.filter((signal) => signal.type !== "delta" && signal.type !== "limit");

		expect(settled).toEqual([
			{ type: "tool.call", toolUseId: expect.any(String), name: "echo", input: { text: "hello" } },
			{ type: "tool.result", toolUseId: expect.any(String), output: "echo: hello", isError: false },
			{ type: "message", block: 0, text: "Echoed hello." },
			{ type: "finished", status: "succeeded", usage: expect.objectContaining({ turns: 2 }), error: null },
		]);

		const streamed = signals
			.filter((signal) => signal.type === "delta")
			.map((signal) => signal.text)
			.join("");

		expect(streamed).toBe("Echoed hello.");

		expect(requests).toHaveLength(2);

		expect(requests[0]).toMatchObject({
			model: "gpt-6.2-sol",
			input: expect.arrayContaining([
				expect.objectContaining({
					type: "additional_tools",
					tools: [
						expect.objectContaining({
							name: "echo",
							parameters: expect.objectContaining({ required: ["text"] }),
						}),
					],
				}),
			]),
		});

		expect(JSON.stringify(requests[1])).toContain("echo: hello");
	});

	it("reads the Codex usage headers of every response as limit signals", async () => {
		await logIn();

		const signals: RunSignal[] = [];

		await Effect.runPromise(
			createPiRuntime(fileCredentialStore(authFile)).run(input(), (signal) =>
				Effect.sync(() => {
					signals.push(signal);
				}),
			),
		);

		const limits = signals.filter((signal) => signal.type === "limit");

		expect(limits).toHaveLength(4);

		expect(limits[0]).toEqual({
			type: "limit",
			reading: { window: "primary", status: "allowed", utilization: 0.42, resetsAt: new Date(1795744031 * 1000) },
		});

		expect(limits[1]).toEqual({
			type: "limit",
			reading: { window: "secondary", status: "allowed", utilization: 0, resetsAt: new Date(1796169875 * 1000) },
		});
	});

	it("turns a 429 usage_limit_reached into a rejected reading and a failed run", async () => {
		await logIn();

		answer = "limited";

		const signals: RunSignal[] = [];

		await Effect.runPromise(
			createPiRuntime(fileCredentialStore(authFile)).run(input(), (signal) =>
				Effect.sync(() => {
					signals.push(signal);
				}),
			),
		);

		expect(signals.filter((signal) => signal.type === "limit")).toEqual([
			{
				type: "limit",
				reading: { window: "secondary", status: "allowed", utilization: 0, resetsAt: new Date(1796169875 * 1000) },
			},
			{
				type: "limit",
				reading: { window: "primary", status: "rejected", utilization: 1, resetsAt: new Date(1795744031 * 1000) },
			},
		]);

		expect(signals.at(-1)).toMatchObject({ type: "finished", status: "failed" });
	});

	it("stops when interrupted while it waits for the model", async () => {
		await logIn();

		const stall = stallSecondRequest();

		const fiber = Effect.runFork(createPiRuntime(fileCredentialStore(authFile)).run(input(), () => Effect.void));

		await stall;

		await Effect.runPromise(Fiber.interrupt(fiber));

		expect(requests).toHaveLength(2);

		expect(echoes).toContain("hello");
	});

	it("fails with the login hint when Pi has no Codex login", async () => {
		const runtime = createPiRuntime(fileCredentialStore(authFile));

		await expect(Effect.runPromise(runtime.run(input(), () => Effect.void))).rejects.toThrow(piLoginHint);

		expect(requests).toEqual([]);
	});
});

describe("codexLimitReadings", () => {
	it("skips windows the headers don't carry", () => {
		expect(codexLimitReadings({ "x-codex-primary-used-percent": "91.5" })).toEqual([
			{ window: "primary", status: "allowed", utilization: 0.915, resetsAt: null },
		]);

		expect(codexLimitReadings({})).toEqual([]);
	});
});

describe("the Pi credential store", () => {
	it("writes one provider under the lock and keeps the others", async () => {
		await logIn();

		const store = fileCredentialStore(authFile);

		await store.modify(piProvider, async (current) =>
			current?.type === "oauth" ? { ...current, refresh: "rotated" } : current,
		);

		const saved = JSON.parse(await readFile(authFile, "utf8")) as Record<string, Record<string, unknown>>;

		expect(saved[piProvider]?.refresh).toBe("rotated");

		expect(saved.anthropic).toEqual({ type: "api_key", key: "kept" });

		expect(await store.list()).toEqual([
			{ providerId: "anthropic", type: "api_key" },
			{ providerId: piProvider, type: "oauth" },
		]);
	});
});
