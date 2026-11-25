CREATE TABLE "access_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"capability" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"venture_id" uuid,
	"command" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "access_requests_capability_check" CHECK ("access_requests"."capability" IN ('work','links','propose')),
	CONSTRAINT "access_requests_status_check" CHECK ("access_requests"."status" IN ('pending','approved','denied'))
);
--> statement-breakpoint
CREATE TABLE "agent_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"capability" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"access_request_id" uuid,
	"revoked_by" text,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agent_grants_capability_check" CHECK ("agent_grants"."capability" IN ('work','links','propose'))
);
--> statement-breakpoint
CREATE TABLE "agent_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"name" text NOT NULL,
	"runtime" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_profiles_actor_unique" UNIQUE("actor")
);
--> statement-breakpoint
INSERT INTO "agent_profiles" ("id", "actor", "name", "runtime", "model") VALUES
	('claude', 'agent:claude', 'Claude', 'claude-agent-sdk', 'claude-opus-5-5'),
	('gpt', 'agent:gpt', 'GPT', 'pi', 'gpt-6.2-sol');--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "agent_profile_id" text DEFAULT 'claude' NOT NULL;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_profile_id_agent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_profile_id_agent_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_access_request_id_access_requests_id_fk" FOREIGN KEY ("access_request_id") REFERENCES "public"."access_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_one_pending" ON "access_requests" USING btree ("profile_id","capability") WHERE "access_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "access_requests_status_created_idx" ON "access_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_grants_one_active" ON "agent_grants" USING btree ("profile_id","capability") WHERE "agent_grants"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_agent_profile_id_agent_profiles_id_fk" FOREIGN KEY ("agent_profile_id") REFERENCES "public"."agent_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
INSERT INTO "agent_grants" ("id", "profile_id", "capability", "granted_by") VALUES
	(gen_random_uuid(), 'claude', 'work', 'braise'),
	(gen_random_uuid(), 'claude', 'links', 'braise'),
	(gen_random_uuid(), 'claude', 'propose', 'braise');--> statement-breakpoint
GRANT SELECT ON "agent_profiles" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "agent_grants" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "access_requests" TO braise_agent_reader;
