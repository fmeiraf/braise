import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const archivedAt = () => timestamp("archived_at", { withTimezone: true });

export const ventures = pgTable(
	"ventures",
	{
		id: uuid("id").primaryKey(),
		slug: text("slug").notNull().unique(),
		name: text("name").notNull(),
		kind: text("kind", { enum: ["for_profit", "non_profit"] }).notNull(),
		lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		archivedAt: archivedAt(),
	},
	(table) => [check("ventures_kind_check", sql`${table.kind} IN ('for_profit','non_profit')`)],
);

export const strategyVersions = pgTable(
	"strategy_versions",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		version: integer("version").notNull(),
		status: text("status", { enum: ["draft", "active", "superseded"] }).notNull(),
		why: text("why").notNull(),
		what: text("what").notNull(),
		diagnosis: text("diagnosis").notNull().default(""),
		guidingPolicy: text("guiding_policy").notNull().default(""),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
		activatedAt: timestamp("activated_at", { withTimezone: true }),
	},
	(table) => [
		unique("strategy_versions_venture_version_unique").on(table.ventureId, table.version),
		uniqueIndex("strategy_versions_one_active").on(table.ventureId).where(sql`${table.status} = 'active'`),
		check("strategy_versions_status_check", sql`${table.status} IN ('draft','active','superseded')`),
	],
);

export const bets = pgTable(
	"bets",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		hypothesis: text("hypothesis").notNull(),
		action: text("action").notNull(),
		killCriteria: text("kill_criteria").notNull(),
		status: text("status", { enum: ["open", "won", "lost", "killed"] })
			.notNull()
			.default("open"),
		introducedIn: uuid("introduced_in")
			.notNull()
			.references(() => strategyVersions.id),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		archivedAt: archivedAt(),
	},
	(table) => [
		index("bets_venture_idx").on(table.ventureId),
		check("bets_status_check", sql`${table.status} IN ('open','won','lost','killed')`),
	],
);

export const goals = pgTable(
	"goals",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		betId: uuid("bet_id").references(() => bets.id),
		outcome: text("outcome").notNull(),
		signal: text("signal").notNull(),
		horizon: date("horizon", { mode: "string" }),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		archivedAt: archivedAt(),
	},
	(table) => [index("goals_venture_idx").on(table.ventureId)],
);

export const workItems = pgTable(
	"work_items",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		goalId: uuid("goal_id")
			.notNull()
			.references(() => goals.id),
		parentId: uuid("parent_id"),
		depth: smallint("depth").notNull(),
		position: integer("position").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status", { enum: ["todo", "doing", "done"] })
			.notNull()
			.default("todo"),
		function: text("function", {
			enum: ["product", "design", "engineering", "marketing", "sales", "ops"],
		}).notNull(),
		priority: text("priority", { enum: ["none", "low", "medium", "high", "urgent"] })
			.notNull()
			.default("none"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		archivedAt: archivedAt(),
	},
	(table) => [
		foreignKey({ columns: [table.parentId], foreignColumns: [table.id] }),
		index("work_items_venture_idx").on(table.ventureId),
		index("work_items_goal_idx").on(table.goalId),
		index("work_items_parent_idx").on(table.parentId),
		check("work_items_depth_check", sql`${table.depth} BETWEEN 0 AND 2`),
		check("work_items_status_check", sql`${table.status} IN ('todo','doing','done')`),
		check(
			"work_items_function_check",
			sql`${table.function} IN ('product','design','engineering','marketing','sales','ops')`,
		),
		check("work_items_priority_check", sql`${table.priority} IN ('none','low','medium','high','urgent')`),
	],
);

export const commands = pgTable("commands", {
	id: uuid("id").primaryKey(),
	idempotencyKey: text("idempotency_key").notNull().unique(),
	name: text("name").notNull(),
	ventureId: uuid("venture_id"),
	actor: text("actor").notNull(),
	reason: text("reason"),
	payload: jsonb("payload").notNull(),
	payloadHash: text("payload_hash").notNull(),
	result: jsonb("result"),
	runId: uuid("run_id"),
	createdAt: createdAt(),
});

export const events = pgTable(
	"events",
	{
		ventureId: uuid("venture_id").notNull(),
		seq: bigint("seq", { mode: "number" }).notNull(),
		commandId: uuid("command_id").notNull(),
		type: text("type").notNull(),
		subject: text("subject").notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		actor: text("actor").notNull(),
		runId: uuid("run_id"),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.ventureId, table.seq] }),
		foreignKey({ columns: [table.ventureId], foreignColumns: [ventures.id] }),
		foreignKey({ columns: [table.commandId], foreignColumns: [commands.id] }),
	],
);

export const threads = pgTable(
	"threads",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id").references(() => ventures.id),
		title: text("title").notNull(),
		lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		archivedAt: archivedAt(),
	},
	(table) => [index("threads_venture_updated_idx").on(table.ventureId, table.updatedAt.desc())],
);

export const threadLinks = pgTable(
	"thread_links",
	{
		threadId: uuid("thread_id")
			.notNull()
			.references(() => threads.id),
		subjectType: text("subject_type", { enum: ["work_item", "goal", "bet", "venture"] }).notNull(),
		subjectId: uuid("subject_id").notNull(),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.threadId, table.subjectType, table.subjectId] }),
		index("thread_links_subject_idx").on(table.subjectType, table.subjectId),
		check("thread_links_subject_type_check", sql`${table.subjectType} IN ('work_item','goal','bet','venture')`),
	],
);

export const runs = pgTable(
	"runs",
	{
		id: uuid("id").primaryKey(),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => threads.id),
		messageId: uuid("message_id").notNull(),
		retryOf: uuid("retry_of"),
		runtime: text("runtime").notNull(),
		model: text("model").notNull(),
		actor: text("actor").notNull(),
		status: text("status", {
			enum: ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"],
		}).notNull(),
		error: jsonb("error").$type<{ message: string }>(),
		usage: jsonb("usage").$type<Record<string, number>>(),
		createdAt: createdAt(),
		startedAt: timestamp("started_at", { withTimezone: true }),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(table) => [
		foreignKey({ columns: [table.retryOf], foreignColumns: [table.id] }),
		index("runs_thread_idx").on(table.threadId),
		uniqueIndex("runs_one_active_per_thread").on(table.threadId).where(sql`${table.status} IN ('queued','running')`),
		check(
			"runs_status_check",
			sql`${table.status} IN ('queued','running','succeeded','failed','cancelled','interrupted')`,
		),
	],
);

export const threadMessages = pgTable(
	"thread_messages",
	{
		id: uuid("id").primaryKey(),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => threads.id),
		seq: bigint("seq", { mode: "number" }).notNull(),
		author: text("author").notNull(),
		runId: uuid("run_id").references(() => runs.id),
		body: text("body").notNull(),
		createdAt: createdAt(),
	},
	(table) => [unique("thread_messages_thread_seq_unique").on(table.threadId, table.seq)],
);

export const runEvents = pgTable(
	"run_events",
	{
		runId: uuid("run_id")
			.notNull()
			.references(() => runs.id),
		seq: integer("seq").notNull(),
		type: text("type").notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		createdAt: createdAt(),
	},
	(table) => [primaryKey({ columns: [table.runId, table.seq] })],
);
