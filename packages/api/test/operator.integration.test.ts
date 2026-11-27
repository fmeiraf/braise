import type { Cockpit, DraftSummary, ThreadDetail, VentureWork } from "@braise/core";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { loadRunContext } from "../src/agent/context.ts";
import {
	accessRequests,
	assumptions,
	bets,
	events,
	objectives,
	proposals,
	threadMessages,
	threads,
	ventures,
	workItems,
} from "../src/db/schema.ts";
import { draftViewStats } from "../src/draft-view.ts";
import { handlers } from "../src/handlers.ts";
import type { HubMessage } from "../src/hints.ts";
import { executeCommand } from "../src/pipeline.ts";
import {
	betPayload,
	createAssumption,
	createLoop,
	createMetricObjective,
	createVenture,
	freshKey,
	openTestDatabase,
} from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

const agent = "agent:claude";

interface Refusal {
	status: number;
	code: string | undefined;
	rule: unknown;
	details: Record<string, unknown> | undefined;
}

async function owner<Result>(name: string, payload: Record<string, unknown>, reason?: string) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name), reason });

	const body = (await response.json()) as {
		result: Result;
		error?: { code: string; details: Record<string, unknown> };
	};

	expect(response.status, JSON.stringify(body)).toBe(200);

	return body.result;
}

async function ownerRefused(name: string, payload: Record<string, unknown>) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name) });

	const body = (await response.json()) as { error?: { code: string; details: Record<string, unknown> } };

	return {
		status: response.status,
		code: body.error?.code,
		rule: body.error?.details.rule,
		details: body.error?.details,
	} satisfies Refusal;
}

async function read<Body>(path: string) {
	const response = await database.app.request(`/api${path}`);

	expect(response.status, await response.clone().text()).toBe(200);

	return (await response.json()) as Body;
}

interface Session {
	session: { id: string; ventureId: string | null; operatorVentureId: string | null; archivedAt: string | null };
	opened: boolean;
}

async function operatorRun(ventureId: string, body = "Operate the board") {
	const { session } = await owner<Session>("operator.open", { ventureId });

	const posted = await owner<{ run: { id: string }; session: { id: string } }>("thread.post", {
		threadId: session.id,
		body,
	});

	await owner("run.cancel", { runId: posted.run.id });

	return { sessionId: posted.session.id, runId: posted.run.id };
}

async function asAgent<Result>(runId: string, name: string, payload: Record<string, unknown>) {
	const response = await executeCommand(database.db, handlers, database.services, {
		name,
		body: { payload, idempotencyKey: freshKey(name) },
		actor: agent,
		runId,
	});

	return response.result as Result;
}

async function agentRefused(runId: string | null, name: string, payload: Record<string, unknown>) {
	try {
		await executeCommand(database.db, handlers, database.services, {
			name,
			body: { payload, idempotencyKey: freshKey(name) },
			actor: agent,
			runId,
		});
	} catch (error) {
		return error as { code: string; status: number; details: Record<string, unknown> };
	}

	throw new Error(`${name} was not refused`);
}

interface Added {
	changeId: string;
	entityId: string | null;
	label: string;
	draftId: string;
	version: number;
}

function drafter(ventureId: string, runId: string) {
	return (command: string, payload: Record<string, unknown>, note = "Asked by the owner") =>
		asAgent<Added>(runId, "draft.add", { ventureId, command, payload, note });
}

async function draftRow(ventureId: string) {
	const [row] = await database.db
		.select()
		.from(proposals)
		.where(and(eq(proposals.ventureId, ventureId), eq(proposals.status, "drafting")));

	return row;
}

const learningObjective = {
	kind: "learning",
	statement: "Will teams pay for braise?",
	decision: "Whether to charge from day one",
	doneRule: "Twenty teams asked for a price",
};

function assumptionOf(objectiveId: unknown, statement = "Teams pay for planning tools") {
	return { objectiveId, statement, impact: "high", function: "sales" };
}

function betOf(assumptionId: unknown, action = "Show a price on the sign-up page") {
	const { ventureId: _ventureId, ...bet } = betPayload("", assumptionId, action);

	return bet;
}

