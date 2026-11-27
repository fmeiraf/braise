import type { Objective, Reading } from "@braise/core";
import { describe, expect, it } from "vitest";
import { doneThisWeek, leadObjective, workCounts } from "./figures.ts";

function objective(fields: Partial<Objective> & Pick<Objective, "id" | "kind" | "createdAt">) {
	return {
		ventureId: "v1",
		statement: `Objective ${fields.id}`,
		measure: null,
		unit: "%",
		baseline: null,
		target: null,
		decision: null,
		doneRule: null,
		doneList: [],
		byDate: null,
		guardrails: "",
		budget: "",
		status: "active",
		updatedAt: fields.createdAt,
		closedAt: null,
		archivedAt: null,
		...fields,
	} satisfies Objective;
}

function reading(subjectId: string, value: number, takenOn: string) {
	return {
		id: `${subjectId}-${takenOn}`,
		ventureId: "v1",
		subjectType: "objective",
		subjectId,
		value,
		takenOn,
		source: "test",
		enteredBy: "owner",
		createdAt: `${takenOn}T09:00:00Z`,
	} satisfies Reading;
}

describe("leadObjective", () => {
	it("is null without an active objective", () => {
		expect(leadObjective({ objectives: [], readings: [] })).toBeNull();
	});

	it("leads with a metric objective over an older build objective, measured by its latest reading", () => {
		const lead = leadObjective({
			objectives: [
				objective({ id: "b", kind: "build", createdAt: "2026-11-01T00:00:00Z" }),
				objective({ id: "m", kind: "metric", createdAt: "2026-11-02T00:00:00Z", baseline: 10, target: 30 }),
			],
			readings: [reading("m", 15, "2026-11-20"), reading("m", 20, "2026-11-21")],
		});

		expect(lead).toEqual({ statement: "Objective m", share: 0.5, figure: "20% of 30%" });
	});

	it("counts a build objective's ticked done list", () => {
		const lead = leadObjective({
			objectives: [
				objective({
					id: "b",
					kind: "build",
					createdAt: "2026-11-01T00:00:00Z",
					doneList: [
						{ id: "1", text: "a", done: true },
						{ id: "2", text: "b", done: false },
					],
				}),
			],
			readings: [],
		});

		expect(lead).toEqual({ statement: "Objective b", share: 0.5, figure: "1/2" });
	});

	it("gives a learning objective no figure", () => {
		const lead = leadObjective({
			objectives: [objective({ id: "l", kind: "learning", createdAt: "2026-11-01T00:00:00Z" })],
			readings: [],
		});

		expect(lead).toEqual({ statement: "Objective l", share: null, figure: null });
	});
});

describe("workCounts", () => {
	it("counts one venture's live items by status", () => {
		const counts = workCounts(
			[
				{ ventureId: "v1", status: "done", archivedAt: null },
				{ ventureId: "v1", status: "doing", archivedAt: null },
				{ ventureId: "v1", status: "todo", archivedAt: "2026-11-01T00:00:00Z" },
				{ ventureId: "v2", status: "todo", archivedAt: null },
			],
			"v1",
		);

		expect(counts).toEqual({ done: 1, doing: 1, todo: 0 });
	});
});

describe("doneThisWeek", () => {
	const now = Date.parse("2026-11-27T12:00:00Z");

	const marked = (id: string, to: string, createdAt: string) => ({
		type: "work.status_set",
		subject: `work:${id}`,
		payload: { title: id, changes: { status: { from: "doing", to } } },
		createdAt,
	});

	it("counts items marked done this week that are still done", () => {
		const events = [
			marked("a", "done", "2026-11-26T12:00:00Z"),
			marked("b", "done", "2026-11-10T12:00:00Z"),
			marked("c", "done", "2026-11-25T12:00:00Z"),
			marked("d", "doing", "2026-11-25T12:00:00Z"),
			{ type: "work.moved", subject: "work:e", payload: {}, createdAt: "2026-11-26T12:00:00Z" },
		];

		const items = ["a", "b", "c", "d", "e"].map((id) => ({
			id,
			status: id === "c" || id === "d" ? ("doing" as const) : ("done" as const),
			archivedAt: null,
		}));

		expect(doneThisWeek(events, items, now)).toBe(1);
	});
});
