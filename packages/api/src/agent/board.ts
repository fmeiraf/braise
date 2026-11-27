import {
	type DraftMark,
	type DraftSummary,
	rankAssumptions,
	strategyMarkKey,
	upkeepKey,
	workHomeKey,
} from "@braise/core";
import { type Board, betNumbersOf } from "../draft-labels.ts";

function quoted(value: unknown) {
	return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

function markText(mark: DraftMark | undefined) {
	if (mark === undefined) return "";

	const changes = mark.changeIds.map((id) => `c:${id}`).join(", ");
	const parts: string[] = [];

	if (mark.created) parts.push("new");

	const fields = Object.entries(mark.fields).map(([field, from]) => `${field} was ${quoted(from)}`);

	if (fields.length > 0) parts.push(`edited: ${fields.join("; ")}`);

	if (mark.moved !== null) parts.push(`moved from ${quoted(mark.moved.from)}`);

	if (mark.status !== null) parts.push(`status ${quoted(mark.status.from)} → ${quoted(mark.status.to)}`);

	if (mark.archived) parts.push("archived");

	return ` [draft ${changes}: ${parts.join(", ")}]`;
}

function workLines(board: Board, marks: Record<string, DraftMark>, homeKey: string) {
	const items = board.workItems.filter((item) => workHomeKey(item) === homeKey);

	const lines: string[] = [];

	const render = (parentId: string | null, depth: number) => {
		const children = items
			.filter((item) => item.parentId === parentId)
			.toSorted((left, right) => left.position - right.position);

		for (const item of children) {
			lines.push(
				`${"  ".repeat(depth + 2)}- "${item.title}" (work ${item.id}, ${item.status}, ${item.function}${item.priority === "none" ? "" : `, ${item.priority}`})${markText(marks[item.id])}`,
			);

			render(item.id, depth + 1);
		}
	};

	render(null, 0);

	return lines;
}

/** The venture's board as compact text, with drafted rows marked by their change ids, as the agent reads it. */
export function renderBoard(board: Board, draft: DraftSummary | null) {
	const marks = draft?.marks ?? {};
	const bets = betNumbersOf(board.bets);
	const { strategy, venture } = board;

	const lines = [
		`Venture: ${venture.name} (id ${venture.id}, ${venture.kind.replace("_", " ")})${markText(marks[venture.id])}`,
		`Strategy v${strategy?.version ?? 0}${markText(marks[strategyMarkKey])}:`,
		`  - Why: ${strategy?.why ?? ""}`,
		`  - What: ${strategy?.what ?? ""}`,
		`  - Diagnosis: ${strategy?.diagnosis || "(none)"}`,
		`  - Guiding policy: ${strategy?.guidingPolicy || "(none)"}`,
		"Objectives:",
	];

	if (board.objectives.length === 0) lines.push("  (none)");

	for (const objective of board.objectives) {
		const details =
			objective.kind === "metric"
				? `${objective.measure}: ${objective.baseline} → ${objective.target}${objective.unit} by ${objective.byDate}`
				: objective.kind === "learning"
					? `decides "${objective.decision}"; answered when ${objective.doneRule}${objective.byDate === null ? "" : `, by ${objective.byDate}`}`
					: `done list: ${objective.doneList.map((item) => `[${item.done ? "x" : " "}] ${item.text}`).join("; ")}; by ${objective.byDate}`;

		lines.push(
			`  - ${objective.kind} "${objective.statement}" (objective ${objective.id}, ${objective.status}; ${details})${markText(marks[objective.id])}`,
		);

		const under = rankAssumptions(
			board.assumptions
				.filter((assumption) => assumption.objectiveId === objective.id)
				.map((assumption) => ({ ...assumption, createdAt: assumption.createdAt.toISOString() })),
		);

		for (const assumption of under) {
			lines.push(
				`    - assumption "${assumption.statement}" (assumption ${assumption.id}, ${assumption.impact} impact, confidence ${assumption.confidence}/4, ${assumption.function}, ${assumption.status})${markText(marks[assumption.id])}`,
			);

			for (const bet of board.bets.filter((candidate) => candidate.assumptionId === assumption.id)) {
				lines.push(
					`      - ${bets.get(bet.id)} bet (bet ${bet.id}, ${bet.status}): ${bet.action} Signal ${bet.signal}; pass at ${bet.passAt}${bet.unit}, fail past ${bet.failAt}${bet.unit}; ${bet.method}; deadline ${bet.deadline}${markText(marks[bet.id])}`,
				);
			}
		}
	}

	const hunches = board.assumptions.filter((assumption) => assumption.objectiveId === null);

	if (hunches.length > 0) {
		lines.push("Worth testing later:");

		for (const hunch of hunches) {
			lines.push(`  - "${hunch.statement}" (assumption ${hunch.id})${markText(marks[hunch.id])}`);
		}
	}

	lines.push("Work:");

	const homes = [
		...board.bets.map((bet) => ({ key: `bet:${bet.id}`, name: `${bets.get(bet.id)} "${bet.action}"` })),
		...board.objectives
			.filter((objective) => objective.kind === "build")
			.map((objective) => ({ key: `objective:${objective.id}`, name: `build objective "${objective.statement}"` })),
		{ key: upkeepKey, name: "Upkeep" },
	];

	for (const home of homes) {
		const items = workLines(board, marks, home.key);

		if (items.length > 0) lines.push(`  - ${home.name}:`, ...items);
	}

	if (board.workItems.length === 0) lines.push("  (none)");

	return lines.join("\n");
}

/** The open changes of a draft, one line each, as the agent reads them. */
export function renderDraftChanges(draft: DraftSummary | null) {
	if (draft === null || draft.changes.length === 0) return "The draft is empty.";

	return draft.changes
		.map((change) => {
			const tags = [
				change.stale === null ? null : `STALE: ${change.stale}`,
				change.error === null ? null : `FAILS: ${change.error}`,
				change.editedBy === "owner" ? `owner edited ${change.editedFields.join(", ") || "it"}` : null,
			].filter((tag) => tag !== null);

			const suffix = tags.length === 0 ? "" : ` [${tags.join("; ")}]`;

			return `- c:${change.id} ${change.command} "${change.label}"${change.entityId === null ? "" : ` (entity ${change.entityId})`}: ${JSON.stringify(change.payload)} · ${change.note}${suffix}`;
		})
		.join("\n");
}
