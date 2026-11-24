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
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.ventureId, table.seq] }),
		foreignKey({ columns: [table.ventureId], foreignColumns: [ventures.id] }),
		foreignKey({ columns: [table.commandId], foreignColumns: [commands.id] }),
	],
);
