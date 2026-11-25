import type { Bet, Capability, DomainEvent } from "@braise/core";

const fieldNames: Record<string, string> = {
	why: "why",
	what: "what",
	diagnosis: "diagnosis",
	guidingPolicy: "guiding policy",
	hypothesis: "hypothesis",
	action: "action",
	killCriteria: "kill criteria",
	outcome: "outcome",
	signal: "signal",
	horizon: "horizon",
	betId: "bet",
	status: "status",
	title: "title",
	description: "description",
	function: "function",
	priority: "priority",
	index: "position",
	goalId: "goal",
};

export interface EventLabel {
	action: string;
	subject: string | null;
	detail: string | null;
}

function text(payload: Record<string, unknown>, field: string) {
	const value = payload[field];

	return typeof value === "string" ? value : null;
}

function changedFields(payload: Record<string, unknown>) {
	const changes = payload.changes;

	if (typeof changes !== "object" || changes === null) return null;

	const names = Object.keys(changes).map((field) => fieldNames[field] ?? field);

	return names.length === 0 ? null : `Changed ${names.join(", ")}`;
}

function statusTo(payload: Record<string, unknown>, fallback = "settled") {
	const changes = payload.changes as { status?: { to?: unknown } } | undefined;

	return typeof changes?.status?.to === "string" ? changes.status.to : fallback;
}

const workKindByDepth = ["an initiative", "a task", "a subtask"];

function workKind(payload: Record<string, unknown>) {
	return typeof payload.depth === "number" ? (workKindByDepth[payload.depth] ?? "work") : "work";
}

function archivedCount(payload: Record<string, unknown>) {
	const ids = payload.archivedIds;

	if (!Array.isArray(ids) || ids.length <= 1) return null;

	return ids.length === 2 ? "With 1 item under it" : `With ${ids.length - 1} items under it`;
}

function movedAction(payload: Record<string, unknown>) {
	const changes = payload.changes as { goalId?: unknown } | undefined;

	return changes?.goalId === undefined ? "reordered work" : "moved work to another goal";
}

export function plural(count: number, noun: string) {
	return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

function approvalDetail(payload: Record<string, unknown>) {
	const parts = [
		typeof payload.applied === "number" ? `${plural(payload.applied, "change")} applied` : null,
		typeof payload.edited === "number" && payload.edited > 0 ? `${payload.edited} edited` : null,
		typeof payload.dropped === "number" && payload.dropped > 0 ? `${payload.dropped} dropped` : null,
	].filter((part) => part !== null);

	return parts.length === 0 ? null : parts.join(", ");
}

export function labelEvent(event: Pick<DomainEvent, "type" | "payload">) {
	const { payload } = event;

	switch (event.type) {
		case "venture.created":
			return { action: "created the venture", subject: text(payload, "name"), detail: null } satisfies EventLabel;
		case "venture.archived":
			return { action: "archived the venture", subject: text(payload, "name"), detail: null } satisfies EventLabel;
		case "strategy.revised":
			return {
				action: `revised the strategy to v${String(payload.version)}`,
				subject: null,
				detail: changedFields(payload),
			} satisfies EventLabel;
		case "bet.created":
			return { action: "added a bet", subject: text(payload, "hypothesis"), detail: null } satisfies EventLabel;
		case "bet.updated":
			return {
				action: "edited a bet",
				subject: text(payload, "hypothesis"),
				detail: changedFields(payload),
			} satisfies EventLabel;
		case "bet.status_set":
			return {
				action: `marked a bet ${statusTo(payload)}`,
				subject: text(payload, "hypothesis"),
				detail: null,
			} satisfies EventLabel;
		case "bet.archived":
			return { action: "archived a bet", subject: text(payload, "hypothesis"), detail: null } satisfies EventLabel;
		case "goal.created":
			return { action: "added a goal", subject: text(payload, "outcome"), detail: null } satisfies EventLabel;
		case "goal.updated":
			return {
				action: "edited a goal",
				subject: text(payload, "outcome"),
				detail: changedFields(payload),
			} satisfies EventLabel;
		case "goal.archived":
			return { action: "archived a goal", subject: text(payload, "outcome"), detail: null } satisfies EventLabel;
		case "work.created":
			return {
				action: `added ${workKind(payload)}`,
				subject: text(payload, "title"),
				detail: null,
			} satisfies EventLabel;
		case "work.updated":
			return {
				action: "edited work",
				subject: text(payload, "title"),
				detail: changedFields(payload),
			} satisfies EventLabel;
		case "work.status_set":
			return {
				action: `marked work ${statusTo(payload, "changed")}`,
				subject: text(payload, "title"),
				detail: null,
			} satisfies EventLabel;
		case "work.moved":
			return { action: movedAction(payload), subject: text(payload, "title"), detail: null } satisfies EventLabel;
		case "work.archived":
			return {
				action: "archived work",
				subject: text(payload, "title"),
				detail: archivedCount(payload),
			} satisfies EventLabel;
		case "proposal.created":
			return {
				action: "proposed changes",
				subject: text(payload, "title"),
				detail: typeof payload.changeCount === "number" ? plural(payload.changeCount, "change") : null,
			} satisfies EventLabel;
		case "proposal.approved":
			return {
				action: "approved a proposal",
				subject: text(payload, "title"),
				detail: approvalDetail(payload),
			} satisfies EventLabel;
		case "proposal.rejected":
			return { action: "rejected a proposal", subject: text(payload, "title"), detail: null } satisfies EventLabel;
		default:
			return { action: event.type, subject: null, detail: null } satisfies EventLabel;
	}
}

export const kindLabel = { for_profit: "For profit", non_profit: "Non-profit" } as const;

export const capabilityPhrases = {
	work: "create, edit, reorder and set the status of work items",
	links: "link and unlink its threads",
	propose: "propose changes to strategy, bets and goals",
} as const satisfies Record<Capability, string>;

/** Numbers a venture's bets in the order they were made: B1, B2, … */
export function betNumbers(bets: readonly Pick<Bet, "id" | "createdAt">[]) {
	return new Map(
		bets.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)).map((bet, index) => [bet.id, `B${index + 1}`]),
	);
}
