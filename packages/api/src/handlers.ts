import {
	betLockedFields,
	type CommandPayload,
	confidenceRange,
	type DoneItem,
	defaultConfidence,
	type FieldChanges,
	judgeReading,
	maxClimbingObjectives,
	maxWorkDepth,
	slugify,
	workHomeKey,
} from "@braise/core";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { accessHandlers } from "./access-handlers.ts";
import type { Transaction } from "./db/client.ts";
import {
	assumptions,
	bets,
	learnings,
	objectives,
	readings,
	strategyVersions,
	ventures,
	workItems,
} from "./db/schema.ts";
import { AppError } from "./errors.ts";
import type { HandlerContext, Handlers, VentureRow } from "./pipeline.ts";
import { proposalHandlers } from "./proposal-handlers.ts";
import { threadHandlers } from "./thread-handlers.ts";

function requireVenture(context: HandlerContext) {
	if (context.venture === null) throw new AppError("internal_error", "Command ran without a venture lock");

	return context.venture;
}

function changesBetween<Fields extends Record<string, unknown>>(current: Fields, next: Partial<Fields>) {
	const changes: FieldChanges = {};

	for (const [field, to] of Object.entries(next)) {
		if (to !== undefined && current[field] !== to) changes[field] = { from: current[field], to };
	}

	return changes;
}

function hasChanges(changes: FieldChanges) {
	return Object.keys(changes).length > 0;
}

function noChanges() {
	return new AppError("rule_violated", "Nothing changed", { rule: "no_changes" });
}

async function activeStrategy(tx: Transaction, ventureId: string) {
	const [strategy] = await tx
		.select()
		.from(strategyVersions)
		.where(and(eq(strategyVersions.ventureId, ventureId), eq(strategyVersions.status, "active")));

	if (strategy === undefined) throw new AppError("internal_error", "Venture has no active strategy");

	return strategy;
}

type ObjectiveRow = typeof objectives.$inferSelect;

type WorkItemRow = typeof workItems.$inferSelect;

interface Home {
	betId: string | null;
	objectiveId: string | null;
}

async function liveObjective(tx: Transaction, venture: VentureRow, objectiveId: string) {
	const [objective] = await tx
		.select()
		.from(objectives)
		.where(and(eq(objectives.id, objectiveId), eq(objectives.ventureId, venture.id)));

	if (objective === undefined) throw new AppError("not_found", "Objective not found", { objectiveId });

	if (objective.archivedAt !== null) {
		throw new AppError("rule_violated", "The objective is archived", { rule: "objective_archived", objectiveId });
	}

	return objective;
}

async function activeObjective(tx: Transaction, venture: VentureRow, objectiveId: string) {
	const objective = await liveObjective(tx, venture, objectiveId);

	if (objective.status !== "active") {
		throw new AppError("rule_violated", "The objective is closed", {
			rule: "objective_closed",
			objectiveId,
			status: objective.status,
		});
	}

	return objective;
}

async function climbingObjective(tx: Transaction, venture: VentureRow, objectiveId: string) {
	const objective = await activeObjective(tx, venture, objectiveId);

	if (objective.kind === "build") {
		throw new AppError("rule_violated", "A build objective has no assumptions; note a hunch for later instead", {
			rule: "objective_not_climbing",
			objectiveId,
		});
	}

	return objective;
}

async function liveAssumption(tx: Transaction, venture: VentureRow, assumptionId: string) {
	const [assumption] = await tx
		.select()
		.from(assumptions)
		.where(and(eq(assumptions.id, assumptionId), eq(assumptions.ventureId, venture.id)));

	if (assumption === undefined) throw new AppError("not_found", "Assumption not found", { assumptionId });

	if (assumption.archivedAt !== null) {
		throw new AppError("rule_violated", "The assumption is archived", { rule: "assumption_archived", assumptionId });
	}

	return assumption;
}

async function hasOpenBets(tx: Transaction, assumptionId: string) {
	const [open] = await tx
		.select({ id: bets.id })
		.from(bets)
		.where(and(eq(bets.assumptionId, assumptionId), eq(bets.status, "open"), isNull(bets.archivedAt)))
		.limit(1);

	return open !== undefined;
}

function assumptionBusy(assumptionId: string) {
	return new AppError("rule_violated", "Close this assumption's open bets first", {
		rule: "assumption_has_open_bets",
		assumptionId,
	});
}

