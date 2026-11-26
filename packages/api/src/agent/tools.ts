import { createHash } from "node:crypto";
import {
	assumptionStatuses,
	betMethods,
	betResults,
	type Capability,
	type CommandName,
	capabilityLabels,
	failCauses,
	impacts,
	maxConfidence,
	maxProposalChanges,
	proposalTitleLength,
	threadLinkTypes,
	workFunctions,
	workPriorities,
	workStatuses,
} from "@braise/core";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { z } from "zod";
import type { Database } from "../db/client.ts";
import { bets, objectives, workItems } from "../db/schema.ts";
import { AppError } from "../errors.ts";
import { handlers } from "../handlers.ts";
import { executeCommand, type Services } from "../pipeline.ts";
import { type Reader, readerStatementTimeoutMs } from "./reader.ts";
import type { AgentTool, ToolOutput } from "./runtime.ts";

export const maxQueryRows = 200;

const maxOutputLength = 60_000;

export interface ToolScope {
	db: Database;
	reader: Reader;
	services: Services;
	actor: string;
	runId: string;
	threadId: string;
}

function defineTool<Shape extends z.ZodRawShape>(tool: {
	name: string;
	description: string;
	input: Shape;
	execute(args: z.output<z.ZodObject<Shape>>): Promise<ToolOutput>;
}) {
	const schema = z.object(tool.input);

	return {
		name: tool.name,
		description: tool.description,
		input: tool.input,
		execute: (args: unknown) => tool.execute(schema.parse(args)),
	} satisfies AgentTool;
}

function ok(value: unknown) {
	const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);

	return { text: text.length > maxOutputLength ? `${text.slice(0, maxOutputLength)}\n…(cut)` : text, isError: false };
}

function accessRequested(error: AppError) {
	const { accessRequestId, capability } = error.details;

	if (error.code !== "not_granted" || typeof accessRequestId !== "string" || typeof capability !== "string") {
		return null;
	}

	const label = capabilityLabels[capability as Capability];

	return {
		text: JSON.stringify({
			accessRequested: { accessRequestId, capability, label },
			message: `Access requested · ${label}. The owner decides in the inbox; carry on with what you can and tell the owner. Don't retry until the owner says it's granted.`,
		}),
		isError: false,
	};
}

function failure(error: unknown) {
	if (error instanceof AppError) {
		return accessRequested(error) ?? { text: JSON.stringify(error.toBody().error), isError: true };
	}

	return { text: error instanceof Error ? error.message : String(error), isError: true };
}

export async function readOnly<Result>(reader: Reader, work: (client: pg.PoolClient) => Promise<Result>) {
	const client = await reader.connect();

	let broken: Error | undefined;

	try {
		await client.query("BEGIN READ ONLY");

		return await work(client);
	} finally {
		try {
			await client.query("ROLLBACK");
		} catch (error) {
			broken = error instanceof Error ? error : new Error(String(error));

			console.error("agent: read-only rollback failed; discarding the connection", broken);
		} finally {
			client.release(broken);
		}
	}
}

export function wrapQuery(statement: string) {
	const trimmed = statement.trim().replace(/;+\s*$/u, "");

	return `SELECT * FROM (${trimmed}\n) AS result LIMIT $1`;
}

export async function runReadQuery(reader: Reader, statement: string) {
	const result = await readOnly(reader, (client) =>
		client.query<Record<string, unknown>>(wrapQuery(statement), [maxQueryRows + 1]),
	);

	const truncated = result.rows.length > maxQueryRows;

	return { rows: result.rows.slice(0, maxQueryRows), rowCount: Math.min(result.rows.length, maxQueryRows), truncated };
}

export async function describeSchema(reader: Reader) {
	const result = await readOnly(reader, (client) =>
		client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
			`SELECT table_name, column_name, data_type, is_nullable
			 FROM information_schema.columns
			 WHERE table_schema = 'public'
			 ORDER BY table_name, ordinal_position`,
		),
	);

	const tables = new Map<string, string[]>();

	for (const row of result.rows) {
		const column = `${row.column_name} ${row.data_type}${row.is_nullable === "YES" ? " null" : ""}`;

		tables.set(row.table_name, [...(tables.get(row.table_name) ?? []), column]);
	}

	return [...tables.entries()].map(([table, columns]) => `${table}(${columns.join(", ")})`).join("\n");
}

async function ventureOfWorkItem(db: Database, workItemId: string) {
	const [item] = await db
		.select({ ventureId: workItems.ventureId })
		.from(workItems)
		.where(eq(workItems.id, workItemId));

	if (item === undefined) throw new AppError("not_found", "Work item not found", { workItemId });

	return item.ventureId;
}