async function planned(ventureId: string, runId: string) {
	const draft = drafter(ventureId, runId);

	const objective = await draft("objective.create", learningObjective);

	const first = await draft("assumption.create", assumptionOf({ change: objective.changeId }));

	const second = await draft("assumption.create", assumptionOf({ change: objective.changeId }, "Teams pay yearly"));

	const bet = await draft("bet.create", betOf({ change: first.changeId }));

	return { draft, objective, first, second, bet };
}

describe("draft.add", () => {
	it("stores a change with a stable entity id, bumps the version, and applies nothing", async () => {
		const venture = await createVenture(database);

		const { runId, sessionId } = await operatorRun(venture.id);

		const draft = drafter(venture.id, runId);

		const objective = await draft("objective.create", learningObjective);

		expect(objective).toMatchObject({ version: 1, label: learningObjective.statement });

		const assumption = await draft("assumption.create", assumptionOf({ change: objective.changeId }));

		expect(assumption.version).toBe(2);

		const stored = await draftRow(venture.id);

		expect(stored).toMatchObject({ status: "drafting", threadId: sessionId, runId, createdBy: agent, version: 2 });

		expect(stored?.changes).toHaveLength(2);

		expect(stored?.changes[1]).toMatchObject({
			command: "assumption.create",
			payload: { objectiveId: { change: objective.changeId } },
			state: "open",
			runId,
			note: "Asked by the owner",
			entityId: assumption.entityId,
		});

		expect(await database.db.select().from(objectives).where(eq(objectives.ventureId, venture.id))).toHaveLength(0);

		const domain = await database.db.select().from(events).where(eq(events.ventureId, venture.id));

		expect(domain.map((event) => event.type)).toEqual(["venture.created"]);
	});

	it("reports a rule error against the new change and stores nothing", async () => {
		const venture = await createVenture(database);

		const { runId } = await operatorRun(venture.id);

		const draft = drafter(venture.id, runId);

		await draft("objective.create", learningObjective);

		const invalid = await agentRefused(runId, "draft.add", {
			ventureId: venture.id,
			command: "bet.create",
			payload: { assumptionId: crypto.randomUUID() },
			note: "x",
		});

		expect(invalid).toMatchObject({ code: "validation_failed", details: { scope: "change" } });

		await draft("objective.create", { ...learningObjective, statement: "Second climb" });

		const limited = await agentRefused(runId, "draft.add", {
			ventureId: venture.id,
			command: "objective.create",
			payload: { ...learningObjective, statement: "A third climb" },
			note: "x",
		});

		expect(limited).toMatchObject({ code: "rule_violated", details: { rule: "objective_limit" } });

		expect(limited.details.change).toEqual(expect.any(String));

		const stored = await draftRow(venture.id);

		expect(stored?.changes).toHaveLength(2);

		expect(stored?.version).toBe(2);
	});

	it("is refused outside the operator chat without filing an access request, and keeps one draft per venture", async () => {
		const venture = await createVenture(database);

		const started = await owner<{ thread: { id: string }; run: { id: string } }>("thread.start", {
			ventureId: venture.id,
			body: "A normal thread",
		});

		await owner("run.cancel", { runId: started.run.id });

		const payload = { ventureId: venture.id, command: "objective.create", payload: learningObjective, note: "x" };

		const before = await database.db.select().from(accessRequests);

		const refused = await agentRefused(started.run.id, "draft.add", payload);

		expect(refused).toMatchObject({ code: "not_in_operator_chat", status: 403 });

		expect(await agentRefused(null, "draft.add", payload)).toMatchObject({ code: "not_in_operator_chat" });

		const other = await createVenture(database);

		const { runId: otherRun } = await operatorRun(other.id);

		expect(await agentRefused(otherRun, "draft.add", payload)).toMatchObject({ code: "not_in_operator_chat" });

		expect(await database.db.select().from(accessRequests)).toHaveLength(before.length);

		const { runId } = await operatorRun(venture.id);

		await drafter(venture.id, runId)("objective.create", learningObjective);

		const second = await operatorRun(venture.id, "Again");

		await drafter(venture.id, second.runId)("objective.create", { ...learningObjective, statement: "Two" });

		const drafts = await database.db
			.select()
			.from(proposals)
			.where(and(eq(proposals.ventureId, venture.id), eq(proposals.status, "drafting")));

		expect(drafts).toHaveLength(1);

		expect(drafts[0]?.changes).toHaveLength(2);

		await expect(
			database.db.execute(sql`
				INSERT INTO proposals (id, venture_id, thread_id, run_id, created_by, title, reason, changes, status)
				SELECT gen_random_uuid(), venture_id, thread_id, run_id, created_by, title, reason, changes, 'drafting'
				FROM proposals WHERE id = ${drafts[0]?.id ?? ""}`),
		).rejects.toMatchObject({ cause: { constraint: "proposals_one_draft" } });
	});

	it("refuses owner-only draft commands from the agent", async () => {
		const venture = await createVenture(database);

		const { runId } = await operatorRun(venture.id);

		const added = await drafter(venture.id, runId)("objective.create", learningObjective);

		const refused = await agentRefused(runId, "draft.keep", { ventureId: venture.id, changeIds: [added.changeId] });

		expect(refused).toMatchObject({ code: "not_granted" });
	});
});

