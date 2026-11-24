CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"reason" text NOT NULL,
	"changes" jsonb NOT NULL,
	"status" text NOT NULL,
	"applied" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "proposals_status_check" CHECK ("proposals"."status" IN ('pending','approved','rejected'))
);
--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_status_created_idx" ON "proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "proposals_venture_idx" ON "proposals" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "proposals_thread_idx" ON "proposals" USING btree ("thread_id");--> statement-breakpoint
GRANT SELECT ON "proposals" TO braise_agent_reader;
