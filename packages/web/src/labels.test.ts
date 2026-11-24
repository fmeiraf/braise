import { describe, expect, it } from "vitest";
import { labelEvent } from "./labels.ts";

describe("labelEvent", () => {
	it("names the revised version and the fields that changed", () => {
		expect(
			labelEvent({
				type: "strategy.revised",
				payload: { version: 3, changes: { why: { from: "a", to: "b" }, guidingPolicy: { from: "", to: "c" } } },
			}),
		).toEqual({ action: "revised the strategy to v3", subject: null, detail: "why, guiding policy" });
	});

	it("names a settled bet by its new status", () => {
		expect(
			labelEvent({
				type: "bet.status_set",
				payload: { hypothesis: "They pay", changes: { status: { from: "open", to: "killed" } } },
			}),
		).toEqual({ action: "marked a bet killed", subject: "They pay", detail: null });
	});

	it("falls back to the raw type for events it does not know", () => {
		expect(labelEvent({ type: "work.created", payload: {} })).toEqual({
			action: "work.created",
			subject: null,
			detail: null,
		});
	});
});