describe("pointers", () => {
	it("resolve each pointer field to its create type and refuse any other", async () => {
		const loop = await createLoop(database);

		const { runId } = await operatorRun(loop.ventureId);

		const { draft, objective, first, bet } = await planned(loop.ventureId, runId);

		const initiative = await draft("work.create", {
			home: { type: "bet", id: { change: bet.changeId } },
			title: "Landing page",
			function: "marketing",
		});

		await draft("work.create", { parentId: { change: initiative.changeId }, title: "Copy" });

		await draft("reading.record", {
			subject: { type: "bet", id: { change: bet.changeId } },
			value: 3,
			takenOn: "2026-12-01",
			source: "Analytics",
		});

		const wrongTarget = async (command: string, payload: Record<string, unknown>) =>
			agentRefused(runId, "draft.add", { ventureId: loop.ventureId, command, payload, note: "x" });

		expect(await wrongTarget("bet.create", betOf({ change: objective.changeId }))).toMatchObject({
			details: { rule: "draft_pointer_invalid", field: "assumptionId", expected: "assumption.create" },
		});

		expect(await wrongTarget("assumption.create", assumptionOf({ change: first.changeId }))).toMatchObject({
			details: { rule: "draft_pointer_invalid", field: "objectiveId" },
		});

		expect(
			await wrongTarget("work.create", {
				home: { type: "objective", id: { change: bet.changeId } },
				title: "x",
				function: "ops",
			}),
		).toMatchObject({ details: { rule: "draft_pointer_invalid", field: "home.id" } });

		expect(await wrongTarget("work.create", { parentId: { change: crypto.randomUUID() }, title: "x" })).toMatchObject(
			{ details: { rule: "draft_pointer_invalid", field: "parentId" } },
		);

		const raw = await draft("work.create", {
			home: { type: "bet", id: bet.entityId },
			title: "Pricing survey",
			function: "sales",
		});

		const stored = await draftRow(loop.ventureId);

		expect(stored?.changes.find((change) => (change as { id?: string }).id === raw.changeId)?.payload).toMatchObject({
			home: { type: "bet", id: { change: bet.changeId } },
		});
	});

	it("refuse updating a drafted row and name the change to revise", async () => {
		const venture = await createVenture(database);

		const { runId } = await operatorRun(venture.id);

		const { bet } = await planned(venture.id, runId);

		for (const betId of [bet.entityId, { change: bet.changeId }]) {
			const refused = await agentRefused(runId, "draft.add", {
				ventureId: venture.id,
				command: "bet.update",
				payload: { betId, passAt: 20 },
				note: "x",
			});

			expect(refused).toMatchObject({ details: { rule: "draft_revise_create", changeId: bet.changeId } });
		}
	});

	it("draft.remove withdraws the change and every change that points at it", async () => {
		const venture = await createVenture(database);

		const { runId } = await operatorRun(venture.id);

		const { objective, second } = await planned(venture.id, runId);

		const removed = await asAgent<{ removed: string[]; open: number }>(runId, "draft.remove", {
			ventureId: venture.id,
			changeId: objective.changeId,
		});

		expect(removed.removed).toHaveLength(4);

		expect(removed.removed).toContain(second.changeId);

		expect(removed.open).toBe(0);

		const [closed] = await database.db.select().from(proposals).where(eq(proposals.id, objective.draftId));

		expect(closed?.status).toBe("rejected");
	});
});

