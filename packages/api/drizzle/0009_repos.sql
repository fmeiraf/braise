CREATE TABLE "checkouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"dir" text NOT NULL,
	"branch" text NOT NULL,
	"base_sha" text NOT NULL,
	"checkpoint_sha" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "github_app" (
	"id" bigint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"owner_login" text NOT NULL,
	"html_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"run_id" uuid,
	"number" integer NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"branch" text NOT NULL,
	"state" text NOT NULL,
	"head_sha" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_requests_repo_number_unique" UNIQUE("repo_id","number"),
	CONSTRAINT "pull_requests_state_check" CHECK ("pull_requests"."state" IN ('open','closed','merged'))
);
--> statement-breakpoint
CREATE TABLE "venture_repos" (
	"id" uuid PRIMARY KEY NOT NULL,
	"venture_id" uuid NOT NULL,
	"github_repo_id" bigint NOT NULL,
	"installation_id" bigint NOT NULL,
	"full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"mirror_head_sha" text,
	"fetched_at" timestamp with time zone,
	"allowed_domains" text[] DEFAULT '{}'::text[] NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "venture_repos_status_check" CHECK ("venture_repos"."status" IN ('cloning','ready','failed','no_access'))
);
--> statement-breakpoint
ALTER TABLE "access_requests" DROP CONSTRAINT "access_requests_capability_check";--> statement-breakpoint
ALTER TABLE "agent_grants" DROP CONSTRAINT "agent_grants_capability_check";--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkouts" ADD CONSTRAINT "checkouts_repo_id_venture_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."venture_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repo_id_venture_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."venture_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venture_repos" ADD CONSTRAINT "venture_repos_venture_id_ventures_id_fk" FOREIGN KEY ("venture_id") REFERENCES "public"."ventures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "checkouts_one_live" ON "checkouts" USING btree ("thread_id","repo_id") WHERE "checkouts"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "checkouts_repo_idx" ON "checkouts" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "pull_requests_thread_idx" ON "pull_requests" USING btree ("thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venture_repos_one_live" ON "venture_repos" USING btree ("github_repo_id") WHERE "venture_repos"."removed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "venture_repos_venture_idx" ON "venture_repos" USING btree ("venture_id");--> statement-breakpoint
ALTER TABLE "access_requests" ADD CONSTRAINT "access_requests_capability_check" CHECK ("access_requests"."capability" IN ('work','links','propose','delegate','code'));--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_capability_check" CHECK ("agent_grants"."capability" IN ('work','links','propose','delegate','code'));--> statement-breakpoint
GRANT SELECT ON "github_app" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "venture_repos" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "checkouts" TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "pull_requests" TO braise_agent_reader;
