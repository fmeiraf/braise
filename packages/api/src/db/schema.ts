import type { AppliedChange, DoneItem, ProposalChange } from "@braise/core";
import { sql } from "drizzle-orm";
import {
	bigint,
	check,
	date,
	doublePrecision,
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

const functions = ["product", "design", "engineering", "marketing", "sales", "ops"] as const;

const functionCheck = (column: unknown) =>
	sql`${column} IN ('product','design','engineering','marketing','sales','ops')`;

export const objectives = pgTable(
	"objectives",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		kind: text("kind", { enum: ["metric", "learning", "build"] }).notNull(),
		statement: text("statement").notNull(),
		measure: text("measure"),
		unit: text("unit").notNull().default(""),
		baseline: doublePrecision("baseline"),
		target: doublePrecision("target"),
		decision: text("decision"),
		doneRule: text("done_rule"),
		doneList: jsonb("done_list").$type<DoneItem[]>().notNull().default([]),
		byDate: date("by_date", { mode: "string" }),
		guardrails: text("guardrails").notNull().default(""),
		budget: text("budget").notNull().default(""),
		status: text("status", { enum: ["active", "met", "dropped"] })
			.notNull()
			.default("active"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		archivedAt: archivedAt(),
	},
	(table) => [
		index("objectives_venture_idx").on(table.ventureId),
		check("objectives_kind_check", sql`${table.kind} IN ('metric','learning','build')`),
		check("objectives_status_check", sql`${table.status} IN ('active','met','dropped')`),
	],
);

export const assumptions = pgTable(
	"assumptions",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		objectiveId: uuid("objective_id").references(() => objectives.id),
		statement: text("statement").notNull(),
		impact: text("impact", { enum: ["low", "medium", "high"] })
			.notNull()
			.default("medium"),
		confidence: smallint("confidence").notNull().default(1),
		function: text("function", { enum: functions }).notNull(),
		status: text("status", { enum: ["open", "holds", "false", "dropped"] })
			.notNull()
			.default("open"),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		archivedAt: archivedAt(),
	},
	(table) => [
		index("assumptions_venture_idx").on(table.ventureId),
		index("assumptions_objective_idx").on(table.objectiveId),
		check("assumptions_impact_check", sql`${table.impact} IN ('low','medium','high')`),
		check("assumptions_confidence_check", sql`${table.confidence} BETWEEN 0 AND 4`),
		check("assumptions_function_check", functionCheck(table.function)),
		check("assumptions_status_check", sql`${table.status} IN ('open','holds','false','dropped')`),
	],
);

const methods = [
	"existing_data",
	"interviews",
	"fake_door",
	"concierge",
	"before_after",
	"staggered_rollout",
	"ab_test",
] as const;

export const bets = pgTable(
	"bets",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		assumptionId: uuid("assumption_id")
			.notNull()
			.references(() => assumptions.id),
		function: text("function", { enum: functions }).notNull(),
		action: text("action").notNull(),
		signal: text("signal").notNull(),
		unit: text("unit").notNull().default(""),
		baseline: doublePrecision("baseline"),
		passAt: doublePrecision("pass_at").notNull(),
		failAt: doublePrecision("fail_at").notNull(),
		method: text("method", { enum: methods }).notNull(),
		budget: text("budget").notNull().default(""),
		deadline: date("deadline", { mode: "string" }).notNull(),
		status: text("status", { enum: ["open", "closed"] })
			.notNull()
			.default("open"),
		createdAt: createdAt(),
		updatedAt: updatedAt(),
		closedAt: timestamp("closed_at", { withTimezone: true }),
		archivedAt: archivedAt(),
	},
	(table) => [
		index("bets_venture_idx").on(table.ventureId),
		index("bets_assumption_idx").on(table.assumptionId),
		check("bets_status_check", sql`${table.status} IN ('open','closed')`),
		check("bets_function_check", functionCheck(table.function)),
		check(
			"bets_method_check",
			sql`${table.method} IN ('existing_data','interviews','fake_door','concierge','before_after','staggered_rollout','ab_test')`,
		),
		check("bets_marks_check", sql`${table.passAt} <> ${table.failAt}`),
	],
);

export const learnings = pgTable(
	"learnings",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		betId: uuid("bet_id")
			.notNull()
			.unique()
			.references(() => bets.id),
		assumptionId: uuid("assumption_id")
			.notNull()
			.references(() => assumptions.id),
		result: text("result", { enum: ["pass", "fail", "inconclusive"] }).notNull(),
		cause: text("cause", { enum: ["idea", "execution"] }),
		statement: text("statement").notNull(),
		value: doublePrecision("value"),
		confidenceFrom: smallint("confidence_from").notNull(),
		confidenceTo: smallint("confidence_to").notNull(),
		function: text("function", { enum: functions }).notNull(),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		index("learnings_venture_idx").on(table.ventureId),
		index("learnings_assumption_idx").on(table.assumptionId),
		check("learnings_result_check", sql`${table.result} IN ('pass','fail','inconclusive')`),
		check("learnings_cause_check", sql`(${table.result} = 'fail') = (${table.cause} IS NOT NULL)`),
		check("learnings_function_check", functionCheck(table.function)),
	],
);