describe("draft.keep", () => {
	it("applies the dependency closure in one transaction and one seq range, keeping the preset ids", async () => {
		const venture = await createVenture(database);

		const { runId } = await operatorRun(venture.id);

		const { draft, objective, first, second, bet } = await planned(venture.id, runId);

		const work = await draft("work.create", {
			home: { type: "bet", id: { change: bet.changeId } },
			title: "Landing page",
			function: "marketing",
		});

		const [before] = await database.db.select().from(ventures).where(eq(ventures.id, venture.id));

		const kept = await owner<{ kept: string[]; open: number }>("draft.keep", {
			ventureId: venture.id,
			changeIds: [work.changeId],
		});

		expect(kept.kept).toEqual([objective.changeId, first.changeId, bet.changeId, work.changeId]);

		expect(kept.open).toBe(1);

		const applied = await database.db
			.select()
			.from(events)
			.where(and(eq(events.ventureId, venture.id), gt(events.seq, before?.lastSeq ?? 0)))
			.orderBy(asc(events.seq));

		expect(applied.map((event) => event.type)).toEqual([
			"draft.kept",
			"objective.created",
			"assumption.created",
			"bet.created",
			"work.created",
		]);

		expect(new Set(applied.map((event) => event.commandId)).size).toBe(1);

		expect(applied.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5].map((n) => (before?.lastSeq ?? 0) + n));

		expect(applied.slice(1).map((event) => event.payload.changeId)).toEqual(kept.kept);

		expect(applied.every((event) => event.payload.proposalId === objective.draftId)).toBe(true);

		const [realBet] = await database.db
			.select()
			.from(bets)
			.where(eq(bets.id, bet.entityId ?? ""));

		expect(realBet).toMatchObject({ assumptionId: first.entityId, action: "Show a price on the sign-up page" });

		const [item] = await database.db
			.select()
			.from(workItems)
			.where(eq(workItems.id, work.entityId ?? ""));

		expect(item?.betId).toBe(bet.entityId);

		const stored = await draftRow(venture.id);

		const open = stored?.changes.find((change) => (change as { id?: string }).id === second.changeId);

		expect(open?.payload.objectiveId).toBe(objective.entityId);

		await owner("draft.keep", { ventureId: venture.id, changeIds: [second.changeId] });

		expect(await draftRow(venture.id)).toBeUndefined();

		const [closed] = await database.db.select().from(proposals).where(eq(proposals.id, objective.draftId));

		expect(closed).toMatchObject({ status: "approved" });

		expect(closed?.decidedAt).not.toBeNull();
	});

	it("records the note as the reason and posts a braise line when the draft closes", async () => {
		const venture = await createVenture(database);

		const { runId, sessionId } = await operatorRun(venture.id);

		const revised = await drafter(venture.id, runId)(
			"strategy.revise",
			{ why: "Because it matters", what: "One sentence", diagnosis: "", guidingPolicy: "" },
			"Tightened the what",
		);

		await owner("draft.keep", { ventureId: venture.id, changeIds: [revised.changeId] });

		const cockpit = await read<Cockpit>(`/ventures/${venture.slug}`);

		expect(cockpit.strategy).toMatchObject({ version: 2, what: "One sentence", reason: "Tightened the what" });

		const thread = await read<ThreadDetail>(`/threads/${sessionId}`);

		expect(thread.messages.at(-1)).toMatchObject({ author: "braise", body: "Draft kept · 1 change" });
	});

	it("refuses a stale change and lists it as failed in the draft view", async () => {
		const loop = await createLoop(database);

		const { runId } = await operatorRun(loop.ventureId);

		const draft = drafter(loop.ventureId, runId);

		const edit = await draft("bet.update", { betId: loop.bet.id, passAt: 20 }, "Lower the bar");

		await owner("bet.update", { ventureId: loop.ventureId, betId: loop.bet.id, action: "By hand" });

		const refused = await ownerRefused("draft.keep", { ventureId: loop.ventureId, changeIds: [edit.changeId] });

		expect(refused).toMatchObject({ status: 422, rule: "proposal_stale" });

		const view = await read<Cockpit & { draft: DraftSummary }>(`/ventures/${loop.slug}?draft=current`);

		expect(view.draft.changes[0]).toMatchObject({ id: edit.changeId, stale: "The bet changed since" });

		expect(view.bets.find((bet) => bet.id === loop.bet.id)?.passAt).toBe(30);

		await asAgent(runId, "draft.revise", {
			ventureId: loop.ventureId,
			changeId: edit.changeId,
			payload: { betId: loop.bet.id, passAt: 20 },
		});

		const fresh = await read<Cockpit & { draft: DraftSummary }>(`/ventures/${loop.slug}?draft=current`);

		expect(fresh.draft.changes[0]?.stale).toBeNull();

		expect(fresh.bets.find((bet) => bet.id === loop.bet.id)?.passAt).toBe(20);
	});

	it("resolves a pointer to a change kept mid-run to the real id", async () => {
		const venture = await createVenture(database);

		const { runId } = await operatorRun(venture.id);

		const draft = drafter(venture.id, runId);

		const objective = await draft("objective.create", learningObjective);

		await owner("draft.keep", { ventureId: venture.id, changeIds: [objective.changeId] });

		const assumption = await draft("assumption.create", assumptionOf({ change: objective.changeId }));

		const stored = await draftRow(venture.id);

		expect(stored?.changes.at(-1)?.payload.objectiveId).toBe(objective.entityId);

		await owner("draft.keep", { ventureId: venture.id, changeIds: [assumption.changeId] });

		const [real] = await database.db
			.select()
			.from(assumptions)
			.where(eq(assumptions.id, assumption.entityId ?? ""));

		expect(real?.objectiveId).toBe(objective.entityId);
	});
});

