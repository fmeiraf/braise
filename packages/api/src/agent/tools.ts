import { createHash } from "node:crypto";
import {
	assumptionStatuses,
	betMethods,
	betResults,
	type Capability,
	type CommandName,
	capabilityLabels,
	commandSchemas,
	draftNoteLength,
	failCauses,
	impacts,
	maxConfidence,
	maxDraftChanges,
	maxProposalChanges,
	maxThreadsStartedPerRun,
	operableCommands,
	proposalTitleLength,
	threadLinkTypes,
	workFunctions,
	workPriorities,
	workStatuses,
} from "@braise/core";
import { desc, eq } from "drizzle-orm";
import type pg from "pg";
import { z } from "zod";
import type { CodeHost } from "../code/host.ts";
import { codingTools } from "../code/tools.ts";
import type { Database } from "../db/client.ts";
import { bets, objectives, runs, workItems } from "../db/schema.ts";
import { boardOf } from "../draft-handlers.ts";
import { draftProjection } from "../draft-view.ts";
import { AppError } from "../errors.ts";
import { handlers } from "../handlers.ts";
import { executeCommand, type Services } from "../pipeline.ts";
import { renderBoard, renderDraftChanges } from "./board.ts";
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
	rootRunId?: string;
	threadId: string;
	chatOf?: { spaceId: string; ventureId: string | null } | null;
	operator?: { ventureId: string; slug: string } | null;
	onInputRequested?: () => void;
	coding?: { code: CodeHost; ventureId: string; threadTitle: string; signal: AbortSignal } | null;
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

export function toolIdempotencyKey(
	runId: string,
	call: number,
	name: string,
	payload: unknown,
	rootRunId: string = runId,
) {
	const digest = createHash("sha256").update(JSON.stringify({ name, payload })).digest("hex").slice(0, 32);

	return name.endsWith(".create") ? `run:${rootRunId}:create:${digest}` : `run:${runId}:${call}:${digest}`;
}

async function latestRunOf(db: Database, threadId: string) {
	const [run] = await db
		.select({ id: runs.id })
		.from(runs)
		.where(eq(runs.threadId, threadId))
		.orderBy(desc(runs.createdAt), desc(runs.id))
		.limit(1);

	if (run === undefined) throw new AppError("not_found", "The thread has no run to retry", { threadId });

	return run.id;
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

function cleanSchema(value: unknown) {
	if (Array.isArray(value)) {
		const items: unknown[] = value.map(cleanSchema);

		return items;
	}

	if (typeof value !== "object" || value === null) return value;

	const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) => {
		if (key === "$schema" || (key === "additionalProperties" && inner === false)) return [];

		if (key === "properties" && typeof inner === "object" && inner !== null) {
			const { ventureId: _ventureId, ...rest } = inner as Record<string, unknown>;

			return [[key, cleanSchema(rest)]];
		}

		if (key === "required" && Array.isArray(inner)) return [[key, inner.filter((field) => field !== "ventureId")]];

		return [[key, cleanSchema(inner)]];
	});

	const cleaned: unknown = Object.fromEntries(entries);

	return cleaned;
}

/** The payload schema of every operable command, generated from the zod schemas, without the venture id. */
export function operableSchemas() {
	return operableCommands
		.map((name) => `- ${name}: ${JSON.stringify(cleanSchema(z.toJSONSchema(commandSchemas[name], { io: "input" })))}`)
		.join("\n");
}

