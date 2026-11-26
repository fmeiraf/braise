import type { Assumption, Bet, Cockpit, Learning, Objective } from "@braise/core";
import { afterAll, describe, expect, it } from "vitest";
import { seedExample } from "../src/seed.ts";
import {
	betPayload,
	createAssumption,
	createBuildObjective,
	createLoop,
	createMetricObjective,
	createVenture,
	freshKey,
	openTestDatabase,
	recordReading,
} from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

async function send<Result>(name: string, payload: Record<string, unknown>, reason?: string) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name), reason });

	const body = (await response.json()) as {
		result: Result;
		error?: { code: string; details: Record<string, unknown> };
	};

	return {
		status: response.status,
		result: body.result,
		rule: body.error?.details.rule,
		details: body.error?.details,
	};
}

async function ok<Result>(name: string, payload: Record<string, unknown>, reason?: string) {
	const sent = await send<Result>(name, payload, reason);

	expect(sent.status, JSON.stringify(sent)).toBe(200);

	return sent.result;
}

async function cockpitOf(slug: string) {
	const response = await database.app.request(`/api/ventures/${slug}`);

	return (await response.json()) as Cockpit;
}

interface Closed {
	bet: Bet;
	learning: Learning;
	assumption: Assumption;
}

describe("objectives", () => {
	it("climbs at most two metric or learning objectives at once, and any number of build ones", async () => {
		const venture = await createVenture(database);

		await createMetricObjective(database, venture.id, "First");

		const second = await createMetricObjective(database, venture.id, "Second");

		const third = await send("objective.create", {
			ventureId: venture.id,
			kind: "learning",
			statement: "A third hill?",
			decision: "d",
			doneRule: "r",
		});

		expect(third).toMatchObject({ status: 422, rule: "objective_limit" });

		for (const name of ["One", "Two", "Three"]) await createBuildObjective(database, venture.id, name);

		await ok("objective.close", { ventureId: venture.id, objectiveId: second.id, status: "dropped" });

		const afterClosing = await send("objective.create", {
			ventureId: venture.id,
			kind: "learning",
			statement: "Now there is room",
			decision: "d",
			doneRule: "r",
		});

		expect(afterClosing.status).toBe(200);
	});

	it("keeps each kind to its own fields and its date", async () => {
		const venture = await createVenture(database);

		const build = await createBuildObjective(database, venture.id);

		const base = { ventureId: venture.id, objectiveId: build.id };

		expect(await send("objective.update", { ...base, target: 5 })).toMatchObject({ rule: "field_not_for_kind" });

		expect(await send("objective.update", { ...base, byDate: null })).toMatchObject({ rule: "by_date_required" });

		const noDate = await send("objective.create", {
			ventureId: venture.id,
			kind: "build",
			statement: "No time box",
			doneList: ["x"],
		});

		expect(noDate.status).toBe(400);

		const metric = await createMetricObjective(database, venture.id);

		expect(
			await send("objective.update", { ventureId: venture.id, objectiveId: metric.id, target: 10 }),
		).toMatchObject({ rule: "target_equals_baseline" });
	});

	it("ticks and rewrites a build objective's done list, keeping ticks by id", async () => {
		const venture = await createVenture(database);

		const created = (await createBuildObjective(database, venture.id)) as Objective;

		const base = { ventureId: venture.id, objectiveId: created.id };
		const [first] = created.doneList;

		const ticked = await ok<Objective>("objective.check", { ...base, itemId: first?.id, done: true });

		expect(ticked.doneList).toEqual([{ id: first?.id, text: "It works", done: true }]);

		expect(await send("objective.check", { ...base, itemId: first?.id, done: true })).toMatchObject({
			rule: "no_changes",
		});

		const rewritten = await ok<Objective>("objective.update", {
			...base,
			doneList: [{ id: first?.id, text: "It works on a phone" }, { text: "Someone used it" }],
		});

		expect(rewritten.doneList.map((item) => [item.text, item.done])).toEqual([
			["It works on a phone", true],
			["Someone used it", false],
		]);

		expect(
			await send("objective.update", { ...base, doneList: [{ id: crypto.randomUUID(), text: "Ghost" }] }),
		).toMatchObject({ rule: "done_item_unknown" });
	});

	it("can't close over open bets, and takes no changes once closed", async () => {
		const { ventureId, objective, bet } = await createLoop(database);

		const base = { ventureId, objectiveId: objective.id };

		expect(await send("objective.close", { ...base, status: "met" })).toMatchObject({
			rule: "objective_has_open_bets",
		});

		await ok("bet.close", { ventureId, betId: bet.id, result: "inconclusive", statement: "Ran out of time" });

		const closed = await ok<Objective>("objective.close", { ...base, status: "met" });

		expect(closed).toMatchObject({ status: "met" });
		expect(closed.closedAt).not.toBeNull();

		expect(await send("objective.update", { ...base, statement: "Too late" })).toMatchObject({
			rule: "objective_closed",
		});
	});
});