export const readings = pgTable(
	"readings",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		subjectType: text("subject_type", { enum: ["objective", "bet"] }).notNull(),
		subjectId: uuid("subject_id").notNull(),
		value: doublePrecision("value").notNull(),
		takenOn: date("taken_on", { mode: "string" }).notNull(),
		source: text("source").notNull(),
		enteredBy: text("entered_by").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		index("readings_subject_idx").on(table.subjectType, table.subjectId, table.takenOn),
		check("readings_subject_type_check", sql`${table.subjectType} IN ('objective','bet')`),
	],
);

export const workItems = pgTable(
	"work_items",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		betId: uuid("bet_id").references(() => bets.id),
		objectiveId: uuid("objective_id").references(() => objectives.id),
		parentId: uuid("parent_id"),
		depth: smallint("depth").notNull(),
		position: integer("position").notNull(),
		title: text("title").notNull(),
		description: text("description").notNull().default(""),
		status: text("status", { enum: ["todo", "doing", "done"] })
			.notNull()
			.default("todo"),
		function: text("function", { enum: functions }).notNull(),
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
		index("work_items_bet_idx").on(table.betId),
		index("work_items_objective_idx").on(table.objectiveId),
		index("work_items_parent_idx").on(table.parentId),
		check("work_items_depth_check", sql`${table.depth} BETWEEN 0 AND 2`),
		check("work_items_status_check", sql`${table.status} IN ('todo','doing','done')`),
		check("work_items_function_check", functionCheck(table.function)),
		check("work_items_priority_check", sql`${table.priority} IN ('none','low','medium','high','urgent')`),
		check("work_items_home_check", sql`${table.betId} IS NULL OR ${table.objectiveId} IS NULL`),
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

export const agentProfiles = pgTable("agent_profiles", {
	id: text("id").primaryKey(),
	actor: text("actor").notNull().unique(),
	name: text("name").notNull(),
	runtime: text("runtime").notNull(),
	model: text("model").notNull(),
	createdAt: createdAt(),
});

export const threads = pgTable(
	"threads",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id").references(() => ventures.id),
		agentProfileId: text("agent_profile_id")
			.notNull()
			.default("claude")
			.references(() => agentProfiles.id),
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
		subjectType: text("subject_type", {
			enum: ["work_item", "bet", "assumption", "objective", "venture"],
		}).notNull(),
		subjectId: uuid("subject_id").notNull(),
		createdBy: text("created_by").notNull(),
		createdAt: createdAt(),
	},
	(table) => [
		primaryKey({ columns: [table.threadId, table.subjectType, table.subjectId] }),
		index("thread_links_subject_idx").on(table.subjectType, table.subjectId),
		check(
			"thread_links_subject_type_check",
			sql`${table.subjectType} IN ('work_item','bet','assumption','objective','venture')`,
		),
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
		cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
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

export const proposals = pgTable(
	"proposals",
	{
		id: uuid("id").primaryKey(),
		ventureId: uuid("venture_id")
			.notNull()
			.references(() => ventures.id),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => threads.id),
		runId: uuid("run_id")
			.notNull()
			.references(() => runs.id),
		createdBy: text("created_by").notNull(),
		title: text("title").notNull(),
		reason: text("reason").notNull(),
		changes: jsonb("changes").$type<ProposalChange[]>().notNull(),
		status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull(),
		applied: jsonb("applied").$type<(AppliedChange | null)[]>(),
		note: text("note"),
		createdAt: createdAt(),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
	},
	(table) => [
		index("proposals_status_created_idx").on(table.status, table.createdAt),
		index("proposals_venture_idx").on(table.ventureId),
		index("proposals_thread_idx").on(table.threadId),
		check("proposals_status_check", sql`${table.status} IN ('pending','approved','rejected')`),
	],
);

const capabilityCheck = (column: unknown) => sql`${column} IN ('work','links','propose')`;

export const accessRequests = pgTable(
	"access_requests",
	{
		id: uuid("id").primaryKey(),
		profileId: text("profile_id")
			.notNull()
			.references(() => agentProfiles.id),
		capability: text("capability", { enum: ["work", "links", "propose"] }).notNull(),
		threadId: uuid("thread_id")
			.notNull()
			.references(() => threads.id),
		runId: uuid("run_id")
			.notNull()
			.references(() => runs.id),
		ventureId: uuid("venture_id").references(() => ventures.id),
		command: text("command").notNull(),
		payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
		attempts: integer("attempts").notNull().default(1),
		status: text("status", { enum: ["pending", "approved", "denied"] }).notNull(),
		note: text("note"),
		createdAt: createdAt(),
		decidedAt: timestamp("decided_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("access_requests_one_pending")
			.on(table.profileId, table.capability)
			.where(sql`${table.status} = 'pending'`),
		index("access_requests_status_created_idx").on(table.status, table.createdAt),
		check("access_requests_capability_check", capabilityCheck(table.capability)),
		check("access_requests_status_check", sql`${table.status} IN ('pending','approved','denied')`),
	],
);

export const agentGrants = pgTable(
	"agent_grants",
	{
		id: uuid("id").primaryKey(),
		profileId: text("profile_id")
			.notNull()
			.references(() => agentProfiles.id),
		capability: text("capability", { enum: ["work", "links", "propose"] }).notNull(),
		grantedBy: text("granted_by").notNull(),
		grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
		accessRequestId: uuid("access_request_id").references(() => accessRequests.id),
		revokedBy: text("revoked_by"),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("agent_grants_one_active")
			.on(table.profileId, table.capability)
			.where(sql`${table.revokedAt} IS NULL`),
		check("agent_grants_capability_check", capabilityCheck(table.capability)),
	],
);
