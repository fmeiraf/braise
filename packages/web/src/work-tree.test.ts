import type { WorkItem } from "@braise/core";
import { describe, expect, it } from "vitest";
import { buildForest, filterForest, homeProgress, visibleRows } from "./work-tree.ts";

function item(id: string, fields: Partial<WorkItem>) {
	return {
		id,
		ventureId: "venture",
		betId: "bet-a",
		objectiveId: null,
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
	item("other", { betId: null, objectiveId: "build-b" }),
	item("bill", { betId: null, function: "ops" }),
];

describe("buildForest", () => {
	it("groups roots by their home, nests children and counts every done item beneath", () => {
		const forest = buildForest(items);
		const underBet = forest.get("bet:bet-a") ?? [];

		expect(underBet.map((node) => node.item.id)).toEqual(["first", "second"]);
		expect(underBet[0]?.children[0]?.children[0]?.item.id).toBe("sub");
		expect(underBet[0]?.children[0]).toMatchObject({ done: 1, total: 1 });
		expect(underBet[0]).toMatchObject({ done: 1, total: 2 });
		expect(forest.get("objective:build-b")?.map((node) => node.item.id)).toEqual(["other"]);
		expect(forest.get("upkeep")?.map((node) => node.item.id)).toEqual(["bill"]);
	});

	it("lists visible rows depth-first and skips collapsed subtrees", () => {
		const forest = buildForest(items).get("bet:bet-a") ?? [];

		expect(visibleRows(forest, new Set()).map((node) => node.item.id)).toEqual(["first", "task", "sub", "second"]);
		expect(visibleRows(forest, new Set(["first"])).map((node) => node.item.id)).toEqual(["first", "second"]);
	});
});

describe("homeProgress", () => {
	it("counts every live item of the home", () => {
		expect(homeProgress(items, "bet:bet-a")).toEqual({ done: 1, total: 4 });
	});
});

describe("filterForest", () => {
	it("keeps matches and the path that leads to them", () => {
		const forest = buildForest([...items, item("flyers", { parentId: "second", depth: 1, function: "marketing" })]);
		const roots = forest.get("bet:bet-a") ?? [];

		expect(visibleRows(filterForest(roots, "marketing"), new Set()).map((node) => node.item.id)).toEqual([
			"second",
			"flyers",
		]);

		expect(filterForest(roots, "sales")).toEqual([]);

		expect(filterForest(roots, null)).toHaveLength(2);
	});
});
