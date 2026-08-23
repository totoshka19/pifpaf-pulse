CREATE TABLE "apify_usage" (
	"period" text PRIMARY KEY NOT NULL,
	"results" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_apify_usage_period" CHECK ("apify_usage"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "ck_apify_usage_results" CHECK ("apify_usage"."results" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reel_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reel_id" uuid NOT NULL,
	"views" bigint,
	"plays" bigint,
	"likes" bigint,
	"comments" bigint,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_snapshots_non_negative" CHECK (("reel_snapshots"."views" IS NULL OR "reel_snapshots"."views" >= 0)
      AND ("reel_snapshots"."plays" IS NULL OR "reel_snapshots"."plays" >= 0)
      AND ("reel_snapshots"."likes" IS NULL OR "reel_snapshots"."likes" >= 0)
      AND ("reel_snapshots"."comments" IS NULL OR "reel_snapshots"."comments" >= 0))
);
--> statement-breakpoint
CREATE TABLE "reel_thumbnails" (
	"reel_id" uuid PRIMARY KEY NOT NULL,
	"data" "bytea" NOT NULL,
	"mime" text DEFAULT 'image/webp' NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shortcode" text NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"owner_username" text,
	"thumbnail_src" text,
	"posted_at" timestamp with time zone,
	"duration_sec" numeric(6, 2),
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"sync_error" text,
	"last_synced_at" timestamp with time zone,
	"next_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reels_sync_status" CHECK ("reels"."sync_status" IN ('pending', 'ok', 'failed', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"reel_id" uuid,
	"apify_run_id" text,
	"status" text NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ck_sync_runs_status" CHECK ("sync_runs"."status" IN ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"instagram_handle" text,
	"avatar_url" text,
	"role" text DEFAULT 'blogger' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "ck_users_role" CHECK ("users"."role" IN ('blogger', 'admin'))
);
--> statement-breakpoint
ALTER TABLE "reel_snapshots" ADD CONSTRAINT "reel_snapshots_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reel_thumbnails" ADD CONSTRAINT "reel_thumbnails_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reels" ADD CONSTRAINT "reels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_reel_id_reels_id_fk" FOREIGN KEY ("reel_id") REFERENCES "public"."reels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_snapshots_reel_ts" ON "reel_snapshots" USING btree ("reel_id","captured_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reels_user_shortcode" ON "reels" USING btree ("user_id","shortcode");--> statement-breakpoint
CREATE INDEX "idx_reels_user" ON "reels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reels_due" ON "reels" USING btree ("next_sync_at") WHERE sync_status <> 'unavailable';