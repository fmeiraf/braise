import type { betMethods, betResults, failCauses, impacts } from "./commands.ts";

export type BetMethod = (typeof betMethods)[number];

export type BetResult = (typeof betResults)[number];

export type FailCause = (typeof failCauses)[number];

export type Impact = (typeof impacts)[number];

/** The highest confidence a passed bet can earn, by the rung of the test ladder it used. */
export const methodCeilings = {
	existing_data: 1,
	interviews: 2,
	fake_door: 3,
	concierge: 3,
	before_after: 3,
	staggered_rollout: 4,
	ab_test: 4,
} as const satisfies Record<BetMethod, number>;

export const methodLabels = {
	existing_data: "Existing data",
	interviews: "Interviews and observation",
	fake_door: "Fake door or pre-sale",
	concierge: "Concierge",
	before_after: "Before and after",
	staggered_rollout: "Staggered rollout",
	ab_test: "A/B test",
} as const satisfies Record<BetMethod, string>;

interface Thresholds {
	passAt: number;
	failAt: number;
}

/** Whether a higher reading is the better one, read off the two marks. */
export function higherIsBetter(bet: Thresholds) {
	return bet.passAt > bet.failAt;
}

/** Compares a reading with the marks fixed when the bet was registered. Between the marks is inconclusive. */
export function judgeReading(bet: Thresholds, value: number) {
	const up = higherIsBetter(bet);

	if (up ? value >= bet.passAt : value <= bet.passAt) return "pass" satisfies BetResult;

	if (up ? value < bet.failAt : value > bet.failAt) return "fail" satisfies BetResult;

	return "inconclusive" satisfies BetResult;
}

interface Verdict {
	result: BetResult;
	cause: FailCause | undefined;
	method: BetMethod;
	current: number;
}

/** The confidence a closed bet may leave on its assumption: evidence moves it, opinion doesn't. */
export function confidenceRange({ result, cause, method, current }: Verdict) {
	if (result === "pass") return { min: current, max: Math.max(current, methodCeilings[method]) };

	if (result === "fail" && cause === "idea") return { min: 0, max: Math.max(current - 1, 0) };

	return { min: current, max: current };
}

export function defaultConfidence(verdict: Verdict) {
	return confidenceRange(verdict).max;
}

const impactRank = { high: 0, medium: 1, low: 2 } as const satisfies Record<Impact, number>;

interface Rankable {
	impact: Impact;
	confidence: number;
	createdAt: string | Date;
}

/** The next move first: highest impact, then lowest confidence, then oldest. */
export function rankAssumptions<Item extends Rankable>(assumptions: readonly Item[]) {
	return assumptions.toSorted(
		(left, right) =>
			impactRank[left.impact] - impactRank[right.impact] ||
			left.confidence - right.confidence ||
			String(left.createdAt).localeCompare(String(right.createdAt)),
	);
}

type WorkHome = { betId: string | null; objectiveId: string | null };

export const upkeepKey = "upkeep";

/** The key of the group a work item sits in: its bet, its build objective, or Upkeep. */
export function workHomeKey(item: WorkHome) {
	if (item.betId !== null) return `bet:${item.betId}`;

	return item.objectiveId === null ? upkeepKey : `objective:${item.objectiveId}`;
}

export function isRef(value: unknown): value is { ref: number } {
	return (
		typeof value === "object" &&
		value !== null &&
		Object.keys(value).length === 1 &&
		"ref" in value &&
		typeof value.ref === "number" &&
		Number.isInteger(value.ref)
	);
}
