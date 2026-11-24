ALTER TABLE "runs" ADD CONSTRAINT "runs_message_id_thread_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."thread_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'braise_agent_reader') THEN
		CREATE ROLE braise_agent_reader NOLOGIN;
	END IF;
END
$$;--> statement-breakpoint
GRANT braise_agent_reader TO CURRENT_USER;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO braise_agent_reader;--> statement-breakpoint
GRANT SELECT ON "ventures", "strategy_versions", "bets", "goals", "work_items", "events", "threads", "thread_links", "thread_messages", "runs", "run_events" TO braise_agent_reader;
