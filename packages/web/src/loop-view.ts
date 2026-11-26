import {
	type Assumption,
	type Bet,
	higherIsBetter,
	type Learning,
	type Objective,
	type ProposedBet,
	type Reading,
	type ReadingSubject,
} from "@braise/core";
import { actorName } from "./thread-timeline.ts";

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** A value with its unit: symbols sit against the number, words after a space. */
export function amount(value: number, unit: string) {
	const number = numberFormat.format(value);

	if (unit === "") return number;

	return /^[a-z]/iu.test(unit) ? `${number} ${unit}` : `${number}${unit}`;
}

const dayMs = 24 * 3600 * 1000;

function dayOf(iso: string) {
	return Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso);
}

export function daysUntil(isoDate: string, now: number) {
	return Math.ceil((dayOf(isoDate) + dayMs - now) / dayMs) - 1;
}

export function timeLeft(isoDate: string, now: number) {
	const days = daysUntil(isoDate, now);

	if (days === 0) return "due today";

	if (days < 0) return days === -1 ? "1 day over" : `${-days} days over`;

	return days === 1 ? "1 day left" : `${days} days left`;
}

/** Where a time box stands: the day it is on, its length, and the share used. */
export function timeBox(startIso: string, endIsoDate: string, now: number) {
	const start = dayOf(startIso.slice(0, 10));
	const total = Math.max(1, Math.round((dayOf(endIsoDate) - start) / dayMs) + 1);
	const day = Math.min(total, Math.max(1, Math.floor((now - start) / dayMs) + 1));

	return { day, total, share: day / total };
}

export function readingsOf(readings: readonly Reading[], type: ReadingSubject, id: string) {
	const byDay = new Map<string, Reading>();

	for (const reading of readings) {
		if (reading.subjectType === type && reading.subjectId === id) byDay.set(reading.takenOn, reading);
	}

	return [...byDay.values()].toSorted((left, right) => left.takenOn.localeCompare(right.takenOn));
}

export function latestOf(readings: readonly Reading[], type: ReadingSubject, id: string) {
	return readingsOf(readings, type, id).at(-1) ?? null;
}

/** How far a value has come from the baseline toward the target, from 0 to 1. */
export function shareOfWay(baseline: number, target: number, value: number) {
	if (baseline === target) return 0;

	return Math.min(1, Math.max(0, (value - baseline) / (target - baseline)));
}

export function failPhrase(bet: Pick<Bet, "passAt" | "failAt" | "unit">) {
	return `fail ${higherIsBetter(bet) ? "under" : "over"} ${amount(bet.failAt, bet.unit)}`;
}

export function passPhrase(bet: Pick<Bet, "passAt" | "failAt" | "unit">) {
	return `${higherIsBetter(bet) ? "at least" : "at most"} ${amount(bet.passAt, bet.unit)}`;
}

const resultWords = { pass: "passed", fail: "failed", inconclusive: "inconclusive" } as const;

export function learningVerdict(learning: Pick<Learning, "result" | "cause">) {
	if (learning.result !== "fail") return resultWords[learning.result];

	return learning.cause === "idea" ? "failed, the idea was wrong" : "failed on execution";
}

function count(value: number, noun: string) {
	return `${value} ${value === 1 ? noun : `${noun}s`}`;
}

/** What is happening on an assumption, in the few words that follow its impact and function. */
export function assumptionState(
	assumption: Pick<Assumption, "id" | "status">,
	bets: readonly Pick<Bet, "assumptionId" | "status">[],
	learnings: readonly Pick<Learning, "assumptionId" | "result">[],
	proposed: readonly Pick<ProposedBet, "assumptionId" | "createdBy">[],
) {
	if (assumption.status === "holds") return "holds";

	if (assumption.status === "false") return "shown false";

	if (assumption.status === "dropped") return "dropped";

	if (bets.some((bet) => bet.assumptionId === assumption.id && bet.status === "open")) return "testing now";

	const waiting = proposed.find((bet) => bet.assumptionId === assumption.id);

	if (waiting !== undefined) return `${actorName(waiting.createdBy)} proposed a bet`;

	const mine = learnings.filter((learning) => learning.assumptionId === assumption.id);

	if (mine.length === 0) return "no bet yet";

	const passed = mine.filter((learning) => learning.result === "pass").length;
	const failed = mine.filter((learning) => learning.result === "fail").length;

	return [
		passed > 0 ? `${count(passed, "bet")} passed` : null,
		failed > 0 ? `${count(failed, "bet")} failed` : null,
		mine.length - passed - failed > 0 ? `${mine.length - passed - failed} inconclusive` : null,
	]
		.filter((part) => part !== null)
		.join(", ");
}

export const kindNames = {
	metric: "Metric objective",
	learning: "Learning objective",
	build: "Build objective",
} as const satisfies Record<Objective["kind"], string>;

export const impactNames = { high: "High impact", medium: "Medium impact", low: "Low impact" } as const;
