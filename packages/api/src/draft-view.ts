import {
	type DraftChange,
	type DraftChangeView,
	type DraftMark,
	type DraftSummary,
	draftViewOf,
	type FieldChanges,
	pointersOf,
	strategyMarkKey,
} from "@braise/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database, Transaction } from "./db/client.ts";
import { assumptions, bets, objectives, ventures, workItems } from "./db/schema.ts";
import {
	boardOf,
	changesOf,
	currentDraft,
	type DraftRow,
	type OperableHandlers,
	type ReplayStep,
	replay,
	stalenessOf,
} from "./draft-handlers.ts";
import { type Board, changeLabel } from "./draft-labels.ts";
import { AppError } from "./errors.ts";
import type { HandlerContext, Services, VentureRow } from "./pipeline.ts";

export interface DraftProjection {
	board: Board;
	draft: DraftSummary;
}

const cache = new Map<string, { key: string; value: DraftProjection }>();

/** How many times a draft view was replayed rather than served from the cache. */
export const draftViewStats = { replays: 0 };

function emptyMark() {
	return { changeIds: [], created: false, fields: {}, moved: null, status: null, archived: false } satisfies DraftMark;
}

function markOf(marks: Record<string, DraftMark>, key: string, changeId: string) {
	const mark = marks[key] ?? emptyMark();

	if (!mark.changeIds.includes(changeId)) mark.changeIds.push(changeId);

	marks[key] = mark;

	return mark;
}

function fieldChanges(payload: Record<string, unknown>) {
	const changes = payload.changes;

	return typeof changes === "object" && changes !== null ? (changes as FieldChanges) : {};
}

function earlier(mark: DraftMark, changes: FieldChanges, skip: readonly string[] = []) {
	for (const [field, change] of Object.entries(changes)) {
		if (!skip.includes(field) && !Object.hasOwn(mark.fields, field)) mark.fields[field] = change.from;
	}
}

function markStep(marks: Record<string, DraftMark>, step: ReplayStep) {
	const { change } = step;
	const entity = change.entityId;

	for (const event of step.events) {
		const changes = fieldChanges(event.payload);

		switch (event.type) {
			case "objective.created":
			case "assumption.created":
			case "bet.created":
			case "work.created":
			case "reading.recorded":
				if (entity !== null) markOf(marks, entity, change.id).created = true;

				break;
			case "strategy.revised":
				earlier(markOf(marks, strategyMarkKey, change.id), changes);

				break;
			case "venture.updated":
			case "objective.updated":
			case "bet.updated":
			case "work.updated":
				if (entity !== null) earlier(markOf(marks, entity, change.id), changes);

				break;
			case "assumption.updated": {
				if (entity === null) break;

				const mark = markOf(marks, entity, change.id);

				earlier(mark, changes, ["objectiveId", "status"]);

				if (changes.objectiveId !== undefined) mark.moved ??= { from: changes.objectiveId.from };

				if (changes.status !== undefined) mark.status = { from: changes.status.from, to: changes.status.to };

				break;
			}
			case "work.moved":
				if (entity !== null) {
					const from = changes.home?.from ?? changes.index?.from ?? null;

					markOf(marks, entity, change.id).moved ??= { from };
				}

				break;
			case "work.status_set":
			case "objective.closed":
				if (entity !== null && changes.status !== undefined) {
					markOf(marks, entity, change.id).status = { from: changes.status.from, to: changes.status.to };
				}

				break;
			case "bet.closed":
				if (entity !== null) markOf(marks, entity, change.id).status = { from: "open", to: event.payload.result };

				break;
			case "objective.done_checked":
				if (entity !== null) markOf(marks, entity, change.id).fields.doneList ??= "checked";

				break;
			case "objective.archived":
			case "assumption.archived":
			case "bet.archived":
				if (entity !== null) markOf(marks, entity, change.id).archived = true;

				break;
			case "work.archived": {
				const ids = Array.isArray(event.payload.archivedIds) ? (event.payload.archivedIds as string[]) : [];

				for (const id of ids) markOf(marks, id, change.id).archived = true;

				break;
			}
			default:
				break;
		}
	}
}

