import type { MemberState, ReportOutcome, RunStatus } from "./entities.ts";

const outcomeWords = {
	succeeded: "finished",
	failed: "failed",
	interrupted: "was interrupted",
	cancelled: "was stopped",
	needs_input: "needs you",
} as const satisfies Record<ReportOutcome, string>;

export function reportLine(report: { title: string; outcome: ReportOutcome; detail: string | null }) {
	const head = `“${report.title}” ${outcomeWords[report.outcome]}`;

	return report.detail === null || report.detail.trim() === "" ? head : `${head}: ${report.detail.trim()}`;
}

export function memberStateOf(latest: RunStatus | null, needsInput: boolean) {
	if (needsInput) return "needs_you" satisfies MemberState;

	if (latest === "running") return "running" satisfies MemberState;

	return latest === "queued" ? ("queued" satisfies MemberState) : ("done" satisfies MemberState);
}