describe("draft.drop and draft.discard", () => {
	it("drop the changes that depend on the dropped ones", async () => {
		const venture = await createVenture(database);

		const { runId } = await operatorRun(venture.id);

		const { first, second, bet } = await planned(venture.id, runId);

		const dropped = await owner<{ dropped: string[]; open: number }>("draft.drop", {
			ventureId: venture.id,
			changeIds: [first.changeId],
		});

		expect(dropped.dropped.toSorted()).toEqual([first.changeId, bet.changeId].toSorted());

		expect(dropped.open).toBe(2);

		const discarded = await owner<{ dropped: string[]; open: number; status: string }>("draft.discard", {
			ventureId: venture.id,
		});

		expect(discarded.dropped).toContain(second.changeId);

		expect(discarded).toMatchObject({ open: 0, status: "rejected" });

		const domain = await database.db
			.select({ type: events.type })
			.from(events)
			.where(eq(events.ventureId, venture.id));

		expect(domain.map((event) => event.type)).toEqual(["venture.created", "draft.dropped", "draft.dropped"]);
	});
});

describe("the draft view", () => {
	it("projects the cockpit and work tree as applying would, with marks, and leaves the tables alone", async () => {
		const loop = await createLoop(database);

		const initiative = await owner<{ id: string }>("work.create", {
			ventureId: loop.ventureId,
			home: { type: "bet", id: loop.bet.id },
			title: "Old onboarding",
			function: "product",
		});

		const second = await owner<{ id: string }>("work.create", {
			ventureId: loop.ventureId,
			home: { type: "bet", id: loop.bet.id },
			title: "Second",
			function: "product",
		});

		const { runId } = await operatorRun(loop.ventureId);

		const draft = drafter(loop.ventureId, runId);

		const renamed = await draft("venture.update", { name: "Kiln" });

		const edited = await draft("bet.update", { betId: loop.bet.id, deadline: "2027-02-01" });

		expect(edited.label).toBe("B1");

		const created = await draft("assumption.create", assumptionOf(loop.objective.id, "A new one"));

		const moved = await draft("work.move", { workItemId: second.id, index: 0 });

		const status = await draft("work.set_status", { workItemId: second.id, status: "doing" });

		const archived = await draft("work.archive", { workItemId: initiative.id });

		const before = await database.db.select().from(workItems).where(eq(workItems.ventureId, loop.ventureId));

		const view = await read<Cockpit & { draft: DraftSummary }>(`/ventures/${loop.slug}?draft=current`);

		const work = await read<VentureWork & { draft: DraftSummary }>(`/ventures/${loop.slug}/work?draft=current`);

		expect(view.venture.name).toBe("Kiln");

		expect(view.venture.slug).toBe(loop.slug);

		expect(view.bets.find((bet) => bet.id === loop.bet.id)?.deadline).toBe("2027-02-01");

		expect(view.assumptions.map((assumption) => assumption.id)).toContain(created.entityId);

		const marks = view.draft.marks;

		expect(marks[loop.ventureId]).toMatchObject({
			changeIds: [renamed.changeId],
			fields: { name: expect.any(String) },
		});

		expect(marks[loop.bet.id]).toMatchObject({ fields: { deadline: "2026-12-31" }, created: false });

		expect(marks[created.entityId ?? ""]).toMatchObject({ created: true });

		expect(marks[second.id]).toMatchObject({
			changeIds: [moved.changeId, status.changeId],
			moved: { from: 1 },
			status: { from: "todo", to: "doing" },
		});

		expect(marks[initiative.id]).toMatchObject({ archived: true, changeIds: [archived.changeId] });

		expect(work.workItems.find((item) => item.id === initiative.id)?.archivedAt).not.toBeNull();

		expect(work.workItems.find((item) => item.id === second.id)).toMatchObject({ position: 0, status: "doing" });

		expect(work.draft.changes.map((change) => change.label)).toEqual([
			"Kiln",
			"B1",
			"A new one",
			"Second",
			"Second",
			"Old onboarding",
		]);

		expect(work.draft.changes.map((change) => change.view)).toEqual([
			"overview",
			"strategy",
			"strategy",
			"work",
			"work",
			"work",
		]);

		const after = await database.db.select().from(workItems).where(eq(workItems.ventureId, loop.ventureId));

		expect(after).toEqual(before);

		const [venture] = await database.db.select().from(ventures).where(eq(ventures.id, loop.ventureId));

		expect(venture?.name).not.toBe("Kiln");

		const plain = await read<Cockpit & { draft: null }>(`/ventures/${loop.slug}`);

		expect(plain.draft).toBeNull();

		expect(plain.assumptions.map((assumption) => assumption.id)).not.toContain(created.entityId);

		await owner("draft.keep", {
			ventureId: loop.ventureId,
			changeIds: work.draft.changes.map((change) => change.id),
		});

		const applied = await read<VentureWork>(`/ventures/${loop.slug}/work`);

		const strip = (items: VentureWork["workItems"]) =>
			items.map(({ id, position, status: itemStatus, betId }) => ({ id, position, status: itemStatus, betId }));

		expect(strip(applied.workItems)).toEqual(strip(work.workItems.filter((item) => item.archivedAt === null)));
	});

	it("is cached by draft version and last_seq", async () => {
		const loop = await createLoop(database);

		const { runId } = await operatorRun(loop.ventureId);

		const draft = drafter(loop.ventureId, runId);

		await draft("assumption.create", assumptionOf(loop.objective.id, "First"));

		const path = `/ventures/${loop.slug}/draft`;

		await read(path);

		const replays = draftViewStats.replays;

		await read(path);

		await read(`/ventures/${loop.slug}?draft=current`);

		expect(draftViewStats.replays).toBe(replays);

		await draft("assumption.create", assumptionOf(loop.objective.id, "Second"));

		const grown = await read<{ draft: DraftSummary }>(path);

		expect(draftViewStats.replays).toBe(replays + 1);

		expect(grown.draft.changes).toHaveLength(2);

		await createAssumption(database, loop.ventureId, loop.objective.id, "By hand");

		await read(path);

		expect(draftViewStats.replays).toBe(replays + 2);
	});

	it("serves the draft without one and with stale ones failed", async () => {
		const venture = await createVenture(database);

		expect(await read<{ draft: null }>(`/ventures/${venture.slug}/draft`)).toEqual({ draft: null });

		const work = await read<VentureWork & { draft: null }>(`/ventures/${venture.slug}/work?draft=current`);

		expect(work.draft).toBeNull();
	});
});

