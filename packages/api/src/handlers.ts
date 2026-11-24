import { type FieldChanges, slugify } from "@braise/core";
import { and, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Transaction } from "./db/client.ts";
import { bets, goals, strategyVersions, ventures } from "./db/schema.ts";
import { AppError } from "./errors.ts";
import type { HandlerContext, Handlers, VentureRow } from "./pipeline.ts";

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

async function linkableBet(tx: Transaction, venture: VentureRow, betId: string) {
	const [bet] = await tx.select().from(bets).where(eq(bets.id, betId));

	if (bet === undefined || bet.ventureId !== venture.id || bet.archivedAt !== null) {
		throw new AppError("rule_violated", "A goal can only test a live bet of the same venture", {
			rule: "bet_not_in_venture",
			betId,
		});
	}

	return bet;
}

async function liveGoal(tx: Transaction, venture: VentureRow, goalId: string) {
	const [goal] = await tx
		.select()
		.from(goals)
		.where(and(eq(goals.id, goalId), eq(goals.ventureId, venture.id)));

	if (goal === undefined) throw new AppError("not_found", "Goal not found", { goalId });

	if (goal.archivedAt !== null) {
		throw new AppError("rule_violated", "The goal is archived", { rule: "goal_archived", goalId });
	}

	return goal;
}

export const handlers = {
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

	"bet.create": async (context, payload) => {
		const venture = requireVenture(context);

		const strategy = await activeStrategy(context.tx, venture.id);

		const [bet] = await context.tx
			.insert(bets)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				hypothesis: payload.hypothesis,
				action: payload.action,
				killCriteria: payload.killCriteria,
				introducedIn: strategy.id,
			})
			.returning();

		return {
			ventureId: venture.id,
			result: bet,
			events: [
				{
					type: "bet.created",
					subject: `bet:${bet?.id}`,
					payload: { hypothesis: payload.hypothesis, strategyVersion: strategy.version },
				},
			],
		};
	},

	"bet.update": async (context, payload) => {
		const venture = requireVenture(context);

		const bet = await liveBet(context.tx, venture, payload.betId);

		const changes = changesBetween(bet, {
			hypothesis: payload.hypothesis,
			action: payload.action,
			killCriteria: payload.killCriteria,
		});

		if (!hasChanges(changes)) throw noChanges();

		const [updated] = await context.tx
			.update(bets)
			.set({
				hypothesis: payload.hypothesis,
				action: payload.action,
				killCriteria: payload.killCriteria,
				updatedAt: sql`now()`,
			})
			.where(eq(bets.id, bet.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [{ type: "bet.updated", subject: `bet:${bet.id}`, payload: { hypothesis: bet.hypothesis, changes } }],
		};
	},

	"bet.archive": async (context, payload) => {
		const venture = requireVenture(context);

		const bet = await liveBet(context.tx, venture, payload.betId);

		const [liveGoalOfBet] = await context.tx
			.select({ id: goals.id })
			.from(goals)
			.where(and(eq(goals.betId, bet.id), isNull(goals.archivedAt)))
			.limit(1);

		if (liveGoalOfBet !== undefined) {
			throw new AppError("rule_violated", "Archive or move this bet's goals first", {
				rule: "bet_has_goals",
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
			events: [{ type: "bet.archived", subject: `bet:${bet.id}`, payload: { hypothesis: bet.hypothesis } }],
		};
	},

	"bet.set_status": async (context, payload) => {
		const venture = requireVenture(context);

		const bet = await liveBet(context.tx, venture, payload.betId);

		if (bet.status !== "open") {
			throw new AppError("rule_violated", "Only an open bet can be settled", {
				rule: "bet_not_open",
				status: bet.status,
			});
		}

		const [updated] = await context.tx
			.update(bets)
			.set({ status: payload.status, updatedAt: sql`now()` })
			.where(eq(bets.id, bet.id))
			.returning();

		const archivedGoals = payload.archiveGoals
			? await context.tx
					.update(goals)
					.set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
					.where(and(eq(goals.betId, bet.id), isNull(goals.archivedAt)))
					.returning()
			: [];

		return {
			ventureId: venture.id,
			result: { bet: updated, archivedGoals },
			events: [
				{
					type: "bet.status_set",
					subject: `bet:${bet.id}`,
					payload: { hypothesis: bet.hypothesis, changes: { status: { from: bet.status, to: payload.status } } },
				},
				...archivedGoals.map((goal) => ({
					type: "goal.archived",
					subject: `goal:${goal.id}`,
					payload: { outcome: goal.outcome },
				})),
			],
		};
	},

	"goal.create": async (context, payload) => {
		const venture = requireVenture(context);

		if (payload.betId !== null) await linkableBet(context.tx, venture, payload.betId);

		const [goal] = await context.tx
			.insert(goals)
			.values({
				id: uuidv7(),
				ventureId: venture.id,
				betId: payload.betId,
				outcome: payload.outcome,
				signal: payload.signal,
				horizon: payload.horizon,
			})
			.returning();

		return {
			ventureId: venture.id,
			result: goal,
			events: [
				{
					type: "goal.created",
					subject: `goal:${goal?.id}`,
					payload: { outcome: payload.outcome, betId: payload.betId },
				},
			],
		};
	},

	"goal.update": async (context, payload) => {
		const venture = requireVenture(context);

		const goal = await liveGoal(context.tx, venture, payload.goalId);

		if (payload.betId !== undefined && payload.betId !== null) await linkableBet(context.tx, venture, payload.betId);

		const next = {
			betId: payload.betId,
			outcome: payload.outcome,
			signal: payload.signal,
			horizon: payload.horizon,
		};

		const changes = changesBetween(goal, next);

		if (!hasChanges(changes)) throw noChanges();

		const [updated] = await context.tx
			.update(goals)
			.set({ ...next, updatedAt: sql`now()` })
			.where(eq(goals.id, goal.id))
			.returning();

		return {
			ventureId: venture.id,
			result: updated,
			events: [{ type: "goal.updated", subject: `goal:${goal.id}`, payload: { outcome: goal.outcome, changes } }],
		};
	},

	"goal.archive": async (context, payload) => {
		const venture = requireVenture(context);

		const goal = await liveGoal(context.tx, venture, payload.goalId);

		const [archived] = await context.tx
			.update(goals)
			.set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
			.where(eq(goals.id, goal.id))
			.returning();

		return {
			ventureId: venture.id,
			result: archived,
			events: [{ type: "goal.archived", subject: `goal:${goal.id}`, payload: { outcome: goal.outcome } }],
		};
	},
} satisfies Handlers;