const draftDescription =
	() => `Draft one change to this venture's board: the owner sees it on the venture's pages at once and keeps or drops it. Nothing applies until the owner keeps it, so never say a change is applied.
Give the command, its payload (the fields below; ventureId is filled in for you) and a one-line note saying why, which becomes the recorded reason when kept.
Any id field that names something you drafted earlier may point at its change instead: {"change": "<change id>"} for objectiveId, assumptionId, betId, a home's id, a reading subject's id and parentId. To change an item that is itself still drafted, revise its change with draft_revise instead of drafting an update. The change is checked against the board with every other open change; an error comes back if it would fail. At most ${maxDraftChanges} open changes.
Commands and their payloads (JSON Schema):
${operableSchemas()}`;

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
				body: { payload, idempotencyKey: toolIdempotencyKey(scope.runId, call, name, payload, scope.rootRunId) },
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

	const chat = scope.chatOf ?? null;

	const delegateTools =
		chat === null
			? []
			: [
					defineTool({
						name: "start_thread",
						description: `Start a member thread in this space: pick the agent, give a short title and a first message that stands on its own (the agent sees only that thread). Its run is queued at once; you don't wait for it. At most ${maxThreadsStartedPerRun} per run.`,
						input: {
							agentProfileId: z.string().min(1).max(40).describe("The agent profile id, e.g. claude or gpt"),
							title: z.string().min(1).max(80),
							message: z.string().min(1).max(20_000),
						},
						execute: ({ agentProfileId, title, message }) =>
							command(
								"thread.start",
								{
									...(chat.ventureId === null ? {} : { ventureId: chat.ventureId }),
									spaceId: chat.spaceId,
									agentProfileId,
									title,
									body: message,
								},
								(result) => {
									const started = result as { thread: { id: string }; run: { id: string } };

									return { threadId: started.thread.id, runId: started.run.id, status: "queued" };
								},
							),
					}),
					defineTool({
						name: "message_thread",
						description:
							"Send a follow-up message to a member thread of this space and queue its agent's run. Refused while that thread's agent is still working.",
						input: { threadId: z.uuid(), message: z.string().min(1).max(20_000) },
						execute: ({ threadId, message }) => command("thread.message", { threadId, body: message }),
					}),
					defineTool({
						name: "retry_thread",
						description:
							"Retry a member thread whose latest run failed or was interrupted. The retry sees what the earlier attempt already did and continues from there.",
						input: { threadId: z.uuid() },
						execute: ({ threadId }) =>
							attempt(async () => command("run.retry", { runId: await latestRunOf(scope.db, threadId) })),
					}),
					defineTool({
						name: "add_thread_to_space",
						description: "Add an existing thread of the same scope to this space.",
						input: { threadId: z.uuid() },
						execute: ({ threadId }) => command("space.add_thread", { spaceId: chat.spaceId, threadId }),
					}),
					defineTool({
						name: "remove_thread_from_space",
						description: "Remove a member thread from this space; its history stays.",
						input: { threadId: z.uuid() },
						execute: ({ threadId }) => command("space.remove_thread", { spaceId: chat.spaceId, threadId }),
					}),
				];

	const coding =
		scope.coding === null || scope.coding === undefined
			? []
			: codingTools({
					db: scope.db,
					code: scope.coding.code,
					threadId: scope.threadId,
					threadTitle: scope.coding.threadTitle,
					ventureId: scope.coding.ventureId,
					signal: scope.coding.signal,
					command: (name, payload) => command(name, payload),
					fail: failure,
				});

	const operator = scope.operator ?? null;

	const askOwner = defineTool({
		name: "ask_owner",
		description:
			"Ask the owner one clear question you can't answer by looking things up. It goes to the owner's inbox as Needs you, and your run ends right after; the owner's reply in this thread starts your next run.",
		input: { question: z.string().min(1).max(4_000) },
		execute: async ({ question }) => {
			const output = await command("input.request", { question }, () => ({
				asked: true,
				message: "Asked. Your run ends now; the owner's reply resumes the work.",
			}));

			if (!output.isError) scope.onInputRequested?.();

			return output;
		},
	});

	const readTools = [
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
	];

	const linkTools = [
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

	if (operator !== null) {
		const drafted = (result: unknown) => {
			const added = result as { changeId: string; entityId: string | null; label: string; open: number };

			return { changeId: added.changeId, entityId: added.entityId, label: added.label, openChanges: added.open };
		};

		return [
			defineTool({
				name: "board",
				description:
					"Read this venture's board as the owner sees it now: strategy, objectives, assumptions, bets and the work tree, with every drafted change in place and marked with its change id, then the open changes with any that are stale or fail.",
				input: {},
				execute: () =>
					attempt(async () => {
						const projected = await draftProjection(scope.db, handlers, scope.services, operator.slug);

						const board = projected?.board ?? (await boardOf(scope.db, operator.slug));

						return ok(
							`${renderBoard(board, projected?.draft ?? null)}\n\nOpen draft changes:\n${renderDraftChanges(projected?.draft ?? null)}`,
						);
					}),
			}),
			defineTool({
				name: "draft",
				description: draftDescription(),
				input: {
					command: z.enum(operableCommands),
					payload: z.record(z.string(), z.unknown()).describe("The command's fields, without ventureId"),
					note: z.string().min(1).max(draftNoteLength).describe("Why, in one line"),
				},
				execute: ({ command: name, payload, note }) =>
					command("draft.add", { ventureId: operator.ventureId, command: name, payload, note }, drafted),
			}),
			defineTool({
				name: "draft_revise",
				description:
					"Replace the payload of an open drafted change (give the whole payload, as for draft). Use it to change something you drafted, to keep the owner's edits while changing another field, or to re-check a stale change against the board as it is now.",
				input: {
					changeId: z.uuid(),
					payload: z.record(z.string(), z.unknown()),
					note: z.string().min(1).max(draftNoteLength).optional(),
				},
				execute: ({ changeId, payload, note }) =>
					command(
						"draft.revise",
						{ ventureId: operator.ventureId, changeId, payload, ...(note === undefined ? {} : { note }) },
						drafted,
					),
			}),
			defineTool({
				name: "draft_remove",
				description:
					"Withdraw an open drafted change, and with it every open change that points at it. The result lists what was withdrawn.",
				input: { changeId: z.uuid() },
				execute: ({ changeId }) => command("draft.remove", { ventureId: operator.ventureId, changeId }),
			}),
			askOwner,
			...readTools,
			...linkTools,
		];
	}

	return [
		...coding,
		defineTool({
			name: "ask_owner",
			description:
				"Ask the owner one clear question you can't answer by looking things up. It goes to the owner's inbox as Needs you, and your run ends right after; the owner's reply in this thread starts your next run.",
			input: { question: z.string().min(1).max(4_000) },
			execute: async ({ question }) => {
				const output = await command("input.request", { question }, () => ({
					asked: true,
					message: "Asked. Your run ends now; the owner's reply resumes the work.",
				}));

				if (!output.isError) scope.onInputRequested?.();

				return output;
			},
		}),
		...delegateTools,
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