describe("assumptions", () => {
	it("attach to metric and learning objectives only, or wait as hunches", async () => {
		const venture = await createVenture(database);

		const build = await createBuildObjective(database, venture.id);

		const metric = await createMetricObjective(database, venture.id);

		const underBuild = await send("assumption.create", {
			ventureId: venture.id,
			objectiveId: build.id,
			statement: "s",
			function: "ops",
		});

		expect(underBuild).toMatchObject({ status: 422, rule: "objective_not_climbing" });

		const hunch = await createAssumption(database, venture.id, null, "A hunch");

		expect(await send("bet.create", betPayload(venture.id, hunch.id))).toMatchObject({
			rule: "assumption_not_attached",
		});

		const attached = await ok<Assumption>("assumption.update", {
			ventureId: venture.id,
			assumptionId: hunch.id,
			objectiveId: metric.id,
		});

		expect(attached).toMatchObject({ objectiveId: metric.id, confidence: 1, status: "open" });

		expect((await send("bet.create", betPayload(venture.id, hunch.id))).status).toBe(200);
	});

	it("can't be moved, settled or archived from under an open bet", async () => {
		const { ventureId, assumption } = await createLoop(database);

		const base = { ventureId, assumptionId: assumption.id };

		expect(await send("assumption.update", { ...base, objectiveId: null })).toMatchObject({
			rule: "assumption_has_open_bets",
		});

		expect(await send("assumption.update", { ...base, status: "dropped" })).toMatchObject({
			rule: "assumption_has_open_bets",
		});

		expect(await send("assumption.archive", base)).toMatchObject({ rule: "assumption_has_bets" });

		expect((await send("assumption.update", { ...base, impact: "high" })).status).toBe(200);
	});
});