async function liveBet(tx: Transaction, venture: VentureRow, betId: string) {
	const [bet] = await tx
		.select()
		.from(bets)
		.where(and(eq(bets.id, betId), eq(bets.ventureId, venture.id)));

	if (bet === undefined) throw new AppError("not_found", "Bet not found", { betId });

	if (bet.archivedAt !== null)
		throw new AppError("rule_violated", "The bet is archived", { rule: "bet_archived", betId });

	return bet;
}

async function openBet(tx: Transaction, venture: VentureRow, betId: string) {
	const bet = await liveBet(tx, venture, betId);

	if (bet.status !== "open") {
		throw new AppError("rule_violated", "The bet is closed", { rule: "bet_not_open", betId });
	}

	return bet;
}

async function latestReading(tx: Transaction, subject: { type: "objective" | "bet"; id: string }) {
	const [reading] = await tx
		.select()
		.from(readings)
		.where(and(eq(readings.subjectType, subject.type), eq(readings.subjectId, subject.id)))
		.orderBy(desc(readings.takenOn), desc(readings.createdAt))
		.limit(1);

	return reading ?? null;
}

const kindFields = {
	metric: ["measure", "unit", "baseline", "target"],
	learning: ["decision", "doneRule"],
	build: ["doneList"],
} as const;

function assertFieldsFitKind(objective: ObjectiveRow, payload: Record<string, unknown>) {
	const foreign = Object.entries(kindFields)
		.filter(([kind]) => kind !== objective.kind)
		.flatMap(([, fields]) => fields)
		.filter((field) => payload[field] !== undefined);

	if (foreign.length > 0) {
		throw new AppError("rule_violated", `A ${objective.kind} objective has no ${foreign.join(", ")}`, {
			rule: "field_not_for_kind",
			kind: objective.kind,
			fields: foreign,
		});
	}
}

function nextDoneList(current: DoneItem[], items: { id?: string | undefined; text: string }[]) {
	return items.map((item) => {
		if (item.id === undefined) return { id: uuidv7(), text: item.text, done: false } satisfies DoneItem;

		const kept = current.find((existing) => existing.id === item.id);

		if (kept === undefined) {
			throw new AppError("rule_violated", "A done-list item to keep is not on the list", {
				rule: "done_item_unknown",
				itemId: item.id,
			});
		}

		return { ...kept, text: item.text } satisfies DoneItem;
	});
}

async function homeFor(tx: Transaction, venture: VentureRow, home: CommandPayload<"work.create">["home"]) {
	if (home === undefined) throw new AppError("internal_error", "Initiative without a home passed validation");

	if (home.type === "upkeep") return { betId: null, objectiveId: null } satisfies Home;

	if (home.type === "bet") {
		const [bet] = await tx.select().from(bets).where(eq(bets.id, home.id));

		if (bet === undefined || bet.ventureId !== venture.id || bet.archivedAt !== null || bet.status !== "open") {
			throw new AppError("rule_violated", "Work can only hang off an open bet of the same venture", {
				rule: "home_not_available",
				home,
			});
		}

		return { betId: bet.id, objectiveId: null } satisfies Home;
	}

	const [objective] = await tx.select().from(objectives).where(eq(objectives.id, home.id));

	if (
		objective === undefined ||
		objective.ventureId !== venture.id ||
		objective.archivedAt !== null ||
		objective.status !== "active" ||
		objective.kind !== "build"
	) {
		throw new AppError("rule_violated", "Work can only hang off an active build objective of the same venture", {
			rule: "home_not_available",
			home,
		});
	}

	return { betId: null, objectiveId: objective.id } satisfies Home;
}

function workArchived(workItemId: string) {
	return new AppError("rule_violated", "The work item is archived", { rule: "work_archived", workItemId });
}

async function liveWorkItem(tx: Transaction, venture: VentureRow, workItemId: string) {
	const [item] = await tx
		.select()
		.from(workItems)
		.where(and(eq(workItems.id, workItemId), eq(workItems.ventureId, venture.id)));

	if (item === undefined) throw new AppError("not_found", "Work item not found", { workItemId });

	if (item.archivedAt !== null) throw workArchived(workItemId);

	return item;
}

async function parentFor(tx: Transaction, venture: VentureRow, parentId: string) {
	const [parent] = await tx.select().from(workItems).where(eq(workItems.id, parentId));

	if (parent === undefined || parent.ventureId !== venture.id) {
		throw new AppError("rule_violated", "The parent must be a work item of the same venture", {
			rule: "parent_not_in_venture",
			parentId,
		});
	}

	if (parent.archivedAt !== null) throw workArchived(parentId);

	if (parent.depth >= maxWorkDepth) {
		throw new AppError("rule_violated", "Work items nest at most three levels deep", {
			rule: "depth_exceeded",
			parentId,
		});
	}

	return parent;
}

