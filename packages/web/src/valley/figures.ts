import type { Cockpit, DomainEvent, WorkItem, WorkStatus } from "@braise/core";
import { amount, latestOf, shareOfWay } from "../loop-view.ts";

const weekMs = 7 * 24 * 60 * 60 * 1000;

/** The objective a venture card leads with: the first active metric or learning objective, else the first build objective, with how far it has come. */
export function leadObjective(cockpit: Pick<Cockpit, "objectives" | "readings">) {
	const active = cockpit.objectives
		.filter((objective) => objective.status === "active" && objective.archivedAt === null)
		.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));

	const lead = active.find((objective) => objective.kind !== "build") ?? active[0];

	if (lead === undefined) return null;

	if (lead.kind === "build") {
		const done = lead.doneList.filter((item) => item.done).length;
		const total = lead.doneList.length;

		return {
			statement: lead.statement,
			share: total === 0 ? null : done / total,
			figure: total === 0 ? null : `${done}/${total}`,
		};
	}

	const latest = latestOf(cockpit.readings, "objective", lead.id);

	if (lead.kind === "learning" || lead.baseline === null || lead.target === null || latest === null) {
		return { statement: lead.statement, share: null, figure: null };
	}

	return {
		statement: lead.statement,
		share: shareOfWay(lead.baseline, lead.target, latest.value),
		figure: `${amount(latest.value, lead.unit)} of ${amount(lead.target, lead.unit)}`,
	};
}

/** A venture's live work by status. */
export function workCounts(items: readonly Pick<WorkItem, "ventureId" | "status" | "archivedAt">[], ventureId: string) {
	const counts: Record<WorkStatus, number> = { done: 0, doing: 0, todo: 0 };

	for (const item of items) {
		if (item.ventureId === ventureId && item.archivedAt === null) counts[item.status] += 1;
	}

	return counts;
}

export const weekAgo = (now: number) => now - weekMs;

function movedToDone(event: Pick<DomainEvent, "type" | "payload">) {
	const changes = event.payload.changes as { status?: { to?: unknown } } | undefined;

	return event.type === "work.status_set" && changes?.status?.to === "done";
}

/** Work items marked done in the last seven days that are still done. */
export function doneThisWeek(
	events: readonly Pick<DomainEvent, "type" | "subject" | "payload" | "createdAt">[],
	items: readonly Pick<WorkItem, "id" | "status" | "archivedAt">[],
	now: number,
) {
	const marked = new Set(
		events
			.filter((event) => movedToDone(event) && Date.parse(event.createdAt) >= weekAgo(now))
			.map((event) => event.subject.replace(/^work:/u, "")),
	);

	return items.filter((item) => item.status === "done" && item.archivedAt === null && marked.has(item.id)).length;
}
