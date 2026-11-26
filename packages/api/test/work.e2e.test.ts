import type { Cockpit, HoldingWork, VentureWork, WorkItem } from "@braise/core";
import { afterAll, describe, expect, it } from "vitest";
import { createBuildObjective, createLoop, freshKey, openTestDatabase } from "./database.test-utils.ts";

const database = await openTestDatabase();

afterAll(() => database.close());

async function send<Result>(name: string, payload: Record<string, unknown>) {
	const response = await database.post(name, { payload, idempotencyKey: freshKey(name) });

	return { status: response.status, body: (await response.json()) as { result: Result; error?: { details: object } } };
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

function rootTitles(work: VentureWork, betId: string) {
	return work.workItems
		.filter((item) => item.betId === betId && item.parentId === null)
		.toSorted((a, b) => a.position - b.position)
		.map((item) => item.title);
}

describe("slice 2 demo scenario over HTTP", () => {
	it("builds a work tree under a bet, tracks progress, reorders, moves and archives", async () => {
		const { venture, ventureId, bet } = await createLoop(database);

		const build = await createBuildObjective(database, ventureId, "The page exists");

		const betHome = { type: "bet", id: bet.id };
		const buildHome = { type: "objective", id: build.id };

		const initiative = await ok<WorkItem>("work.create", {
			ventureId,
			home: betHome,
			title: "Initiative",
			function: "engineering",
		});

		const task = await ok<WorkItem>("work.create", { ventureId, parentId: initiative.id, title: "Task" });

		const subtask = await ok<WorkItem>("work.create", { ventureId, parentId: task.id, title: "Subtask" });

		expect([initiative.depth, task.depth, subtask.depth]).toEqual([0, 1, 2]);
		expect([task.function, subtask.function, subtask.betId]).toEqual(["engineering", "engineering", bet.id]);

		const tooDeep = await send("work.create", { ventureId, parentId: subtask.id, title: "Fourth level" });

		expect(tooDeep).toMatchObject({ status: 422, body: { error: { details: { rule: "depth_exceeded" } } } });

		await ok("work.set_status", { ventureId, workItemId: subtask.id, status: "doing" });

		await ok("work.set_status", { ventureId, workItemId: subtask.id, status: "done" });

		const cockpit = await read<Cockpit>(`/ventures/${venture.slug}`);

		expect(cockpit.workProgress[`bet:${bet.id}`]).toEqual({ done: 1, total: 3 });

		const edited = await ok<WorkItem>("work.update", {
			ventureId,
			workItemId: task.id,
			title: "Task, renamed",
			description: "What done looks like",
			priority: "high",
			function: "design",
		});

		expect(edited).toMatchObject({ title: "Task, renamed", priority: "high", function: "design" });

		const second = await ok<WorkItem>("work.create", {
			ventureId,
			home: betHome,
			title: "Second initiative",
			function: "marketing",
		});

		expect(second.position).toBe(1);

		await ok("work.move", { ventureId, workItemId: second.id, index: 0 });

		expect(rootTitles(await read<VentureWork>(`/ventures/${venture.slug}/work`), bet.id)).toEqual([
			"Second initiative",
			"Initiative",
		]);

		await ok("work.move", { ventureId, workItemId: initiative.id, home: buildHome, index: 0 });

		const moved = await read<VentureWork>(`/ventures/${venture.slug}/work`);

		expect(moved.workItems.filter((item) => item.objectiveId === build.id).map((item) => item.title)).toEqual([
			"Initiative",
			"Task, renamed",
			"Subtask",
		]);

		expect(moved.workItems.find((item) => item.id === second.id)?.position).toBe(0);

		const refused = await send("objective.archive", { ventureId, objectiveId: build.id });

		expect(refused).toMatchObject({ status: 422, body: { error: { details: { rule: "objective_has_work" } } } });

		const archived = await ok<{ archivedIds: string[] }>("work.archive", { ventureId, workItemId: initiative.id });

		expect(archived.archivedIds.toSorted()).toEqual([initiative.id, task.id, subtask.id].toSorted());

		await ok("objective.archive", { ventureId, objectiveId: build.id });

		const holding = await read<HoldingWork>("/work");

		expect(holding.ventures.map((row) => row.id)).toContain(ventureId);

		expect(holding.workItems.filter((item) => item.ventureId === ventureId).map((item) => item.title)).toEqual([
			"Second initiative",
		]);

		const activity = await read<{ events: { type: string; actor: string }[] }>(`/ventures/${venture.slug}/events`);

		expect(activity.events.filter((event) => event.type.startsWith("work.")).map((event) => event.type)).toEqual([
			"work.archived",
			"work.moved",
			"work.moved",
			"work.created",
			"work.updated",
			"work.status_set",
			"work.status_set",
			"work.created",
			"work.created",
			"work.created",
		]);

		expect(new Set(activity.events.map((event) => event.actor))).toEqual(new Set(["owner"]));
	});
});
