import type { Inbox, ProposalDetail, Run, ThreadDetail } from "@braise/core";
import { and, asc, eq, gt } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { braiseTools } from "../src/agent/tools.ts";
import { assumptions, bets, events, learnings, objectives, proposals, strategyVersions } from "../src/db/schema.ts";
import { handlers } from "../src/handlers.ts";
import { executeCommand } from "../src/pipeline.ts";
import {
	betPayload,
	createLoop,
	createVenture,
	freshKey,
	openTestDatabase,
	recordReading,
} from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

interface Sent<Result> {
	status: number;
	body: { result: Result; error?: { code: string; details: Record<string, unknown> } };
}

async function send<Result>(name: string, payload: Record<string, unknown>, reason?: string) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name), reason });

	return { status: response.status, body: await response.json() } as Sent<Result>;
}

async function ok<Result>(name: string, payload: Record<string, unknown>, reason?: string) {
	const sent = await send<Result>(name, payload, reason);

	expect(sent.status, JSON.stringify(sent.body)).toBe(200);

	return sent.body.result;
}

async function refused(name: string, payload: Record<string, unknown>, reason?: string) {
	const sent = await send(name, payload, reason);

	return {
		status: sent.status,
		code: sent.body.error?.code,
		rule: sent.body.error?.details.rule,
		details: sent.body.error?.details,
	};
}

async function read<Body>(path: string) {
	const response = await database.app.request(`/api${path}`);

	expect(response.status).toBe(200);

	return (await response.json()) as Body;
}

interface Started {
	thread: { id: string; ventureId: string | null };
	run: Run;
}

const strategyChange = {
	command: "strategy.revise",
	why: "Because it matters",
	what: "A useful thing",
	diagnosis: "A new competitor opened next door",
	guidingPolicy: "Win on loyalty",
};

const objectiveChange = {
	command: "objective.create",
	kind: "learning",
	statement: "Will a loyalty card bring people back?",
	decision: "Whether to print cards for every shop",
	doneRule: "Fifty cards handed out and a month of visits counted",
};

const assumptionChange = {
	command: "assumption.create",
	objectiveId: { ref: 1 },
	statement: "Regulars come back weekly for a stamp",
	impact: "high",
	function: "marketing",
};

const hunchChange = {
	command: "assumption.create",
	objectiveId: null,
	statement: "A loyalty card brings people back",
	impact: "medium",
	function: "marketing",
};

async function setup(ventureScoped = true, given?: { id: string; slug: string }) {
	const venture = given ?? (await createVenture(database));

	const started = await ok<Started>("thread.start", {
		ventureId: ventureScoped ? venture.id : undefined,
		body: "Propose something",
	});

	await ok("run.cancel", { runId: started.run.id });

	const tools = braiseTools({
		db: database.db,
		reader: database.reader,
		services: database.services,
		actor: "agent:claude",
		runId: started.run.id,
		threadId: started.thread.id,
	});

	const propose = (args: Record<string, unknown>) => {
		const tool = tools.find((candidate) => candidate.name === "propose_changes");

		if (tool === undefined) throw new Error("propose_changes is missing");

		return tool.execute({ ventureId: venture.id, title: "Loyalty", reason: "Competition", ...args });
	};

	return { venture, started, propose };
}

