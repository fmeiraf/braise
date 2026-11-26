import type { Bet, Goal, Inbox, ProposalDetail, Run, ThreadDetail } from "@braise/core";
import { and, asc, eq, gt } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { braiseTools } from "../src/agent/tools.ts";
import { bets, events, goals, proposals, strategyVersions } from "../src/db/schema.ts";
import { handlers } from "../src/handlers.ts";
import { executeCommand } from "../src/pipeline.ts";
import { createVenture, freshKey, openTestDatabase } from "./database.test-utils.ts";

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

const betChange = {
	command: "bet.create",
	hypothesis: "A loyalty card brings people back",
	action: "Hand out stamp cards",
	killCriteria: "Fewer than 50 cards in a month",
};

const goalChange = {
	command: "goal.create",
	betId: { ref: 1 },
	outcome: "Regulars come back weekly",
	signal: "Stamps per week",
	horizon: null,
};

async function setup(ventureScoped = true) {
	const venture = await createVenture(database);

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
	const output = await propose({ changes: [strategyChange, betChange, goalChange] });

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

		expect(stored?.changes[2]?.payload).toMatchObject({ betId: { ref: 1 } });

		const after = await database.db
			.select({ type: events.type, actor: events.actor, runId: events.runId, seq: events.seq })
			.from(events)
			.where(and(eq(events.ventureId, venture.id), gt(events.seq, before.length)));

		expect(after).toEqual([
			{ type: "proposal.created", actor: "agent:claude", runId: started.run.id, seq: before.length + 1 },
		]);

		expect(await database.db.select().from(bets).where(eq(bets.ventureId, venture.id))).toHaveLength(0);

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
			changes: [{ command: "bet.update", betId: crypto.randomUUID(), hypothesis: "x" }],
		});

		expect(JSON.parse(missingBet.text)).toMatchObject({ code: "not_found" });
	});

	it("refuses bad references, other ventures, foreign threads and calls without a run", async () => {
		const { venture, started, propose } = await setup();

		const forward = await propose({ changes: [{ ...goalChange, betId: { ref: 0 } }] });

		expect(JSON.parse(forward.text)).toMatchObject({ details: { rule: "proposal_ref_invalid" } });

		const other = await createVenture(database);

		const wrongVenture = await propose({ ventureId: other.id, changes: [betChange] });

		expect(JSON.parse(wrongVenture.text)).toMatchObject({ details: { rule: "proposal_out_of_scope" } });

		const payload = {
			ventureId: venture.id,
			threadId: started.thread.id,
			title: "Owner proposal",
			reason: "x",
			changes: [{ command: "bet.create", payload: { hypothesis: "h", action: "a", killCriteria: "k" } }],
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
					payload: { ...payload, changes: [{ command: "goal.archive", payload: {} }] },
					idempotencyKey: freshKey("x"),
				},
				actor: "agent:claude",
				runId: started.run.id,
			}),
		).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("lets a Holding thread propose for any venture", async () => {
		const { propose } = await setup(false);

		expect((await propose({ changes: [betChange] })).isError).toBe(false);
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
				?.execute({ ventureId: venture.id, title: "Once", reason: "r", changes: [betChange] });

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

		changes[2] = { payload: { ...detail.changes[2]?.payload, signal: "Stamps per week, counted Sundays" } };

		const seqBefore = (await database.db.select().from(events).where(eq(events.ventureId, venture.id))).length;

		await ok(
			"proposal.approve",
			{ ventureId: venture.id, proposalId, changes, note: "Signal tightened" },
			"Competition",
		);

		const [bet] = await database.db.select().from(bets).where(eq(bets.ventureId, venture.id));

		const [goal] = await database.db.select().from(goals).where(eq(goals.ventureId, venture.id));

		expect(goal).toMatchObject({ betId: bet?.id, signal: "Stamps per week, counted Sundays" });

		const applied = await database.db
			.select({ type: events.type, seq: events.seq, actor: events.actor, payload: events.payload })
			.from(events)
			.where(and(eq(events.ventureId, venture.id), gt(events.seq, seqBefore)))
			.orderBy(asc(events.seq));

		expect(applied.map((event) => event.type)).toEqual([
			"proposal.approved",
			"strategy.revised",
			"bet.created",
			"goal.created",
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

		expect(await database.db.select().from(bets).where(eq(bets.ventureId, venture.id))).toHaveLength(0);

		const inbox = await read<Inbox>("/inbox");

		expect(inbox.pending.find((item) => item.id === proposalId)).toMatchObject({ staleCount: 1, changeCount: 3 });
	});

	it("marks bet and goal updates stale when the row changed", async () => {
		const { venture, propose } = await setup();

		const bet = await ok<Bet>("bet.create", {
			ventureId: venture.id,
			hypothesis: "h",
			action: "a",
			killCriteria: "k",
		});

		const goal = await ok<Goal>("goal.create", {
			ventureId: venture.id,
			betId: bet.id,
			outcome: "o",
			signal: "s",
			horizon: null,
		});

		const output = await propose({
			changes: [
				{ command: "bet.update", betId: bet.id, action: "Bigger action" },
				{ command: "goal.update", goalId: goal.id, signal: "Sharper" },
			],
		});

		const { proposalId } = JSON.parse(output.text) as { proposalId: string };

		await ok("goal.update", { ventureId: venture.id, goalId: goal.id, outcome: "Owner outcome" });

		const detail = await read<ProposalDetail>(`/proposals/${proposalId}`);

		expect(detail.changes.map((change) => change.stale)).toEqual([null, "The goal changed since"]);

		const changes = [{ payload: detail.changes[0]?.payload ?? {} }, null];

		await ok("proposal.approve", { ventureId: venture.id, proposalId, changes }, "Only the bet");

		const [updated] = await database.db.select().from(bets).where(eq(bets.id, bet.id));

		expect(updated?.action).toBe("Bigger action");
	});

	it("refuses to drop a bet that a kept goal refers to, or to keep nothing", async () => {
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
