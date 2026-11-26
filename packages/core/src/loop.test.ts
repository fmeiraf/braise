import { describe, expect, it } from "vitest";
import {
	confidenceRange,
	defaultConfidence,
	isRef,
	judgeReading,
	rankAssumptions,
	upkeepKey,
	workHomeKey,
} from "./loop.ts";

describe("judgeReading", () => {
	const upward = { passAt: 30, failAt: 12 };
	const downward = { passAt: 5, failAt: 9 };

	it("passes at the pass mark and fails under the fail mark", () => {
		expect([30, 29, 12, 11].map((value) => judgeReading(upward, value))).toEqual([
			"pass",
			"inconclusive",
			"inconclusive",
			"fail",
		]);
	});

	it("reads the direction off the marks when lower is better", () => {
		expect([5, 6, 9, 10].map((value) => judgeReading(downward, value))).toEqual([
			"pass",
			"inconclusive",
			"inconclusive",
			"fail",
		]);
	});
});

describe("confidenceRange", () => {
	it("lets a pass earn up to what its method can show", () => {
		expect(confidenceRange({ result: "pass", cause: undefined, method: "before_after", current: 1 })).toEqual({
			min: 1,
			max: 3,
		});
	});

	it("never lowers confidence on a pass by a weak method", () => {
		expect(confidenceRange({ result: "pass", cause: undefined, method: "interviews", current: 3 })).toEqual({
			min: 3,
			max: 3,
		});
	});

	it("lowers confidence only when the idea was wrong", () => {
		expect(confidenceRange({ result: "fail", cause: "idea", method: "ab_test", current: 2 })).toEqual({
			min: 0,
			max: 1,
		});

		expect(confidenceRange({ result: "fail", cause: "execution", method: "ab_test", current: 2 })).toEqual({
			min: 2,
			max: 2,
		});

		expect(defaultConfidence({ result: "inconclusive", cause: undefined, method: "ab_test", current: 2 })).toBe(2);
	});
});

describe("rankAssumptions", () => {
	it("puts the highest impact and lowest confidence first", () => {
		const ranked = rankAssumptions([
			{ id: "a", impact: "medium", confidence: 0, createdAt: "2026-01-01" },
			{ id: "b", impact: "high", confidence: 3, createdAt: "2026-01-02" },
			{ id: "c", impact: "high", confidence: 1, createdAt: "2026-01-03" },
		] as const);

		expect(ranked.map((item) => item.id)).toEqual(["c", "b", "a"]);
	});
});

describe("workHomeKey", () => {
	it("names the bet, the objective or Upkeep", () => {
		expect([
			workHomeKey({ betId: "b", objectiveId: null }),
			workHomeKey({ betId: null, objectiveId: "o" }),
			workHomeKey({ betId: null, objectiveId: null }),
		]).toEqual(["bet:b", "objective:o", upkeepKey]);
	});
});

describe("isRef", () => {
	it("accepts only a lone integer ref", () => {
		expect([isRef({ ref: 0 }), isRef({ ref: 1.5 }), isRef({ ref: 0, x: 1 }), isRef("x")]).toEqual([
			true,
			false,
			false,
			false,
		]);
	});
});
