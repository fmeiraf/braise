import { describe, expect, it } from "vitest";
import { labelEvent } from "./labels.ts";

describe("labelEvent", () => {
	it("names the revised version and the fields that changed", () => {
		expect(
			labelEvent({
				type: "strategy.revised",
				payload: { version: 3, changes: { why: { from: "a", to: "b" }, guidingPolicy: { from: "", to: "c" } } },
			}),
		).toEqual({ action: "revised the strategy to v3", subject: null, detail: "Changed why, guiding policy" });
	});

	it("names a settled bet by its new status", () => {
		expect(
			labelEvent({
				type: "bet.status_set",
				payload: { hypothesis: "They pay", changes: { status: { from: "open", to: "killed" } } },
			}),
		).toEqual({ action: "marked a bet killed", subject: "They pay", detail: null });
	});

	it("names work by its kind, status and archived subtree", () => {
		expect(labelEvent({ type: "work.created", payload: { title: "Form", depth: 1 } })).toEqual({
			action: "added a task",
			subject: "Form",
			detail: null,
		});

		expect(
			labelEvent({
				type: "work.status_set",
				payload: { title: "Form", changes: { status: { from: "todo", to: "done" } } },
			}),
		).toMatchObject({ action: "marked work done" });

		expect(
			labelEvent({ type: "work.archived", payload: { title: "Page", archivedIds: ["a", "b", "c"] } }),
		).toMatchObject({
			detail: "With 2 items under it",
		});

		expect(
			labelEvent({ type: "work.moved", payload: { title: "Page", changes: { goalId: { from: "a", to: "b" } } } }),
		).toMatchObject({ action: "moved work to another goal" });
	});

	it("falls back to the raw type for events it does not know", () => {
		expect(labelEvent({ type: "thread.created", payload: {} })).toEqual({
			action: "thread.created",
			subject: null,
			detail: null,
		});
	});
});
