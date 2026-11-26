import { describe, expect, it } from "vitest";
import {
	amount,
	assumptionState,
	daysUntil,
	failPhrase,
	latestOf,
	passPhrase,
	readingsOf,
	shareOfWay,
	timeBox,
	timeLeft,
} from "./loop-view.ts";

const noon = (isoDate: string) => Date.parse(`${isoDate}T12:00:00`);

describe("amount", () => {
	it("joins symbols to the number and spaces words", () => {
		expect([amount(19, "%"), amount(30, "a week"), amount(1234.5, ""), amount(140, "€")]).toEqual([
			"19%",
			"30 a week",
			"1,234.5",
			"140€",
		]);
	});
});

describe("time", () => {
	it("counts whole days to a date", () => {
		expect([
			daysUntil("2026-12-07", noon("2026-11-25")),
			daysUntil("2026-11-25", noon("2026-11-25")),
			daysUntil("2026-11-24", noon("2026-11-25")),
		]).toEqual([12, 0, -1]);
	});

	it("says how long is left or over", () => {
		expect([
			timeLeft("2026-12-07", noon("2026-11-25")),
			timeLeft("2026-11-26", noon("2026-11-25")),
			timeLeft("2026-11-25", noon("2026-11-25")),
			timeLeft("2026-11-22", noon("2026-11-25")),
		]).toEqual(["12 days left", "1 day left", "due today", "3 days over"]);
	});

	it("places today in a time box and stops at its end", () => {
		expect(timeBox("2026-10-06T09:00:00Z", "2026-10-26", noon("2026-10-17"))).toMatchObject({ day: 12, total: 21 });

		expect(timeBox("2026-10-06T09:00:00Z", "2026-10-26", noon("2026-11-30"))).toMatchObject({ day: 21, share: 1 });
	});
});

describe("readings", () => {
	const reading = (subjectId: string, takenOn: string, value: number) => ({
		id: `${subjectId}:${takenOn}:${value}`,
		ventureId: "v",
		subjectType: "bet" as const,
		subjectId,
		value,
		takenOn,
		source: "sheet",
		enteredBy: "owner",
		createdAt: takenOn,
	});

	const all = [reading("b", "2026-11-09", 9), reading("b", "2026-11-16", 14), reading("b", "2026-11-16", 15)];

	it("keeps the last reading entered for a day", () => {
		expect(readingsOf(all, "bet", "b").map((item) => item.value)).toEqual([9, 15]);

		expect(latestOf(all, "bet", "b")?.value).toBe(15);

		expect(latestOf(all, "objective", "b")).toBeNull();
	});
});

describe("marks", () => {
	it("reads the direction off the pass and fail marks", () => {
		const up = { passAt: 30, failAt: 12, unit: "" };
		const down = { passAt: 6, failAt: 15, unit: "%" };

		expect([passPhrase(up), failPhrase(up), passPhrase(down), failPhrase(down)]).toEqual([
			"at least 30",
			"fail under 12",
			"at most 6%",
			"fail over 15%",
		]);
	});

	it("measures the way from baseline to target in either direction", () => {
		expect([shareOfWay(8, 33, 19), shareOfWay(20, 5, 10), shareOfWay(8, 33, 2), shareOfWay(8, 33, 40)]).toEqual([
			0.44,
			2 / 3,
			0,
			1,
		]);
	});
});

describe("assumptionState", () => {
	const assumption = { id: "a", status: "open" } as const;

	it("names the open bet, then a waiting proposal, then the record", () => {
		expect(assumptionState(assumption, [{ assumptionId: "a", status: "open" }], [], [])).toBe("testing now");

		expect(assumptionState(assumption, [], [], [{ assumptionId: "a", createdBy: "agent:claude" }])).toBe(
			"Claude proposed a bet",
		);

		expect(assumptionState(assumption, [], [], [])).toBe("no bet yet");

		expect(
			assumptionState(
				assumption,
				[{ assumptionId: "a", status: "closed" }],
				[
					{ assumptionId: "a", result: "pass" },
					{ assumptionId: "a", result: "fail" },
					{ assumptionId: "a", result: "fail" },
				],
				[],
			),
		).toBe("1 bet passed, 2 bets failed");
	});

	it("says when the assumption is settled", () => {
		expect(assumptionState({ id: "a", status: "false" }, [], [], [])).toBe("shown false");
	});
});
