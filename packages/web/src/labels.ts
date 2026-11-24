import type { DomainEvent } from "@braise/core";

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

	return names.length === 0 ? null : names.join(", ");
}

function statusTo(payload: Record<string, unknown>) {
	const changes = payload.changes as { status?: { to?: unknown } } | undefined;

	return typeof changes?.status?.to === "string" ? changes.status.to : "settled";
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
		default:
			return { action: event.type, subject: null, detail: null } satisfies EventLabel;
	}
}

export const kindLabel = { for_profit: "For profit", non_profit: "Non-profit" } as const;
