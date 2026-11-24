import { createHash } from "node:crypto";
import { type CommandName, threadLinkTypes, workFunctions, workPriorities, workStatuses } from "@braise/core";
import { eq } from "drizzle-orm";
import type pg from "pg";
import { z } from "zod";
import type { Database } from "../db/client.ts";
import { goals, workItems } from "../db/schema.ts";
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

function failure(error: unknown) {
	if (error instanceof AppError) return { text: JSON.stringify(error.toBody().error), isError: true };

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

async function ventureOfGoal(db: Database, goalId: string) {
	const [goal] = await db.select({ ventureId: goals.ventureId }).from(goals).where(eq(goals.id, goalId));

	if (goal === undefined) throw new AppError("not_found", "Goal not found", { goalId });

	return goal.ventureId;
}

export function toolIdempotencyKey(runId: string, call: number, name: string, payload: unknown) {
	const digest = createHash("sha256").update(JSON.stringify({ name, payload })).digest("hex").slice(0, 32);

	return `run:${runId}:${call}:${digest}`;
}

const linkShape = {
	type: z.enum(threadLinkTypes).describe("What the link points at"),
	id: z.uuid().describe("The id of the work item, goal, bet or venture"),
};

const sqlDescription = `Run one read-only SQL SELECT against braise's Postgres database and get the rows as JSON.
Use describe_schema first to see the tables. At most ${maxQueryRows} rows come back; the query times out after ${readerStatementTimeoutMs / 1000}s.
Rows with archived_at set are archived. The active strategy of a venture has status 'active'.`;

export function braiseTools(scope: ToolScope) {
	let calls = 0;

	const command = async (name: CommandName, payload: Record<string, unknown>) => {
		calls += 1;

		const call = calls;

		try {
			const response = await executeCommand(scope.db, handlers, scope.services, {
				name,
				body: { payload, idempotencyKey: toolIdempotencyKey(scope.runId, call, name, payload) },
				actor: scope.actor,
				runId: scope.runId,
			});

			return ok(response.result);
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
				"Create a work item. Give goalId for a new initiative (top level) or parentId for a task or subtask (at most three levels). An initiative needs a function; a child inherits its parent's.",
			input: {
				goalId: z.uuid().optional(),
				parentId: z.uuid().optional(),
				title: z.string().min(1).max(500),
				description: z.string().max(10_000).optional(),
				function: z.enum(workFunctions).optional(),
				priority: z.enum(workPriorities).optional(),
			},
			execute: (args) =>
				attempt(async () => {
					if (args.parentId !== undefined) {
						return command("work.create", {
							ventureId: await ventureOfWorkItem(scope.db, args.parentId),
							...args,
						});
					}

					if (args.goalId !== undefined) {
						return command("work.create", { ventureId: await ventureOfGoal(scope.db, args.goalId), ...args });
					}

					return failure(new AppError("validation_failed", "Give goalId (new initiative) or parentId"));
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
				"Reorder a work item among its siblings (index is 0-based). For an initiative, goalId moves it and its subtree to another goal of the same venture.",
			input: { workItemId: z.uuid(), index: z.number().int().min(0), goalId: z.uuid().optional() },
			execute: (args) =>
				attempt(async () =>
					command("work.move", { ventureId: await ventureOfWorkItem(scope.db, args.workItemId), ...args }),
				),
		}),
		defineTool({
			name: "link_thread",
			description: "Link this thread to a work item, goal, bet or venture, so it shows up there.",
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