function siblingIds(tx: Transaction, place: Home & { ventureId: string; parentId: string | null }) {
	const group =
		place.parentId === null
			? and(
					eq(workItems.ventureId, place.ventureId),
					place.betId === null ? isNull(workItems.betId) : eq(workItems.betId, place.betId),
					place.objectiveId === null
						? isNull(workItems.objectiveId)
						: eq(workItems.objectiveId, place.objectiveId),
					isNull(workItems.parentId),
				)
			: eq(workItems.parentId, place.parentId);

	return tx
		.select({ id: workItems.id })
		.from(workItems)
		.where(and(group, isNull(workItems.archivedAt)))
		.orderBy(asc(workItems.position))
		.then((rows) => rows.map((row) => row.id));
}

async function renumber(tx: Transaction, ids: string[]) {
	if (ids.length === 0) return;

	await tx.execute(sql`
		UPDATE work_items SET position = ordered.ord - 1
		FROM unnest(${`{${ids.join(",")}}`}::uuid[]) WITH ORDINALITY AS ordered(id, ord)
		WHERE work_items.id = ordered.id AND work_items.position <> ordered.ord - 1
	`);
}

function indexOutOfRange(index: number, size: number) {
	return new AppError("rule_violated", "There is no such position", {
		rule: "index_out_of_range",
		index,
		size,
	});
}

function subtreeCondition(item: WorkItemRow) {
	return or(
		eq(workItems.id, item.id),
		eq(workItems.parentId, item.id),
		inArray(workItems.parentId, sql`(SELECT id FROM work_items WHERE parent_id = ${item.id})`),
	);
}

async function reloadWorkItem(tx: Transaction, workItemId: string) {
	const [item] = await tx.select().from(workItems).where(eq(workItems.id, workItemId));

	if (item === undefined) throw new AppError("internal_error", "Work item disappeared during the command");

	return item;
}

