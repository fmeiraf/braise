ALTER TABLE "proposals" DROP CONSTRAINT "proposals_status_check";--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "operator_venture_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_operator_venture_id_ventures_id_fk" FOREIGN KEY ("operator_venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_one_draft" ON "proposals" USING btree ("venture_id") WHERE "proposals"."status" = 'drafting';--> statement-breakpoint
CREATE UNIQUE INDEX "threads_one_open_operator_session" ON "threads" USING btree ("operator_venture_id") WHERE "threads"."operator_venture_id" IS NOT NULL AND "threads"."archived_at" IS NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_status_check" CHECK ("proposals"."status" IN ('pending','approved','rejected','drafting'));