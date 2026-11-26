import type { AgentOverview, Inbox, InboxAccessRequest, Run, ThreadDetail } from "@braise/core";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { braiseTools } from "../src/agent/tools.ts";
import { accessRequests, agentGrants, commands, workItems } from "../src/db/schema.ts";
import { handlers } from "../src/handlers.ts";
import { executeCommand } from "../src/pipeline.ts";
import { createBuildObjective, createVenture, freshKey, openTestDatabase } from "./database.test-utils.ts";

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

async function read<Body>(path: string) {
	const response = await database.app.request(`/api${path}`);

	expect(response.status).toBe(200);

	return (await response.json()) as Body;
}

async function asAgent(actor: string, runId: string | null, name: string, payload: Record<string, unknown>) {
	try {
		const response = await executeCommand(database.db, handlers, database.services, {
			name,
			body: { payload, idempotencyKey: freshKey(name) },
			actor,
			runId,
		});

		return { ok: true as const, result: response.result };
	} catch (error) {
		return { ok: false as const, error: error as { code: string; details: Record<string, unknown> } };
	}
}

interface Started {
	thread: { id: string; ventureId: string | null; agentProfileId: string };
	run: Run;
}

async function startThread(agentProfileId: string) {
	const venture = await createVenture(database);

	const objective = await createBuildObjective(database, venture.id, "Regulars come back");

	const started = await ok<Started>("thread.start", { ventureId: venture.id, agentProfileId, body: "Plan the work" });

	await ok("run.cancel", { runId: started.run.id });

	return { venture, objective, thread: started.thread, run: started.run };
}

function newInitiative(ventureId: string, objectiveId: string, title: string) {
	return { ventureId, home: { type: "objective", id: objectiveId }, title, function: "ops" };
}

async function agents() {
	return (await read<{ agents: AgentOverview[] }>("/agents")).agents;
}

async function gptCapability(capability: string) {
	const gpt = (await agents()).find((agent) => agent.id === "gpt");

	return gpt?.capabilities.find((state) => state.capability === capability);
}

function nextAccessHint() {
	return new Promise<void>((resolve) => {
		const unsubscribe = database.subscribe((message) => {
			if (message.type !== "access") return;

			unsubscribe();

			resolve();
		});
	});
}

async function threadLines(threadId: string) {
	const detail = await read<ThreadDetail>(`/threads/${threadId}`);

	return detail.messages.filter((message) => message.author === "braise").map((message) => message.body);
}

describe("agent profiles", () => {
	it("seeds Claude with every capability and GPT with none", async () => {
		const [claude, gpt] = await agents();

		expect(claude).toMatchObject({ id: "claude", runtime: "claude-agent-sdk", model: "claude-opus-5-5" });

		expect(claude?.capabilities.every((state) => state.granted)).toBe(true);

		expect(gpt).toMatchObject({ id: "gpt", actor: "agent:gpt", runtime: "pi", model: "gpt-6.2-sol" });

		expect(gpt?.capabilities.some((state) => state.granted)).toBe(false);
	});

	it("queues a GPT thread's runs on Pi and keeps the agent for later messages", async () => {
		const { thread, run } = await startThread("gpt");

		expect(thread.agentProfileId).toBe("gpt");

		expect(run).toMatchObject({ runtime: "pi", model: "gpt-6.2-sol", actor: "agent:gpt" });

		const posted = await ok<{ run: Run }>("thread.post", { threadId: thread.id, body: "And next?" });

		expect(posted.run).toMatchObject({ runtime: "pi", actor: "agent:gpt" });

		await ok("run.cancel", { runId: posted.run.id });

		expect((await read<ThreadDetail>(`/threads/${thread.id}`)).agent).toEqual({ id: "gpt", name: "GPT" });
	});

	it("refuses an unknown agent profile", async () => {
		const sent = await send("thread.start", { agentProfileId: "nobody", body: "Hi" });

		expect(sent.status).toBe(404);
	});

	it("lets Claude's seeded grants run today's commands", async () => {
		const { venture, objective, run } = await startThread("claude");

		const created = await asAgent(
			"agent:claude",
			run.id,
			"work.create",
			newInitiative(venture.id, objective.id, "Bake rye"),
		);

		expect(created.ok).toBe(true);
	});
});