async function ventureOfBet(db: Database, betId: string) {
	const [bet] = await db.select({ ventureId: bets.ventureId }).from(bets).where(eq(bets.id, betId));

	if (bet === undefined) throw new AppError("not_found", "Bet not found", { betId });

	return bet.ventureId;
}

async function ventureOfObjective(db: Database, objectiveId: string) {
	const [objective] = await db
		.select({ ventureId: objectives.ventureId })
		.from(objectives)
		.where(eq(objectives.id, objectiveId));

	if (objective === undefined) throw new AppError("not_found", "Objective not found", { objectiveId });

	return objective.ventureId;
}

interface HomeArgs {
	betId?: string | undefined;
	objectiveId?: string | undefined;
	upkeepVentureId?: string | undefined;
}

async function homeOf(db: Database, args: HomeArgs) {
	const given = [args.betId, args.objectiveId, args.upkeepVentureId].filter((value) => value !== undefined);

	if (given.length !== 1) return null;

	if (args.betId !== undefined) {
		return { ventureId: await ventureOfBet(db, args.betId), home: { type: "bet", id: args.betId } };
	}

	if (args.objectiveId !== undefined) {
		return {
			ventureId: await ventureOfObjective(db, args.objectiveId),
			home: { type: "objective", id: args.objectiveId },
		};
	}

	return { ventureId: args.upkeepVentureId, home: { type: "upkeep" } };
}

export function toolIdempotencyKey(runId: string, call: number, name: string, payload: unknown) {
	const digest = createHash("sha256").update(JSON.stringify({ name, payload })).digest("hex").slice(0, 32);

	return `run:${runId}:${call}:${digest}`;
}

const reference = (target: string) =>
	z.union([
		z.uuid(),
		z.strictObject({ ref: z.number().int().min(0).describe(`Index of an earlier ${target} in this proposal`) }),
	]);

const isoDate = z.iso.date();

const fn = z.enum(workFunctions);

const confidence = z.number().int().min(0).max(maxConfidence);

const proposedChange = z.discriminatedUnion("command", [
	z.object({
		command: z.literal("strategy.revise"),
		why: z.string().min(1),
		what: z.string().min(1),
		diagnosis: z.string(),
		guidingPolicy: z.string(),
	}),
	z.object({
		command: z.literal("objective.create"),
		kind: z.enum(["metric", "learning", "build"]),
		statement: z
			.string()
			.min(1)
			.describe("The target, the question (learning) or the thing that should exist (build)"),
		byDate: isoDate.nullable().optional().describe("Required for metric and build (the time box)"),
		guardrails: z.string().optional().describe("Numbers that must not get worse on the way"),
		budget: z.string().optional(),
		measure: z.string().optional().describe("metric: what is measured"),
		unit: z.string().optional().describe("metric: short unit shown after values, e.g. % or €"),
		baseline: z.number().optional().describe("metric"),
		target: z.number().optional().describe("metric"),
		decision: z.string().optional().describe("learning: the decision the answer changes"),
		doneRule: z.string().optional().describe("learning: when the question counts as answered"),
		doneList: z.array(z.string().min(1)).optional().describe("build: what done means, one line each"),
	}),
	z.object({
		command: z.literal("objective.update"),
		objectiveId: z.uuid(),
		statement: z.string().min(1).optional(),
		byDate: isoDate.nullable().optional(),
		guardrails: z.string().optional(),
		budget: z.string().optional(),
		measure: z.string().optional(),
		unit: z.string().optional(),
		baseline: z.number().optional(),
		target: z.number().optional(),
		decision: z.string().optional(),
		doneRule: z.string().optional(),
		doneList: z
			.array(z.object({ id: z.uuid().optional(), text: z.string().min(1) }))
			.optional()
			.describe("build: the whole list; give an item's id to keep it and its tick"),
	}),
	z.object({
		command: z.literal("objective.close"),
		objectiveId: z.uuid(),
		status: z.enum(["met", "dropped"]),
	}),
	z.object({
		command: z.literal("assumption.create"),
		objectiveId: reference("objective.create")
			.nullable()
			.describe("A metric or learning objective, or null to note it under Worth testing later"),
		statement: z.string().min(1).describe("One falsifiable sentence that must be true for the objective"),
		impact: z.enum(impacts).describe("How badly the objective fails if this is false"),
		confidence: confidence.min(1).optional().describe("1 unless existing evidence already earns more"),
		function: fn,
	}),
	z.object({
		command: z.literal("assumption.update"),
		assumptionId: z.uuid(),
		objectiveId: reference("objective.create").nullable().optional(),
		statement: z.string().min(1).optional(),
		impact: z.enum(impacts).optional(),
		function: fn.optional(),
		status: z.enum(assumptionStatuses).optional(),
	}),
	z.object({
		command: z.literal("bet.create"),
		assumptionId: reference("assumption.create"),
		function: fn.describe("The function that leads the bet"),
		action: z.string().min(1).describe("What will be done"),
		signal: z.string().min(1).describe("The number that is read"),
		unit: z.string().optional(),
		baseline: z.number().nullable().optional(),
		passAt: z.number().describe("The reading that counts as a pass"),
		failAt: z.number().describe("The reading past which the bet fails; between the two is inconclusive"),
		method: z.enum(betMethods),
		budget: z.string().optional(),
		deadline: isoDate,
	}),
	z.object({
		command: z.literal("bet.update"),
		betId: z.uuid(),
		function: fn.optional(),
		action: z.string().min(1).optional(),
		signal: z.string().min(1).optional(),
		unit: z.string().optional(),
		baseline: z.number().nullable().optional(),
		passAt: z.number().optional(),
		failAt: z.number().optional(),
		method: z.enum(betMethods).optional(),
		budget: z.string().optional(),
		deadline: isoDate.optional(),
	}),
	z.object({
		command: z.literal("bet.close"),
		betId: z.uuid(),
		result: z.enum(betResults),
		cause: z.enum(failCauses).optional().describe("Only for fail: was the idea wrong, or the execution?"),
		statement: z.string().min(1).describe("The learning: one or two sentences worth remembering"),
		confidenceTo: confidence.optional().describe("Leave out to take what the result and method earn"),
	}),
]);

