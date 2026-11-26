CREATE TABLE "input_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	CONSTRAINT "input_requests_status_check" CHECK ("input_requests"."status" IN ('pending','answered'))
);
--> statement-breakpoint
CREATE TABLE "limit_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runtime" text NOT NULL,
	"window" text NOT NULL,
	"status" text NOT NULL,
	"utilization" double precision,
	"resets_at" timestamp with time zone,
	"run_id" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "limit_readings_runtime_check" CHECK ("limit_readings"."runtime" IN ('claude-agent-sdk','pi')),
	CONSTRAINT "limit_readings_status_check" CHECK ("limit_readings"."status" IN ('allowed','warning','rejected')),
	CONSTRAINT "limit_readings_utilization_check" CHECK ("limit_readings"."utilization" BETWEEN 0 AND 1)
);
--> statement-breakpoint
CREATE TABLE "runtime_pauses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"runtime" text NOT NULL,
	"reason" text NOT NULL,
	"until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	CONSTRAINT "runtime_pauses_runtime_check" CHECK ("runtime_pauses"."runtime" IN ('claude-agent-sdk','pi')),
	CONSTRAINT "runtime_pauses_reason_check" CHECK ("runtime_pauses"."reason" IN ('limit','owner'))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid,
	"title" text NOT NULL,
	"goal" text,
	"agent_profile_id" text NOT NULL,
	"chat_thread_id" uuid NOT NULL,
	"wakes_since_owner" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "spaces_chat_thread_id_unique" UNIQUE("chat_thread_id")
);
--> statement-breakpoint
ALTER TABLE "access_requests" DROP CONSTRAINT "access_requests_capability_check";--> statement-breakpoint
ALTER TABLE "agent_grants" DROP CONSTRAINT "agent_grants_capability_check";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "first_token_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "space_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "started_by_run_id" uuid;--> statement-breakpoint
ALTER TABLE "input_requests" ADD CONSTRAINT "input_requests_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_requests" ADD CONSTRAINT "input_requests_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limit_readings" ADD CONSTRAINT "limit_readings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_chat_thread_id_threads_id_fk" FOREIGN KEY ("chat_thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "input_requests_one_pending" ON "input_requests" USING btree ("thread_id") WHERE "input_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "input_requests_status_created_idx" ON "input_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "input_requests_run_idx" ON "input_requests" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "limit_readings_runtime_observed_idx" ON "limit_readings" USING btree ("runtime","window","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_pauses_one_open" ON "runtime_pauses" USING btree ("runtime") WHERE "runtime_pauses"."lifted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "spaces_venture_updated_idx" ON "spaces" USING btree ("venture_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_started_by_run_id_runs_id_fk" FOREIGN KEY ("started_by_run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_retry_of_idx" ON "runs" USING btree ("retry_of");--> statement-breakpoint
CREATE INDEX "runs_runtime_created_idx" ON "runs" USING btree ("runtime","created_at");--> statement-breakpoint
CREATE INDEX "threads_space_idx" ON "threads" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "threads_started_by_run_idx" ON "threads" USING btree ("started_by_run_id");--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_capability_check" CHECK ("access_requests"."capability" IN ('work','links','propose','delegate'));--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_capability_check" CHECK ("agent_grants"."capability" IN ('work','links','propose','delegate'));--> statement-breakpoint
INSERT INTO "agent_grants" ("id", "profile_id", "capability", "granted_by") VALUES
	(gen_random_uuid(), 'claude', 'delegate', 'braise');--> statement-breakpoint
GRANT SELECT ON "spaces" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "input_requests" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "limit_readings" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "runtime_pauses" TO braise_agent_reader;