describe("access requests", () => {
	it("refuses GPT's work.create, files a request and writes nothing else", async () => {
		const { venture, objective, thread, run } = await startThread("gpt");

		const hint = nextAccessHint();

		const refused = await asAgent(
			"agent:gpt",
			run.id,
			"work.create",
			newInitiative(venture.id, objective.id, "Print loyalty cards"),
		);

		await hint;

		expect(refused.ok).toBe(false);

		expect(refused.ok ? null : refused.error).toMatchObject({
			code: "not_granted",
			details: { capability: "work", command: "work.create", actor: "agent:gpt" },
		});

		const requestId = refused.ok ? "" : String(refused.error.details.accessRequestId);

		const [request] = await database.db.select().from(accessRequests).where(eq(accessRequests.id, requestId));

		expect(request).toMatchObject({
			profileId: "gpt",
			capability: "work",
			threadId: thread.id,
			runId: run.id,
			ventureId: venture.id,
			command: "work.create",
			attempts: 1,
			status: "pending",
		});

		const written = await database.db.select().from(workItems).where(eq(workItems.ventureId, venture.id));

		expect(written).toEqual([]);

		const [filed] = await database.db
			.select({ actor: commands.actor, runId: commands.runId })
			.from(commands)
			.where(and(eq(commands.name, "access.request"), eq(commands.runId, run.id)));

		expect(filed).toEqual({ actor: "agent:gpt", runId: run.id });

		const second = await asAgent(
			"agent:gpt",
			run.id,
			"work.create",
			newInitiative(venture.id, objective.id, "Order ink"),
		);

		expect(second.ok ? null : second.error.details.accessRequestId).toBe(requestId);

		const [bumped] = await database.db.select().from(accessRequests).where(eq(accessRequests.id, requestId));

		expect(bumped?.attempts).toBe(2);

		const inbox = await read<Inbox>("/inbox");

		const item = inbox.pending.find((entry) => entry.id === requestId) as InboxAccessRequest | undefined;

		expect(item).toMatchObject({
			kind: "access_request",
			agent: { id: "gpt", name: "GPT" },
			capability: "work",
			summary: "create work item “Print loyalty cards”",
			references: { home: "Regulars come back" },
			attempts: 2,
			thread: { id: thread.id },
		});

		expect((await gptCapability("work"))?.pendingRequestId).toBe(requestId);
	});

	it("refuses owner-only commands without filing a request", async () => {
		const { venture, objective, run } = await startThread("gpt");

		const refused = await asAgent("agent:gpt", run.id, "objective.archive", {
			ventureId: venture.id,
			objectiveId: objective.id,
		});

		expect(refused.ok ? null : refused.error).toMatchObject({ code: "not_granted" });

		expect(refused.ok ? "ok" : refused.error.details.accessRequestId).toBeUndefined();

		expect(await database.db.select().from(accessRequests).where(eq(accessRequests.runId, run.id))).toEqual([]);
	});

	it("answers a malformed attempt with a validation error, not an access request", async () => {
		const { run } = await startThread("gpt");

		const refused = await asAgent("agent:gpt", run.id, "work.create", { ventureId: "not-a-uuid", title: "" });

		expect(refused.ok ? null : refused.error.code).toBe("validation_failed");

		expect(await database.db.select().from(accessRequests).where(eq(accessRequests.runId, run.id))).toEqual([]);
	});

	it("refuses without filing when there is no run", async () => {
		const { venture, objective } = await startThread("gpt");

		const refused = await asAgent(
			"agent:gpt",
			null,
			"work.create",
			newInitiative(venture.id, objective.id, "No run"),
		);

		expect(refused.ok ? null : refused.error).toMatchObject({ code: "not_granted", details: { capability: "work" } });

		expect(refused.ok ? "ok" : refused.error.details.accessRequestId).toBeUndefined();
	});

	it("approves into a standing grant, posts the line, and the retry succeeds", async () => {
		const { venture, objective, thread: second, run } = await startThread("gpt");

		const refused = await asAgent(
			"agent:gpt",
			run.id,
			"work.create",
			newInitiative(venture.id, objective.id, "Cards"),
		);

		const requestId = refused.ok ? "" : String(refused.error.details.accessRequestId);

		const [pending] = await database.db.select().from(accessRequests).where(eq(accessRequests.id, requestId));

		const thread = { id: pending?.threadId ?? "" };

		expect(thread.id).not.toBe(second.id);

		const hint = nextAccessHint();

		await ok("access.approve", { accessRequestId: requestId, note: "Fine for work" });

		await hint;

		expect(await threadLines(thread.id)).toContain("Granted Work and readings to GPT · Fine for work");

		expect(await threadLines(second.id)).toContain("Granted Work and readings to GPT · Fine for work");

		expect(await gptCapability("work")).toMatchObject({
			granted: true,
			changedBy: "owner",
			viaRequest: true,
			pendingRequestId: null,
		});

		const retried = await asAgent(
			"agent:gpt",
			run.id,
			"work.create",
			newInitiative(venture.id, objective.id, "Cards"),
		);

		expect(retried.ok).toBe(true);

		const decided = await send("access.approve", { accessRequestId: requestId });

		expect(decided.status).toBe(422);

		expect(decided.body.error?.details.rule).toBe("access_decided");

		const inbox = await read<Inbox>("/inbox");

		expect(inbox.decided.find((entry) => entry.id === requestId)).toMatchObject({ status: "approved" });
	});

	it("refuses again after a revoke, and denies with a line", async () => {
		const { venture, objective, thread, run } = await startThread("gpt");

		await ok("grant.revoke", { profileId: "gpt", capability: "work" });

		expect(await gptCapability("work")).toMatchObject({ granted: false, changedBy: "owner" });

		const refused = await asAgent(
			"agent:gpt",
			run.id,
			"work.create",
			newInitiative(venture.id, objective.id, "Again"),
		);

		expect(refused.ok).toBe(false);

		const requestId = refused.ok ? "" : String(refused.error.details.accessRequestId);

		await ok("access.deny", { accessRequestId: requestId, note: "Not now" });

		expect(await threadLines(thread.id)).toContain("Denied Work and readings to GPT · Not now");

		const [denied] = await database.db.select().from(accessRequests).where(eq(accessRequests.id, requestId));

		expect(denied).toMatchObject({ status: "denied", note: "Not now" });

		const again = await asAgent("agent:gpt", run.id, "work.create", newInitiative(venture.id, objective.id, "Again"));

		const againId = again.ok ? "" : String(again.error.details.accessRequestId);

		expect(againId).not.toBe(requestId);

		const [fresh] = await database.db.select().from(accessRequests).where(eq(accessRequests.id, againId));

		expect(fresh?.status).toBe("pending");

		await ok("access.deny", { accessRequestId: againId });

		const revokedAgain = await send("grant.revoke", { profileId: "gpt", capability: "work" });

		expect(revokedAgain.body.error?.details.rule).toBe("no_changes");
	});

	it("approves a pending request when the owner grants the capability directly", async () => {
		const { thread, run } = await startThread("gpt");

		const refused = await asAgent("agent:gpt", run.id, "thread.link", {
			threadId: thread.id,
			link: { type: "venture", id: thread.ventureId },
		});

		const requestId = refused.ok ? "" : String(refused.error.details.accessRequestId);

		await ok("grant.add", { profileId: "gpt", capability: "links" });

		const [request] = await database.db.select().from(accessRequests).where(eq(accessRequests.id, requestId));

		expect(request?.status).toBe("approved");

		expect(request?.ventureId).toBe(thread.ventureId);

		const [grant] = await database.db
			.select()
			.from(agentGrants)
			.where(and(eq(agentGrants.profileId, "gpt"), eq(agentGrants.capability, "links")));

		expect(grant?.accessRequestId).toBe(requestId);

		expect(await threadLines(thread.id)).toContain("Granted Thread links to GPT");

		const again = await send("grant.add", { profileId: "gpt", capability: "links" });

		expect(again.body.error?.details.rule).toBe("no_changes");

		await ok("grant.revoke", { profileId: "gpt", capability: "links" });
	});

	it("refuses every access and grant command from agents", async () => {
		const { run } = await startThread("claude");

		for (const [name, payload] of [
			["access.approve", { accessRequestId: crypto.randomUUID() }],
			["access.deny", { accessRequestId: crypto.randomUUID() }],
			["grant.add", { profileId: "gpt", capability: "work" }],
			["grant.revoke", { profileId: "claude", capability: "work" }],
		] as const) {
			const refused = await asAgent("agent:claude", run.id, name, payload);

			expect(refused.ok ? null : refused.error.code, name).toBe("not_granted");
		}
	});
});

describe("braise tools", () => {
	it("turn a refused command into an access-requested result, not an error", async () => {
		const { objective, thread, run } = await startThread("gpt");

		const tools = braiseTools({
			db: database.db,
			reader: database.reader,
			services: database.services,
			actor: "agent:gpt",
			runId: run.id,
			threadId: thread.id,
		});

		const create = tools.find((tool) => tool.name === "create_work_item");

		const output = await create?.execute({ objectiveId: objective.id, title: "Flyers", function: "ops" });

		expect(output?.isError).toBe(false);

		expect(JSON.parse(output?.text ?? "{}")).toMatchObject({
			accessRequested: { capability: "work", label: "Work and readings" },
		});
	});
});