const proposeDescription = `Propose changes to a venture's strategy, objectives, assumptions or bets for the owner to approve. Nothing changes until the owner approves in the inbox; they may edit or drop changes, or reject with a note, and the decision appears in this thread as a braise line.
Group related changes into one proposal, in the order they should apply. strategy.revise needs the full new text of all four fields (copy unchanged ones). A change can build on an earlier one in the same proposal: give objectiveId or assumptionId as {"ref": <index of that objective.create or assumption.create>}. Closing a bet and registering the next one belong in one proposal.
The changes are checked right away; an error comes back if one would fail.`;

const linkShape = {
	type: z.enum(threadLinkTypes).describe("What the link points at"),
	id: z.uuid().describe("The id of the work item, bet, assumption, objective or venture"),
};

const sqlDescription = `Run one read-only SQL SELECT against braise's Postgres database and get the rows as JSON.
Use describe_schema first to see the tables. At most ${maxQueryRows} rows come back; the query times out after ${readerStatementTimeoutMs / 1000}s.
Rows with archived_at set are archived. The active strategy of a venture has status 'active'.`;

export function braiseTools(scope: ToolScope) {
	let calls = 0;

	const command = async (
		name: CommandName,
		payload: Record<string, unknown>,
		present: (result: unknown) => unknown = (result) => result,
	) => {
		calls += 1;

		const call = calls;

		try {
			const response = await executeCommand(scope.db, handlers, scope.services, {
				name,
				body: { payload, idempotencyKey: toolIdempotencyKey(scope.runId, call, name, payload) },
				actor: scope.actor,
				runId: scope.runId,
			});

			return ok(present(response.result));
		} catch (error) {
			return failure(error);
		}
	};

	const attempt = async (work: () => Promise<ToolOutput>) => {
		try {
			return await work();
		} catch (error) {
			return failure(error);
		}
	};

	return [
		defineTool({
			name: "describe_schema",
			description: "List the tables and columns of braise's database that the query tool can read.",
			input: {},
			execute: () => attempt(async () => ok(await describeSchema(scope.reader))),
		}),
		defineTool({
			name: "query",
			description: sqlDescription,
			input: { sql: z.string().min(1).max(10_000).describe("One SELECT statement, without a trailing semicolon") },
			execute: ({ sql }) => attempt(async () => ok(await runReadQuery(scope.reader, sql))),
		}),
		defineTool({
			name: "create_work_item",
			description:
				"Create a work item. For a new initiative (top level) say where it lives: betId (an open bet), objectiveId (an active build objective) or upkeepVentureId (work that tests nothing). For a task or subtask give parentId (at most three levels). An initiative needs a function; a child inherits its parent's.",
			input: {
				betId: z.uuid().optional(),
				objectiveId: z.uuid().optional(),
				upkeepVentureId: z.uuid().optional(),
				parentId: z.uuid().optional(),
				title: z.string().min(1).max(500),
				description: z.string().max(10_000).optional(),
				function: z.enum(workFunctions).optional(),
				priority: z.enum(workPriorities).optional(),
			},
			execute: ({ betId, objectiveId, upkeepVentureId, ...fields }) =>
				attempt(async () => {
					if (fields.parentId !== undefined) {
						return command("work.create", {
							ventureId: await ventureOfWorkItem(scope.db, fields.parentId),
							...fields,
						});
					}

					const placed = await homeOf(scope.db, { betId, objectiveId, upkeepVentureId });

					if (placed === null) {
						return failure(
							new AppError(
								"validation_failed",
								"Give exactly one of betId, objectiveId, upkeepVentureId or parentId",
							),
						);
					}

					return command("work.create", { ...placed, ...fields });
				}),
		}),
		defineTool({
			name: "update_work_item",
			description: "Change a work item's title, description, function or priority.",
			input: {
				workItemId: z.uuid(),
				title: z.string().min(1).max(500).optional(),
				description: z.string().max(10_000).optional(),
				function: z.enum(workFunctions).optional(),
				priority: z.enum(workPriorities).optional(),
			},
			execute: (args) =>
				attempt(async () =>
					command("work.update", { ventureId: await ventureOfWorkItem(scope.db, args.workItemId), ...args }),
				),
		}),
		defineTool({
			name: "set_work_item_status",
			description: "Set a work item's status to todo, doing or done.",
			input: { workItemId: z.uuid(), status: z.enum(workStatuses) },
			execute: (args) =>
				attempt(async () =>
					command("work.set_status", { ventureId: await ventureOfWorkItem(scope.db, args.workItemId), ...args }),
				),
		}),
		defineTool({
			name: "move_work_item",
			description:
				"Reorder a work item among its siblings (index is 0-based). For an initiative, betId, objectiveId or upkeep: true moves it and its subtree to another open bet, build objective or Upkeep of the same venture.",
			input: {
				workItemId: z.uuid(),
				index: z.number().int().min(0),
				betId: z.uuid().optional(),
				objectiveId: z.uuid().optional(),
				upkeep: z.literal(true).optional(),
			},
			execute: ({ workItemId, index, betId, objectiveId, upkeep }) =>
				attempt(async () => {
					const ventureId = await ventureOfWorkItem(scope.db, workItemId);

					const placed = await homeOf(scope.db, {
						betId,
						objectiveId,
						upkeepVentureId: upkeep === true ? ventureId : undefined,
					});

					return command("work.move", {
						ventureId,
						workItemId,
						index,
						...(placed === null ? {} : { home: placed.home }),
					});
				}),
		}),
		defineTool({
			name: "record_reading",
			description:
				"Record a measured value for a metric objective (objectiveId) or an open bet (betId): the number, the day it was taken and where it came from. The latest reading by day is the one a bet is judged on.",
			input: {
				betId: z.uuid().optional(),
				objectiveId: z.uuid().optional(),
				value: z.number(),
				takenOn: isoDate.describe("The day the value was measured"),
				source: z.string().min(1).max(500).describe("Where the number comes from"),
			},
			execute: ({ betId, objectiveId, ...reading }) =>
				attempt(async () => {
					const placed = await homeOf(scope.db, { betId, objectiveId });

					if (placed === null) return failure(new AppError("validation_failed", "Give betId or objectiveId"));

					return command("reading.record", { ventureId: placed.ventureId, subject: placed.home, ...reading });
				}),
		}),
		defineTool({
			name: "check_done_item",
			description: "Tick or untick one line of a build objective's done list.",
			input: { objectiveId: z.uuid(), itemId: z.uuid(), done: z.boolean() },
			execute: (args) =>
				attempt(async () =>
					command("objective.check", { ventureId: await ventureOfObjective(scope.db, args.objectiveId), ...args }),
				),
		}),
		defineTool({
			name: "propose_changes",
			description: proposeDescription,
			input: {
				ventureId: z.uuid(),
				title: z.string().min(1).max(proposalTitleLength).describe("Short name for the proposal"),
				reason: z.string().min(1).max(2_000).describe("Why: becomes the recorded reason when approved"),
				changes: z.array(proposedChange).min(1).max(maxProposalChanges),
			},
			execute: ({ ventureId, title, reason, changes }) =>
				command(
					"proposal.create",
					{
						ventureId,
						threadId: scope.threadId,
						title,
						reason,
						changes: changes.map(({ command: name, ...payload }) => ({ command: name, payload })),
					},
					(result) => {
						const proposal = result as { id: string; status: string };

						return {
							proposalId: proposal.id,
							status: proposal.status,
							changes: changes.length,
							inbox: `/inbox?proposal=${proposal.id}`,
						};
					},
				),
		}),
		defineTool({
			name: "link_thread",
			description: "Link this thread to a work item, bet, assumption, objective or venture, so it shows up there.",
			input: linkShape,
			execute: (link) => command("thread.link", { threadId: scope.threadId, link }),
		}),
		defineTool({
			name: "unlink_thread",
			description: "Remove a link from this thread.",
			input: linkShape,
			execute: (link) => command("thread.unlink", { threadId: scope.threadId, link }),
		}),
	];
}
