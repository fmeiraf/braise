CREATE TABLE "assumptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"objective_id" uuid,
	"statement" text NOT NULL,
	"impact" text DEFAULT 'medium' NOT NULL,
	"confidence" smallint DEFAULT 1 NOT NULL,
	"function" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "assumptions_impact_check" CHECK ("assumptions"."impact" IN ('low','medium','high')),
	CONSTRAINT "assumptions_confidence_check" CHECK ("assumptions"."confidence" BETWEEN 0 AND 4),
	CONSTRAINT "assumptions_function_check" CHECK ("assumptions"."function" IN ('product','design','engineering','marketing','sales','ops')),
	CONSTRAINT "assumptions_status_check" CHECK ("assumptions"."status" IN ('open','holds','false','dropped'))
);
--> statement-breakpoint
CREATE TABLE "learnings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"bet_id" uuid NOT NULL,
	"assumption_id" uuid NOT NULL,
	"result" text NOT NULL,
	"cause" text,
	"statement" text NOT NULL,
	"value" double precision,
	"confidence_from" smallint NOT NULL,
	"confidence_to" smallint NOT NULL,
	"function" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learnings_bet_id_unique" UNIQUE("bet_id"),
	CONSTRAINT "learnings_result_check" CHECK ("learnings"."result" IN ('pass','fail','inconclusive')),
	CONSTRAINT "learnings_cause_check" CHECK (("learnings"."result" = 'fail') = ("learnings"."cause" IS NOT NULL)),
	CONSTRAINT "learnings_function_check" CHECK ("learnings"."function" IN ('product','design','engineering','marketing','sales','ops'))
);
--> statement-breakpoint
CREATE TABLE "objectives" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"statement" text NOT NULL,
	"measure" text,
	"unit" text DEFAULT '' NOT NULL,
	"baseline" double precision,
	"target" double precision,
	"decision" text,
	"done_rule" text,
	"done_list" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"by_date" date,
	"guardrails" text DEFAULT '' NOT NULL,
	"budget" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "objectives_kind_check" CHECK ("objectives"."kind" IN ('metric','learning','build')),
	CONSTRAINT "objectives_status_check" CHECK ("objectives"."status" IN ('active','met','dropped'))
);
--> statement-breakpoint
CREATE TABLE "readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"value" double precision NOT NULL,
	"taken_on" date NOT NULL,
	"source" text NOT NULL,
	"entered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "readings_subject_type_check" CHECK ("readings"."subject_type" IN ('objective','bet'))
);
--> statement-breakpoint
INSERT INTO "objectives" ("id", "venture_id", "kind", "statement", "done_list", "by_date", "status", "created_at", "updated_at", "archived_at")
SELECT "id", "venture_id", 'build', "outcome",
	jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'text', "signal", 'done', false)),
	"horizon", 'active', "created_at", "updated_at", "archived_at"
FROM "goals";--> statement-breakpoint
INSERT INTO "assumptions" ("id", "venture_id", "objective_id", "statement", "impact", "confidence", "function", "status", "created_by", "created_at", "updated_at", "archived_at")
SELECT "id", "venture_id", NULL, "hypothesis", 'medium',
	CASE WHEN "status" = 'lost' THEN 0 ELSE 1 END,
	'product',
	CASE "status" WHEN 'won' THEN 'holds' WHEN 'lost' THEN 'false' WHEN 'killed' THEN 'dropped' ELSE 'open' END,
	coalesce((SELECT e."actor" FROM "events" e WHERE e."venture_id" = "bets"."venture_id" AND e."type" = 'bet.created' AND e."subject" = 'bet:' || "bets"."id" LIMIT 1), 'owner'),
	"created_at", "updated_at", "archived_at"
FROM "bets";--> statement-breakpoint
ALTER TABLE "thread_links" DROP CONSTRAINT "thread_links_subject_type_check";--> statement-breakpoint
UPDATE "thread_links" SET "subject_type" = CASE "subject_type" WHEN 'goal' THEN 'objective' ELSE 'assumption' END WHERE "subject_type" IN ('goal','bet');--> statement-breakpoint
UPDATE "proposals" SET "status" = 'rejected', "decided_at" = now(), "note" = 'Closed by braise: written for the bets and goals model that the strategy loop replaced.' WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "bet_id" uuid;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "objective_id" uuid;--> statement-breakpoint
UPDATE "work_items" SET "objective_id" = "goal_id";--> statement-breakpoint
DROP TABLE "goals" CASCADE;--> statement-breakpoint
DELETE FROM "bets";--> statement-breakpoint
ALTER TABLE "bets" DROP CONSTRAINT "bets_status_check";--> statement-breakpoint
ALTER TABLE "bets" DROP CONSTRAINT "bets_introduced_in_strategy_versions_id_fk";
--> statement-breakpoint
DROP INDEX "work_items_goal_idx";--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "assumption_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "function" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "signal" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "unit" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "baseline" double precision;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "pass_at" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "fail_at" double precision NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "method" text NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "budget" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "deadline" date NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assumptions" ADD CONSTRAINT "assumptions_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learnings" ADD CONSTRAINT "learnings_assumption_id_assumptions_id_fk" FOREIGN KEY ("assumption_id") REFERENCES "public"."assumptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "readings" ADD CONSTRAINT "readings_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assumptions_venture_idx" ON "assumptions" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "assumptions_objective_idx" ON "assumptions" USING btree ("objective_id");--> statement-breakpoint
CREATE INDEX "learnings_venture_idx" ON "learnings" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "learnings_assumption_idx" ON "learnings" USING btree ("assumption_id");--> statement-breakpoint
CREATE INDEX "objectives_venture_idx" ON "objectives" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "readings_subject_idx" ON "readings" USING btree ("subject_type","subject_id","taken_on");--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_assumption_id_assumptions_id_fk" FOREIGN KEY ("assumption_id") REFERENCES "public"."assumptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_objective_id_objectives_id_fk" FOREIGN KEY ("objective_id") REFERENCES "public"."objectives"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bets_assumption_idx" ON "bets" USING btree ("assumption_id");--> statement-breakpoint
CREATE INDEX "work_items_bet_idx" ON "work_items" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX "work_items_objective_idx" ON "work_items" USING btree ("objective_id");--> statement-breakpoint
ALTER TABLE "bets" DROP COLUMN "hypothesis";--> statement-breakpoint
ALTER TABLE "bets" DROP COLUMN "kill_criteria";--> statement-breakpoint
ALTER TABLE "bets" DROP COLUMN "introduced_in";--> statement-breakpoint
ALTER TABLE "work_items" DROP COLUMN "goal_id";--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_function_check" CHECK ("bets"."function" IN ('product','design','engineering','marketing','sales','ops'));--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_method_check" CHECK ("bets"."method" IN ('existing_data','interviews','fake_door','concierge','before_after','staggered_rollout','ab_test'));--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_marks_check" CHECK ("bets"."pass_at" <> "bets"."fail_at");--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_status_check" CHECK ("bets"."status" IN ('open','closed'));--> statement-breakpoint
ALTER TABLE "thread_links" ADD CONSTRAINT "thread_links_subject_type_check" CHECK ("thread_links"."subject_type" IN ('work_item','bet','assumption','objective','venture'));--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_home_check" CHECK ("work_items"."bet_id" IS NULL OR "work_items"."objective_id" IS NULL);--> statement-breakpoint
GRANT SELECT ON "objectives", "assumptions", "learnings", "readings" TO braise_agent_reader;