async function proposed(propose: (args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>) {
	const output = await propose({ changes: [strategyChange, objectiveChange, assumptionChange] });

	expect(output.isError, output.text).toBe(false);

	return JSON.parse(output.text) as { proposalId: string; inbox: string };
}

function keep(detail: ProposalDetail) {
	return detail.changes.map((change) => ({ payload: change.payload }));
}

describe("proposal.create", () => {
	it("stores a pending proposal with bases and one event, and applies nothing", async () => {
		const { venture, started, propose } = await setup();

		const before = await database.db.select().from(events).where(eq(events.ventureId, venture.id));

		const { proposalId, inbox } = await proposed(propose);

		expect(inbox).toBe(`/inbox?proposal=${proposalId}`);

		const [stored] = await database.db.select().from(proposals).where(eq(proposals.id, proposalId));

		expect(stored).toMatchObject({
			status: "pending",
			createdBy: "agent:claude",
			runId: started.run.id,
			threadId: started.thread.id,
		});

		expect(stored?.changes.map((change) => change.base)).toEqual([{ strategyVersion: 1 }, null, null]);

		expect(stored?.changes[2]?.payload).toMatchObject({ objectiveId: { ref: 1 } });

		const after = await database.db
			.select({ type: events.type, actor: events.actor, runId: events.runId, seq: events.seq })
			.from(events)
			.where(and(eq(events.ventureId, venture.id), gt(events.seq, before.length)));

		expect(after).toEqual([
			{ type: "proposal.created", actor: "agent:claude", runId: started.run.id, seq: before.length + 1 },
		]);

		expect(await database.db.select().from(objectives).where(eq(objectives.ventureId, venture.id))).toHaveLength(0);

		const versions = await database.db
			.select({ version: strategyVersions.version })
			.from(strategyVersions)
			.where(eq(strategyVersions.ventureId, venture.id));

		expect(versions).toEqual([{ version: 1 }]);
	});

	it("returns the dry run's rule error as the tool result", async () => {
		const { propose } = await setup();

		const unchanged = await propose({
			changes: [{ ...strategyChange, diagnosis: "", guidingPolicy: "" }],
		});

		expect(unchanged.isError).toBe(true);

		expect(JSON.parse(unchanged.text)).toMatchObject({ code: "rule_violated", details: { rule: "no_changes" } });

		const missingBet = await propose({
			changes: [{ command: "bet.update", betId: crypto.randomUUID(), action: "x" }],
		});

		expect(JSON.parse(missingBet.text)).toMatchObject({ code: "not_found" });
	});

	it("refuses bad references, other ventures, foreign threads and calls without a run", async () => {
		const { venture, started, propose } = await setup();

		const forward = await propose({ changes: [{ ...assumptionChange, objectiveId: { ref: 0 } }] });

		expect(JSON.parse(forward.text)).toMatchObject({ details: { rule: "proposal_ref_invalid" } });

		const other = await createVenture(database);

		const wrongVenture = await propose({ ventureId: other.id, changes: [hunchChange] });

		expect(JSON.parse(wrongVenture.text)).toMatchObject({ details: { rule: "proposal_out_of_scope" } });

		const payload = {
			ventureId: venture.id,
			threadId: started.thread.id,
			title: "Owner proposal",
			reason: "x",
			changes: [{ command: "assumption.create", payload: { objectiveId: null, statement: "s", function: "ops" } }],
		};

		await expect(
			executeCommand(database.db, handlers, database.services, {
				name: "proposal.create",
				body: { payload, idempotencyKey: freshKey("no-run") },
				actor: "agent:claude",
			}),
		).rejects.toMatchObject({ details: { rule: "proposal_needs_run" } });

		await expect(
			executeCommand(database.db, handlers, database.services, {
				name: "proposal.create",
				body: {
					payload: { ...payload, changes: [{ command: "bet.archive", payload: {} }] },
					idempotencyKey: freshKey("x"),
				},
				actor: "agent:claude",
				runId: started.run.id,
			}),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("lets a Holding thread propose for any venture", async () => {
		const { propose } = await setup(false);

		expect((await propose({ changes: [hunchChange] })).isError).toBe(false);
	});

	it("is idempotent when the tool call is replayed", async () => {
		const { venture, started } = await setup();

		const replay = () =>
			braiseTools({
				db: database.db,
				reader: database.reader,
				services: database.services,
				actor: "agent:claude",
				runId: started.run.id,
				threadId: started.thread.id,
			})
				.find((tool) => tool.name === "propose_changes")
				?.execute({ ventureId: venture.id, title: "Once", reason: "r", changes: [hunchChange] });

		const first = JSON.parse((await replay())?.text ?? "{}") as { proposalId: string };

		const second = JSON.parse((await replay())?.text ?? "{}") as { proposalId: string };

		expect(second.proposalId).toBe(first.proposalId);

		expect(await database.db.select().from(proposals).where(eq(proposals.ventureId, venture.id))).toHaveLength(1);
	});
});

describe("proposal.approve", () => {
	it("applies the kept changes atomically with edits, resolves the ref and posts the decision", async () => {
		const { venture, started, propose } = await setup();

		const { proposalId } = await proposed(propose);

		const detail = await read<ProposalDetail>(`/proposals/${proposalId}`);

		expect(detail.changes.map((change) => change.stale)).toEqual([null, null, null]);

		expect(detail.changes[0]?.current).toMatchObject({ version: 1, diagnosis: "" });

		const changes = keep(detail);

		changes[2] = { payload: { ...detail.changes[2]?.payload, statement: "Regulars come back twice a week" } };

		const seqBefore = (await database.db.select().from(events).where(eq(events.ventureId, venture.id))).length;

		await ok(
			"proposal.approve",
			{ ventureId: venture.id, proposalId, changes, note: "Signal tightened" },
			"Competition",
		);

		const [objective] = await database.db.select().from(objectives).where(eq(objectives.ventureId, venture.id));

		const [assumption] = await database.db.select().from(assumptions).where(eq(assumptions.ventureId, venture.id));

		expect(assumption).toMatchObject({
			objectiveId: objective?.id,
			statement: "Regulars come back twice a week",
			createdBy: "owner",
		});

		const applied = await database.db
			.select({ type: events.type, seq: events.seq, actor: events.actor, payload: events.payload })
			.from(events)
			.where(and(eq(events.ventureId, venture.id), gt(events.seq, seqBefore)))
			.orderBy(asc(events.seq));

		expect(applied.map((event) => event.type)).toEqual([
			"proposal.approved",
			"strategy.revised",
			"objective.created",
			"assumption.created",
		]);

		expect(applied.map((event) => event.seq)).toEqual([1, 2, 3, 4].map((offset) => seqBefore + offset));

		expect(applied.every((event) => event.actor === "owner" && event.payload.proposalId === proposalId)).toBe(true);

		expect(applied[0]?.payload).toMatchObject({ applied: 3, dropped: 0, edited: 1 });

		const history = await read<{ versions: { version: number; reason: string | null }[] }>(
			`/ventures/${venture.slug}/strategy/versions`,
		);

		expect(history.versions.find((version) => version.version === 2)?.reason).toBe("Competition");

		const thread = await read<ThreadDetail>(`/threads/${started.thread.id}`);

		expect(thread.messages.at(-1)).toMatchObject({
			author: "braise",
			body: "Approved “Loyalty” with edits · Signal tightened",
		});

		expect(await refused("proposal.approve", { ventureId: venture.id, proposalId, changes }, "again")).toMatchObject({
			rule: "proposal_decided",
		});
	});

	it("refuses a stale change and applies nothing", async () => {
		const { venture, propose } = await setup();

		const { proposalId } = await proposed(propose);

		const detail = await read<ProposalDetail>(`/proposals/${proposalId}`);

		await ok(
			"strategy.revise",
			{ ventureId: venture.id, why: "Owner edit", what: "A useful thing", diagnosis: "", guidingPolicy: "" },
			"Owner change",
		);

		const stale = await read<ProposalDetail>(`/proposals/${proposalId}`);

		expect(stale.changes.map((change) => change.stale)).toEqual(["The strategy is now v2", null, null]);

		expect(
			await refused("proposal.approve", { ventureId: venture.id, proposalId, changes: keep(detail) }, "r"),
		).toMatchObject({ status: 422, rule: "proposal_stale", details: { stale: [{ change: 0 }] } });

		expect(await database.db.select().from(objectives).where(eq(objectives.ventureId, venture.id))).toHaveLength(0);

		const inbox = await read<Inbox>("/inbox");

		expect(inbox.pending.find((item) => item.id === proposalId)).toMatchObject({ staleCount: 1, changeCount: 3 });
	});

	it("marks updates stale when the row changed", async () => {
		const loop = await createLoop(database);

		const { propose } = await setup(true, loop.venture);

		const ventureId = loop.ventureId;

		const output = await propose({
			changes: [
				{ command: "bet.update", betId: loop.bet.id, action: "Bigger action" },
				{ command: "assumption.update", assumptionId: loop.assumption.id, impact: "high" },
			],
		});

		const { proposalId } = JSON.parse(output.text) as { proposalId: string };

		await ok("assumption.update", { ventureId, assumptionId: loop.assumption.id, statement: "Owner wording" });

		const detail = await read<ProposalDetail>(`/proposals/${proposalId}`);

		expect(detail.changes.map((change) => change.stale)).toEqual([null, "The assumption changed since"]);

		expect(detail.changes[0]?.current).toMatchObject({ action: "Run the test", passAt: 30 });

		const changes = [{ payload: detail.changes[0]?.payload ?? {} }, null];

		await ok("proposal.approve", { ventureId, proposalId, changes }, "Only the bet");

		const [updated] = await database.db.select().from(bets).where(eq(bets.id, loop.bet.id));

		expect(updated?.action).toBe("Bigger action");
	});

	it("closes a bet and registers the next one in a single proposal", async () => {
		const loop = await createLoop(database);

		const { propose } = await setup(true, loop.venture);

		const ventureId = loop.ventureId;

		const early = await propose({
			changes: [{ command: "bet.close", betId: loop.bet.id, result: "pass", statement: "It worked" }],
		});

		expect(JSON.parse(early.text)).toMatchObject({ details: { rule: "bet_not_passed" } });

		await recordReading(database, ventureId, loop.bet.id, 34);

		const { command: _command, ...nextBet } = {
			command: "bet.create",
			...betPayload(ventureId, { ref: 1 }, "Counter card"),
		};

		const output = await propose({
			changes: [
				{
					command: "bet.close",
					betId: loop.bet.id,
					result: "pass",
					statement: "Regulars pre-order when it is quick",
				},
				{
					command: "assumption.create",
					objectiveId: loop.objective.id,
					statement: "They hear at the counter",
					impact: "high",
					function: "marketing",
				},
				{ command: "bet.create", ...nextBet, ventureId: undefined },
			],
		});

		expect(output.isError, output.text).toBe(false);

		const { proposalId } = JSON.parse(output.text) as { proposalId: string };

		const cockpit = await read<{ proposedBets: { assumptionId: unknown; action: string }[] }>(
			`/ventures/${loop.slug}`,
		);

		expect(cockpit.proposedBets).toEqual([]);

		const detail = await read<ProposalDetail>(`/proposals/${proposalId}`);

		await ok("proposal.approve", { ventureId, proposalId, changes: keep(detail) }, "Passed");

		const [learning] = await database.db.select().from(learnings).where(eq(learnings.betId, loop.bet.id));

		expect(learning).toMatchObject({
			result: "pass",
			value: 34,
			confidenceFrom: 1,
			confidenceTo: 3,
			createdBy: "owner",
		});

		const open = await database.db
			.select({ action: bets.action })
			.from(bets)
			.where(and(eq(bets.ventureId, ventureId), eq(bets.status, "open")));

		expect(open).toEqual([{ action: "Counter card" }]);
	});

	it("shows a proposed bet on its assumption while it waits", async () => {
		const loop = await createLoop(database);

		const { propose } = await setup(true, loop.venture);

		const { ventureId: _ventureId, ...second } = betPayload(loop.ventureId, loop.assumption.id, "A second test");

		const output = await propose({ changes: [{ command: "bet.create", ...second }] });

		const { proposalId } = JSON.parse(output.text) as { proposalId: string };

		const cockpit = await read<{ proposedBets: object[] }>(`/ventures/${loop.slug}`);

		expect(cockpit.proposedBets).toEqual([
			{ proposalId, assumptionId: loop.assumption.id, action: "A second test", createdBy: "agent:claude" },
		]);
	});

	it("refuses to drop a new objective that a kept assumption builds on, or to keep nothing", async () => {
		const { venture, propose } = await setup();

		const { proposalId } = await proposed(propose);

		const detail = await read<ProposalDetail>(`/proposals/${proposalId}`);

		const changes = [
			{ payload: detail.changes[0]?.payload ?? {} },
			null,
			{ payload: detail.changes[2]?.payload ?? {} },
		];

		expect(await refused("proposal.approve", { ventureId: venture.id, proposalId, changes }, "r")).toMatchObject({
			rule: "proposal_ref_dropped",
		});

		expect(
			await refused("proposal.approve", { ventureId: venture.id, proposalId, changes: [null, null, null] }, "r"),
		).toMatchObject({ rule: "proposal_nothing_kept" });

		expect(
			await refused("proposal.approve", { ventureId: venture.id, proposalId, changes: keep(detail) }),
		).toMatchObject({ code: "validation_failed" });
	});

	it("is owner-only", async () => {
		const { venture, propose } = await setup();

		const { proposalId } = await proposed(propose);

		for (const name of ["proposal.approve", "proposal.reject"]) {
			await expect(
				database.command(
					name,
					{ payload: { ventureId: venture.id, proposalId, changes: [] }, idempotencyKey: freshKey(name) },
					"agent:claude",
				),
			).rejects.toMatchObject({ code: "not_granted", status: 403 });
		}
	});
});

describe("proposal.reject and the inbox", () => {
	it("rejects with a note, posts the line and moves the proposal to decided", async () => {
		const { venture, started, propose } = await setup();

		const { proposalId } = await proposed(propose);

		const pending = await read<Inbox>("/inbox");

		expect(pending.pending.find((item) => item.id === proposalId)).toMatchObject({
			venture: { id: venture.id },
			thread: { id: started.thread.id },
			status: "pending",
		});

		await ok("proposal.reject", { ventureId: venture.id, proposalId, note: "Redo on the current version" });

		const thread = await read<ThreadDetail>(`/threads/${started.thread.id}`);

		expect(thread.messages.at(-1)).toMatchObject({
			author: "braise",
			body: "Rejected “Loyalty” · Redo on the current version",
		});

		const after = await read<Inbox>("/inbox");

		expect(after.pending.some((item) => item.id === proposalId)).toBe(false);

		expect(after.decided.find((item) => item.id === proposalId)).toMatchObject({ status: "rejected" });

		const detail = await read<ProposalDetail>(`/proposals/${proposalId}`);

		expect(detail.proposal).toMatchObject({ status: "rejected", note: "Redo on the current version" });

		const [event] = await database.db
			.select({ type: events.type })
			.from(events)
			.where(and(eq(events.ventureId, venture.id), eq(events.type, "proposal.rejected")));

		expect(event).toBeDefined();
	});

	it("answers 404 for an unknown proposal", async () => {
		const response = await database.app.request(`/api/proposals/${crypto.randomUUID()}`);

		expect(response.status).toBe(404);
	});
});