describe("venture.update", () => {
	it("changes the name and kind, never the slug", async () => {
		const venture = await createVenture(database);

		await owner("venture.update", { ventureId: venture.id, name: "Kiln", kind: "non_profit" });

		const [row] = await database.db.select().from(ventures).where(eq(ventures.id, venture.id));

		expect(row).toMatchObject({ name: "Kiln", kind: "non_profit", slug: venture.slug });

		expect(await ownerRefused("venture.update", { ventureId: venture.id, slug: "other" })).toMatchObject({
			code: "validation_failed",
		});

		expect(await ownerRefused("venture.update", { ventureId: venture.id, name: "Kiln" })).toMatchObject({
			rule: "no_changes",
		});
	});
});

describe("sessions", () => {
	it("operator.open reuses the open session, replaces an idle one, and never leaves two open", async () => {
		const venture = await createVenture(database);

		const first = await owner<Session>("operator.open", { ventureId: venture.id });

		expect(first).toMatchObject({ opened: true, session: { operatorVentureId: venture.id } });

		const again = await owner<Session>("operator.open", { ventureId: venture.id });

		expect(again).toMatchObject({ opened: false, session: { id: first.session.id } });

		await owner("thread.post", { threadId: first.session.id, body: "Hello" });

		await database.db
			.update(threadMessages)
			.set({ createdAt: sql`now() - interval '5 hours'` })
			.where(eq(threadMessages.threadId, first.session.id));

		await database.db.execute(
			sql`UPDATE runs SET status = 'cancelled', finished_at = now() WHERE thread_id = ${first.session.id}`,
		);

		const replaced = await owner<Session>("operator.open", { ventureId: venture.id });

		expect(replaced.opened).toBe(true);

		expect(replaced.session.id).not.toBe(first.session.id);

		const [old] = await database.db.select().from(threads).where(eq(threads.id, first.session.id));

		expect(old?.archivedAt).not.toBeNull();

		const fresh = await owner<Session>("operator.new_session", { ventureId: venture.id });

		const open = await database.db
			.select()
			.from(threads)
			.where(and(eq(threads.operatorVentureId, venture.id), isNull(threads.archivedAt)));

		expect(open.map((thread) => thread.id)).toEqual([fresh.session.id]);

		const state = await read<{ session: { id: string }; sessions: { id: string }[] }>(
			`/ventures/${venture.slug}/operator`,
		);

		expect(state.session.id).toBe(fresh.session.id);

		expect(state.sessions).toHaveLength(3);

		const listed = await read<{ threads: { id: string }[] }>(`/threads?ventureId=${venture.id}`);

		expect(listed.threads).toHaveLength(0);
	});

	it("a post to an idle session starts a fresh one, and a run's context holds only its session's messages", async () => {
		const venture = await createVenture(database);

		const { sessionId, runId } = await operatorRun(venture.id, "Old message");

		await database.db
			.update(threadMessages)
			.set({ createdAt: sql`now() - interval '5 hours'` })
			.where(eq(threadMessages.threadId, sessionId));

		const posted = await owner<{ run: { id: string; threadId: string }; session: { id: string } }>("thread.post", {
			threadId: sessionId,
			body: "Fresh message",
		});

		expect(posted.session.id).not.toBe(sessionId);

		expect(posted.run.threadId).toBe(posted.session.id);

		const run = { id: posted.run.id, threadId: posted.session.id, actor: agent, retryOf: null };

		const [message] = await database.db
			.select({ id: threadMessages.id })
			.from(threadMessages)
			.where(eq(threadMessages.threadId, posted.session.id));

		const context = await loadRunContext(database.db, { ...run, messageId: message?.id ?? "" });

		expect(context.transcript).toEqual([]);

		expect(context.message).toBe("Fresh message");

		expect(runId).not.toBe(posted.run.id);
	});

	it("queues operator runs with chat priority", async () => {
		const venture = await createVenture(database);

		const seen: HubMessage[] = [];
		const stop = database.subscribe((message) => seen.push(message));

		const { runId } = await operatorRun(venture.id);

		stop();

		const [job] = await database.db
			.execute<{ priority: number }>(sql`SELECT priority FROM pgboss.job WHERE data->>'runId' = ${runId}`)
			.then((result) => result.rows);

		expect(job?.priority).toBe(1);
	});
});

describe("readings", () => {
	it("keeps a reading drafted on a real objective", async () => {
		const venture = await createVenture(database);

		const objective = await createMetricObjective(database, venture.id);

		const { runId } = await operatorRun(venture.id);

		const reading = await drafter(venture.id, runId)("reading.record", {
			subject: { type: "objective", id: objective.id },
			value: 12,
			takenOn: "2026-12-01",
			source: "Sheet",
		});

		expect(reading.label).toBe("Reading of A number moves");

		await owner("draft.keep", { ventureId: venture.id, changeIds: [reading.changeId] });

		const cockpit = await read<Cockpit>(`/ventures/${venture.slug}`);

		expect(cockpit.readings.map((row) => row.id)).toEqual([reading.entityId]);
	});
});