async function withArchived(tx: Transaction, board: Board, marks: Record<string, DraftMark>) {
	const archived = Object.entries(marks)
		.filter(([, mark]) => mark.archived)
		.map(([id]) => id);

	if (archived.length === 0) return board;

	const scoped = { ventureId: board.venture.id };

	const [objectiveRows, assumptionRows, betRows, workRows] = [
		await tx
			.select()
			.from(objectives)
			.where(and(eq(objectives.ventureId, scoped.ventureId), inArray(objectives.id, archived))),
		await tx
			.select()
			.from(assumptions)
			.where(and(eq(assumptions.ventureId, scoped.ventureId), inArray(assumptions.id, archived))),
		await tx
			.select()
			.from(bets)
			.where(and(eq(bets.ventureId, scoped.ventureId), inArray(bets.id, archived))),
		await tx
			.select()
			.from(workItems)
			.where(and(eq(workItems.ventureId, scoped.ventureId), inArray(workItems.id, archived))),
	];

	return {
		...board,
		objectives: [...board.objectives, ...objectiveRows],
		assumptions: [...board.assumptions, ...assumptionRows],
		bets: [...board.bets, ...betRows],
		workItems: [...board.workItems, ...workRows],
	} satisfies Board;
}

function changeViews(board: Board, changes: DraftChange[], steps: ReplayStep[]) {
	const open = new Set(changes.filter((change) => change.state === "open").map((change) => change.id));

	return steps.map(
		({ change, stale, error }) =>
			({
				...change,
				label: changeLabel(board, change),
				view: draftViewOf(change.command),
				dependsOn: pointersOf(change).filter((id) => open.has(id)),
				stale,
				error: stale === null ? (error?.message ?? null) : null,
			}) satisfies DraftChangeView,
	);
}

function replayContext(tx: Transaction, venture: VentureRow, services: Services) {
	return {
		tx,
		actor: "owner",
		reason: null,
		runId: null,
		venture,
		queueRun: () => undefined,
		scheduleLift: () => undefined,
		queueCode: () => undefined,
		code: services.code,
	} satisfies HandlerContext;
}

async function project(db: Database, apply: OperableHandlers, services: Services, ventureId: string, slug: string) {
	return db.transaction(async (tx) => {
		const [venture] = await tx.select().from(ventures).where(eq(ventures.id, ventureId)).for("update");

		if (venture === undefined) throw new AppError("not_found", "Venture not found", { slug });

		const draft = await currentDraft(tx, venture.id);

		if (draft === undefined) return null;

		const changes = changesOf(draft);

		const stale = await stalenessOf(tx, venture.id, changes);

		await tx.execute(sql`SAVEPOINT draft_view`);

		try {
			const steps = await replay(apply, replayContext(tx, venture, services), venture, changes, stale);

			const marks: Record<string, DraftMark> = {};

			for (const step of steps) markStep(marks, step);

			const board = await withArchived(tx, await boardOf(tx, slug), marks);

			draftViewStats.replays += 1;

			return {
				venture,
				draft,
				projection: { board, draft: summarize(draft, changes, changeViews(board, changes, steps), marks) },
			};
		} finally {
			await tx.execute(sql`ROLLBACK TO SAVEPOINT draft_view`);
		}
	});
}

function summarize(
	draft: DraftRow,
	changes: DraftChange[],
	views: DraftChangeView[],
	marks: Record<string, DraftMark>,
) {
	const stamps = changes.flatMap((change) => [change.createdAt, change.editedAt ?? change.createdAt]);

	return {
		id: draft.id,
		ventureId: draft.ventureId,
		threadId: draft.threadId,
		version: draft.version,
		createdAt: draft.createdAt.toISOString(),
		updatedAt: stamps.toSorted().at(-1) ?? draft.createdAt.toISOString(),
		kept: changes.filter((change) => change.state === "kept").length,
		dropped: changes.filter((change) => change.state === "dropped").length,
		changes: views,
		marks,
	} satisfies DraftSummary;
}

/**
 * The venture's board as it would be with its open draft applied, computed by replaying the draft through the
 * real handlers and rolled back, or null when the venture has no draft. Cached by draft version and `last_seq`.
 */
export async function draftProjection(db: Database, apply: OperableHandlers, services: Services, slug: string) {
	const [venture] = await db.select().from(ventures).where(eq(ventures.slug, slug));

	if (venture === undefined) throw new AppError("not_found", "Venture not found", { slug });

	const draft = await currentDraft(db, venture.id);

	if (draft === undefined) return null;

	const key = `${draft.id}:${draft.version}:${venture.lastSeq}`;
	const cached = cache.get(venture.id);

	if (cached?.key === key) return cached.value;

	const projected = await project(db, apply, services, venture.id, slug);

	if (projected === null) return null;

	cache.set(venture.id, {
		key: `${projected.draft.id}:${projected.draft.version}:${projected.venture.lastSeq}`,
		value: projected.projection,
	});

	return projected.projection;
}