describe("bets and readings", () => {
	it("needs a reason to change the marks of a registered bet", async () => {
		const { ventureId, bet } = await createLoop(database);

		const base = { ventureId, betId: bet.id };

		expect((await send("bet.update", { ...base, action: "Reworded" })).status).toBe(200);

		expect(await send("bet.update", { ...base, passAt: 20 })).toMatchObject({
			status: 422,
			rule: "reason_required",
			details: { fields: ["passAt"] },
		});

		const moved = await ok<Bet>("bet.update", { ...base, passAt: 20 }, "The shop closes Mondays");

		expect(moved.passAt).toBe(20);

		expect(await send("bet.update", { ...base, failAt: 20 }, "x")).toMatchObject({ rule: "marks_equal" });
	});

	it("passes only on a reading at the pass mark, and earns what the method can show", async () => {
		const { ventureId, slug, bet, assumption } = await createLoop(database);

		const close = { ventureId, betId: bet.id, result: "pass", statement: "It worked" };

		expect(await send("bet.close", close)).toMatchObject({ rule: "bet_not_passed" });

		await recordReading(database, ventureId, bet.id, 21);

		expect(await send("bet.close", close)).toMatchObject({ rule: "bet_not_passed", details: { reading: 21 } });

		await ok("reading.record", {
			ventureId,
			subject: { type: "bet", id: bet.id },
			value: 34,
			takenOn: "2026-12-08",
			source: "Order sheet",
		});

		expect(await send("bet.close", { ...close, confidenceTo: 4 })).toMatchObject({
			rule: "confidence_out_of_range",
			details: { min: 1, max: 3 },
		});

		const closed = await ok<Closed>("bet.close", close);

		expect(closed.bet.status).toBe("closed");

		expect(closed.learning).toMatchObject({
			result: "pass",
			cause: null,
			value: 34,
			confidenceFrom: 1,
			confidenceTo: 3,
			assumptionId: assumption.id,
		});

		expect(closed.assumption.confidence).toBe(3);

		const cockpit = await cockpitOf(slug);

		expect(cockpit.learnings.map((learning) => learning.statement)).toEqual(["It worked"]);
		expect(cockpit.readings.map((reading) => reading.value)).toEqual([21, 34]);

		expect(await send("bet.close", close)).toMatchObject({ rule: "bet_not_open" });

		expect(
			await send("reading.record", {
				ventureId,
				subject: { type: "bet", id: bet.id },
				value: 1,
				takenOn: "2026-12-09",
				source: "Late",
			}),
		).toMatchObject({ rule: "bet_not_open" });
	});

	it("lowers confidence only when the idea was wrong, and marks the assumption false at zero", async () => {
		const { ventureId, bet, assumption } = await createLoop(database);

		const fail = { ventureId, betId: bet.id, result: "fail", statement: "Nobody ordered" };

		expect((await send("bet.close", fail)).status).toBe(400);

		await recordReading(database, ventureId, bet.id, 20);

		expect(await send("bet.close", { ...fail, cause: "idea" })).toMatchObject({ rule: "bet_not_failed" });

		const execution = await ok<Closed>("bet.close", {
			...fail,
			cause: "execution",
			statement: "Flyers never printed",
		});

		expect(execution.learning).toMatchObject({ confidenceFrom: 1, confidenceTo: 1, cause: "execution" });

		const again = await ok<Bet>("bet.create", betPayload(ventureId, assumption.id, "Run it again"));

		await recordReading(database, ventureId, again.id, 4);

		const refuted = await ok<Closed>("bet.close", { ...fail, betId: again.id, cause: "idea" });

		expect(refuted.learning).toMatchObject({ confidenceFrom: 1, confidenceTo: 0 });
		expect(refuted.assumption).toMatchObject({ confidence: 0, status: "false" });

		expect(await send("bet.create", betPayload(ventureId, assumption.id))).toMatchObject({
			rule: "assumption_not_open",
		});
	});

	it("takes readings for metric objectives only", async () => {
		const venture = await createVenture(database);

		const metric = await createMetricObjective(database, venture.id);

		const build = await createBuildObjective(database, venture.id);

		const reading = { ventureId: venture.id, value: 12, takenOn: "2026-12-01", source: "Order sheet" };

		expect((await send("reading.record", { ...reading, subject: { type: "objective", id: metric.id } })).status).toBe(
			200,
		);

		expect(await send("reading.record", { ...reading, subject: { type: "objective", id: build.id } })).toMatchObject({
			rule: "reading_needs_metric",
		});
	});
});

describe("the example seed", () => {
	it("runs through the pipeline, and running it again changes nothing", async () => {
		const seeded = await seedExample(database.db);

		const first = await cockpitOf(seeded.slug);

		await seedExample(database.db);

		const second = await cockpitOf(seeded.slug);

		expect(second.venture.lastSeq).toBe(first.venture.lastSeq);

		expect(first.objectives.map((objective) => objective.kind)).toEqual(["metric", "build", "learning"]);

		expect(first.bets.map((bet) => bet.status)).toEqual(["closed", "open", "open"]);

		expect(first.learnings).toHaveLength(1);

		expect(first.assumptions.filter((assumption) => assumption.objectiveId === null)).toHaveLength(1);

		expect(Object.keys(first.workProgress).toSorted()).toEqual(
			[
				`bet:${first.bets[1]?.id}`,
				`bet:${first.bets[2]?.id}`,
				`objective:${first.objectives[1]?.id}`,
				"upkeep",
			].toSorted(),
		);
	});
});
