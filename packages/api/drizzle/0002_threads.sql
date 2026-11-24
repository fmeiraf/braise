CREATE TABLE "run_events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"retry_of" uuid,
	"runtime" text NOT NULL,
	"model" text NOT NULL,
	"actor" text NOT NULL,
	"status" text NOT NULL,
	"error" jsonb,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" IN ('queued','running','succeeded','failed','cancelled','interrupted'))
);
--> statement-breakpoint
CREATE TABLE "thread_links" (
	"thread_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_links_thread_id_subject_type_subject_id_pk" PRIMARY KEY("thread_id","subject_type","subject_id"),
	CONSTRAINT "thread_links_subject_type_check" CHECK ("thread_links"."subject_type" IN ('work_item','goal','bet','venture'))
);
--> statement-breakpoint
CREATE TABLE "thread_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"author" text NOT NULL,
	"run_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "thread_messages_thread_seq_unique" UNIQUE("thread_id","seq")
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid,
	"title" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "commands" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_retry_of_runs_id_fk" FOREIGN KEY ("retry_of") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_links" ADD CONSTRAINT "thread_links_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD CONSTRAINT "thread_messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_thread_idx" ON "runs" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_thread" ON "runs" USING btree ("thread_id") WHERE "runs"."status" IN ('queued','running');--> statement-breakpoint
CREATE INDEX "thread_links_subject_idx" ON "thread_links" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "threads_venture_updated_idx" ON "threads" USING btree ("venture_id","updated_at" DESC NULLS LAST);