const domainHandlers = {
	...threadHandlers,
	"venture.create": async ({ tx, actor }, payload) => {
		const slug = payload.slug ?? slugify(payload.name);

		if (slug === "") {
			throw new AppError("rule_violated", "Give the venture a name with letters or digits", {
				rule: "slug_empty",
				field: "slug",
			});
		}

		const [taken] = await tx.select({ id: ventures.id }).from(ventures).where(eq(ventures.slug, slug));

		if (taken !== undefined) {
			throw new AppError("rule_violated", "Another venture already uses this slug", {
				rule: "slug_taken",
				field: "slug",
				slug,
			});
		}

		const ventureId = uuidv7();

		const [venture] = await tx
			.insert(ventures)
			.values({ id: ventureId, slug, name: payload.name, kind: payload.kind })
			.returning();

		const [strategy] = await tx
			.insert(strategyVersions)
			.values({
				id: uuidv7(),
				ventureId,
				version: 1,
				status: "active",
				why: payload.why,
				what: payload.what,
				diagnosis: payload.diagnosis,
				guidingPolicy: payload.guidingPolicy,
				createdBy: actor,
				activatedAt: sql`now()`,
			})
			.returning();

		return {
			ventureId,
			result: { venture: { ...venture, lastSeq: 1 }, strategy },
			events: [
				{
					type: "venture.created",
					subject: `venture:${ventureId}`,
					payload: { name: payload.name, slug, kind: payload.kind, strategyVersion: 1 },
				},
			],
		};
	},

	"venture.archive": async (context) => {
		const venture = requireVenture(context);

		const [archived] = await context.tx
			.update(ventures)
			.set({ archivedAt: sql`now()` })
			.where(eq(ventures.id, venture.id))
			.returning();

		return {
			ventureId: venture.id,
			result: archived,
			events: [{ type: "venture.archived", subject: `venture:${venture.id}`, payload: { name: venture.name } }],
		};
	},

	"strategy.revise": async (context, payload) => {
		const venture = requireVenture(context);

		const current = await activeStrategy(context.tx, venture.id);

		const { ventureId: _ventureId, ...fields } = payload;
		const changes = changesBetween(current, fields);

		if (!hasChanges(changes)) throw noChanges();

		await context.tx
			.update(strategyVersions)
			.set({ status: "superseded" })
			.where(eq(strategyVersions.id, current.id));

		const [next] = await context.tx
			.insert(strategyVersions)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				version: current.version + 1,
				status: "active",
				...fields,
				createdBy: context.actor,
				activatedAt: sql`now()`,
			})
			.returning();

		return {
			ventureId: venture.id,
			result: { ...next, reason: context.reason },
			events: [
				{
					type: "strategy.revised",
					subject: `strategy:${venture.id}`,
					payload: { version: current.version + 1, strategyVersionId: next?.id, changes },
				},
			],
		};
	},

	"objective.create": async (context, payload) => {
		const venture = requireVenture(context);

		if (payload.kind !== "build") {
			const climbing = await context.tx
				.select({ id: objectives.id })
				.from(objectives)
				.where(
					and(
						eq(objectives.ventureId, venture.id),
						eq(objectives.status, "active"),
						ne(objectives.kind, "build"),
						isNull(objectives.archivedAt),
					),
				);

			if (climbing.length >= maxClimbingObjectives) {
				throw new AppError(
					"rule_violated",
					`A venture climbs at most ${maxClimbingObjectives} metric or learning objectives at once; close one first`,
					{ rule: "objective_limit", limit: maxClimbingObjectives },
				);
			}
		}

		const { ventureId: _ventureId, ...fields } = payload;

		const [objective] = await context.tx
			.insert(objectives)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				...fields,
				doneList:
					payload.kind === "build"
						? payload.doneList.map((item) => ({ id: uuidv7(), text: item, done: false }))
						: [],
			})
			.returning();

		return {
			ventureId: venture.id,
			result: objective,
			events: [
				{
					type: "objective.created",
					subject: `objective:${objective?.id}`,
					payload: { statement: payload.statement, kind: payload.kind },
				},
			],
		};
	},

	"objective.update": async (context, payload) => {
		const venture = requireVenture(context);

		const objective = await activeObjective(context.tx, venture, payload.objectiveId);

		const { ventureId: _ventureId, objectiveId: _objectiveId, doneList: items, ...fields } = payload;

		assertFieldsFitKind(objective, payload);

		if (payload.byDate === null && objective.kind !== "learning") {
			throw new AppError("rule_violated", `A ${objective.kind} objective needs a date`, {
				rule: "by_date_required",
				field: "byDate",
			});
		}

		if (
			(payload.baseline ?? objective.baseline) === (payload.target ?? objective.target) &&
			objective.kind === "metric"
		) {
			throw new AppError("rule_violated", "The target must differ from the baseline", {
				rule: "target_equals_baseline",
				field: "target",
			});
		}

		const doneList = items === undefined ? undefined : nextDoneList(objective.doneList, items);
		const changes = changesBetween(objective, fields);

		if (doneList !== undefined && JSON.stringify(doneList) !== JSON.stringify(objective.doneList)) {
			changes.doneList = { from: objective.doneList, to: doneList };
		}

		if (!hasChanges(changes)) throw noChanges();

		const [updated] = await context.tx
			.update(objectives)
			.set({ ...fields, doneList, updatedAt: sql`now()` })
			.where(eq(objectives.id, objective.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [
				{
					type: "objective.updated",
					subject: `objective:${objective.id}`,
					payload: { statement: objective.statement, changes },
				},
			],
		};
	},

	"objective.check": async (context, payload) => {
		const venture = requireVenture(context);

		const objective = await activeObjective(context.tx, venture, payload.objectiveId);

		const item = objective.doneList.find((candidate) => candidate.id === payload.itemId);

		if (item === undefined) throw new AppError("not_found", "Done-list item not found", { itemId: payload.itemId });

		if (item.done === payload.done) throw noChanges();

		const [updated] = await context.tx
			.update(objectives)
			.set({
				doneList: objective.doneList.map((candidate) =>
					candidate.id === item.id ? { ...candidate, done: payload.done } : candidate,
				),
				updatedAt: sql`now()`,
			})
			.where(eq(objectives.id, objective.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [
				{
					type: "objective.done_checked",
					subject: `objective:${objective.id}`,
					payload: { statement: objective.statement, item: item.text, done: payload.done },
				},
			],
		};
	},

	"objective.close": async (context, payload) => {
		const venture = requireVenture(context);

		const objective = await activeObjective(context.tx, venture, payload.objectiveId);

		const [openBetUnder] = await context.tx
			.select({ id: bets.id })
			.from(bets)
			.innerJoin(assumptions, eq(assumptions.id, bets.assumptionId))
			.where(and(eq(assumptions.objectiveId, objective.id), eq(bets.status, "open"), isNull(bets.archivedAt)))
			.limit(1);

		if (openBetUnder !== undefined) {
			throw new AppError("rule_violated", "Close this objective's open bets first, so each leaves a learning", {
				rule: "objective_has_open_bets",
				objectiveId: objective.id,
			});
		}

		const [closed] = await context.tx
			.update(objectives)
			.set({ status: payload.status, closedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(objectives.id, objective.id))
			.returning();

		return {
			ventureId: venture.id,
			result: closed,
			events: [
				{
					type: "objective.closed",
					subject: `objective:${objective.id}`,
					payload: {
						statement: objective.statement,
						changes: { status: { from: objective.status, to: payload.status } },
					},
				},
			],
		};
	},

	"objective.archive": async (context, payload) => {
		const venture = requireVenture(context);

		const objective = await liveObjective(context.tx, venture, payload.objectiveId);

		const [[liveWork], [liveAssumptionUnder]] = await Promise.all([
			context.tx
				.select({ id: workItems.id })
				.from(workItems)
				.where(and(eq(workItems.objectiveId, objective.id), isNull(workItems.archivedAt)))
				.limit(1),
			context.tx
				.select({ id: assumptions.id })
				.from(assumptions)
				.where(and(eq(assumptions.objectiveId, objective.id), isNull(assumptions.archivedAt)))
				.limit(1),
		]);

		if (liveWork !== undefined) {
			throw new AppError("rule_violated", "Archive or move this objective's work first", {
				rule: "objective_has_work",
				objectiveId: objective.id,
			});
		}

		if (liveAssumptionUnder !== undefined) {
			throw new AppError("rule_violated", "Archive or move this objective's assumptions first", {
				rule: "objective_has_assumptions",
				objectiveId: objective.id,
			});
		}

		const [archived] = await context.tx
			.update(objectives)
			.set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(objectives.id, objective.id))
			.returning();

		return {
			ventureId: venture.id,
			result: archived,
			events: [
				{
					type: "objective.archived",
					subject: `objective:${objective.id}`,
					payload: { statement: objective.statement },
				},
			],
		};
	},

	"assumption.create": async (context, payload) => {
		const venture = requireVenture(context);

		if (payload.objectiveId !== null) await climbingObjective(context.tx, venture, payload.objectiveId);

		const [assumption] = await context.tx
			.insert(assumptions)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				objectiveId: payload.objectiveId,
				statement: payload.statement,
				impact: payload.impact,
				confidence: payload.confidence,
				function: payload.function,
				createdBy: context.actor,
			})
			.returning();

		return {
			ventureId: venture.id,
			result: assumption,
			events: [
				{
					type: "assumption.created",
					subject: `assumption:${assumption?.id}`,
					payload: { statement: payload.statement, objectiveId: payload.objectiveId },
				},
			],
		};
	},

	"assumption.update": async (context, payload) => {
		const venture = requireVenture(context);

		const assumption = await liveAssumption(context.tx, venture, payload.assumptionId);

		const next = {
			objectiveId: payload.objectiveId,
			statement: payload.statement,
			impact: payload.impact,
			function: payload.function,
			status: payload.status,
		};

		const changes = changesBetween(assumption, next);

		if (!hasChanges(changes)) throw noChanges();

		if (changes.objectiveId !== undefined || (changes.status !== undefined && payload.status !== "open")) {
			if (await hasOpenBets(context.tx, assumption.id)) throw assumptionBusy(assumption.id);
		}

		if (changes.objectiveId !== undefined && payload.objectiveId !== null && payload.objectiveId !== undefined) {
			await climbingObjective(context.tx, venture, payload.objectiveId);
		}

		const [updated] = await context.tx
			.update(assumptions)
			.set({ ...next, updatedAt: sql`now()` })
			.where(eq(assumptions.id, assumption.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [
				{
					type: "assumption.updated",
					subject: `assumption:${assumption.id}`,
					payload: { statement: assumption.statement, changes },
				},
			],
		};
	},

	"assumption.archive": async (context, payload) => {
		const venture = requireVenture(context);

		const assumption = await liveAssumption(context.tx, venture, payload.assumptionId);

		const [liveBetUnder] = await context.tx
			.select({ id: bets.id })
			.from(bets)
			.where(and(eq(bets.assumptionId, assumption.id), isNull(bets.archivedAt)))
			.limit(1);

		if (liveBetUnder !== undefined) {
			throw new AppError("rule_violated", "This assumption has bets; drop it instead, so their learnings stay", {
				rule: "assumption_has_bets",
				assumptionId: assumption.id,
			});
		}

		const [archived] = await context.tx
			.update(assumptions)
			.set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(assumptions.id, assumption.id))
			.returning();

		return {
			ventureId: venture.id,
			result: archived,
			events: [
				{
					type: "assumption.archived",
					subject: `assumption:${assumption.id}`,
					payload: { statement: assumption.statement },
				},
			],
		};
	},

	"bet.create": async (context, payload) => {
		const venture = requireVenture(context);

		const assumption = await liveAssumption(context.tx, venture, payload.assumptionId);

		if (assumption.status !== "open") {
			throw new AppError("rule_violated", "A bet tests an open assumption", {
				rule: "assumption_not_open",
				assumptionId: assumption.id,
				status: assumption.status,
			});
		}

		if (assumption.objectiveId === null) {
			throw new AppError(
				"rule_violated",
				"Attach the assumption to a metric or learning objective before betting on it",
				{
					rule: "assumption_not_attached",
					assumptionId: assumption.id,
				},
			);
		}

		await climbingObjective(context.tx, venture, assumption.objectiveId);

		const { ventureId: _ventureId, ...fields } = payload;

		const [bet] = await context.tx
			.insert(bets)
			.values({ id: uuidv7(), ventureId: venture.id, ...fields })
			.returning();

		return {
			ventureId: venture.id,
			result: bet,
			events: [
				{
					type: "bet.created",
					subject: `bet:${bet?.id}`,
					payload: { action: payload.action, assumptionId: assumption.id, assumption: assumption.statement },
				},
			],
		};
	},

	"bet.update": async (context, payload) => {
		const venture = requireVenture(context);

		const bet = await openBet(context.tx, venture, payload.betId);

		const { ventureId: _ventureId, betId: _betId, ...fields } = payload;
		const changes = changesBetween(bet, fields);

		if (!hasChanges(changes)) throw noChanges();

		const locked = betLockedFields.filter((field) => changes[field] !== undefined);

		if (locked.length > 0 && context.reason === null) {
			throw new AppError(
				"rule_violated",
				"Say why the test changes; its marks were fixed when the bet was registered",
				{
					rule: "reason_required",
					field: "reason",
					fields: locked,
				},
			);
		}

		if ((payload.passAt ?? bet.passAt) === (payload.failAt ?? bet.failAt)) {
			throw new AppError("rule_violated", "The pass and fail marks must differ", {
				rule: "marks_equal",
				field: "failAt",
			});
		}

		const [updated] = await context.tx
			.update(bets)
			.set({ ...fields, updatedAt: sql`now()` })
			.where(eq(bets.id, bet.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [{ type: "bet.updated", subject: `bet:${bet.id}`, payload: { action: bet.action, changes } }],
		};
	},

	"bet.close": async (context, payload) => {
		const venture = requireVenture(context);

		const bet = await openBet(context.tx, venture, payload.betId);

		const assumption = await liveAssumption(context.tx, venture, bet.assumptionId);

		const reading = await latestReading(context.tx, { type: "bet", id: bet.id });

		const judged = reading === null ? null : judgeReading(bet, reading.value);

		if (payload.result === "pass" && judged !== "pass") {
			throw new AppError("rule_violated", "The latest reading doesn't reach the pass mark", {
				rule: "bet_not_passed",
				reading: reading?.value ?? null,
				passAt: bet.passAt,
			});
		}

		if (payload.result === "fail" && payload.cause === "idea" && judged !== "fail") {
			throw new AppError(
				"rule_violated",
				"The latest reading isn't past the fail mark, so the idea isn't refuted; close as inconclusive or as failed on execution",
				{ rule: "bet_not_failed", reading: reading?.value ?? null, failAt: bet.failAt },
			);
		}

		const verdict = {
			result: payload.result,
			cause: payload.cause,
			method: bet.method,
			current: assumption.confidence,
		};

		const range = confidenceRange(verdict);
		const confidenceTo = payload.confidenceTo ?? defaultConfidence(verdict);

		if (confidenceTo < range.min || confidenceTo > range.max) {
			throw new AppError(
				"rule_violated",
				range.min === range.max
					? `This result leaves confidence at ${range.min}`
					: `This result can put confidence between ${range.min} and ${range.max}`,
				{ rule: "confidence_out_of_range", field: "confidenceTo", ...range },
			);
		}

		const [closed] = await context.tx
			.update(bets)
			.set({ status: "closed", closedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(bets.id, bet.id))
			.returning();

		const [learning] = await context.tx
			.insert(learnings)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				betId: bet.id,
				assumptionId: assumption.id,
				result: payload.result,
				cause: payload.cause ?? null,
				statement: payload.statement,
				value: reading?.value ?? null,
				confidenceFrom: assumption.confidence,
				confidenceTo,
				function: bet.function,
				createdBy: context.actor,
			})
			.returning();

		const refuted = confidenceTo === 0 && assumption.status === "open";

		const [updatedAssumption] =
			confidenceTo === assumption.confidence && !refuted
				? [assumption]
				: await context.tx
						.update(assumptions)
						.set({
							confidence: confidenceTo,
							status: refuted ? "false" : assumption.status,
							updatedAt: sql`now()`,
						})
						.where(eq(assumptions.id, assumption.id))
						.returning();

		return {
			ventureId: venture.id,
			result: { bet: closed, learning, assumption: updatedAssumption },
			events: [
				{
					type: "bet.closed",
					subject: `bet:${bet.id}`,
					payload: {
						action: bet.action,
						result: payload.result,
						cause: payload.cause ?? null,
						learning: payload.statement,
						assumptionId: assumption.id,
						confidence: { from: assumption.confidence, to: confidenceTo },
					},
				},
			],
		};
	},

	"bet.archive": async (context, payload) => {
		const venture = requireVenture(context);

		const bet = await liveBet(context.tx, venture, payload.betId);

		const [liveWork] = await context.tx
			.select({ id: workItems.id })
			.from(workItems)
			.where(and(eq(workItems.betId, bet.id), isNull(workItems.archivedAt)))
			.limit(1);

		if (liveWork !== undefined) {
			throw new AppError("rule_violated", "Archive or move this bet's work first", {
				rule: "bet_has_work",
				betId: bet.id,
			});
		}

		const [archived] = await context.tx
			.update(bets)
			.set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(bets.id, bet.id))
			.returning();

		return {
			ventureId: venture.id,
			result: archived,
			events: [{ type: "bet.archived", subject: `bet:${bet.id}`, payload: { action: bet.action } }],
		};
	},

	"reading.record": async (context, payload) => {
		const venture = requireVenture(context);

		const { subject } = payload;
		let label: string;
		let unit: string;

		if (subject.type === "objective") {
			const objective = await activeObjective(context.tx, venture, subject.id);

			if (objective.kind !== "metric") {
				throw new AppError("rule_violated", "Only a metric objective takes readings", {
					rule: "reading_needs_metric",
					objectiveId: objective.id,
				});
			}

			label = objective.measure ?? objective.statement;

			unit = objective.unit;
		} else {
			const bet = await openBet(context.tx, venture, subject.id);

			label = bet.signal;

			unit = bet.unit;
		}

		const [reading] = await context.tx
			.insert(readings)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				subjectType: subject.type,
				subjectId: subject.id,
				value: payload.value,
				takenOn: payload.takenOn,
				source: payload.source,
				enteredBy: context.actor,
			})
			.returning();

		return {
			ventureId: venture.id,
			result: reading,
			events: [
				{
					type: "reading.recorded",
					subject: `${subject.type}:${subject.id}`,
					payload: { label, value: payload.value, unit, takenOn: payload.takenOn, subjectType: subject.type },
				},
			],
		};
	},

	"work.create": async (context, payload) => {
		const venture = requireVenture(context);

		const parent = payload.parentId === undefined ? null : await parentFor(context.tx, venture, payload.parentId);

		const home =
			parent === null
				? await homeFor(context.tx, venture, payload.home)
				: ({ betId: parent.betId, objectiveId: parent.objectiveId } satisfies Home);

		const place = { ventureId: venture.id, ...home, parentId: parent?.id ?? null };

		const siblings = await siblingIds(context.tx, place);

		const fn = payload.function ?? parent?.function;

		if (fn === undefined) throw new AppError("internal_error", "Work item without a function passed validation");

		const [item] = await context.tx
			.insert(workItems)
			.values({
				id: uuidv7(),
				...place,
				depth: parent === null ? 0 : parent.depth + 1,
				position: siblings.length,
				title: payload.title,
				description: payload.description,
				function: fn,
				priority: payload.priority,
			})
			.returning();

		return {
			ventureId: venture.id,
			result: item,
			events: [
				{
					type: "work.created",
					subject: `work:${item?.id}`,
					payload: { title: payload.title, ...home, parentId: place.parentId, depth: item?.depth },
				},
			],
		};
	},

	"work.update": async (context, payload) => {
		const venture = requireVenture(context);

		const item = await liveWorkItem(context.tx, venture, payload.workItemId);

		const next = {
			title: payload.title,
			description: payload.description,
			function: payload.function,
			priority: payload.priority,
		};

		const changes = changesBetween(item, next);

		if (!hasChanges(changes)) throw noChanges();

		const [updated] = await context.tx
			.update(workItems)
			.set({ ...next, updatedAt: sql`now()` })
			.where(eq(workItems.id, item.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [{ type: "work.updated", subject: `work:${item.id}`, payload: { title: item.title, changes } }],
		};
	},

	"work.set_status": async (context, payload) => {
		const venture = requireVenture(context);

		const item = await liveWorkItem(context.tx, venture, payload.workItemId);

		if (item.status === payload.status) throw noChanges();

		const [updated] = await context.tx
			.update(workItems)
			.set({ status: payload.status, updatedAt: sql`now()` })
			.where(eq(workItems.id, item.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [
				{
					type: "work.status_set",
					subject: `work:${item.id}`,
					payload: { title: item.title, changes: { status: { from: item.status, to: payload.status } } },
				},
			],
		};
	},

	"work.move": async (context, payload) => {
		const venture = requireVenture(context);

		const item = await liveWorkItem(context.tx, venture, payload.workItemId);

		if (payload.home !== undefined && item.parentId !== null) {
			throw new AppError("rule_violated", "Only an initiative can move to another bet, objective or Upkeep", {
				rule: "home_on_child",
				workItemId: item.id,
			});
		}

		const current = { betId: item.betId, objectiveId: item.objectiveId } satisfies Home;

		const target = payload.home === undefined ? current : await homeFor(context.tx, venture, payload.home);

		const here = { ventureId: venture.id, ...current, parentId: item.parentId };

		const changes: FieldChanges = {};

		if (workHomeKey(target) === workHomeKey(current)) {
			const siblings = await siblingIds(context.tx, here);

			if (payload.index >= siblings.length) throw indexOutOfRange(payload.index, siblings.length);

			if (payload.index === item.position) throw noChanges();

			const reordered = siblings.filter((id) => id !== item.id);

			reordered.splice(payload.index, 0, item.id);

			await renumber(context.tx, reordered);
		} else {
			const targetSiblings = await siblingIds(context.tx, { ventureId: venture.id, ...target, parentId: null });

			if (payload.index > targetSiblings.length) throw indexOutOfRange(payload.index, targetSiblings.length + 1);

			await context.tx
				.update(workItems)
				.set({ ...target, updatedAt: sql`now()` })
				.where(subtreeCondition(item));

			await renumber(context.tx, await siblingIds(context.tx, here));

			targetSiblings.splice(payload.index, 0, item.id);

			await renumber(context.tx, targetSiblings);

			changes.home = { from: workHomeKey(current), to: workHomeKey(target) };
		}

		changes.index = { from: item.position, to: payload.index };

		await context.tx.update(workItems).set({ updatedAt: sql`now()` }).where(eq(workItems.id, item.id));

		return {
			ventureId: venture.id,
			result: await reloadWorkItem(context.tx, item.id),
			events: [{ type: "work.moved", subject: `work:${item.id}`, payload: { title: item.title, changes } }],
		};
	},

	"work.archive": async (context, payload) => {
		const venture = requireVenture(context);

		const item = await liveWorkItem(context.tx, venture, payload.workItemId);

		const archived = await context.tx
			.update(workItems)
			.set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
			.where(and(subtreeCondition(item), isNull(workItems.archivedAt)))
			.returning({ id: workItems.id });

		await renumber(context.tx, await siblingIds(context.tx, item));

		const archivedIds = archived.map((row) => row.id);

		return {
			ventureId: venture.id,
			result: { workItem: await reloadWorkItem(context.tx, item.id), archivedIds },
			events: [{ type: "work.archived", subject: `work:${item.id}`, payload: { title: item.title, archivedIds } }],
		};
	},
} satisfies Omit<
	Handlers,
	| "proposal.create"
	| "proposal.approve"
	| "proposal.reject"
	| "access.request"
	| "access.approve"
	| "access.deny"
	| "grant.add"
	| "grant.revoke"
>;

export const handlers = {
	...domainHandlers,
	...proposalHandlers(domainHandlers),
	...accessHandlers,
} satisfies Handlers;
