CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"hypothesis" text NOT NULL,
	"action" text NOT NULL,
	"kill_criteria" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"introduced_in" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "bets_status_check" CHECK ("bets"."status" IN ('open','won','lost','killed'))
);
--> statement-breakpoint
CREATE TABLE "commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"name" text NOT NULL,
	"venture_id" uuid,
	"actor" text NOT NULL,
	"reason" text,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commands_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"venture_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"command_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_venture_id_seq_pk" PRIMARY KEY("venture_id","seq")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"bet_id" uuid,
	"outcome" text NOT NULL,
	"signal" text NOT NULL,
	"horizon" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "strategy_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"why" text NOT NULL,
	"what" text NOT NULL,
	"diagnosis" text DEFAULT '' NOT NULL,
	"guiding_policy" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "strategy_versions_venture_version_unique" UNIQUE("venture_id","version"),
	CONSTRAINT "strategy_versions_status_check" CHECK ("strategy_versions"."status" IN ('draft','active','superseded'))
);
--> statement-breakpoint
CREATE TABLE "ventures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "ventures_slug_unique" UNIQUE("slug"),
	CONSTRAINT "ventures_kind_check" CHECK ("ventures"."kind" IN ('for_profit','non_profit'))
);
--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_introduced_in_strategy_versions_id_fk" FOREIGN KEY ("introduced_in") REFERENCES "public"."strategy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_command_id_commands_id_fk" FOREIGN KEY ("command_id") REFERENCES "public"."commands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategy_versions" ADD CONSTRAINT "strategy_versions_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bets_venture_idx" ON "bets" USING btree ("venture_id");--> statement-breakpoint
CREATE INDEX "goals_venture_idx" ON "goals" USING btree ("venture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "strategy_versions_one_active" ON "strategy_versions" USING btree ("venture_id") WHERE "strategy_versions"."status" = 'active';