import type { DraftChange } from "@braise/core";
import type { workItems } from "./db/schema.ts";
import type { getCockpit } from "./queries.ts";

export type Board = Awaited<ReturnType<typeof getCockpit>> & { workItems: (typeof workItems.$inferSelect)[] };

const labelLength = 60;

function clip(text: string) {
	const characters = [...text.trim()];

	return characters.length <= labelLength ? text.trim() : `${characters.slice(0, labelLength - 1).join("")}…`;
}

export function betNumbersOf(bets: readonly { id: string; createdAt: Date }[]) {
	const ordered = bets.toSorted(
		(left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
	);

	return new Map(ordered.map((bet, index) => [bet.id, `B${index + 1}`]));
}

function fromPayload(change: Pick<DraftChange, "command" | "payload">) {
	const { payload } = change;

	for (const field of ["title", "statement", "action", "name"]) {
		const value = payload[field];

		if (typeof value === "string" && value.trim() !== "") return clip(value);
	}

	return change.command;
}

function entityLabel(board: Board, id: string, bets: Map<string, string>) {
	const bet = bets.get(id);

	if (bet !== undefined) return bet;

	const found =
		board.objectives.find((objective) => objective.id === id)?.statement ??
		board.assumptions.find((assumption) => assumption.id === id)?.statement ??
		board.workItems.find((item) => item.id === id)?.title;

	return found === undefined ? null : clip(found);
}

/** A short name for what a change touches, as the owner sees it on the board: `B3`, `Landing page`. */
export function changeLabel(board: Board, change: Pick<DraftChange, "command" | "payload" | "entityId">) {
	const bets = betNumbersOf(board.bets);

	if (change.command === "venture.update") return clip(board.venture.name);

	if (change.command === "strategy.revise") return "Strategy";

	if (change.command === "reading.record") {
		const subject = change.payload.subject as { id?: unknown } | undefined;
		const of = typeof subject?.id === "string" ? entityLabel(board, subject.id, bets) : null;

		return of === null ? "Reading" : `Reading of ${of}`;
	}

	const named = change.entityId === null ? null : entityLabel(board, change.entityId, bets);

	return named ?? fromPayload(change);
}
