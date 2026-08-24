ALTER TABLE "sync_runs" DROP CONSTRAINT "sync_runs_reel_id_reels_id_fk";
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "shortcode" text;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "triggered_by" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sync_runs_pair" ON "sync_runs" USING btree ("user_id","shortcode","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_sync_runs_user_ts" ON "sync_runs" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_sync_runs_running" ON "sync_runs" USING btree ("apify_run_id") WHERE status = 'running';--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "ck_sync_runs_triggered_by" CHECK ("sync_runs"."triggered_by" IN ('manual', 'cron'));