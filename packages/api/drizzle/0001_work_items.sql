CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"parent_id" uuid,
	"depth" smallint NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"function" text NOT NULL,
	"priority" text DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "work_items_depth_check" CHECK ("work_items"."depth" BETWEEN 0 AND 2),
	CONSTRAINT "work_items_status_check" CHECK ("work_items"."status" IN ('todo','doing','done')),
	CONSTRAINT "work_items_function_check" CHECK ("work_items"."function" IN ('product','design','engineering','marketing','sales','ops')),
	CONSTRAINT "work_items_priority_check" CHECK ("work_items"."priority" IN ('none','low','medium','high','urgent'))
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_id_work_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_items_venture_idx" ON "work_items" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "work_items_goal_idx" ON "work_items" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "work_items_parent_idx" ON "work_items" USING btree ("parent_id");