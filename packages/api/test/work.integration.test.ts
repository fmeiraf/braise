import type { VentureWork } from "@braise/core";
import { afterAll, describe, expect, it } from "vitest";
import { createVenture, freshKey, openTestDatabase } from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

async function send(name: string, payload: Record<string, unknown>) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name) });

	return {
		status: response.status,
		body: (await response.json()) as { result: { id: string; function: string }; error?: object },
	};
}

async function created(name: string, payload: Record<string, unknown>) {
	const sent = await send(name, payload);

	expect(sent.status, JSON.stringify(sent.body)).toBe(200);

	return sent.body.result;
}

async function ventureWithGoal() {
	const venture = await createVenture(database);

	const goal = await created("goal.create", {
		ventureId: venture.id,
		betId: null,
		outcome: "An outcome",
		signal: "A signal",
		horizon: null,
	});

	return { ventureId: venture.id, slug: venture.slug, goalId: goal.id };
}

async function livePositions(slug: string, goalId: string) {
	const response = await database.app.request(`/api/ventures/${slug}/work`);

	const work = (await response.json()) as VentureWork;

	return work.workItems
		.filter((item) => item.goalId === goalId && item.parentId === null)
		.toSorted((a, b) => a.position - b.position)
		.map((item) => `${item.position}:${item.title}`);
}

describe("work item rules", () => {
	it("needs exactly one of goal or parent, and a function on initiatives", async () => {
		const { ventureId, goalId } = await ventureWithGoal();

		const root = await created("work.create", { ventureId, goalId, title: "Root", function: "ops" });

		const both = await send("work.create", { ventureId, goalId, parentId: root.id, title: "X", function: "ops" });

		const neither = await send("work.create", { ventureId, title: "X", function: "ops" });

		const noFunction = await send("work.create", { ventureId, goalId, title: "X" });

		expect([both.status, neither.status, noFunction.status]).toEqual([400, 400, 400]);

		const child = await created("work.create", { ventureId, parentId: root.id, title: "Child" });

		const overridden = await created("work.create", {
			ventureId,
			parentId: root.id,
			title: "Child",
			function: "sales",
		});

		expect([child.function, overridden.function]).toEqual(["ops", "sales"]);
	});

	it("refuses goals and parents from another venture, and children of archived items", async () => {
		const own = await ventureWithGoal();

		const other = await ventureWithGoal();

		const foreignGoal = await send("work.create", {
			ventureId: own.ventureId,
			goalId: other.goalId,
			title: "X",
			function: "ops",
		});

		const foreignRoot = await created("work.create", {
			ventureId: other.ventureId,
			goalId: other.goalId,
			title: "Theirs",
			function: "ops",
		});

		const foreignParent = await send("work.create", {
			ventureId: own.ventureId,
			parentId: foreignRoot.id,
			title: "X",
		});

		await created("work.archive", { ventureId: other.ventureId, workItemId: foreignRoot.id });

		const underArchived = await send("work.create", {
			ventureId: other.ventureId,
			parentId: foreignRoot.id,
			title: "X",
		});

		expect(foreignGoal).toMatchObject({ status: 422, body: { error: { details: { rule: "goal_not_in_venture" } } } });

		expect(foreignParent).toMatchObject({
			status: 422,
			body: { error: { details: { rule: "parent_not_in_venture" } } },
		});

		expect(underArchived).toMatchObject({ status: 422, body: { error: { details: { rule: "work_archived" } } } });
	});

	it("keeps sibling positions dense through create, move and archive", async () => {
		const { ventureId, slug, goalId } = await ventureWithGoal();

		const ids: string[] = [];

		for (const title of ["a", "b", "c", "d"]) {
			ids.push((await created("work.create", { ventureId, goalId, title, function: "product" })).id);
		}

		expect(await livePositions(slug, goalId)).toEqual(["0:a", "1:b", "2:c", "3:d"]);

		await created("work.move", { ventureId, workItemId: ids[3], index: 1 });

		expect(await livePositions(slug, goalId)).toEqual(["0:a", "1:d", "2:b", "3:c"]);

		await created("work.archive", { ventureId, workItemId: ids[0] });

		expect(await livePositions(slug, goalId)).toEqual(["0:d", "1:b", "2:c"]);

		const outOfRange = await send("work.move", { ventureId, workItemId: ids[1], index: 3 });

		const unchanged = await send("work.move", { ventureId, workItemId: ids[1], index: 1 });

		expect(outOfRange).toMatchObject({ status: 422, body: { error: { details: { rule: "index_out_of_range" } } } });
		expect(unchanged).toMatchObject({ status: 422, body: { error: { details: { rule: "no_changes" } } } });
	});

	it("only moves initiatives between goals", async () => {
		const { ventureId, goalId } = await ventureWithGoal();

		const root = await created("work.create", { ventureId, goalId, title: "Root", function: "ops" });

		const child = await created("work.create", { ventureId, parentId: root.id, title: "Child" });

		const refused = await send("work.move", { ventureId, workItemId: child.id, goalId, index: 0 });

		expect(refused).toMatchObject({ status: 422, body: { error: { details: { rule: "goal_on_child" } } } });
	});
});
