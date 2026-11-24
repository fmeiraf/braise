import { describe, expect, it } from "vitest";
import { decisionLine, isBetRef, samePayload } from "./proposals.ts";

describe("decisionLine", () => {
	it("names a plain approval", () => {
		expect(decisionLine({ status: "approved", title: "Loyalty", edited: 0, dropped: 0, note: null })).toBe(
			"Approved “Loyalty”",
		);
	});

	it("adds edits, drops and the note", () => {
		expect(decisionLine({ status: "approved", title: "Loyalty", edited: 1, dropped: 2, note: "Tightened" })).toBe(
			"Approved “Loyalty” with edits, 2 changes dropped · Tightened",
		);
	});

	it("names a rejection with its note", () => {
		expect(decisionLine({ status: "rejected", title: "Loyalty", edited: 0, dropped: 0, note: "Redo" })).toBe(
			"Rejected “Loyalty” · Redo",
		);
	});
});

describe("isBetRef", () => {
	it("accepts only a lone integer ref", () => {
		expect([isBetRef({ ref: 0 }), isBetRef({ ref: 1.5 }), isBetRef({ ref: 0, x: 1 }), isBetRef("x")]).toEqual([
			true,
			false,
			false,
			false,
		]);
	});
});

describe("samePayload", () => {
	it("ignores key order and undefined fields", () => {
		expect(samePayload({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1, d: undefined })).toBe(true);
	});

	it("sees a changed value", () => {
		expect(samePayload({ a: 1 }, { a: 2 })).toBe(false);
	});
});
