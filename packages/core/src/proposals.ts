import type { LegacyProposableCommand, ProposableCommand } from "./commands.ts";

export const changeLabels = {
	"strategy.revise": "Revise strategy",
	"objective.create": "New objective",
	"objective.update": "Update objective",
	"objective.close": "Close objective",
	"assumption.create": "New assumption",
	"assumption.update": "Update assumption",
	"bet.create": "New bet",
	"bet.update": "Update bet",
	"bet.close": "Close bet",
	"bet.set_status": "Settle bet",
	"goal.create": "New goal",
	"goal.update": "Update goal",
} as const satisfies Record<ProposableCommand | LegacyProposableCommand, string>;

/** Which earlier change a `{ ref }` in this field may point at. */
export const refTargets = {
	objectiveId: "objective.create",
	assumptionId: "assumption.create",
} as const satisfies Record<string, ProposableCommand>;

export type RefField = keyof typeof refTargets;

export const refFields = Object.keys(refTargets) as RefField[];

function sortedKeys(_key: string, value: unknown) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

	return Object.fromEntries(Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right)));
}

export function samePayload(left: unknown, right: unknown) {
	return JSON.stringify(left, sortedKeys) === JSON.stringify(right, sortedKeys);
}

export function decisionLine(decision: {
	status: "approved" | "rejected";
	title: string;
	edited: number;
	dropped: number;
	note: string | null;
}) {
	const verb = decision.status === "approved" ? "Approved" : "Rejected";

	const details = [
		decision.edited > 0 ? "with edits" : null,
		decision.dropped > 0 ? `${decision.dropped} ${decision.dropped === 1 ? "change" : "changes"} dropped` : null,
	].filter((part) => part !== null);

	const head = [`${verb} “${decision.title}”`, details.join(", ")].filter((part) => part !== "").join(" ");

	return decision.note === null ? head : `${head} · ${decision.note}`;
}
