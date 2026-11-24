import type { WorkItem } from "@braise/core";
import { describe, expect, it } from "vitest";
import { buildForest, goalProgress, visibleRows } from "./work-tree.ts";

function item(id: string, fields: Partial<WorkItem>) {
	return {
		id,
		ventureId: "venture",
		goalId: "goal-a",
		parentId: null,
		depth: 0,
		position: 0,
		title: id,
		description: "",
		status: "todo",
		function: "engineering",
		priority: "none",
		createdAt: "2026-11-24T00:00:00Z",
		updatedAt: "2026-11-24T00:00:00Z",
		archivedAt: null,
		...fields,
	} satisfies WorkItem;
}

const items = [
	item("sub", { parentId: "task", depth: 2, status: "done" }),
	item("second", { position: 1 }),
	item("task", { parentId: "first", depth: 1 }),
	item("first", { position: 0 }),
	item("other", { goalId: "goal-b" }),
];

describe("buildForest", () => {
	it("groups roots by goal, nests children and counts every done item beneath", () => {
		const forest = buildForest(items);
		const goalA = forest.get("goal-a") ?? [];

		expect(goalA.map((node) => node.item.id)).toEqual(["first", "second"]);
		expect(goalA[0]?.children[0]?.children[0]?.item.id).toBe("sub");
		expect(goalA[0]?.children[0]).toMatchObject({ done: 1, total: 1 });
		expect(goalA[0]).toMatchObject({ done: 1, total: 2 });
		expect(forest.get("goal-b")?.map((node) => node.item.id)).toEqual(["other"]);
	});

	it("lists visible rows depth-first and skips collapsed subtrees", () => {
		const forest = buildForest(items).get("goal-a") ?? [];

		expect(visibleRows(forest, new Set()).map((node) => node.item.id)).toEqual(["first", "task", "sub", "second"]);
		expect(visibleRows(forest, new Set(["first"])).map((node) => node.item.id)).toEqual(["first", "second"]);
	});
});

describe("goalProgress", () => {
	it("counts every live item of the goal", () => {
		expect(goalProgress(items, "goal-a")).toEqual({ done: 1, total: 4 });
	});
});
